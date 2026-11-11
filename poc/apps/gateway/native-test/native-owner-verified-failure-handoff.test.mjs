import test from "node:test";
import assert from "node:assert/strict";
import {completeNativeVerifiedFailureHandoff as handoff} from
 "./native-owner-verified-failure-handoff.mjs";

const sha="a".repeat(40),digest="b".repeat(64),rootId="urn:root:original";
function coordinator(){
 let phase="execution",id=rootId,closeCalls=0;
 return {
  get phase(){return phase;},
  get closeCalls(){return closeCalls;},
  changeRoot(idValue){id=idValue;},
  trustedOperationalAuthority(){
   if(phase!=="execution")throw Error("root is closed");
   return {credential_id:id,plan_digest:digest};
  },
  async closeExecution(){closeCalls++;phase="closed";},
  async assertOperationalClosureConfirmed(){
   assert.equal(phase,"closed");
   assert.equal(closeCalls,1);
  }
 };
}
const evidence=()=>({
 status:"verified_test_failure_suspended",
 verified_test_failure:{
  status:"repair_planning_eligible",
  provenance:"gateway_verified_docker_runner",
  authority_kind:"existing_rust_operational_root",
  session_id:"session-1",root_plan_digest:digest,
  tested_commit_sha:sha,first_failed_phase:"typecheck",
  execution_authorized:false,permission_granted:false
 }
});
function input(c,owner,e=evidence()){
 return {result:e,coordinator:c,sessionId:"session-1",
  rootPlanDigest:digest,operationalRootId:rootId,
  trustedOwnerRecovery:{continueWithinActiveRoot:owner}};
}

test("R150.4 genuine gateway-suspended FAIL invokes owner before native root retirement",async()=>{
 const c=coordinator();const phases=[],seen=[];
 const r=await handoff({...input(c,async(signal)=>{
  assert.equal(c.phase,"execution");
  assert.equal(signal.tested_commit_sha,sha);
  seen.push(signal);
 }),onPilotPhase:p=>phases.push(p)});
 assert.equal(seen.length,1);
 assert.deepEqual(phases,["trusted_owner_repair_handoff"]);
 assert.equal(r.status,"trusted_owner_repair_handoff_retired");
 assert.equal(r.original_dag_completed,false);
 assert.equal(r.final_runner_pass_verified,false);
 assert.equal(r.pull_request_created,false);
 assert.equal(r.original_root_revoked,true);
 assert.equal(c.phase,"closed");
 assert.equal(c.closeCalls,1);
});

test("R150.4 forged feedback cannot invoke owner and retires root",async()=>{
 const c=coordinator();let calls=0;
 const forged=evidence();
 forged.verified_test_failure.provenance="model_claim";
 await assert.rejects(handoff(input(c,async()=>{calls++;},forged)),
  /not eligible/);
 assert.equal(calls,0);
 assert.equal(c.phase,"closed");
});

test("R150.4 uncertain owner error never strands operational authority",async()=>{
 const c=coordinator();
 await assert.rejects(handoff(input(c,async()=>{
  throw Error("simulated provider transport interruption");
 })),/transport interruption/);
 assert.equal(c.closeCalls,1);
 assert.equal(c.phase,"closed");
});

test("R150.4 callback cannot swap Rust root while handing off D1",async()=>{
 const c=coordinator();
 await assert.rejects(handoff(input(c,async()=>{
  c.changeRoot("urn:root:replacement");
 })),/root changed/);
 assert.equal(c.phase,"closed");
 assert.equal(c.closeCalls,1);
});

test("R150.4 missing owner continuation fails closed without PASS",async()=>{
 const c=coordinator();
 await assert.rejects(handoff({...input(c,async()=>{}),
  trustedOwnerRecovery:undefined}),/not eligible/);
 assert.equal(c.phase,"closed");
 assert.equal(c.closeCalls,1);
});
