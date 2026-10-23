import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync,sign as signJwt,randomBytes} from "node:crypto";
import {mkdtemp,rm,writeFile,chmod,readdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {makeApproval,planDigest}
  from "../../plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans}
  from "../../../apps/gateway/src/approved-execution-plans.ts";
import {compilePlanningProposal} from "../src/trusted-adk-planner.ts";
import {SignedEngineerApprovalFileStore}
  from "../src/signed-approval-store.ts";
import {TrustedPlanningReviewGate}
  from "../src/trusted-planning-review-gate.ts";
import {signTrustedPlanningCheckpoint,verifyTrustedPlanningCheckpoint,
  stageVerifiedPlanningCheckpoint}
  from "../src/trusted-planning-checkpoint.ts";
import {SignedPlanningCheckpointFileStore}
  from "../src/trusted-planning-checkpoint-store.ts";
import {startPersistedReviewedGeminiHandoff}
  from "../src/trusted-manual-gemini-handoff.ts";
import {startAdmittedGithubReviewedGeminiHandoff}
  from "../src/trusted-admitted-github-handoff.ts";
import {createReviewedApprovedDagExecution}
  from "../src/trusted-reviewed-approved-dag.ts";
import {TrustedGithubAdmissionReceiptStore}
  from "../src/trusted-github-admission-store.ts";
import {TrustedOperationalRecoveryStore,reconcileOrphanedOperationalRoots}
  from "../src/trusted-operational-recovery-store.ts";
import {GithubOidcReplayFileStore}
  from "../src/trusted-github-oidc-replay-store.ts";
import {startTrustedGithubOidcIntakeServer}
  from "../src/trusted-github-oidc-intake.ts";
import {verifyGithubManualGeminiDispatch}
  from "../src/trusted-manual-github-dispatch.ts";
import {TrustedEngineerAuthoritySession}
  from "../src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "../src/trusted-execution-coordinator.ts";
import {verifyManualGeminiExecutionReadiness,createReviewedGeminiAdkModel,
  createReviewedGeminiA2ARoleRuntime,startReviewedGeminiA2AServers,
  verifyPortableManualGeminiHandoff}
  from "../src/trusted-gemini-execution-readiness.ts";

const SHA="a".repeat(40),FILE="src/billing/invoice.ts";
const ENGINEER="did:thesis:engineer";
const REPO={authority:"gitea.local",owner:"thesis",repository:"invoices"};
const SNAPSHOT={session_id:"review-session-1",repository:REPO,
  base_revision:SHA,directories:["","src","src/billing"],files:[FILE]};
const AGENTS={
  backend:{did:"did:thesis:backend",card_ref:"trusted:backend"},
  frontend:{did:"did:thesis:frontend",card_ref:"trusted:frontend"},
  test:{did:"did:thesis:test",card_ref:"trusted:test"}
};
const CFG={snapshot:SNAPSHOT,requirement:"Sort invoices by due date",
  planId:"invoice-plan-1",workBranch:"feature/invoice-sort",agents:AGENTS};
const CATALOG=new Set(RUST_OPERATIONS);
function sketch(){
  return {tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Create work branch",
      description:"Create a separate feature branch",depends_on:[],
      permissions:[{operation:"create_branch",path:null,reason:"Isolate changes"}]},
    {id:"backend",agent_id:"backend",title:"Implement sorting",
      description:"Read and update invoice service",depends_on:["branch"],
      permissions:[
        {operation:"read_file",path:FILE,reason:"Read source"},
        {operation:"update_file",path:FILE,reason:"Implement sorting"}
      ]}
  ],assumptions:[],uncertainties:[]};
}
function root(id:string,index:string){
  return {credential_id:id,valid_from:new Date().toISOString(),
    validity_seconds:300,credential_status:{
      type:"BitstringStatusListEntry" as const,
      statusPurpose:"revocation" as const,
      statusListIndex:index,statusListCredential:"https://example.test/status/review"
    }};
}
async function fixture(recovery=false){
  const directory=await mkdtemp(join(tmpdir(),"approved-review-"));
  const recoveryDirectory=recovery?
    await mkdtemp(join(tmpdir(),"operational-recovery-")):undefined;
  const keys=generateKeyPairSync("ed25519");
  const publicKey=keys.publicKey.export({format:"pem",type:"spki"}).toString();
  const privateKey=keys.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const signed=new SignedEngineerApprovalFileStore({directory,
    engineerDid:ENGINEER,trustedKeys:{
      key1:{engineer_did:ENGINEER,public_key_pem:publicKey}
    }});
  const issued:{id:string;permissions:{resource:string;operation:string}[]}[]=[];
  const revoked:string[]=[];
  let onOperationalIssue:(()=>Promise<void>)|undefined;
  const credentials={
    async issueScopedOrchestratorRoot(input:any){
      issued.push({id:input.credential_id,
        permissions:structuredClone(input.permissions)});
      if(input.credential_id==="urn:operational" && onOperationalIssue)
        await onOperationalIssue();
      return {id:input.credential_id,credentialSubject:{
        per:structuredClone(input.permissions)
      }};
    },
    async revokeRoot(id:string){revoked.push(id);}
  };
  let coordinator!:TrustedExecutionCoordinator;
  const gate=new TrustedPlanningReviewGate({
    snapshot:SNAPSHOT,expectedWorkBranch:CFG.workBranch,
    authenticatedEngineerDid:ENGINEER,signedApprovals:signed,
    planningIsActive:()=>coordinator?.phase==="planning"
  });
  const authority=new TrustedEngineerAuthoritySession({
    snapshot:SNAPSHOT,credentials,approvals:gate,
    authenticatedEngineerDid:ENGINEER
  });
  const plans=new TrustedApprovedExecutionPlans({
    repository:REPO,engineerDid:ENGINEER,approvals:gate,
    operationalLeaseMs:45_000,
    completionAttestor:{async confirmCompleted(){return false;}}
  });
  coordinator=new TrustedExecutionCoordinator({
    authority,approvedGatewayPlans:plans,credentials,
    sessionId:SNAPSHOT.session_id,baseRevision:SHA,
    ...(recoveryDirectory?{
      operationalRecovery:new TrustedOperationalRecoveryStore(recoveryDirectory)
    }:{})
  });
  function proposal(){
    const result=compilePlanningProposal(sketch(),CFG);
    return {...result,verified_source_reads:1};
  }
  async function sign(plan:any,ids:string[],privateOverride?:string){
    const now=new Date();
    const approved_at=now.toISOString();
    const approval=makeApproval(plan,{allowedOperations:CATALOG,
      decision_id:"engineer-decision-1",approved_by:ENGINEER,approved_at,
      approved_permission_ids:ids
    });
    const receipt=signEngineerApproval({plan,approval,engineerDid:ENGINEER,
      keyId:"key1",privateKeyPem:privateOverride??privateKey,
      issuedAt:approved_at,
      expiresAt:new Date(now.getTime()+600000).toISOString()
    });
    await writeFile(join(directory,SNAPSHOT.session_id+".json"),
      JSON.stringify(receipt),{mode:0o600});
  }
  return {gate,coordinator,issued,revoked,proposal,sign,
    replaceReceiptAfterOperationalIssue(handler:()=>Promise<void>){
      onOperationalIssue=handler;
    },
    close:async()=>{
      await rm(directory,{recursive:true,force:true});
      if(recoveryDirectory)
        await rm(recoveryDirectory,{recursive:true,force:true});
    }};
}

test("signed Engineer review exactly binds Planner digest and approved subset to operational root/Gateway",async()=>{
  const f=await fixture(true);
  try{
    await assert.rejects(f.coordinator.beginExecution(root("urn:operational","102")),
      /prior Planning/);
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    await assert.rejects(f.gate.loadAuthenticatedApproval(SNAPSHOT.session_id),
      /no exact staged Planning proposal/);
    assert.deepEqual(f.revoked,[]);
    const proposal=f.proposal();
    const review=f.gate.stageTrustedProposal(proposal);
    assert.equal(review.status,"awaiting_engineer_signature");
    assert.equal(review.plan_digest,planDigest(proposal.plan));
    assert.deepEqual(review.plan.requested_permissions,proposal.plan.requested_permissions);
    review.plan.tasks[1].description="malicious mutation to review copy";
    assert.notEqual(f.gate.reviewPacket().plan.tasks[1].description,
      "malicious mutation to review copy");
    await assert.rejects(f.gate.loadAuthenticatedApproval(SNAPSHOT.session_id));
    assert.deepEqual(f.revoked,[]);
    await f.sign(proposal.plan,["permission-1","permission-3"]);
    const starting=f.coordinator.beginExecution(root("urn:operational","102"));
    // The first activation reserves the phase synchronously, BEFORE
    // awaiting journal I/O. A second simultaneous request never issues.
    await assert.rejects(f.coordinator.beginExecution(
      root("urn:parallel-root","103")
    ),/prior Planning/);
    const active=await starting;
    assert.equal(active.plan_digest,proposal.digest);
    assert.equal(f.coordinator.phase,"execution");
    assert.deepEqual(f.revoked,["urn:preliminary"]);
    assert.equal(f.issued.length,2);
    assert.deepEqual(f.issued[1].permissions.map(x=>x.operation),
      ["create_branch","update_file"]);
    assert.equal(f.coordinator.trustedOperationalAuthority().plan_digest,
      proposal.digest);
    await f.coordinator.closeExecution();
    assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
  }finally{await f.close();}
});

test("without a persisted signed receipt, Execution fails closed before revocation",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    f.gate.stageTrustedProposal(f.proposal());
    await assert.rejects(f.coordinator.beginExecution(root("urn:operational","102")));
    assert.equal(f.coordinator.phase,"failed_closed");
    assert.deepEqual(f.revoked,[]);
    assert.equal(f.issued.length,1);
  }finally{await f.close();}
});

test("altered, independently signed plan is NOT the exact proposal and cannot revoke Planning root",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const original=f.proposal();
    f.gate.stageTrustedProposal(original);
    const altered=structuredClone(original.plan);
    altered.tasks[1].description="Different Engineer-visible work";
    await f.sign(altered,["permission-1","permission-3"]);
    await assert.rejects(f.coordinator.beginExecution(root("urn:operational","102")),
      /signed Engineer plan differs from the staged proposal/);
    assert.deepEqual(f.revoked,[]);
    assert.equal(f.issued.length,1);
    assert.equal(f.coordinator.phase,"failed_closed");
  }finally{await f.close();}
});

test("changed valid signed decision after root issuance makes Gateway activation revoke the new root",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const p=f.proposal();f.gate.stageTrustedProposal(p);
    await f.sign(p.plan,["permission-1","permission-3"]);
    // After Rust issues its independently scoped operational root, replace
    // the original signed receipt with a different ALSO-valid Engineer
    // signature on the same plan but a different permission subset.
    f.replaceReceiptAfterOperationalIssue(async()=>{
      await f.sign(p.plan,["permission-1","permission-2"]);
    });
    await assert.rejects(f.coordinator.beginExecution(root("urn:operational","102")),
      /signed permission decision changed after initial trusted load/);
    assert.equal(f.coordinator.phase,"failed_closed");
    assert.deepEqual(f.issued.map(x=>x.id),["urn:preliminary","urn:operational"]);
    assert.deepEqual(f.issued[1].permissions.map(x=>x.operation),
      ["create_branch","update_file"]);
    assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
    await assert.rejects(f.coordinator.beginExecution(root("another","103")));
  }finally{await f.close();}
});

test("untrusted review staging is one-shot, scope-bound and requires active Planning",async()=>{
  const f=await fixture();
  try{
    const original=f.proposal();
    assert.throws(()=>f.gate.stageTrustedProposal(original),/phase is not active/);
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    for(const mutate of [
      (x:any)=>{x.status="approved";},
      (x:any)=>{x.digest="b".repeat(64);},
      (x:any)=>{x.verified_source_reads=0;},
      (x:any)=>{x.plan.base_revision="b".repeat(40);},
      (x:any)=>{x.plan.repository.owner="attacker";},
      (x:any)=>{x.plan.tasks[1].resources[0]="gitea://attacker/external";}
    ]){
      const copy=structuredClone(original);mutate(copy);
      assert.throws(()=>f.gate.stageTrustedProposal(copy));
    }
    f.gate.stageTrustedProposal(original);
    assert.throws(()=>f.gate.stageTrustedProposal(original),/one immutable proposal/);
    await assert.rejects(f.gate.loadAuthenticatedApproval("wrong-session"),
      /no exact staged Planning proposal/);
    assert.deepEqual(f.revoked,[]);
  }finally{await f.close();}
});

test("untrusted signer and modified receipt cannot authorize an operational root",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const p=f.proposal();f.gate.stageTrustedProposal(p);
    const rogue=generateKeyPairSync("ed25519").privateKey
      .export({format:"pem",type:"pkcs8"}).toString();
    await f.sign(p.plan,["permission-1","permission-3"],rogue);
    await assert.rejects(f.gate.loadAuthenticatedApproval(SNAPSHOT.session_id),
      /invalid approval signature/);
    assert.deepEqual(f.revoked,[]);
  }finally{await f.close();}
});


test("manual Gemini readiness requires independent Ed25519 review and never creates authority",async()=>{
  const f=await fixture();
  try{
    const base={
      githubEventName:"workflow_dispatch",
      githubRunAttempt:"1",
      authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
      geminiApiKey:"ci-dummy-non-live-secret",
      modelName:"gemini-3.8-flash",
      maxModelTurns:12,
      maxOutputTokens:16000,
      trustedPhase:()=>f.coordinator.phase,
      reviewGate:f.gate
    };
    await assert.rejects(verifyManualGeminiExecutionReadiness(base),
      /active Coordinator/);
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    await assert.rejects(verifyManualGeminiExecutionReadiness(base),
      /no staged proposal/);
    const draft=f.proposal();
    f.gate.stageTrustedProposal(draft);
    await assert.rejects(verifyManualGeminiExecutionReadiness(base));
    assert.equal(f.issued.length,1);
    assert.deepEqual(f.revoked,[]);
    await f.sign(draft.plan,["permission-1","permission-3"]);
    for(const patch of [
      {githubEventName:"push"},{githubRunAttempt:"2"},
      {authorizationInput:"I AUTHORIZE"},{geminiApiKey:""},
      {modelName:"openai-gpt"},{modelName:"gemini-3.8-flash/other"},
      {maxModelTurns:0},{maxModelTurns:33},
      {maxOutputTokens:0},{maxOutputTokens:32001}
    ]){
      await assert.rejects(verifyManualGeminiExecutionReadiness({
        ...base,...patch
      }),/Trusted paid Gemini readiness/);
    }
    const ready=await verifyManualGeminiExecutionReadiness(base);
    assert.equal(ready.plan_digest,draft.digest);
    assert.equal(ready.base_revision,SHA);
    assert.equal(ready.model_name,"gemini-3.8-flash");
    assert.equal(ready.status,"signed_engineer_approved_manual_gemini_ready");
    assert.deepEqual(ready.approved_permission_ids,
      ["permission-1","permission-3"]);
    assert.equal(ready.authenticated_engineer_did,ENGINEER);
    assert.ok(Object.isFrozen(ready));
    assert.ok(Object.isFrozen(ready.approved_permission_ids));
    assert.ok(!JSON.stringify(ready).includes(base.geminiApiKey));
    assert.deepEqual(f.revoked,[]);
    assert.equal(f.issued.length,1); // Readiness is never operational issuance
    await f.coordinator.beginExecution(root("urn:operational","102"));
    await assert.rejects(verifyManualGeminiExecutionReadiness(base),
      /active Coordinator/);
  }finally{await f.close();}
});

test("Gemini manual opt-in does not bypass an altered Engineer-signed plan",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const proposal=f.proposal();f.gate.stageTrustedProposal(proposal);
    const altered=structuredClone(proposal.plan);
    altered.tasks[1].description="Substitute signed scope";
    await f.sign(altered,["permission-1","permission-3"]);
    await assert.rejects(verifyManualGeminiExecutionReadiness({
      githubEventName:"workflow_dispatch",
      githubRunAttempt:"1",
      authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
      geminiApiKey:"ci-fake-key",modelName:"gemini-3.8-flash",
      maxModelTurns:8,maxOutputTokens:16000,
      trustedPhase:()=>f.coordinator.phase,reviewGate:f.gate
    }),/signed Engineer plan differs from the staged proposal/);
    assert.equal(f.issued.length,1);
    assert.deepEqual(f.revoked,[]);
  }finally{await f.close();}
});


test("manual Gemini factory constructs ADK model only after signing; no inference or root issuance",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const p=f.proposal();f.gate.stageTrustedProposal(p);
    const options={
      githubEventName:"workflow_dispatch",
      githubRunAttempt:"1",
      authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
      geminiApiKey:"not-a-real-api-key",
      modelName:"gemini-3.8-flash",
      maxModelTurns:8,
      maxOutputTokens:16000,
      trustedPhase:()=>f.coordinator.phase,
      reviewGate:f.gate
    };
    await assert.rejects(createReviewedGeminiAdkModel(options));
    await f.sign(p.plan,["permission-1","permission-3"]);
    const {model,readiness}=await createReviewedGeminiAdkModel(options);
    assert.equal(model.model,"gemini-3.8-flash");
    assert.equal(readiness.plan_digest,p.digest);
    assert.ok(!JSON.stringify(readiness).includes(options.geminiApiKey));
    assert.equal(f.issued.length,1);
    assert.deepEqual(f.revoked,[]);
    await assert.rejects(createReviewedGeminiAdkModel({
      ...options,githubRunAttempt:"2"
    }),/first GitHub Actions attempt/);
  }finally{await f.close();}
});


test("manual signed Gemini gate transfers identical bounded ADK settings to all three roles",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const proposal=f.proposal();
    f.gate.stageTrustedProposal(proposal);
    const transports={
      backend:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"backend-secret"},
      frontend:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"frontend-secret"},
      test:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"test-secret"}
    };
    const options={
      githubEventName:"workflow_dispatch",
      githubRunAttempt:"1",authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
      geminiApiKey:"not-a-real-api-key",modelName:"gemini-3.8-flash",
      maxModelTurns:12,maxOutputTokens:16000,
      maxModelCallMs:120000,
      trustedPhase:()=>f.coordinator.phase,
      reviewGate:f.gate,transports
    };
    await assert.rejects(createReviewedGeminiA2ARoleRuntime(options));
    assert.deepEqual(f.revoked,[]);
    await f.sign(proposal.plan,["permission-1","permission-3"]);
    const runtime=await createReviewedGeminiA2ARoleRuntime(options);
    assert.equal(runtime.readiness.plan_digest,proposal.digest);
    assert.ok(Object.isFrozen(runtime.role_configs));
    const roles=["backend","frontend","test"] as const;
    assert.deepEqual(Object.keys(runtime.role_configs),[...roles]);
    for(const role of roles){
      const config=runtime.role_configs[role];
      assert.equal(config.model.model,"gemini-3.8-flash");
      assert.equal(config.maxModelTurns,12);
      assert.equal(config.maxModelCallMs,120000);
      assert.deepEqual(config.generateContentConfig,{maxOutputTokens:16000});
      assert.equal(config.scopeModelPaths,true);
      assert.equal(config.adapterToken,transports[role].adapterToken);
    }
    assert.notEqual(runtime.role_configs.backend.model,runtime.role_configs.test.model);
    for(const patch of [
      {maxModelCallMs:361000},
      {maxModelCallMs:0},
      {transports:{...transports,frontend:{...transports.frontend,
        adapterToken:transports.backend.adapterToken}}},
      {transports:{...transports,test:{...transports.test,
        gatewayBaseUrl:"javascript:invalid"}}}
    ]){
      await assert.rejects(createReviewedGeminiA2ARoleRuntime({
        ...options,...patch
      }),/Trusted paid Gemini readiness/);
    }
    assert.equal(f.issued.length,1); // construction is not operational root
    assert.deepEqual(f.revoked,[]);
  }finally{await f.close();}
});


test("trusted operational approval binds startup of three loopback ADK A2A servers without inference",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const proposal=f.proposal();f.gate.stageTrustedProposal(proposal);
    await f.sign(proposal.plan,["permission-1","permission-3"]);
    const input={
      githubEventName:"workflow_dispatch",
      githubRunAttempt:"1",authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
      geminiApiKey:"fake-unused-secret",modelName:"gemini-3.8-flash",
      maxModelTurns:6,maxOutputTokens:12000,maxModelCallMs:30000,
      trustedPhase:()=>f.coordinator.phase,reviewGate:f.gate,
      transports:{
        backend:{gatewayBaseUrl:"http://127.0.0.1:8080",
          adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"backend"},
        frontend:{gatewayBaseUrl:"http://127.0.0.1:8080",
          adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"frontend"},
        test:{gatewayBaseUrl:"http://127.0.0.1:8080",
          adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"test"}
      }
    };
    const reviewed=await createReviewedGeminiA2ARoleRuntime(input);
    const ports={backend:30181,frontend:30182,test:30183};
    await assert.rejects(startReviewedGeminiA2AServers({
      coordinator:f.coordinator,reviewed,ports
    }),/operational root/);
    assert.deepEqual(f.revoked,[]);
    const active=await f.coordinator.beginExecution(root("urn:operational","102"));
    assert.equal(active.plan_digest,reviewed.readiness.plan_digest);
    await assert.rejects(startReviewedGeminiA2AServers({
      coordinator:f.coordinator,reviewed:{...reviewed},ports
    }),/authenticated minted Gemini runtime/);
    assert.equal(f.coordinator.phase,"execution");
    const running=await startReviewedGeminiA2AServers({
      coordinator:f.coordinator,reviewed,ports
    });
    try{
      assert.deepEqual(Object.keys(running.endpoints),
        ["backend","frontend","test"]);
      for(const role of ["backend","frontend","test"] as const){
        assert.equal(running.servers[role].role,role);
        assert.equal(running.endpoints[role],
          "http://127.0.0.1:"+ports[role]);
      }
      assert.deepEqual(f.revoked,["urn:preliminary"]);
      assert.equal(f.issued.length,2); // no new child/root DC at startup
    }finally{await running.close();}
    await f.coordinator.closeExecution();
    assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
  }finally{await f.close();}
});

test("approved Gemini A2A server startup fails closed and revokes operational authority on invalid ports",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const proposal=f.proposal();f.gate.stageTrustedProposal(proposal);
    await f.sign(proposal.plan,["permission-1","permission-3"]);
    const reviewed=await createReviewedGeminiA2ARoleRuntime({
      githubEventName:"workflow_dispatch",githubRunAttempt:"1",
      authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
      geminiApiKey:"not-real",modelName:"gemini-3.8-flash",
      maxModelTurns:6,maxOutputTokens:12000,maxModelCallMs:30000,
      trustedPhase:()=>f.coordinator.phase,reviewGate:f.gate,
      transports:{
        backend:{gatewayBaseUrl:"http://127.0.0.1:8080",
          adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"backend"},
        frontend:{gatewayBaseUrl:"http://127.0.0.1:8080",
          adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"frontend"},
        test:{gatewayBaseUrl:"http://127.0.0.1:8080",
          adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"test"}
      }
    });
    await f.coordinator.beginExecution(root("urn:operational","102"));
    await assert.rejects(startReviewedGeminiA2AServers({
      coordinator:f.coordinator,reviewed,
      ports:{backend:30080,frontend:30080,test:30082}
    }),/distinct, valid local A2A ports/);
    assert.equal(f.coordinator.phase,"closed");
    assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
  }finally{await f.close();}
});


test("signed Planning provenance is independent of Engineer receipt and safely stages exact verified proposal",async()=>{
  const f=await fixture();
  try{
    const signing=generateKeyPairSync("ed25519");
    const publicPem=signing.publicKey.export({format:"pem",type:"spki"}).toString();
    const privatePem=signing.privateKey.export({format:"pem",type:"pkcs8"}).toString();
    const proposal=f.proposal();
    const now=new Date();
    const ticket=signTrustedPlanningCheckpoint({
      snapshot:SNAPSHOT,expectedWorkBranch:CFG.workBranch,proposal,
      keyId:"trusted-backend-1",privateKeyPem:privatePem,
      issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+600000).toISOString()
    });
    const config={
      trustedKeys:{"trusted-backend-1":{public_key_pem:publicPem}},
      expectedSessionId:SNAPSHOT.session_id,
      expectedRepository:REPO,
      expectedBaseRevision:SHA,
      expectedWorkBranch:CFG.workBranch
    };
    const verified=verifyTrustedPlanningCheckpoint(ticket,config);
    assert.equal(verified.proposal.digest,proposal.digest);
    assert.equal(verified.key_id,"trusted-backend-1");
    assert.ok(!JSON.stringify(verified).includes(privatePem));
    assert.throws(()=>stageVerifiedPlanningCheckpoint(f.gate,ticket,config),
      /Planning phase is not active/);
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const review=stageVerifiedPlanningCheckpoint(f.gate,ticket,config);
    assert.equal(review.plan_digest,proposal.digest);
    await assert.rejects(f.gate.loadAuthenticatedApproval(SNAPSHOT.session_id));
    await f.sign(proposal.plan,["permission-1","permission-3"]);
    assert.equal((await f.gate.loadAuthenticatedApproval(SNAPSHOT.session_id))
      .authenticated_engineer_did,ENGINEER);
    assert.equal(f.issued.length,1);
    assert.deepEqual(f.revoked,[]);
  }finally{await f.close();}
});

test("Planning checkpoint refuses forged, altered, stale, wrong-session or unpinned provenance",async()=>{
  const signing=generateKeyPairSync("ed25519");
  const publicPem=signing.publicKey.export({format:"pem",type:"spki"}).toString();
  const privatePem=signing.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const now=new Date();
  const original=compilePlanningProposal(sketch(),CFG);
  const ticket=signTrustedPlanningCheckpoint({
    snapshot:SNAPSHOT,expectedWorkBranch:CFG.workBranch,
    proposal:{...original,verified_source_reads:1},
    keyId:"backend-signing-key",privateKeyPem:privatePem,
    issuedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+600000).toISOString()
  });
  const config={
    trustedKeys:{"backend-signing-key":{public_key_pem:publicPem}},
    expectedSessionId:SNAPSHOT.session_id,
    expectedRepository:REPO,
    expectedBaseRevision:SHA,expectedWorkBranch:CFG.workBranch
  };
  const changes=[
    (x:any)=>{x.signature="A".repeat(86);},
    (x:any)=>{x.proposal.plan.tasks[1].description="attacker substitution";},
    (x:any)=>{x.snapshot.files=["src/secrets.ts"];},
    (x:any)=>{x.proposal.digest="0".repeat(64);},
    (x:any)=>{x.expected_work_branch="feature/attacker";},
    (x:any)=>{x.snapshot.base_revision="0".repeat(40);},
    (x:any)=>{x.key_id="attacker";},
    (x:any)=>{x.proposal.verified_source_reads=0;}
  ];
  for(const change of changes){
    const forged=structuredClone(ticket);change(forged);
    assert.throws(()=>verifyTrustedPlanningCheckpoint(forged,config));
  }
  for(const wrong of [
    {expectedSessionId:"another-session"},
    {expectedBaseRevision:"0".repeat(40)},
    {expectedWorkBranch:"feature/other"},
    {expectedRepository:{...REPO,owner:"attacker"}},
    {trustedKeys:{"backend-signing-key":{
      public_key_pem:generateKeyPairSync("ed25519")
        .publicKey.export({format:"pem",type:"spki"}).toString()
    }}},
    {nowMs:now.getTime()+700000}
  ]){
    assert.throws(()=>verifyTrustedPlanningCheckpoint(ticket,{
      ...config,...wrong
    }));
  }
  const malformed={...ticket,unknown:"value"};
  assert.throws(()=>verifyTrustedPlanningCheckpoint(malformed,config));
});


test("portable manual handoff verifies separate Planning and Engineer signatures before paid readiness",async()=>{
  const f=await fixture();
  try{
    const backend=generateKeyPairSync("ed25519");
    const now=new Date();
    const proposal=f.proposal();
    const checkpoint=signTrustedPlanningCheckpoint({
      snapshot:SNAPSHOT,expectedWorkBranch:CFG.workBranch,proposal,
      keyId:"backend-1",
      privateKeyPem:backend.privateKey.export({
        format:"pem",type:"pkcs8"
      }).toString(),
      issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+600000).toISOString()
    });
    const input={
      reviewGate:f.gate,checkpoint,
      checkpointTrust:{
        expectedSessionId:SNAPSHOT.session_id,
        expectedRepository:REPO,expectedBaseRevision:SHA,
        expectedWorkBranch:CFG.workBranch,
        trustedKeys:{ "backend-1":{public_key_pem:backend.publicKey.export({
          format:"pem",type:"spki"
        }).toString()}}
      },
      readiness:{
        githubEventName:"workflow_dispatch",
        githubRunAttempt:"1",
        authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
        geminiApiKey:"only-placeholder-never-used",
        modelName:"gemini-3.8-flash",
        maxModelTurns:8,maxOutputTokens:16000,
        trustedPhase:()=>f.coordinator.phase
      }
    };
    await assert.rejects(verifyPortableManualGeminiHandoff(input),
      /real trusted Planning coordinator/);
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    await f.sign(proposal.plan,["permission-1","permission-3"]);
    const ready=await verifyPortableManualGeminiHandoff(input);
    assert.equal(ready.status,"signed_engineer_approved_manual_gemini_ready");
    assert.equal(ready.plan_digest,proposal.digest);
    assert.deepEqual(ready.approved_permission_ids,
      ["permission-1","permission-3"]);
    assert.deepEqual(f.revoked,[]);
    assert.equal(f.issued.length,1);
    assert.throws(()=>f.gate.stageTrustedProposal(proposal),
      /one immutable proposal/);
    await f.coordinator.beginExecution(root("urn:operational","102"));
    assert.equal(f.coordinator.phase,"execution");
    assert.deepEqual(f.revoked,["urn:preliminary"]);
    await f.coordinator.closeExecution();
    assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
  }finally{await f.close();}
});


test("checkpoint file store verifies pinned backend signature and owner-only persistence",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"trusted-planning-checkpoint-"));
  try{
    const backend=generateKeyPairSync("ed25519");
    const now=new Date();
    const ticket=signTrustedPlanningCheckpoint({
      snapshot:SNAPSHOT,expectedWorkBranch:CFG.workBranch,
      proposal:{...compilePlanningProposal(sketch(),CFG),verified_source_reads:1},
      keyId:"trusted-backend-1",
      privateKeyPem:backend.privateKey.export({
        format:"pem",type:"pkcs8"
      }).toString(),
      issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+600000).toISOString()
    });
    const store=new SignedPlanningCheckpointFileStore({
      directory,
      trust:{
        trustedKeys:{"trusted-backend-1":{
          public_key_pem:backend.publicKey.export({
            format:"pem",type:"spki"
          }).toString()
        }},
        expectedSessionId:SNAPSHOT.session_id,
        expectedRepository:REPO,
        expectedBaseRevision:SHA,
        expectedWorkBranch:CFG.workBranch
      }
    });
    const file=join(directory,SNAPSHOT.session_id+".json");
    await writeFile(file,JSON.stringify(ticket),{mode:0o600});
    const verified=await store.load();
    assert.equal(verified.proposal.digest,ticket.proposal.digest);
    const modified=structuredClone(ticket);
    modified.proposal.plan.tasks[1].description="injected changed source";
    await writeFile(file,JSON.stringify(modified),{mode:0o600});
    // Scope integrity is independently checked even before the signature.
    await assert.rejects(store.load(),/Signed Planning checkpoint:/);
    // writeFile({mode}) does NOT reset permissions on an existing inode.
    // Deliberately chmod the fixture to prove the secure store rejects it.
    await writeFile(file,JSON.stringify(ticket));
    await chmod(file,0o644);
    await assert.rejects(store.load(),/owner-only/);
  }finally{await rm(directory,{recursive:true,force:true});}
});


test("trusted manual host loads persisted backend signature + Engineer receipt then activates three A2A roles",async()=>{
  const f=await fixture();
  const folder=await mkdtemp(join(tmpdir(),"manual-gemini-host-"));
  try{
    const backend=generateKeyPairSync("ed25519");
    const now=new Date();
    const plan=f.proposal();
    const ticket=signTrustedPlanningCheckpoint({
      snapshot:SNAPSHOT,expectedWorkBranch:CFG.workBranch,proposal:plan,
      keyId:"backend-host",
      privateKeyPem:backend.privateKey.export({
        format:"pem",type:"pkcs8"
      }).toString(),
      issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+600000).toISOString()
    });
    await writeFile(join(folder,SNAPSHOT.session_id+".json"),
      JSON.stringify(ticket),{mode:0o600});
    const checkpointStore=new SignedPlanningCheckpointFileStore({
      directory:folder,trust:{
        trustedKeys:{"backend-host":{
          public_key_pem:backend.publicKey.export({
            format:"pem",type:"spki"
          }).toString()
        }},
        expectedSessionId:SNAPSHOT.session_id,
        expectedRepository:REPO,expectedBaseRevision:SHA,
        expectedWorkBranch:CFG.workBranch
      }
    });
    const manual={
      githubEventName:"workflow_dispatch",
      githubRunAttempt:"1",
      authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
      geminiApiKey:"non-billable-dummy",modelName:"gemini-3.8-flash",
      maxModelTurns:8,maxOutputTokens:8000
    };
    const transports={
      backend:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"backend-token"},
      frontend:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"frontend-token"},
      test:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"test-token"}
    };
    const input={
      coordinator:f.coordinator,reviewGate:f.gate,checkpointStore,
      manual,transports,maxModelCallMs:30000,
      operationalRoot:root("urn:operational","102"),
      ports:{backend:30581,frontend:30582,test:30583}
    };
    await assert.rejects(startPersistedReviewedGeminiHandoff(input),
      /Active verified Planning root/);
    assert.equal(f.issued.length,0);
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    await assert.rejects(startPersistedReviewedGeminiHandoff(input));
    assert.equal(f.issued.length,1);
    await f.sign(plan.plan,["permission-1","permission-3"]);
    // The unsigned input object cannot override the trusted phase.
    const launched=await startPersistedReviewedGeminiHandoff(input);
    try{
      assert.equal(launched.readiness.plan_digest,plan.digest);
      assert.equal(launched.operational_root_id,"urn:operational");
      assert.deepEqual(Object.keys(launched.endpoints),
        ["backend","frontend","test"]);
      assert.equal(f.coordinator.phase,"execution");
      assert.equal(f.issued.length,2);
      assert.deepEqual(f.revoked,["urn:preliminary"]);
    }finally{await launched.close();}
    // One trusted host close must revoke the root, not just stop HTTP.
    assert.equal(f.coordinator.phase,"closed");
    assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
  }finally{
    await f.close();
    await rm(folder,{recursive:true,force:true});
  }
});

test("persisted manual host refuses wrong checkpoint SHA before operational issuance",async()=>{
  const f=await fixture();
  const folder=await mkdtemp(join(tmpdir(),"manual-gemini-invalid-"));
  try{
    const backend=generateKeyPairSync("ed25519");
    const now=new Date();
    const proposal=f.proposal();
    const checkpoint=signTrustedPlanningCheckpoint({
      snapshot:SNAPSHOT,expectedWorkBranch:CFG.workBranch,proposal,
      keyId:"backend-host",
      privateKeyPem:backend.privateKey.export({
        format:"pem",type:"pkcs8"
      }).toString(),issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+600000).toISOString()
    });
    await writeFile(join(folder,SNAPSHOT.session_id+".json"),
      JSON.stringify(checkpoint),{mode:0o600});
    const checkpointStore=new SignedPlanningCheckpointFileStore({
      directory:folder,trust:{
        trustedKeys:{"backend-host":{
          public_key_pem:backend.publicKey.export({
            format:"pem",type:"spki"
          }).toString()
        }},
        expectedSessionId:SNAPSHOT.session_id,
        expectedRepository:REPO,
        expectedBaseRevision:"b".repeat(40),
        expectedWorkBranch:CFG.workBranch
      }
    });
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    await f.sign(proposal.plan,["permission-1","permission-3"]);
    await assert.rejects(startPersistedReviewedGeminiHandoff({
      coordinator:f.coordinator,reviewGate:f.gate,checkpointStore,
      manual:{
        githubEventName:"workflow_dispatch",githubRunAttempt:"1",
        authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
        geminiApiKey:"fake",modelName:"gemini-3.8-flash",
        maxModelTurns:8,maxOutputTokens:8000
      },
      transports:{} as any,maxModelCallMs:30000,
      operationalRoot:root("urn:operational","102"),
      ports:{backend:30581,frontend:30582,test:30583}
    }),/not pinned to independently selected session or Gitea SHA/);
    assert.equal(f.issued.length,1);
    assert.equal(f.coordinator.phase,"planning");
    assert.deepEqual(f.revoked,[]);
  }finally{
    await f.close();
    await rm(folder,{recursive:true,force:true});
  }
});


test("verified signed GitHub OIDC reaches live Planning and requires independent Engineer signature",async()=>{
  const f=await fixture(true);
  const checkpointDir=await mkdtemp(join(tmpdir(),"engineer-checkpoint-admission-"));
  const consentDir=await mkdtemp(join(tmpdir(),"engineer-oidc-admission-"));
  const replayDir=await mkdtemp(join(tmpdir(),"engineer-oidc-replay-"));
  let oidcServer:Awaited<ReturnType<typeof startTrustedGithubOidcIntakeServer>>|undefined;
  try{
    const signing=generateKeyPairSync("ed25519");
    const now=new Date();
    const plan=f.proposal();
    const ticket=signTrustedPlanningCheckpoint({
      snapshot:SNAPSHOT,expectedWorkBranch:CFG.workBranch,proposal:plan,
      keyId:"host-backend",
      privateKeyPem:signing.privateKey.export({
        format:"pem",type:"pkcs8"
      }).toString(),issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+600000).toISOString()
    });
    await writeFile(join(checkpointDir,SNAPSHOT.session_id+".json"),
      JSON.stringify(ticket),{mode:0o600});
    const checkpointStore=new SignedPlanningCheckpointFileStore({
      directory:checkpointDir,trust:{
        trustedKeys:{"host-backend":{
          public_key_pem:signing.publicKey.export({
            format:"pem",type:"spki"
          }).toString()
        }},
        expectedSessionId:SNAPSHOT.session_id,
        expectedRepository:REPO,expectedBaseRevision:SHA,
        expectedWorkBranch:CFG.workBranch
      }
    });
    const admissionStore=new TrustedGithubAdmissionReceiptStore({
      directory:consentDir,hmacSecret:Buffer.alloc(32,99),
      expectedSessionId:SNAPSHOT.session_id
    });
    const githubRepo="DarkGh0st03/delegation";
    const githubRef="refs/heads/refactor/post-prof-plan-contracts-20261021";
    const githubSha="f".repeat(40),runId="39829995555";
    const githubWorkflow=".github/workflows/trusted-gemini-dispatch-preflight.yml";
    const dispatch=verifyGithubManualGeminiDispatch({
      env:{
        GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
        GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:githubRepo,
        GITHUB_REF:githubRef,
        GITHUB_WORKFLOW_REF:githubRepo+"/"+githubWorkflow+"@"+githubRef,
        GITHUB_SHA:githubSha,GITHUB_RUN_ID:runId
      },
      event:{
        repository:{full_name:githubRepo},ref:githubRef,
        inputs:{authorization:"I AUTHORIZE GEMINI API CHARGES",
          model:"gemini-3.8-flash",max_model_turns:"8",
          max_output_tokens:"8000",max_model_call_ms:"30000"}
      },
      pinned:{repository:githubRepo,ref:githubRef,
        workflowPath:githubWorkflow,sourceSha:githubSha}
    });
    // Mock GitHub issuer signs real RS256 JWTs; the real verifier checks
    // their signature, immutable subject, source pins and Actions REST run.
    // Separate push CI verifies the live GitHub issuer; this is offline.
    const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
    const publicJwk=rsa.publicKey.export({format:"jwk"}) as any;
    const ownerId="150908952",repositoryId="1374168963";
    const audience="urn:delegation:trusted-engineer-offline-e2e";
    const expectedSubject="repo:DarkGh0st03@"+ownerId+
      "/delegation@"+repositoryId+":ref:"+githubRef;
    function jwtFor(id:string,changes:Record<string,unknown>={}){
      const now=Math.floor(Date.now()/1000);
      const claims={
        iss:"https://token.actions.githubusercontent.com",aud:audience,
        sub:expectedSubject,iat:now-20,nbf:now-10,exp:now+120,
        jti:"offline-oidc-job-"+id+"-"+randomBytes(8).toString("hex"),
        repository:githubRepo,repository_id:repositoryId,
        repository_owner_id:ownerId,
        ref:githubRef,ref_type:"branch",sha:githubSha,
        workflow_sha:githubSha,
        workflow_ref:githubRepo+"/"+githubWorkflow+"@"+githubRef,
        event_name:"workflow_dispatch",run_id:id,run_attempt:"1",
        ...changes
      };
      const header=Buffer.from(JSON.stringify({
        alg:"RS256",typ:"JWT",kid:"offline-e2e-issuer-key"
      })).toString("base64url");
      const payload=Buffer.from(JSON.stringify(claims)).toString("base64url");
      const data=header+"."+payload;
      return data+"."+signJwt("RSA-SHA256",Buffer.from(data),
        rsa.privateKey).toString("base64url");
    }
    let liveRunStatus:"in_progress"|"completed"="in_progress";
    const githubRunFetch=async(url:RequestInfo|URL)=>{
      const id=String(url).split("/").at(-1);
      return new Response(JSON.stringify({
        id:Number(id),event:"workflow_dispatch",run_attempt:1,
        status:liveRunStatus,head_sha:githubSha,
        head_branch:githubRef.slice("refs/heads/".length),
        path:githubWorkflow,
        head_repository:{full_name:githubRepo},
        created_at:new Date().toISOString()
      }),{status:200});
    };
    oidcServer=await startTrustedGithubOidcIntakeServer({
      pinned:{repository:githubRepo,ref:githubRef,
        workflowPath:githubWorkflow,sourceSha:githubSha},
      trust:{
        expectedAudience:audience,expectedSubject,
        expectedRepositoryId:repositoryId,expectedOwnerId:ownerId
      },
      githubApiToken:"test-only-read-token",
      replayStore:new GithubOidcReplayFileStore(replayDir),
      admissionStore,
      oidcJwksFetchFn:(async()=>new Response(JSON.stringify({keys:[{
        ...publicJwk,kid:"offline-e2e-issuer-key",use:"sig",alg:"RS256"
      }]}),{status:200})) as typeof fetch,
      githubApiFetchFn:githubRunFetch as typeof fetch,port:0
    });
    const event={
      repository:{full_name:githubRepo},ref:githubRef,
      inputs:{
        authorization:dispatch.authorization_input,
        model:dispatch.model_name,
        max_model_turns:String(dispatch.max_model_turns),
        max_output_tokens:String(dispatch.max_output_tokens),
        max_model_call_ms:String(dispatch.max_model_call_ms)
      }
    };
    async function admitRun(id:string,alter:Record<string,unknown>={}){
      const env={
        GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
        GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:githubRepo,
        GITHUB_REF:githubRef,
        GITHUB_WORKFLOW_REF:githubRepo+"/"+githubWorkflow+"@"+githubRef,
        GITHUB_SHA:githubSha,GITHUB_RUN_ID:id
      };
      return fetch(oidcServer!.endpoint,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({env,event,oidcJwt:jwtFor(id,alter)})
      });
    }
    assert.equal((await admitRun(runId,{sub:"repo:attacker/bogus"})).status,403);
    assert.deepEqual(await readdir(consentDir),[]);
    assert.deepEqual(await readdir(replayDir),[]);
    const firstAdmission=await admitRun(runId);
    assert.equal(firstAdmission.status,200);
    assert.equal((await firstAdmission.json()).engineer_approval,"not_checked");
    assert.equal((await readdir(replayDir)).length,1);
    const transports={
      backend:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"backend-token"},
      frontend:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"frontend-token"},
      test:{gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",adapterToken:"test-token"}
    };
    const input={
      coordinator:f.coordinator,reviewGate:f.gate,checkpointStore,
      admissionStore,
      pins:{sessionId:SNAPSHOT.session_id,runId,sourceSha:githubSha,
        repository:githubRepo,ref:githubRef},
      geminiApiKey:"dummy-never-billed",
      githubApiToken:"test-only-read-token",
      githubApiFetchFn:githubRunFetch as typeof fetch,
      expectedWorkflowPath:githubWorkflow,
      transports,operationalRoot:root("urn:operational","102"),
      ports:{backend:30781,frontend:30782,test:30783}
    };
    await assert.rejects(startAdmittedGithubReviewedGeminiHandoff(input),
      /Active verified Planning root/);
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    await assert.rejects(startAdmittedGithubReviewedGeminiHandoff({
      ...input,pins:{...input.pins,sessionId:"attacker-session"}
    }),/independent GitHub admission session differs/);
    // OIDC identity and bounded cost consent, even signed with a valid host
    // HMAC, are NOT Engineer approval. The first run must fail before root
    // issuance and its admission remains irreversibly consumed.
    await assert.rejects(startAdmittedGithubReviewedGeminiHandoff(input));
    assert.equal(f.coordinator.phase,"planning");
    assert.equal(f.issued.length,1);
    await assert.rejects(admissionStore.consume({
      expectedRunId:runId,expectedSourceSha:githubSha,
      expectedSessionId:SNAPSHOT.session_id
    }),/already consumed/);
    // A fresh, independently signed OIDC assertion for another manual run
    // succeeds; the failed first admission must remain consumed.
    const nextRunId="39829995556";
    assert.equal((await admitRun(nextRunId)).status,200);
    assert.equal((await readdir(replayDir)).length,2);
    await f.sign(plan.plan,["permission-1","permission-3"]);
    // A canceled/completed workflow between intake and handoff cannot
    // activate the operational root, despite having a valid HMAC receipt.
    liveRunStatus="completed";
    await assert.rejects(startAdmittedGithubReviewedGeminiHandoff({
      ...input,pins:{...input.pins,runId:nextRunId}
    }),/GitHub API does not corroborate active manual run identity/);
    assert.equal(f.coordinator.phase,"planning");
    assert.equal(f.issued.length,1);
    await assert.rejects(admissionStore.consume({
      expectedRunId:nextRunId,expectedSourceSha:githubSha,
      expectedSessionId:SNAPSHOT.session_id
    }),/already consumed/);
    // A new explicitly dispatched run with a fresh signed OIDC assertion
    // can continue only while GitHub still reports that run in progress.
    liveRunStatus="in_progress";
    const finalRunId="39829995557";
    assert.equal((await admitRun(finalRunId)).status,200);
    assert.equal((await readdir(replayDir)).length,3);
    const running=await startAdmittedGithubReviewedGeminiHandoff({
      ...input,pins:{...input.pins,runId:finalRunId}
    });
    try{
      assert.equal(running.readiness.plan_digest,plan.digest);
      assert.equal(running.readiness.max_model_turns,8);
      assert.equal(running.readiness.max_output_tokens,8000);
      assert.deepEqual(Object.keys(running.endpoints),
        ["backend","frontend","test"]);
      assert.equal(f.coordinator.phase,"execution");
      assert.equal(f.issued.length,2);
      assert.equal(running.githubRunWatch.status,"active");
      await running.githubRunWatch.checkNow();
      assert.equal(f.coordinator.phase,"execution");
      // This run terminates AFTER operational activation; a live status
      // check must automatically stop local A2A and revoke the root.
      liveRunStatus="completed";
      await assert.rejects(running.githubRunWatch.checkNow(),
        /active run identity lost/);
      assert.equal(running.githubRunWatch.status,"closed");
      assert.equal(f.coordinator.phase,"closed");
      assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
      // Once closed, GitHub freshness MUST fail, not succeed as a no-op.
      await assert.rejects(running.githubRunWatch.checkNow(),
        /run not active; Execution is forbidden/);
      // An authenticated plan and minted root from the past cannot be
      // resurrected by a late private dispatcher invocation.
      await assert.rejects(
        running.approvedDag.executeApprovedDag({} as any),
        /run not active; Execution is forbidden/);
      assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
    }finally{await running.close();}
    assert.equal(f.coordinator.phase,"closed");
    assert.deepEqual(f.revoked,["urn:preliminary","urn:operational"]);
    await assert.rejects(admissionStore.consume({
      expectedRunId:runId,expectedSourceSha:githubSha,
      expectedSessionId:SNAPSHOT.session_id
    }),/already consumed/);
  }finally{
    await f.close();
    if(oidcServer)await oidcServer.close();
    await rm(checkpointDir,{recursive:true,force:true});
    await rm(consentDir,{recursive:true,force:true});
    await rm(replayDir,{recursive:true,force:true});
  }
});


test("offline admitted manual bridge loads the SAME authenticated approved DAG without Gemini inference",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:bridge:planning","801"));
    const proposal=f.proposal();
    f.gate.stageTrustedProposal(proposal);
    await f.sign(proposal.plan,proposal.plan.requested_permissions.map(p=>p.id));
    const active=await f.coordinator.beginExecution(root("urn:bridge:operational","802"));
    assert.equal(active.plan_digest,proposal.digest);
    let liveChecks=0,closed=0,orchestratorStarts=0,modelCalls=0;
    const bridge=createReviewedApprovedDagExecution({
      coordinator:f.coordinator,reviewGate:f.gate,
      running:{
        operational_root_id:active.credential_id,
        readiness:{
          session_id:SNAPSHOT.session_id,
          base_revision:SHA,
          plan_digest:proposal.digest,
          authenticated_engineer_did:ENGINEER
        },
        endpoints:{
          backend:"http://127.0.0.1:18831",
          frontend:"http://127.0.0.1:18832",
          test:"http://127.0.0.1:18833"
        }
      } as any,
      async verifyLiveRun(){liveChecks++;},
      async close(){
        closed++;
        if(f.coordinator.phase==="execution")
          await f.coordinator.closeExecution();
      }
    });
    await assert.rejects(bridge.executeApprovedDag({
      a2a:{async sendProtectedTask(){
        modelCalls++;
        throw Error("No role inference should start in this offline check");
      }},
      adapter:{adapterBaseUrl:"http://127.0.0.1:8090",
        bearerToken:"offline-adapter-never-called"},
      async authorityForTask(){
        throw Error("No child root before Orchestrator branch confirmation");
      },
      async invokeOrchestratorTask(taskId,gatewayTaskId){
        orchestratorStarts++;
        assert.equal(taskId,"branch");
        assert.match(gatewayTaskId,/^dispatch_[A-Za-z0-9_-]{22}$/u);
        // Confirms the signed DAG was loaded and the correct first Task was
        // reached. Abort before any mock/paid provider or specialized Agent.
        throw Error("offline signed-DAG bridge reached approved branch Task");
      }
    }),/offline signed-DAG bridge reached approved branch Task/);
    assert.equal(liveChecks,1);
    assert.equal(orchestratorStarts,1);
    assert.equal(modelCalls,0);
    assert.equal(closed,1);
    assert.equal(f.coordinator.phase,"closed");
    assert.ok(f.revoked.includes("urn:bridge:operational"));
  }finally{await f.close();}
});
