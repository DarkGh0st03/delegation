import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {request as httpRequest} from "node:http";
import {TrustedBackendDiscoveryChildPresenter} from "../src/trusted-backend-discovery-presenter.ts";
import {TrustedBackendDiscoveryTaskSlot} from "../src/trusted-backend-discovery-task-slot.ts";
import {createTrustedBackendDiscoveryTaskBindingServer,
 TrustedBackendDiscoveryTaskBindingSocketClient} from
 "../src/trusted-backend-discovery-task-binding-ipc.ts";

const branch="feature/invoice-approval",path="src/invoices.ts";
const resource="gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts";
const child="urn:child:r151-remote-discovery";
const runtime="dispatch_"+randomBytes(16).toString("base64url");
const pins={
 runtime_task_id:runtime,plan_task_id:"r151-remote-child-task",
 credential_id:child,presenter_id:"did:example:backend",
 branch,path,resource,audience:"cloud-access-gateway" as const
};
async function fixture(t:import("node:test").TestContext){
 const dir=await mkdtemp(join(tmpdir(),"delegation-r15141-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const socketPath=join(dir,"binder.sock"),secretFile=join(dir,"shared.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 let calls=0;
 const holder=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://adapter.internal:8090",
  backendToken:"SECRET_BACKEND_ONLY",childCredentialId:child,resource,
  audience:"cloud-access-gateway",isTaskActive:()=>true,
  fetchFn:(async(_url:unknown,init?:RequestInit)=>{
   calls++;
   assert.equal(new Headers(init?.headers).get("authorization"),
    "Bearer SECRET_BACKEND_ONLY");
   const b=JSON.parse(String(init?.body));
   assert.deepEqual(b.disclosed_permissions,[{resource,operation:"read_file"}]);
   return new Response(JSON.stringify({signed_vp:"native:"+b.challenge}));
  }) as typeof fetch
 });
 const slot=new TrustedBackendDiscoveryTaskSlot({
  holder,planTaskId:pins.plan_task_id,childCredentialId:child,
  presenterId:pins.presenter_id,
  repository:{authority:"gitea.local",owner:"sample",repository:"invoice-service"},
  branch,path,resource,audience:"cloud-access-gateway"
 });
 const server=await createTrustedBackendDiscoveryTaskBindingServer({
  socketPath,secretFile,slot
 });
 await server.start();t.after(()=>server.close());
 const client=await TrustedBackendDiscoveryTaskBindingSocketClient.connect({
  socketPath,secretFile
 });
 return {slot,client,socketPath,secretFile,server,get calls(){return calls;}};
}
test("R151.41 owner HMAC IPC prebinds exact Backend Child and safely retires it",async t=>{
 const f=await fixture(t);
 assert.equal((await f.client.prepare(pins)).status,
  "backend_discovery_read_prebound_not_executed");
 const context={
  task_id:"real-a2a-id",context_id:"ctx",role:"backend" as const,
  trusted_gateway_task_id:runtime,
  subtask:{subtask_id:pins.plan_task_id,instruction:"Read only",branch,
   relevant_paths:[path],approved_file_permissions:[{operation:"read_file" as const,path}],
   approved_run_tests:false},
  delegation_evidence:{credential:"PRIVATE_DC",
   credential_id:child,presenter_id:pins.presenter_id}
 };
 const signed=f.slot.bindingFor(context);
 assert.ok(signed);
 const challenge=randomBytes(32).toString("base64url");
 assert.equal(await signed!.createSignedPresentation({
  request_id:"prebound-gateway",challenge,
  audience:"cloud-access-gateway",
  required_permission:{resource,operation:"read_file"},
  expires_at:new Date(Date.now()+30000).toISOString()
 }),"native:"+challenge);
 assert.equal(f.calls,1);
 await assert.rejects(f.client.prepare(pins),/binding denied/);
 await f.client.fence(runtime);
 await assert.rejects(signed!.createSignedPresentation({
  request_id:"too-late",challenge:randomBytes(32).toString("base64url"),
  audience:"cloud-access-gateway",required_permission:{resource,operation:"read_file"},
  expires_at:new Date(Date.now()+30000).toISOString()
 }),/closed or cancelled/);
 assert.equal(f.calls,1);
});
test("R151.41 unauthenticated and foreign requests never bind or sign",async t=>{
 const f=await fixture(t);
 let status=0;
 await new Promise<void>((ok,bad)=>{
  const wire=Buffer.from(JSON.stringify({action:"prepare",pins}));
  const req=httpRequest({socketPath:f.socketPath,
   path:"/v1/private-backend-discovery-task-binding",method:"POST",
   headers:{"content-type":"application/json","content-length":wire.length,
    "x-backend-bind-time":String(Date.now()),
    "x-backend-bind-nonce":randomBytes(16).toString("base64url"),
    "x-backend-bind-mac":"0".repeat(64)}
  },res=>{status=res.statusCode??0;res.resume();res.on("end",ok);});
  req.on("error",bad);req.end(wire);
 });
 assert.equal(status,403);
 await assert.rejects(f.client.prepare({...pins,resource:resource+"-foreign"}),
  /binding denied/);
 assert.equal(f.calls,0);
 // A malformed authenticated attempt is one-use fail-closed.
 await assert.rejects(f.client.prepare(pins),/binding denied/);
 assert.equal(f.calls,0);
});

test("R151.41.1 Backend socket shutdown revokes signer even with active bound Task",async t=>{
 const f=await fixture(t);
 await f.client.prepare(pins);
 const context={
  task_id:"r15141-a2a",context_id:"ctx",role:"backend" as const,
  trusted_gateway_task_id:runtime,
  subtask:{subtask_id:pins.plan_task_id,instruction:"Read",branch,
   relevant_paths:[path],approved_file_permissions:[{operation:"read_file" as const,path}],
   approved_run_tests:false},
  delegation_evidence:{credential:"PRIVATE",credential_id:child,
   presenter_id:pins.presenter_id}
 };
 const holder=f.slot.bindingFor(context);
 assert.ok(holder);
 await f.server.close();
 await assert.rejects(holder!.createSignedPresentation({
  request_id:"post-shutdown",audience:"cloud-access-gateway",
  challenge:randomBytes(32).toString("base64url"),
  required_permission:{resource,operation:"read_file"},
  expires_at:new Date(Date.now()+30000).toISOString()
 }),/closed or cancelled/);
 assert.equal(f.calls,0);
 await assert.rejects(f.client.prepare(pins));
});

test("R151.48.1 authenticated source IPC denies missing source and foreign Task",async t=>{
 const f=await fixture(t);
 await f.client.prepare(pins);
 await assert.rejects(f.client.takeSource(pins.runtime_task_id),
  /Backend private Task binding denied/);
 const foreign="dispatch_"+randomBytes(16).toString("base64url");
 await assert.rejects(f.client.takeSource(foreign),
  /Backend private Task binding denied/);
 const text="export const x=42;\n";
 f.slot.captureGatewaySource(pins.runtime_task_id,{
  provider:"gitea",performed:true,tool:"read_file",
  branch,path,revision:"a".repeat(40),content:text,
  size:Buffer.byteLength(text,"utf8"),encoding:"utf-8"
 });
 const delivered=await f.client.takeSource(pins.runtime_task_id);
 assert.equal(delivered.content,text);
 assert.equal(delivered.branch,branch);
 assert.equal(delivered.path,path);
 assert.equal(delivered.revision,"a".repeat(40));
 assert.equal(Object.keys(delivered).includes("source_base64"),false);
 assert.ok(Object.isFrozen(delivered));
 await assert.rejects(f.client.takeSource(pins.runtime_task_id),
  /Backend private Task binding denied/);
 await f.client.fence(pins.runtime_task_id);
});
