import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
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
import {TrustedEngineerAuthoritySession}
  from "../src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "../src/trusted-execution-coordinator.ts";
import {verifyManualGeminiExecutionReadiness,createReviewedGeminiAdkModel,
  createReviewedGeminiA2ARoleRuntime,startReviewedGeminiA2AServers}
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
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),"approved-review-"));
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
    completionAttestor:{async confirmCompleted(){return false;}}
  });
  coordinator=new TrustedExecutionCoordinator({
    authority,approvedGatewayPlans:plans,credentials,
    sessionId:SNAPSHOT.session_id,baseRevision:SHA
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
    close:()=>rm(directory,{recursive:true,force:true})};
}

test("signed Engineer review exactly binds Planner digest and approved subset to operational root/Gateway",async()=>{
  const f=await fixture();
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
    const active=await f.coordinator.beginExecution(root("urn:operational","102"));
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
