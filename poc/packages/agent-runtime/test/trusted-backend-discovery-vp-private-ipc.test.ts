import assert from "node:assert/strict";
import {test,type TestContext} from "node:test";
import {request as httpRequest} from "node:http";
import {randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {TrustedBackendDiscoveryChildPresenter} from
 "../src/trusted-backend-discovery-presenter.ts";
import {createTrustedBackendDiscoveryVpSignerServer,
 TrustedBackendDiscoveryVpSocketClient} from
 "../src/trusted-backend-discovery-vp-private-ipc.ts";

const credential="urn:r151:backend-discovery-child";
const resource="gitea://gitea.local/acme/service/branches/fix/files/src/app.ts";
const audience="urn:thesis:gateway:r151:discovery";
const permission={resource,operation:"read_file" as const};
const input=(challenge:string)=>({
 credential_id:credential,audience,challenge,disclosed_permissions:[permission]
});
async function setup(t:TestContext,opts:{deferred?:boolean}={}){
 const home=await mkdtemp(join(tmpdir(),"r151-backend-ipc-"));
 const dir=join(home,"private");await mkdir(dir,{mode:0o700});
 const socketPath=join(dir,"backend-vp.sock");
 const secretFile=join(dir,"secret.hex");
 const wrongSecret=join(dir,"wrong.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 await writeFile(wrongSecret,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 let active=true,called=0,enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(ok=>{enter=ok;});
 const hold=new Promise<void>(ok=>{release=ok;});
 const presenter=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://adapter.internal:8090/",
  backendToken:"private-backend-bearer",
  childCredentialId:credential,resource,audience,isTaskActive:()=>active,
  fetchFn:(async(url:unknown,req?:RequestInit)=>{
   called++;
   assert.equal(String(url),"http://adapter.internal:8090/v1/presentations");
   assert.equal(new Headers(req?.headers).get("authorization"),
    "Bearer private-backend-bearer");
   const body=JSON.parse(String(req?.body));
   assert.equal(body.credential_id,credential);
   assert.deepEqual(body.disclosed_permissions,[permission]);
   assert.equal(body.audience,audience);
   assert.match(body.challenge,/^[a-f0-9]{64}$/u);
   if(opts.deferred){enter();await hold;}
   return new Response(JSON.stringify({
    signed_vp:"rust-backend-signed:"+body.challenge
   }),{status:200});
  }) as typeof fetch
 });
 const server=await createTrustedBackendDiscoveryVpSignerServer({
  socketPath,secretFile,presenter,childCredentialId:credential,
  resource,audience,isTaskActive:()=>active
 });
 await server.start();
 t.after(async()=>{release();await server.close();await rm(home,{recursive:true,force:true});});
 const client=await TrustedBackendDiscoveryVpSocketClient.connect({socketPath,secretFile});
 return {client,server,entered,release,close(){active=false;},
  socketPath,wrongSecret,called:()=>called};
}
test("R151.29 signed Child proof crosses private IPC but bearer never does",async t=>{
 const f=await setup(t);
 const a=await f.client.present(input("a".repeat(64)));
 const b=await f.client.present(input("b".repeat(64)));
 assert.equal(a,"rust-backend-signed:"+("a".repeat(64)));
 assert.equal(b,"rust-backend-signed:"+("b".repeat(64)));
 assert.equal(f.called(),2);
 assert.equal([a,b].join("").includes("private-backend-bearer"),false);
});
test("R151.29 rejects changed credential, audience, scope and replay before Adapter",async t=>{
 const f=await setup(t);
 await f.client.present(input("c".repeat(64)));
 for(const p of [
  input("c".repeat(64)),
  {...input("d".repeat(64)),credential_id:"urn:foreign-child"},
  {...input("e".repeat(64)),audience:"urn:thesis:gateway:other"},
  {...input("f".repeat(64)),disclosed_permissions:[
   {resource,operation:"update_file" as const}]},
  {...input("0".repeat(64)),disclosed_permissions:[
   {resource:resource+"-foreign",operation:"read_file" as const}]}
 ]){
  await assert.rejects(f.client.present(p),/Private Backend discovery VP/);
 }
 assert.equal(f.called(),1);
});
test("R151.29 unauthenticated and wrong-HMAC socket requests cannot sign",async t=>{
 const f=await setup(t);
 const status=await new Promise<number>((ok,bad)=>{
  const req=httpRequest({socketPath:f.socketPath,method:"POST",
   path:"/v1/private-backend-discovery-vp"},
  res=>{res.resume();res.once("end",()=>ok(res.statusCode??0));});
  req.once("error",bad);req.end(JSON.stringify(input("1".repeat(64))));
 });
 assert.equal(status,403);
 const wrong=await TrustedBackendDiscoveryVpSocketClient.connect({
  socketPath:f.socketPath,secretFile:f.wrongSecret
 });
 await assert.rejects(wrong.present(input("2".repeat(64))),
  /Private Backend discovery VP denied/);
 assert.equal(f.called(),0);
});
test("R151.29 cancellation or fence denies signed VP without granting Task",async t=>{
 const f=await setup(t);
 f.close();
 await assert.rejects(f.client.present(input("3".repeat(64))),
  /Private Backend discovery VP denied/);
 assert.equal(f.called(),0);
});
test("R151.29 cancellation during native Rust Adapter signing returns no stale VP",async t=>{
 const f=await setup(t,{deferred:true});
 const pending=f.client.present(input("4".repeat(64)));
 await f.entered;
 f.close();f.release();
 await assert.rejects(pending,/Private Backend discovery VP denied/);
 assert.equal(f.called(),1);
});
test("R151.29 owner fence and preexisting listener cannot be bypassed",async t=>{
 const f=await setup(t);
 await assert.rejects(f.server.start(),/already started/);
 f.server.fence();
 await assert.rejects(f.client.present(input("5".repeat(64))),
  /Private Backend discovery VP denied/);
 assert.equal(f.called(),0);
});
