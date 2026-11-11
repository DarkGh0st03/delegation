import test from "node:test";
import assert from "node:assert/strict";
import {validateTrustedBackendDiscoveryBindAck} from
 "../src/trusted-remote-discovery-a2a-handoff.ts";

const pins={
 runtime_task_id:"dispatch_"+Buffer.alloc(16,42).toString("base64url"),
 plan_task_id:"r151-remote-child-task",
 credential_id:"urn:child:r151-remote-discovery",
 presenter_id:"did:example:backend",
 resource:"gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts"
};
const correct=()=>({
 ...pins,status:"backend_discovery_read_prebound_not_executed" as const,
 execution_authorized:false as const,source_read:false as const
});
test("R151.39 exact authenticated Backend holder receipt is source-free",()=>{
 assert.doesNotThrow(()=>validateTrustedBackendDiscoveryBindAck(correct(),pins));
 assert.equal(JSON.stringify(correct()).includes("signed_vp"),false);
 assert.equal(JSON.stringify(correct()).includes("token"),false);
});
test("R151.39 foreign Task, credential, issuer or grant cannot prebind A2A",()=>{
 const cases=[
  {runtime_task_id:"dispatch_foreign_task"},
  {plan_task_id:"foreign-discovery-task"},
  {credential_id:"urn:child:other"},
  {presenter_id:"did:example:foreign"},
  {resource:pins.resource+"-foreign"},
  {execution_authorized:true},
  {source_read:true},
  {status:"already-executed"},
  {extra:"untrusted"},
  {signed_vp:"forbidden"},
  {backend_token:"forbidden"}
 ];
 for(const bad of cases){
  assert.throws(()=>validateTrustedBackendDiscoveryBindAck({
   ...correct(),...bad
  } as ReturnType<typeof correct>,pins),
  /Trusted remote discovery A2A NO-GO/);
 }
 for(const invalid of [null,{},[],true,"ok",undefined]){
  assert.throws(()=>validateTrustedBackendDiscoveryBindAck(
   invalid as ReturnType<typeof correct>,pins),
   /Trusted remote discovery A2A NO-GO/);
 }
});
