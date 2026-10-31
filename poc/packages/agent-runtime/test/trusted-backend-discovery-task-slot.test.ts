import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {TrustedBackendDiscoveryChildPresenter} from "../src/trusted-backend-discovery-presenter.ts";
import {TrustedBackendDiscoveryTaskSlot} from "../src/trusted-backend-discovery-task-slot.ts";
const branch="feature/invoice-approval",path="src/invoices.ts";
const resource="gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts";
const credential="urn:child:r151-remote-discovery";
const repo={authority:"gitea.local",owner:"sample",repository:"invoice-service"};
const planTaskId="r151-remote-child-task";
const runtime="dispatch_"+randomBytes(16).toString("base64url");
function fixture(){
 let signatures=0;
 const holder=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://adapter.internal:8090",
  backendToken:"private-backend-secret",childCredentialId:credential,
  resource,audience:"cloud-access-gateway",isTaskActive:()=>true,
  fetchFn:(async(_url:unknown,init?:RequestInit)=>{
   signatures++;
   assert.equal(new Headers(init?.headers).get("authorization"),
    "Bearer private-backend-secret");
   const p=JSON.parse(String(init?.body));
   assert.equal(p.credential_id,credential);
   assert.deepEqual(p.disclosed_permissions,[{resource,operation:"read_file"}]);
   return new Response(JSON.stringify({
    signed_vp:"backend-rust-child:"+p.challenge
   }),{status:200});
  }) as typeof fetch
 });
 const slot=new TrustedBackendDiscoveryTaskSlot({
  holder,planTaskId,childCredentialId:credential,
  presenterId:"did:example:backend",repository:repo,
  branch,path,resource,audience:"cloud-access-gateway"
 });
 const pins={
  runtime_task_id:runtime,plan_task_id:planTaskId,
  credential_id:credential,presenter_id:"did:example:backend",
  branch,path,resource,audience:"cloud-access-gateway" as const
 };
 const context={
  task_id:"backend-a2a-runtime",trusted_gateway_task_id:runtime,
  role:"backend" as const,context_id:"ctx",
  delegation_evidence:{credential:"PRIVATE_DC",
   credential_id:credential,presenter_id:"did:example:backend"},
  subtask:{subtask_id:planTaskId,instruction:"Read source",branch,
   relevant_paths:[path],approved_run_tests:false,
   approved_file_permissions:[{operation:"read_file" as const,path}]}
 };
 return {slot,pins,context,get signatures(){return signatures;}};
}
test("R151.40 private Backend slot binds one Gateway-dispatched Child and signs exact read",async()=>{
 const f=fixture();
 assert.equal(f.slot.bindingFor(f.context),undefined);
 const result=await f.slot.prepare(f.pins);
 assert.equal(result.runtime_task_id,runtime);
 assert.equal(result.execution_authorized,false);
 assert.equal(result.source_read,false);
 const presentation=f.slot.bindingFor(f.context);
 assert.ok(presentation);
 const challenge=randomBytes(32).toString("base64url");
 assert.equal(await presentation!.createSignedPresentation({
  request_id:"req-r15140",audience:"cloud-access-gateway",challenge,
  required_permission:{resource,operation:"read_file"},
  expires_at:new Date(Date.now()+30000).toISOString()
 }),"backend-rust-child:"+challenge);
 assert.equal(f.signatures,1);
 await assert.rejects(f.slot.prepare(f.pins),/already consumed/);
 await f.slot.fence(runtime);
 await assert.rejects(presentation!.createSignedPresentation({
  request_id:"next-request",audience:"cloud-access-gateway",
  challenge:randomBytes(32).toString("base64url"),
  required_permission:{resource,operation:"read_file"},
  expires_at:new Date(Date.now()+30000).toISOString()
 }),/closed or cancelled/);
 assert.equal(f.signatures,1);
});
test("R151.40 mismatched dispatch, Child or A2A permissions cannot select signer",async()=>{
 const f=fixture();
 const fake={
  ...f.context,subtask:{...f.context.subtask,
   approved_file_permissions:[{operation:"update_file",path}]}
 };
 assert.equal(f.slot.bindingFor(fake as typeof f.context),undefined);
 await f.slot.prepare(f.pins);
 assert.throws(()=>f.slot.bindingFor(fake as typeof f.context),
  /Trusted Backend discovery A2A NO-GO/);
 assert.throws(()=>f.slot.bindingFor({...f.context,
  trusted_gateway_task_id:"foreign"}),/Trusted Backend discovery A2A NO-GO/);
 await assert.rejects(f.slot.fence("dispatch_"+randomBytes(16).toString("base64url")),
  /foreign Task/);
 await f.slot.fence(runtime);
});
test("R151.40 unknown control requests consume slot without issuing authority",async()=>{
 for(const changed of [{credential_id:"foreign"},{resource:resource+"x"},
  {runtime_task_id:"not-a-dispatch"},{branch:"feature/foreign"}]){
  const f=fixture();
  await assert.rejects(f.slot.prepare({...f.pins,...changed}),
   /Trusted Backend discovery slot NO-GO/);
  await assert.rejects(f.slot.prepare(f.pins),/already consumed/);
  assert.equal(f.slot.bindingFor(f.context),undefined);
  assert.equal(f.signatures,0);
 }
});
