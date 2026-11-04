import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {invokeNativeCrypto} from "../src/native-crypto-ipc.ts";

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
