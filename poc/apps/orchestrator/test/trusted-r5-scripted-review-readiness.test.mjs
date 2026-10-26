import test from "node:test";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {makeApproval,PLAN_SCHEMA_VERSION} from "../../../packages/plan-contracts/src/plan.mjs";
import {SignedEngineerApprovalFileStore} from "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import assert from "node:assert/strict";
import {planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {assertR5AuthenticSignedReviewReady}
  from "../src/trusted-r5-scripted-review-readiness.mjs";
const SHA="a".repeat(40);
const SID="r5-signed-human-approval-gate";
const plan={
  version:1,plan_id:"r5-plan",session_id:SID,base_revision:SHA,
  repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
  tasks:[],requested_permissions:[]
};
const DIGEST=planDigest(plan);
function fake({
  signed=true,phase="planning",checkpointDigest=DIGEST,
  packetDigest=DIGEST,approvedPlan=plan,rootSha=SHA,
  onRead
}={}){
  const counts={checkpoint:0,packet:0,approval:0};
  const coordinator={phase,trustedPlanningAuthority:()=>({
    session_id:SID,base_revision:rootSha
  })};
  const checkpointStore={async load(){
    counts.checkpoint++;
    onRead?.("checkpoint");
    return {snapshot:{session_id:SID,base_revision:SHA},
      proposal:{digest:checkpointDigest,plan},
      expected_work_branch:"feature/account-suspension"};
  }};
  const reviewGate={
    reviewPacket(){
      counts.packet++;
      onRead?.("packet");
      return {session_id:SID,base_revision:SHA,plan_digest:packetDigest,
        work_branch:"feature/account-suspension",plan};
    },
    async loadAuthenticatedApproval(){
      counts.approval++;
      onRead?.("approval");
      if(!signed)throw Error("ENOENT: genuine Engineer receipt missing");
      return {plan:approvedPlan,approval:{
        session_id:SID,approved_by:"did:example:engineer"
      },authenticated_engineer_did:"did:example:engineer"};
    }
  };
  return {coordinator,checkpointStore,reviewGate,
    expectedSessionId:SID,expectedBaseRevision:SHA,counts};
}
test("R5 signed review readiness has no authority; never treats checkpoint as human consent",async()=>{
  const obj=fake();
  const verified=await assertR5AuthenticSignedReviewReady(obj);
  assert.equal(verified.status,
    "signed_human_review_verified_only_not_oidc_admitted");
  assert.equal(verified.plan_digest,DIGEST);
  assert.equal(verified.operational_root_issued,false);
  assert.equal(verified.dag_executed,false);
  assert.deepEqual(obj.counts,{checkpoint:1,packet:1,approval:1});
  assert.equal(Object.isFrozen(verified),true);
});
test("R5 missing human signature refuses before any single-use GitHub receipt consumption",async()=>{
  const x=fake({signed:false});
  await assert.rejects(assertR5AuthenticSignedReviewReady(x),
    /genuine Engineer receipt missing/);
  assert.deepEqual(x.counts,{checkpoint:1,packet:1,approval:1});
});
test("R5 mismatched Backend signed digest or staged plan refuses before Engineer read",async()=>{
  for(const f of [
    {checkpointDigest:"b".repeat(64)},
    {packetDigest:"b".repeat(64)},
    {rootSha:"b".repeat(40)}
  ]){
    const x=fake(f);
    await assert.rejects(assertR5AuthenticSignedReviewReady(x),
      /signed-review readiness denied/);
    assert.equal(x.counts.approval,0);
  }
});
test("R5 cannot accept a different human-approved plan or a dead Coordinator",async()=>{
  const changed={...plan,plan_id:"substitution"};
  const swapped=fake({approvedPlan:changed});
  await assert.rejects(assertR5AuthenticSignedReviewReady(swapped),
    /signed-review readiness denied/);
  for(const phase of ["idle","execution","closed"]){
    const inactive=fake({phase});
    await assert.rejects(assertR5AuthenticSignedReviewReady(inactive),
      /original active Planning/);
    assert.equal(inactive.counts.approval,0);
  }
});
test("R5 retirement racing signature verification denies promotion",async()=>{
  let target;
  const x=fake({onRead:step=>{
    if(step==="approval")target.coordinator.phase="closed";
  }});
  target=x;
  await assert.rejects(assertR5AuthenticSignedReviewReady(x),
    /Planning authority retired/);
});


test("R5 review readiness verifies a REAL Ed25519 receipt against pinned Engineer public key",async()=>{
  const root=await mkdtemp(join(tmpdir(),"r5-independent-review-signature-"));
  const approvals=join(root,"receipts");
  await mkdir(approvals,{mode:0o700});
  try{
    const pair=generateKeyPairSync("ed25519");
    const did="did:example:engineer";
    const validPlan={
      schema_version:PLAN_SCHEMA_VERSION,
      plan_id:"r5-independent-approval",
      session_id:SID,version:1,
      repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
      base_revision:SHA,requirement:"Review isolated branch",
      candidate_agents:[],
      tasks:[{id:"branch",agent_id:"orchestrator",
        title:"Create reviewed feature branch",
        description:"Never write main",depends_on:[],
        resources:["gitea://thesis/iam/branches/feature/r5"]}],
      requested_permissions:[{id:"perm-branch",
        task_id:"branch",agent_id:"orchestrator",
        resource:"gitea://thesis/iam/branches/feature/r5",
        operation:"create_branch",reason:"Isolated reviewed branch"}],
      assumptions:[],uncertainties:[]
    };
    const time=new Date().toISOString();
    const approval=makeApproval(validPlan,{
      allowedOperations:new Set(["create_branch"]),
      decision_id:"review-one",approved_by:did,approved_at:time,
      approved_permission_ids:["perm-branch"]
    });
    const envelope=signEngineerApproval({
      plan:validPlan,approval,engineerDid:did,keyId:"engineer-ed25519",
      privateKeyPem:pair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
      issuedAt:time,expiresAt:new Date(Date.now()+60_000).toISOString()
    });
    const receiptPath=join(approvals,SID+".json");
    await writeFile(receiptPath,JSON.stringify(envelope),{mode:0o600});
    const store=new SignedEngineerApprovalFileStore({
      directory:approvals,engineerDid:did,
      trustedKeys:{"engineer-ed25519":{
        engineer_did:did,
        public_key_pem:pair.publicKey.export({type:"spki",format:"pem"}).toString()
      }}
    });
    const obj=fake();
    const digest=planDigest(validPlan);
    obj.checkpointStore.load=async()=>({
      snapshot:{session_id:SID,base_revision:SHA},
      proposal:{digest,plan:validPlan},
      expected_work_branch:"feature/account-suspension"
    });
    obj.reviewGate.reviewPacket=()=>({
      session_id:SID,base_revision:SHA,
      plan_digest:digest,plan:validPlan,
      work_branch:"feature/account-suspension"
    });
    obj.reviewGate.loadAuthenticatedApproval=async id=>
      store.loadAuthenticatedApproval(id);
    const result=await assertR5AuthenticSignedReviewReady(obj);
    assert.equal(result.plan_digest,digest);
    assert.equal(result.authenticated_engineer_did,did);
    assert.equal(result.operational_root_issued,false);
    const altered={...envelope,approval:{
      ...envelope.approval,approved_permission_ids:["attacker-branch"]
    }};
    await writeFile(receiptPath,JSON.stringify(altered),{mode:0o600});
    await assert.rejects(assertR5AuthenticSignedReviewReady(obj),
      /signature|invalid/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
