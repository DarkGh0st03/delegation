import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {boundedTrustedRepairDiscoveryObservation} from
 "../src/trusted-operational-repair-planner.ts";
const pins={
 session_id:"r15144-session",epoch:1,task_id:"r151-remote-child-task",
 runtime_task_id:"dispatch_"+Buffer.alloc(16,42).toString("base64url"),
 resource:"gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts",
 branch:"feature/invoice-approval",tested_commit_sha:"a".repeat(40)
};
const proven=()=>({
 status:"gateway_confirmed_exact_sha_discovery_read_no_repair_authority",
 session_id:pins.session_id,epoch:pins.epoch,task_id:pins.task_id,
 runtime_task_id:pins.runtime_task_id,resource:pins.resource,
 branch:pins.branch,revision:pins.tested_commit_sha,
 request_id:"gateway-request-r15144",credential_id:"urn:child:r151-read",
 source_sha256:createHash("sha256").update("export const ok=true;").digest("hex"),
 source_bytes:21,
 gateway_provider_corroborated:true,source_disclosed:false,
 repair_dag_authorized:false,pr_authorized:false
});
test("R151.44 evidence reduction retains only source-free, non-authorizing metadata",()=>{
 const v=boundedTrustedRepairDiscoveryObservation(proven(),pins);
 assert.deepEqual(v,{status:"gateway_discovery_read_confirmed_no_authority",
  resource:pins.resource,branch:pins.branch,
  tested_commit_sha:pins.tested_commit_sha,operation:"read_file"});
 assert.ok(Object.isFrozen(v));
 const serialized=JSON.stringify(v);
 for(const token of ["gateway-request-r15144","urn:child","signed_vp",
  "content","credential_id","repair_dag_authorized","pr_authorized"])
  assert.equal(serialized.includes(token),false);
});
test("R151.44 reject wrong source, SHA, Task, identity, synthetic grant and secret-bearing receipt",()=>{
 for(const change of [
  {revision:"b".repeat(40)},{task_id:"other-task"},
  {runtime_task_id:"another-task"},{session_id:"other-session"},
  {epoch:2},{resource:pins.resource+"-foreign"},
  {branch:"feature/other"},{source_disclosed:true},
  {gateway_provider_corroborated:false},
  {repair_dag_authorized:true},{pr_authorized:true},
  {status:"a2a_reported_read"},{request_id:"invalid/id"},
  {credential_id:"invalid/credential"},
  {source_sha256:"a".repeat(63)},{source_bytes:32769},
  {source_bytes:-1},{source_bytes:1.1},
  {content:"source"}, {signed_vp:"forbidden"}
 ]){
  assert.throws(()=>boundedTrustedRepairDiscoveryObservation({
   ...proven(),...change
  },pins),/Trusted repair planner NO-GO/);
 }
 for(const bad of [null,undefined,{},[],true,"done"])
  assert.throws(()=>boundedTrustedRepairDiscoveryObservation(bad,pins),
   /Trusted repair planner NO-GO/);
});
