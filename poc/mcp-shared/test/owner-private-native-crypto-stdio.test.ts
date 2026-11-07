/** R381.3 offline private stdio -> Unix socket proof. NO real signer/API. */
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createOwnerPrivateNativeCryptoMcpSession}
 from "../src/owner-private-native-crypto-stdio.mjs";

async function fixture<T>(
 reply:(request:Record<string,unknown>)=>unknown,
 run:(socketPath:string,calls:Record<string,unknown>[])=>Promise<T>
):Promise<T>{
 const dir=await mkdtemp(join(tmpdir(),"r3813-mcp-"));
 const socketPath=join(dir,"rust.sock");
 const calls:Record<string,unknown>[]=[];
 const server=createServer({allowHalfOpen:true},socket=>{
  let bytes="";
  socket.on("data",chunk=>{bytes+=chunk.toString("utf8");});
  socket.on("end",()=>{
   try{
    const request=JSON.parse(bytes) as Record<string,unknown>;
    calls.push(request);
    socket.end(JSON.stringify(reply(request)));
   }catch{socket.end(JSON.stringify({ok:false}));}
  });
 });
 try{
  await new Promise<void>((resolve,reject)=>{
   server.once("error",reject);
   server.listen(socketPath,()=>{server.off("error",reject);resolve();});
  });
  return await run(socketPath,calls);
 }finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await rm(dir,{recursive:true,force:true});
 }
}

test("R381.3 Child credential is returned by MCP worker's real native IPC call",async()=>{
 await fixture(
  request=>({ok:true,result:{
   id:"child-from-rust-socket",credentialSubject:{per:[{
    resource:"gitea://test",operation:"read_file"
   }]}}}),
  async(socketPath,calls)=>{
   const body={credential_id:"child-from-rust-socket",delegatee:"backend",
    permissions:[{resource:"gitea://test",operation:"read_file"}]};
   const session=createOwnerPrivateNativeCryptoMcpSession(
    "child_issue",{socketPath,bearerToken:"PRIVATE_ORCHESTRATOR_BEARER"},
    body);
   const signed=await session.invokeOnce();
   assert.equal(signed.id,"child-from-rust-socket");
   assert.equal(calls.length,1);
   assert.deepEqual(calls[0],{
    token:"PRIVATE_ORCHESTRATOR_BEARER",operation:"issue_child",body
   });
   await assert.rejects(session.invokeOnce(),/child issuance unavailable/u);
   assert.equal(calls.length,1);
  });
});

test("R381.3 VP travels back through private MCP; no second Rust signer",async()=>{
 await fixture(
  request=>({ok:true,result:{jwt:"PRIVATE_SIGNED_VP_FROM_NATIVE_RUST"}}),
  async(socketPath,calls)=>{
   const body={credential_id:"child-existing",
    challenge:"gateway-prepared",audience:"cloud-access-gateway",
    disclosed_permissions:[{resource:"gitea://test",operation:"read_file"}]};
   const session=createOwnerPrivateNativeCryptoMcpSession(
    "presentation_create",{socketPath,bearerToken:"PRIVATE_BACKEND_BEARER"},
    body);
   const vp=await session.invokeOnce();
   assert.deepEqual(vp,{jwt:"PRIVATE_SIGNED_VP_FROM_NATIVE_RUST"});
   assert.equal(calls.length,1);
   assert.deepEqual(calls[0],{
    token:"PRIVATE_BACKEND_BEARER",operation:"create_presentation",body
   });
   assert.doesNotMatch(JSON.stringify(session),/PRIVATE_SIGNED_VP/u);
  });
});

test("R381.3 root issue/revoke cannot be requested via native MCP",async()=>{
 assert.throws(()=>createOwnerPrivateNativeCryptoMcpSession(
  "root_issue",{socketPath:"/tmp/socket",bearerToken:"S"},{}),
  /configuration unavailable/u);
 assert.throws(()=>createOwnerPrivateNativeCryptoMcpSession(
  "root_revoke",{socketPath:"/tmp/socket",bearerToken:"S"},{}),
  /configuration unavailable/u);
 assert.throws(()=>createOwnerPrivateNativeCryptoMcpSession(
  "child_issue",{socketPath:"not/absolute",bearerToken:"S"},{}),
  /configuration unavailable/u);
});

test("R381.3 malformed native reply is fail-closed, sanitized and never retried",async()=>{
 await fixture(
  ()=>({ok:false,error:"PRIVATE_RUST_SIGNER_SECRET_NEVER_PRINT"}),
  async(socketPath,calls)=>{
   const session=createOwnerPrivateNativeCryptoMcpSession(
    "child_issue",{socketPath,bearerToken:"PRIVATE"},{
     credential_id:"cannot-sign"
    });
   await assert.rejects(session.invokeOnce(),error=>{
    assert.doesNotMatch(String(error),/PRIVATE_RUST_SIGNER_SECRET/u);
    return /child issuance unavailable/u.test(String(error));
   });
   assert.equal(calls.length,1);
   await assert.rejects(session.invokeOnce());
   assert.equal(calls.length,1);
  });
});

test("R381.3 close-before-connect and concurrency cannot duplicate Rust effect",async()=>{
 await fixture(
  ()=>({ok:true,result:{id:"one"}}),
  async(socketPath,calls)=>{
   const closed=createOwnerPrivateNativeCryptoMcpSession(
    "child_issue",{socketPath,bearerToken:"PRIVATE"},{credential_id:"a"});
   await closed.close();
   await assert.rejects(closed.invokeOnce());
   assert.equal(calls.length,0);
   const session=createOwnerPrivateNativeCryptoMcpSession(
    "child_issue",{socketPath,bearerToken:"PRIVATE"},{credential_id:"b"});
   const first=session.invokeOnce();
   await assert.rejects(session.invokeOnce(),/child issuance unavailable/u);
   assert.deepEqual(await first,{id:"one"});
   assert.equal(calls.length,1);
  });
});
