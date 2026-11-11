import test from "node:test";
import assert from "node:assert/strict";
import {canonicalBranchUri} from "../src/canonical.ts";
import {assertOriginalIncompleteTestFlight}
 from "../src/trusted-authority-only-failed-test-flight.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension";
const grant={resource:canonicalBranchUri(repo,branch),operation:"run_tests" as const};
const root={
 session_id:"session-r340",authority_digest:"a".repeat(64),
 root_credential_id:"root-r340",repository:repo,branch,
 root_permissions:[grant]
};
const row={
 status:"task_registered_preflight_only",task_id:"test-r340",epoch:3,
 agent_id:"test",agent_did:"did:thesis:test",
 session_id:root.session_id,authority_digest:root.authority_digest,
 root_credential_id:root.root_credential_id,permissions:[grant]
};
const child={
 status:"native_child_response_verified_staged",task_id:row.task_id,
 agent_id:"test",agent_did:row.agent_did,epoch:row.epoch,
 credential_id:"child-r340",root_credential_id:root.root_credential_id,
 authority_digest:root.authority_digest,session_id:root.session_id,
 permissions:[grant],expires_at:new Date(Date.now()+60000).toISOString()
};
const flight={
 session_id:root.session_id,authority_digest:root.authority_digest,
 root_credential_id:root.root_credential_id,task_id:row.task_id,
 runtime_task_id:"dispatch_"+"Z".repeat(22),epoch:row.epoch,
 credential_id:child.credential_id,request_id:"req-r340",
 request_fingerprint:"b".repeat(64)
};
const positive=()=>({
 root,row,child,flight,taskId:row.task_id,runtimeTaskId:flight.runtime_task_id,
 approved:[grant],completed:false,predecessorsComplete:true,
 nowMs:Date.now()
});
test("R340 protected original native Test flight is readonly, not a recovered task",()=>{
 const result=assertOriginalIncompleteTestFlight(positive() as never);
 assert.equal(result.status,"gateway_original_test_flight_preflight_only");
 assert.equal(result.agent_did,row.agent_did);
 assert.equal(result.gateway_task_completed,false);
 assert.equal(result.recovery_authorized,false);
 assert.equal(result.gateway_execution_authorized,false);
});
test("R340 foreign Child, Task, scope, exhausted authority or completed Test deny",()=>{
 const base=positive();
 for(const patch of [
  {completed:true},{predecessorsComplete:false},
  {child:{...child,credential_id:"foreign"}},
  {row:{...row,agent_id:"backend"}},
  {flight:{...flight,request_id:"bad!",request_fingerprint:"f".repeat(64)}},
  {root:{...root,root_credential_id:"other"}},
  {approved:[]},
  {child:{...child,expires_at:new Date(Date.now()-60000).toISOString()}}
 ]){
  assert.throws(()=>assertOriginalIncompleteTestFlight({
   ...base,...patch
  } as never),/NO-GO/);
 }
});
