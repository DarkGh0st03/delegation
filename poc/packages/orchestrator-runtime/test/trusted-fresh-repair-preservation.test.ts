import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TrustedFreshWorkDecisionStore}
  from "../src/trusted-fresh-work-decision-store.ts";
import {TrustedPlanningReviewGate}
  from "../src/trusted-planning-review-gate.ts";
import {SignedEngineerApprovalFileStore}
  from "../src/signed-approval-store.ts";
import {verifySignedFreshRepairPreservation as verify}
  from "../src/trusted-fresh-repair-preservation.mjs";
import {verifyTrustedFreshRepairPostRun}
  from "../src/trusted-fresh-repair-post-run.mjs";
import {TrustedGiteaPriorDiffReader}
  from "../src/trusted-gitea-prior-diff-reader.ts";
import {TrustedApprovedExecutionPlans}
  from "../../../apps/gateway/src/approved-execution-plans.ts";
import {GatewayRuntime}
  from "../../../apps/gateway/src/runtime.ts";
import {createFreshTypecheckRepairIssueFence}
  from "../src/trusted-typecheck-repair-activation-fence.mjs";
import {makeApproval,planDigest}
  from "../../plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const root="gitea://gitea.local/thesis/iam-console-poc";
const oldSession="retired-incomplete",nextSession="fresh-approved";
const oldBranch="feature/retired",nextBranch="feature/fresh-repair";
const baseSha="a".repeat(40),oldHead="b".repeat(40);
const backend="apps/backend/src/users/user.service.ts";
const frontend="apps/frontend/src/pages/UserDetailPage.tsx";
const branchUri=root+"/branches/"+encodeURIComponent(nextBranch);
const uri=path=>branchUri+"/files/"+path;
const did="did:thesis:engineer";
const priorAudit=Object.freeze({
  status:"prior_work_audited",previous_session_id:oldSession,
  proposed_next_session_id:nextSession,
  previous_plan_digest:"c".repeat(64),
  previous_base_revision:baseSha,
  previous_branch:oldBranch,
  previous_feature_head_sha:oldHead,
  changed_files:Object.freeze([
    Object.freeze({path:backend,change:"modified"}),
    Object.freeze({path:frontend,change:"modified"})
  ]),planning_authorized:false,prior_changes_imported:false
});
function buildPlan({includeFrontend=true,splitRead=false,wrongRole=false}={}){
  const b=uri(backend),f=uri(frontend);
  const task=(id,agent_id,depends_on,resources)=>({
    id,agent_id,title:id,description:"Engineer reviewed "+id,depends_on,resources
  });
  const grant=(id,task_id,agent_id,operation,resource)=>({
    id,task_id,agent_id,operation,resource,
    reason:"Engineer independently approved "+operation
  });
  const frontendTask=includeFrontend?[
    task("frontend","frontend",["backend"],[f])]:[];
  const frontendGrants=includeFrontend?[
    grant("f-r","frontend","frontend","read_file",f),
    grant("f-u","frontend","frontend","update_file",f)]:[];
  const testDependency=includeFrontend?"frontend":"backend";
  const backendRead=splitRead?"other-backend":"backend";
  return {
    schema_version:"1.0.0",plan_id:"repair-all-prior-work",
    session_id:nextSession,version:1,
    repository:repo,base_revision:baseSha,
    requirement:"Rebuild previous valid changes and repair the compiler error",
    candidate_agents:["backend","frontend","test"].map(id=>({
      agent_id:id,did:"did:thesis:"+id,card_ref:"trusted:"+id
    })),
    tasks:[
      task("branch","orchestrator",[],[root]),
      task("backend","backend",["branch"],[b]),
      ...(splitRead?[task("other-backend","backend",["branch"],[b])]:[]),
      ...frontendTask,
      task("tests","test",[testDependency],[branchUri]),
      task("review","orchestrator",["tests"],[root])
    ],
    requested_permissions:[
      grant("new-branch","branch","orchestrator","create_branch",root),
      grant("b-r",backendRead,"backend","read_file",b),
      grant("b-u","backend",wrongRole?"frontend":"backend","update_file",b),
      ...frontendGrants,
      grant("run","tests","test","run_tests",branchUri),
      grant("pr","review","orchestrator","create_pull_request",root)
    ],assumptions:[],uncertainties:[]
  };
}
async function fixture(options={}){
  const p=buildPlan(options);
  const dir=await mkdtemp(join(tmpdir(),"fresh-preservation-r95-"));
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const signedApprovals=new SignedEngineerApprovalFileStore({
    directory:dir,engineerDid:did,
    trustedKeys:{engineer:{engineer_did:did,
      public_key_pem:publicKey.export({type:"spki",format:"pem"}).toString()}}
  });
  const approval=makeApproval(p,{
    allowedOperations:new Set(RUST_OPERATIONS),decision_id:"new-human-review",
    approved_by:did,
    approved_at:new Date(Date.now()-20000).toISOString(),
    approved_permission_ids:p.requested_permissions.map(x=>x.id)
  });
  const signed=signEngineerApproval({
    plan:p,approval,engineerDid:did,keyId:"engineer",
    privateKeyPem:privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    issuedAt:new Date(Date.now()-15000).toISOString(),
    expiresAt:new Date(Date.now()+20*60_000).toISOString()
  });
  await writeFile(join(dir,nextSession+".json"),JSON.stringify(signed),{mode:0o600});
  const snapshot={session_id:nextSession,repository:repo,base_revision:baseSha,
    directories:["","apps","apps/backend","apps/backend/src",
      "apps/backend/src/users","apps/frontend","apps/frontend/src",
      "apps/frontend/src/pages"],files:[backend,frontend]};
  const gate=new TrustedPlanningReviewGate({
    snapshot,expectedWorkBranch:nextBranch,authenticatedEngineerDid:did,
    signedApprovals,planningIsActive:()=>true
  });
  gate.stageTrustedProposal({
    status:"unapproved_proposal",verified_source_reads:2,
    digest:planDigest(p),plan:p
  });
  const decisionStore=new TrustedFreshWorkDecisionStore(dir);
  await decisionStore.recordDecision({
    audit:priorAudit,disposition:"start_from_pinned_main"
  });
  const input={
    priorAudit,decisionStore,reviewGate:gate,expectedNextSessionId:nextSession,
    expectedNewMainSha:baseSha,expectedOldFeatureSha:oldHead
  };
  const repairScope={
    approvalStore:signedApprovals,previousSessionId:oldSession,
    nextSessionId:nextSession,expectedFreshMainSha:baseSha,
    expectedRepository:repo,trustedDiagnosticPath:backend,
    ownerSelectedRole:"backend",previousApprovedBranch:oldBranch,
    nextApprovedBranch:nextBranch,
    nomination:{
      schema:"typecheck-repair-nomination-v1",
      status:"new_independent_engineer_review_required",
      diagnostic_files:1,backend_candidates:1,frontend_candidates:0,
      test_candidates:0,unresolved_files:0,outside_operational_scope:0,
      signed_task_review_required:true,permissions_issued:false,
      task_dispatched:false,retry_started:false
    }
  };
  return {input,repairScope,dir,
    close:()=>rm(dir,{force:true,recursive:true})};
}
test("R95 both earlier Backend and Frontend changes must be in fresh signed plan",async()=>{
  const f=await fixture();
  try{
    const r=await verify(f.input);
    assert.equal(r.changed_files,2);
    assert.equal(r.modified_file_reimplementations,2);
    assert.equal(r.old_source_imported,false);
    assert.equal(r.functional_equivalence_not_attested,true);
    assert.equal(r.tasks_dispatched,false);
    assert.doesNotMatch(JSON.stringify(r),/user.service|UserDetailPage|gitea:\/\//u);
  }finally{await f.close();}
});
test("R95 failed compiler file alone cannot silently discard valid Frontend change",async()=>{
  const f=await fixture({includeFrontend:false});
  try{await assert.rejects(()=>verify(f.input),/preservation/i);}
  finally{await f.close();}
});
test("R95 read and write on different signed Tasks do not count as preservation",async()=>{
  const f=await fixture({splitRead:true});
  try{await assert.rejects(()=>verify(f.input),/preservation/i);}
  finally{await f.close();}
});
test("R95 old head SHA and recorded owner disposition cannot be substituted",async()=>{
  const f=await fixture();
  try{
    await assert.rejects(()=>verify({
      ...f.input,expectedOldFeatureSha:"d".repeat(40)
    }),/preservation/i);
    await assert.rejects(()=>verify({
      ...f.input,expectedNewMainSha:"e".repeat(40)
    }),/preservation/i);
    await assert.rejects(()=>verify({
      ...f.input,priorAudit:{...priorAudit,
        changed_files:[{path:backend,change:"modified"}]}
    }),/decision|audited/i);
  }finally{await f.close();}
});
test("R95 previous deletion requires manual reconciliation; never silently import",async()=>{
  const f=await fixture();
  try{
    const changed={...priorAudit,
      changed_files:[
        ...priorAudit.changed_files,{path:"apps/backend/obsolete.ts",change:"deleted"}
      ]};
    await assert.rejects(()=>verify({...f.input,priorAudit:changed}),
      /audited|preservation|decision/i);
  }finally{await f.close();}
});

test("R95 admission fence checks all prior work before and after a fresh root",async()=>{
  const f=await fixture();
  try{
    const fence=createFreshTypecheckRepairIssueFence({
      repairScope:f.repairScope,reviewGate:f.input.reviewGate,
      preservation:{
        priorAudit:f.input.priorAudit,
        decisionStore:f.input.decisionStore,
        expectedOldFeatureSha:oldHead
      }
    });
    await fence.pinBeforeOperationalActivation();
    await fence.recheckAfterOperationalActivation();
    await assert.rejects(()=>fence.recheckAfterOperationalActivation(),
      /issue fence/i);
  }finally{await f.close();}
});
test("R95 cannot arm a Backend-only recovery while silently dropping valid Frontend changes",async()=>{
  const f=await fixture({includeFrontend:false});
  try{
    const fence=createFreshTypecheckRepairIssueFence({
      repairScope:f.repairScope,reviewGate:f.input.reviewGate,
      preservation:{
        priorAudit:f.input.priorAudit,
        decisionStore:f.input.decisionStore,
        expectedOldFeatureSha:oldHead
      }
    });
    await assert.rejects(()=>fence.pinBeforeOperationalActivation(),
      /preservation/i);
  }finally{await f.close();}
});
test("R95 cannot substitute a different old branch when arming new authority",async()=>{
  const f=await fixture();
  try{
    assert.throws(()=>createFreshTypecheckRepairIssueFence({
      repairScope:f.repairScope,reviewGate:f.input.reviewGate,
      preservation:{
        priorAudit:{...f.input.priorAudit,previous_branch:"feature/attacker"},
        decisionStore:f.input.decisionStore,
        expectedOldFeatureSha:oldHead
      }
    }),/issue fence/i);
  }finally{await f.close();}
});

async function simulateObservedPostRun(f,{paths=[backend,frontend],
  status="pass",revision="d".repeat(40)}={}){
  // R97 UNIT-ONLY fixture: all provider results are simulated, but they go
  // through real Gateway Prepare, VP/OPA checks, immutable provider records
  // and signed Task completion. Production requires REAL Gitea and Docker.
  const reader=new TrustedGiteaPriorDiffReader({
    baseUrl:"http://127.0.0.1:13377",token:"UNIT_TEST_TOKEN",repository:repo,
    fetchFn:async(url)=>{
      if(url.includes("/branches/"))
        return new Response(JSON.stringify({
          name:nextBranch,commit:{id:revision}
        }),{status:200,headers:{"content-type":"application/json"}});
      if(url.includes("/compare/"))
        return new Response(JSON.stringify({
          total_commits:1,commits:[{
            sha:revision,
            files:paths.map(path=>({filename:path,status:"modified"}))
          }]
        }),{status:200,headers:{"content-type":"application/json"}});
      throw Error("Unexpected independent Gitea comparison");
    }
  });
  const gatewayEvidence=new TrustedApprovedExecutionPlans({
    repository:repo,engineerDid:did,
    approvals:f.repairScope.approvalStore,
    // Strict independent attestation is tested in Gateway native E2E.
    // This unit fixture explicitly fakes it; never use it in production.
    completionAttestor:{async confirmCompleted(){return true;}}
  });
  const phases=["dependency_install","typecheck","backend_tests",
    "frontend_tests","build","playwright_e2e",
    "researcher_acceptance"].map(phase=>({phase,status}));
  const executionPort={
    provider:"gitea",
    providerFor(record){
      return record.request.tool==="run_tests"?"runner":"gitea";
    },
    async execute(record){
      const op=record.request.tool;
      const args=record.request.arguments;
      if(op==="create_branch")return {
        provider:"gitea",performed:true,tool:"create_branch",
        branch:args.branch,base_branch:args.base_branch,
        revision:baseSha,commit_sha:baseSha
      };
      if(op==="update_file")return {
        provider:"gitea",performed:true,tool:"update_file",
        branch:args.branch,path:args.path,
        revision,commit_sha:revision,
        blob_sha:"unit-blob",precondition_blob_sha:"unit-original"
      };
      if(op==="run_tests")return {
        provider:"runner",performed:true,tool:"run_tests",
        branch:args.branch,revision,tested_commit_sha:revision,
        runner_profile:"poc-default",status,phases,
        project_tests:{status,phases:phases.slice(0,6)},
        researcher_acceptance:phases[6]
      };
      throw Error("Unapproved mock provider operation");
    }
  };
  const gateway=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",
      request_ttl_ms:120000,repository:repo},
    adapter_url:"http://none",adapter_gateway_token:"UNIT",
    opa_url:"http://none",opa_timeout_ms:1000,
    provider_mode:"mock",gitea_timeout_ms:1000
  },{
    approvedPlans:gatewayEvidence,executor:executionPort,
    verifier:{async verify(r){
      return {
        presenter_id:"did:thesis:"+r.presenter,
        issuer_id:did,credential_id:"urn:unit:delegated",
        permissions:[r.required_permission],hierarchy_depth:1,
        expiration:"999999999999999"
      };
    }},
    policy:{async evaluate(){return {allow:true,policy_version:"unit"};}}
  });
  await gatewayEvidence.activate(nextSession,baseSha);
  for(const [planId,role] of [
    ["branch","orchestrator"],["backend","backend"],
    ["frontend","frontend"],["tests","test"]
  ])gatewayEvidence.bindTask(nextSession,planId,"run_"+planId,role);
  async function effect(role,id,tool,args){
    const p=gateway.prepare({
      task_id:"run_"+id,agent_role:role,tool,arguments:args
    });
    return gateway.execute({
      request_id:p.request_id,signed_vp:"unit.only.vp"
    });
  }
  await effect("orchestrator","branch","create_branch",{
    base_branch:"main",branch:nextBranch
  });
  await gatewayEvidence.confirmTaskCompletion("run_branch");
  await effect("backend","backend","update_file",{
    branch:nextBranch,path:backend,content:"unit reconstructed backend"
  });
  await gatewayEvidence.confirmTaskCompletion("run_backend");
  await effect("frontend","frontend","update_file",{
    branch:nextBranch,path:frontend,content:"unit reconstructed frontend"
  });
  await gatewayEvidence.confirmTaskCompletion("run_frontend");
  await effect("test","tests","run_tests",{
    branch:nextBranch,profile:"poc-default"
  });
  if(status==="pass")await gatewayEvidence.confirmTaskCompletion("run_tests");
  await gatewayEvidence.retireSession(nextSession);
  return {input:{...f.input,trustedGitea:reader,gatewayEvidence,
    expectedFreshMainSha:baseSha,expectedTestedCommitSha:revision}};
}
test("R96 new signed exact-SHA run reconstructs both Backend and Frontend",async()=>{
  const f=await fixture();
  try{
    const h=await simulateObservedPostRun(f);
    const result=await verifyTrustedFreshRepairPostRun(h.input);
    assert.deepEqual(result,{
      status:"fresh_repair_exact_sha_runner_pass",
      prior_files_accounted_for:2,modified_files_reimplemented:2,
      added_files_recreated:0,exact_signed_branch_revision_verified:true,
      all_fixed_runner_phases_passed:true,
      functional_equivalence_not_attested:true,prior_source_imported:false,
      additional_permissions_issued:false
    });
    assert.equal(h.input.gatewayEvidence.readVerifiedRunnerEffect({
      session_id:nextSession,task_id:"tests",
      branch:nextBranch,tested_commit_sha:"d".repeat(40)
    }).status,"pass");
    assert.doesNotMatch(JSON.stringify(result),/UserDetailPage|user.service|gitea:/u);
  }finally{await f.close();}
});
test("R96 missing prior Frontend file means FAIL despite Runner PASS",async()=>{
  const f=await fixture();
  try{
    const h=await simulateObservedPostRun(f,{paths:[backend]});
    await assert.rejects(()=>verifyTrustedFreshRepairPostRun(h.input),
      /post-run/i);
  }finally{await f.close();}
});
test("R96 no Runner success without all actual fixed Docker phases passing",async()=>{
  const f=await fixture();
  try{
    const h=await simulateObservedPostRun(f,{status:"fail"});
    await assert.rejects(()=>verifyTrustedFreshRepairPostRun(h.input),
      /post-run|trusted|Test|Runner/i);
  }finally{await f.close();}
});
test("R96 must reject stale Gitea, stale old SHA and wrong new SHA",async()=>{
  const f=await fixture();
  try{
    const h=await simulateObservedPostRun(f);
    await assert.rejects(()=>verifyTrustedFreshRepairPostRun({
      ...h.input,expectedTestedCommitSha:"e".repeat(40)
    }),/post-run|Gitea prior-work diff/i);
    await assert.rejects(()=>verifyTrustedFreshRepairPostRun({
      ...h.input,expectedOldFeatureSha:"f".repeat(40)
    }),/preservation|post-run/i);
    await assert.rejects(()=>verifyTrustedFreshRepairPostRun({
      ...h.input,expectedTestedCommitSha:baseSha
    }),/post-run/i);
  }finally{await f.close();}
});
test("R96 cannot rely on Test Agent prose in place of Gateway evidence",async()=>{
  const f=await fixture();
  try{
    const h=await simulateObservedPostRun(f);
    await assert.rejects(()=>verifyTrustedFreshRepairPostRun({
      ...h.input,gatewayEvidence:{}
    }),/post-run/i);
  }finally{await f.close();}
});
