import test from "node:test";
import assert from "node:assert/strict";
import {PLAN_SCHEMA_VERSION,makeApproval,planDigest}
  from "../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../apps/gateway/src/operation-catalog.ts";
import {validateR5SignedRevocationInventory}
  from "../r5-signed-revocation-inventory.mjs";

const SHA="a".repeat(40),RUN="40470000114",DID="did:example:engineer";
const REPO={authority:"gitea.local",owner:"thesis",repository:"iam"};
const ROOT="gitea://gitea.local/thesis/iam";
const BRANCH=ROOT+"/branches/feature%2Fworking";
const FILE=BRANCH+"/files/src/main.ts";
const steps=[
  ["branch","orchestrator","create_branch",ROOT],
  ["backend","backend","read_file",FILE],
  ["frontend","frontend","read_file",FILE],
  ["test","test","run_tests",BRANCH],
  ["pr","orchestrator","create_pull_request",ROOT]
];
function fixture(){
  const plan={
    schema_version:PLAN_SCHEMA_VERSION,plan_id:"r5-ledger-audit",
    session_id:"r5-original",version:1,repository:REPO,base_revision:SHA,
    requirement:"Check approved credential statuses",
    candidate_agents:["backend","frontend","test"].map(role=>({
      agent_id:role,did:"did:example:"+role,card_ref:"private:"+role
    })),
    tasks:steps.map(([id,agent_id,,resource],i)=>({
      id,agent_id,title:id,description:"Signed "+id,
      depends_on:i?[steps[i-1][0]]:[],resources:[resource]
    })),
    requested_permissions:steps.map(([task_id,agent_id,operation,resource])=>({
      id:"p-"+task_id,task_id,agent_id,operation,resource,reason:"Approved "+task_id
    })),assumptions:[],uncertainties:[]
  };
  const digest=planDigest(plan);
  const approval=makeApproval(plan,{
    allowedOperations:new Set(RUST_OPERATIONS),decision_id:"owner-signature",
    approved_by:DID,approved_at:"2026-10-27T00:00:00Z",
    approved_permission_ids:steps.map(([id])=>"p-"+id)
  });
  const ownerEvidence={
    schema:"r5-scripted-owner-completion-v1",
    status:"verified_complete_local_owner_observation",
    source_sha:SHA,github_run_id:RUN,session_id:plan.session_id,
    approved_plan_digest:digest,approved_task_ids:steps.map(x=>x[0]),
    completed_task_ids:steps.map(x=>x[0]),
    authenticated_engineer_did:DID,coordinator_terminal_phase:"closed",
    original_runtime_returned_success:true,
    independently_attested:false,provider_model_calls_verified_here:false,
    external_r5_go:false
  };
  const inventory={
    schema:"r5-credential-issuance-inventory-v1",
    source_sha:SHA,github_run_id:RUN,session_id:plan.session_id,
    approved_plan_digest:digest,
    preliminary_root_id:"urn:r5:planning",
    operational_root_id:"urn:r5:execution",
    task_children:["backend","frontend","test"].map(task_id=>({
      task_id,credential_id:"urn:r5:child:"+task_id
    }))
  };
  return {ownerEvidence,inventory,authenticatedReview:{
    plan,approval,authenticated_engineer_did:DID
  }};
}
test("R5 exact signed task coverage includes every specialized role, no false issuance claim",()=>{
  const r=validateR5SignedRevocationInventory(fixture());
  assert.equal(r.specialized_task_count,3);
  assert.equal(r.issuance_ledger_completeness_independently_verified,false);
  assert.equal(r.external_r5_go,false);
});
test("R5 multiple signed Backend Tasks cannot hide a missing fourth child",()=>{
  const f=fixture();
  const p=f.authenticatedReview.plan;
  p.tasks.push({...p.tasks[1],id:"backend_second",depends_on:["backend"]});
  p.requested_permissions.push({
    ...p.requested_permissions[1],id:"p-backend_second",task_id:"backend_second"
  });
  f.authenticatedReview.approval.approved_permission_ids.push("p-backend_second");
  const digest=planDigest(p);
  f.authenticatedReview.approval.plan_digest=digest;
  f.ownerEvidence.approved_plan_digest=digest;
  f.ownerEvidence.approved_task_ids.push("backend_second");
  f.ownerEvidence.completed_task_ids.push("backend_second");
  f.inventory.approved_plan_digest=digest;
  assert.throws(()=>validateR5SignedRevocationInventory(f),/NO-GO/);
  f.inventory.task_children.push({
    task_id:"backend_second",credential_id:"urn:r5:child:backend-second"
  });
  assert.equal(validateR5SignedRevocationInventory(f).specialized_task_count,4);
});
test("R5 rejects swapped Task, forged digest or missing Engineer-granted specialized permissions",()=>{
  for(const mutate of [
    f=>f.inventory.task_children[0].task_id="branch",
    f=>f.inventory.task_children.push({
      task_id:"branch",credential_id:"urn:extra"
    }),
    f=>f.ownerEvidence.approved_task_ids.push("inject"),
    f=>f.authenticatedReview.authenticated_engineer_did="did:evil",
    f=>f.authenticatedReview.plan.base_revision="c".repeat(40),
    f=>f.authenticatedReview.approval.approved_permission_ids=
      f.authenticatedReview.approval.approved_permission_ids.filter(x=>x!=="p-test")
  ]){
    const f=fixture();mutate(f);
    assert.throws(()=>validateR5SignedRevocationInventory(f),/NO-GO/);
  }
});
