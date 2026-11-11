import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyFreshTypecheckRepairReviewedScope as verify}
  from "../src/trusted-typecheck-repair-preflight.mjs";
import {SignedEngineerApprovalFileStore}
  from "../src/signed-approval-store.ts";
import {makeApproval,planDigest} from "../../plan-contracts/src/plan.mjs";
import {TrustedPlanningReviewGate}
  from "../src/trusted-planning-review-gate.ts";
import {createFreshTypecheckRepairIssueFence}
  from "../src/trusted-typecheck-repair-activation-fence.mjs";
import {signEngineerApproval} from "../../plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const root="gitea://gitea.local/thesis/iam-console-poc";
const oldSession="previous-verified-dag";
const session="fresh-approved-repair";
const branch="feature/fresh-approved-repair";
const oldBranch="feature/retired-dag";
const sha="a".repeat(40);
const target="apps/backend/src/users/user.service.ts";
const branchUri=root+"/branches/"+encodeURIComponent(branch);
const resource=branchUri+"/files/"+target;
const did="did:thesis:engineer";
const nomination={
  schema:"typecheck-repair-nomination-v1",
  status:"new_independent_engineer_review_required",
  diagnostic_files:1,backend_candidates:1,frontend_candidates:0,
  test_candidates:0,unresolved_files:0,outside_operational_scope:0,
  signed_task_review_required:true,permissions_issued:false,
  task_dispatched:false,retry_started:false
};
function plan(){
  const agent=(id)=>({agent_id:id,did:"did:thesis:"+id,card_ref:"trusted:"+id});
  const t=(id,agent_id,depends_on,resources)=>({
    id,agent_id,title:id,description:"Operator reviewed "+id,
    depends_on,resources
  });
  const p=(id,task_id,agent_id,operation,r)=>({
    id,task_id,agent_id,operation,resource:r,reason:"Engineer reviewed "+operation
  });
  return {
    schema_version:"1.0.0",plan_id:"fresh-repair-dag",session_id:session,
    version:1,repository:repo,base_revision:sha,
    requirement:"New independently reviewed corrective execution",
    candidate_agents:[agent("backend"),agent("test")],
    tasks:[
      t("create","orchestrator",[],[root]),
      t("repair","backend",["create"],[resource]),
      t("check","test",["repair"],[branchUri]),
      t("review","orchestrator",["check"],[root])
    ],
    requested_permissions:[
      p("create-p","create","orchestrator","create_branch",root),
      p("read-p","repair","backend","read_file",resource),
      p("write-p","repair","backend","update_file",resource),
      p("check-p","check","test","run_tests",branchUri),
      p("review-p","review","orchestrator","create_pull_request",root)
    ],
    assumptions:[],uncertainties:[]
  };
}
async function fixture(alter=()=>{}){
  const current=plan();alter(current);
  const dir=await mkdtemp(join(tmpdir(),"signed-repair-scope-"));
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const receipt=makeApproval(current,{
    allowedOperations:new Set(RUST_OPERATIONS),decision_id:"reviewed-repair",
    approved_by:did,approved_at:new Date(Date.now()-25000).toISOString(),
    approved_permission_ids:current.requested_permissions.map(p=>p.id)
  });
  const signed=signEngineerApproval({
    plan:current,approval:receipt,engineerDid:did,
    keyId:"pinned-engineer",privateKeyPem:privateKey.export({
      type:"pkcs8",format:"pem"}).toString(),
    issuedAt:new Date(Date.now()-20000).toISOString(),
    expiresAt:new Date(Date.now()+20*60_000).toISOString()
  });
  await writeFile(join(dir,session+".json"),JSON.stringify(signed),{mode:0o600});
  const store=new SignedEngineerApprovalFileStore({
    directory:dir,engineerDid:did,trustedKeys:{
      "pinned-engineer":{engineer_did:did,
        public_key_pem:publicKey.export({type:"spki",format:"pem"}).toString()}
    }
  });
  const input={
    approvalStore:store,previousSessionId:oldSession,
    nextSessionId:session,expectedFreshMainSha:sha,
    expectedRepository:repo,trustedDiagnosticPath:target,
    ownerSelectedRole:"backend",previousApprovedBranch:oldBranch,
    nextApprovedBranch:branch,nomination
  };
  return {input,current,signed,dir,privateKey,
    close:()=>rm(dir,{force:true,recursive:true})};
}
test("R93 independent Ed25519 review confirms signed repair path, DAG order and no authority issuance",async()=>{
  const f=await fixture();
  try{
    const result=await verify(f.input);
    assert.equal(result.status,"fresh_engineer_signed_repair_scope_verified");
    assert.equal(result.same_task_read_write_verified,true);
    assert.equal(result.signed_test_dependency_verified,true);
    assert.equal(result.operational_credentials_issued,false);
    assert.equal(result.execution_activated,false);
    assert.equal(result.model_calls_started,0);
    assert.doesNotMatch(JSON.stringify(result),/user.service|gitea:|repair-p|credential_id/u);
  }finally{await f.close();}
});
test("R93 prohibit A2A nomination amplification, wrong role, old session and replayed branch",async()=>{
  const f=await fixture();
  try{
    for(const change of [
      {nomination:{...nomination,backend_candidates:0,unresolved_files:1}},
      {nomination:{...nomination,permissions_issued:true}},
      {ownerSelectedRole:"frontend"},
      {previousSessionId:session},
      {previousApprovedBranch:branch},
      {expectedFreshMainSha:"b".repeat(40)},
      {trustedDiagnosticPath:"../secrets.ts"}
    ]){
      await assert.rejects(()=>verify({...f.input,...change}),/repair preflight/i);
    }
  }finally{await f.close();}
});
test("R93 missing same-Task read grant fails even with signed update and approval",async()=>{
  const f=await fixture(p=>{
    p.requested_permissions=p.requested_permissions.filter(x=>x.id!=="read-p");
  });
  try{await assert.rejects(()=>verify(f.input),/repair preflight/i);}
  finally{await f.close();}
});
test("R93 signed Test must depend on repair and PR must depend on tests",async()=>{
  for(const mutation of [
    p=>{p.tasks.find(t=>t.id==="check").depends_on=["create"];},
    p=>{p.tasks.find(t=>t.id==="review").depends_on=["repair"];}
  ]){
    const f=await fixture(mutation);
    try{await assert.rejects(()=>verify(f.input),/repair preflight/i);}
    finally{await f.close();}
  }
});
test("R93 forged extra approved writer or missing new branch authorization fails",async()=>{
  const f=await fixture(p=>{
    p.tasks.push({id:"other",agent_id:"backend",title:"other",description:"Other write",
      depends_on:["create"],resources:[resource]});
    p.requested_permissions.push({id:"other-write",task_id:"other",
      agent_id:"backend",operation:"update_file",resource,
      reason:"Unnecessary extra edit"});
  });
  try{await assert.rejects(()=>verify(f.input),/repair preflight/i);}
  finally{await f.close();}
});
test("R93 owner review cannot bypass independently authenticated Engineer signature",async()=>{
  const f=await fixture();
  try{
    await writeFile(join(f.dir,session+".json"),
      JSON.stringify({...f.signed,
        plan:{...f.signed.plan,requirement:"TAMPERED_MODEL_PROMPT"}}),
      {mode:0o600});
    await assert.rejects(()=>verify(f.input),
      /signature|approval|digest/i);
  }finally{await f.close();}
});

function stagedReviewGate(f){
  const gate=new TrustedPlanningReviewGate({
    snapshot:{session_id:session,repository:repo,base_revision:sha,
      directories:["","apps","apps/backend","apps/backend/src",
        "apps/backend/src/users"],
      files:[target]},
    expectedWorkBranch:branch,authenticatedEngineerDid:did,
    signedApprovals:f.input.approvalStore,planningIsActive:()=>true
  });
  gate.stageTrustedProposal({
    status:"unapproved_proposal",verified_source_reads:1,
    digest:planDigest(f.current),plan:f.current
  });
  return gate;
}
test("R94 pin fresh Engineer receipt before root issuance and recheck after activation",async()=>{
  const f=await fixture();
  try{
    const gate=stagedReviewGate(f);
    const fence=createFreshTypecheckRepairIssueFence({
      repairScope:f.input,reviewGate:gate
    });
    await fence.pinBeforeOperationalActivation();
    await fence.recheckAfterOperationalActivation();
    await assert.rejects(()=>fence.recheckAfterOperationalActivation(),
      /issue fence/i);
    assert.equal(f.input.ownerSelectedRole,"backend");
  }finally{await f.close();}
});
test("R94 a second valid Engineer signature changing only permission decision is refused",async()=>{
  const f=await fixture();
  try{
    const gate=stagedReviewGate(f);
    const fence=createFreshTypecheckRepairIssueFence({
      repairScope:f.input,reviewGate:gate
    });
    await fence.pinBeforeOperationalActivation();
    const signed=signEngineerApproval({
      plan:f.current,
      approval:{...f.signed.approval,decision_id:"second-valid-decision"},
      engineerDid:did,keyId:"pinned-engineer",
      privateKeyPem:f.privateKey.export({
        type:"pkcs8",format:"pem"}).toString(),
      issuedAt:new Date(Date.now()-12000).toISOString(),
      expiresAt:new Date(Date.now()+20*60_000).toISOString()
    });
    await writeFile(join(f.dir,session+".json"),JSON.stringify(signed),
      {mode:0o600});
    await assert.rejects(()=>fence.recheckAfterOperationalActivation(),
      /permission decision|signed|issue fence|trusted planning review/i);
  }finally{await f.close();}
});
test("R94 reject unsigned repair scope before any root can issue",async()=>{
  const f=await fixture();
  try{
    const gate=stagedReviewGate(f);
    const rejectFence=createFreshTypecheckRepairIssueFence({
      repairScope:{...f.input,nomination:{
        ...nomination,permissions_issued:true
      }},reviewGate:gate
    });
    await assert.rejects(
      ()=>rejectFence.pinBeforeOperationalActivation(),
      /repair preflight/i);
    await assert.rejects(
      ()=>rejectFence.recheckAfterOperationalActivation(),/issue fence/i);
  }finally{await f.close();}
});
test("R94 capture owner-selected trusted repair path before asynchronous review",async()=>{
  const f=await fixture();
  try{
    const gate=stagedReviewGate(f);
    const selector={...f.input};
    const fence=createFreshTypecheckRepairIssueFence({
      repairScope:selector,reviewGate:gate
    });
    selector.trustedDiagnosticPath="../unapproved.ts";
    selector.nomination={...nomination,permissions_issued:true};
    await fence.pinBeforeOperationalActivation();
    await fence.recheckAfterOperationalActivation();
  }finally{await f.close();}
});
