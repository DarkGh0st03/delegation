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
import {TrustedEngineerAuthoritySession}
  from "../src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "../src/trusted-execution-coordinator.ts";

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
  const credentials={
    async issueScopedOrchestratorRoot(input:any){
      issued.push({id:input.credential_id,
        permissions:structuredClone(input.permissions)});
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

test("substituted signed permission decision after root issuance is rejected by Gateway and revokes root",async()=>{
  const f=await fixture();
  try{
    await f.coordinator.beginPlanning(root("urn:preliminary","101"));
    const p=f.proposal();f.gate.stageTrustedProposal(p);
    await f.sign(p.plan,["permission-1","permission-3"]);
    // Standalone gate load freezes first signed decision, just as authority
    // loads it immediately before issuing the independent root.
    await f.gate.loadAuthenticatedApproval(SNAPSHOT.session_id);
    await f.sign(p.plan,["permission-1","permission-2"]);
    await assert.rejects(f.gate.loadAuthenticatedApproval(SNAPSHOT.session_id),
      /signed permission decision changed/);
    assert.deepEqual(f.revoked,[]);
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
