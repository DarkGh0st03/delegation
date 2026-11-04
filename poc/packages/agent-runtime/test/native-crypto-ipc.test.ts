import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {invokeNativeCrypto} from "../src/native-crypto-ipc.ts";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";

async function fixture(t:import("node:test").TestContext,
 callback:(value:Record<string,unknown>)=>unknown){
 const dir=mkdtempSync(join(tmpdir(),"delegation-r206-"));
 const path=join(dir,"native.sock");
 const calls:Record<string,unknown>[]=[];
 const server=createServer({allowHalfOpen:true},socket=>{
  let input="";
  socket.on("data",b=>input+=b.toString("utf8"));
  socket.on("end",()=>{
   try{
    const request=JSON.parse(input) as Record<string,unknown>;
    calls.push(request);
    socket.end(JSON.stringify(callback(request)));
   }catch{socket.destroy();}
  });
 });
 await new Promise<void>(resolve=>server.listen(path,resolve));
 t.after(async()=>{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  rmSync(dir,{recursive:true,force:true});
 });
 return {path,calls};
}

test("R206 native Rust transport binds Child DC and VP to the same local issuer",async t=>{
 const f=await fixture(t,input=>({ok:true,result:input.operation==="issue_child"
  ?{id:"urn:child:42",credentialSubject:{per:[{resource:"gitea://trusted",operation:"read_file"}]}}
  :{signed_vp:"private.signed.jwt"}}));
 const options={socketPath:f.path,token:"PRIVATE_ORCHESTRATOR_BEARER"};
 const issued=await invokeNativeCrypto(options,"issue_child",{
  credential_id:"urn:child:42",permissions:[{resource:"gitea://trusted",operation:"read_file"}]
 }) as {id:string};
 assert.equal(issued.id,"urn:child:42");
 const vp=await invokeNativeCrypto(options,"create_presentation",{
  credential_id:"urn:child:42",audience:"cloud-access-gateway",
  challenge:"trusted-gateway-nonce"
 }) as {signed_vp:string};
 assert.equal(vp.signed_vp,"private.signed.jwt");
 assert.equal(f.calls.length,2);
 assert.ok(f.calls.every(x=>x.token==="PRIVATE_ORCHESTRATOR_BEARER"));
 assert.deepEqual(f.calls.map(x=>x.operation),["issue_child","create_presentation"]);
});

test("R206 native Rust transport never falls back to HTTP or leaks failures",async t=>{
 const f=await fixture(t,()=>({ok:false,error:"PRIVATE_SIGNER_KEY"}));
 await assert.rejects(invokeNativeCrypto({
  socketPath:f.path,token:"PRIVATE_BEARER"
 },"create_presentation",{credential_id:"any"}),(e:unknown)=>{
  assert.doesNotMatch(String(e),/PRIVATE_SIGNER_KEY/u);
  assert.match(String(e),/authorization denied/u);
  return true;
 });
 assert.equal(f.calls.length,1);
 await assert.rejects(invokeNativeCrypto({
  socketPath:"relative.sock",token:"PRIVATE_BEARER"
 },"issue_child",{}),/transport unavailable/u);
});

test("R213 signed VP handler never falls back to Adapter HTTP when native socket exists",async t=>{
 const signed=await fixture(t,request=>({
  ok:true,result:{signed_vp:"native.private.vp"}
 }));
 let httpRequests=0;
 const handler=new DelegationEvidenceHandler({
  adapterBaseUrl:"http://127.0.0.1:1",adapterToken:"PRIVATE_BACKEND_TOKEN",
  nativeSocketPath:signed.path,
  evidence:{
   credential:"private.opaque.child",credential_id:"urn:child:42",
   presenter_id:"did:thesis:backend"
  },
  fetchFn:(async()=>{httpRequests++;throw Error("Forbidden HTTP Adapter fallback");}) as typeof fetch
 });
 const request={
  request_id:"native-task-1",audience:"cloud-access-gateway",
  challenge:"trusted-gateway-challenge",expires_at:new Date(Date.now()+60_000).toISOString(),
  required_permission:{resource:"gitea://trusted/files/a.ts",operation:"read_file"}
 };
 assert.equal(await handler.createPresentation(request),"native.private.vp");
 assert.equal(httpRequests,0);
 assert.equal(signed.calls.length,1);
 assert.equal(signed.calls[0].operation,"create_presentation");
 assert.equal(signed.calls[0].token,"PRIVATE_BACKEND_TOKEN");
 assert.deepEqual(signed.calls[0].body,{
  credential_id:"urn:child:42",
  disclosed_permissions:[request.required_permission],
  audience:request.audience,challenge:request.challenge
 });

 const denied=await fixture(t,()=>({ok:false,error:"PRIVATE_RUST_SIGNER_SECRET"}));
 const failing=new DelegationEvidenceHandler({
  adapterBaseUrl:"http://127.0.0.1:1",adapterToken:"PRIVATE_BACKEND_TOKEN",
  nativeSocketPath:denied.path,
  evidence:{credential:"private.opaque.child",credential_id:"urn:child:42",
   presenter_id:"did:thesis:backend"},
  fetchFn:(async()=>{httpRequests++;throw Error("Forbidden HTTP Adapter fallback");}) as typeof fetch
 });
 await assert.rejects(failing.createPresentation({...request,request_id:"native-task-2"}),
  (error:unknown)=>{
   assert.match(String(error),/Native Rust cryptographic presentation unavailable/u);
   assert.doesNotMatch(String(error),/PRIVATE_RUST_SIGNER_SECRET/u);
   return true;
  });
 assert.equal(httpRequests,0);
 assert.equal(denied.calls.length,1);
});

test("R218 canonical signed VP handler rejects missing native socket before HTTP",()=>{
 const oldFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 try{
  assert.throws(()=>new DelegationEvidenceHandler({
   adapterBaseUrl:"http://127.0.0.1:8090",
   adapterToken:"PRIVATE_BACKEND_TOKEN",
   evidence:{credential:"private.opaque.child",credential_id:"urn:child:42",
    presenter_id:"did:thesis:backend"},
   fetchFn:(async()=>{throw Error("HTTP fallback forbidden");}) as typeof fetch
  }),/Canonical signed Task VP requires native Rust signer socket/u);
 }finally{
  if(oldFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=oldFlag;
 }
});
