import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createNativeRustEngineerCredentialPort}
 from "../src/trusted-engineer-native-port.ts";
import {createTrustedEngineerCredentialPort}
 from "../src/trusted-engineer-crypto-port.ts";

const resource="gitea://gitea.local/thesis/iam-console-poc";
const issue={
 credential_id:"urn:trusted:engineer-root",
 valid_from:"2026-11-04T06:00:00Z",
 validity_seconds:600,
 credential_status:{
  type:"BitstringStatusListEntry",statusPurpose:"revocation",
  statusListIndex:"725",statusListCredential:"https://status.invalid/list"
 },
 permissions:[{resource,operation:"read_repository"}]
};

async function fixture(t:import("node:test").TestContext,
 effect:(request:any)=>unknown){
 const dir=mkdtempSync(join(tmpdir(),"delegation-r171-native-"));
 const path=join(dir,"engineer.sock");
 const received:unknown[]=[];
 const server=createServer({allowHalfOpen:true},socket=>{
  let input="";
  socket.on("data",chunk=>{input+=chunk.toString("utf8");});
  socket.on("end",()=>{
   try{
    const request=JSON.parse(input);
    received.push(request);
    socket.end(JSON.stringify(effect(request)));
   }catch{socket.destroy();}
  });
 });
 await new Promise<void>(r=>server.listen(path,r));
 t.after(async()=>{
  await new Promise<void>(r=>server.close(()=>r()));
  rmSync(dir,{recursive:true,force:true});
 });
 return {path,received};
}

test("R171 native Engineer root and revocation share one private local Rust port",async t=>{
 const f=await fixture(t,request=>{
  assert.equal(request.token,"TRUSTED_ENGINEER_LOCAL_BEARER");
  if(request.operation==="issue_root"){
   return {ok:true,result:{
    "@context":["https://www.w3.org/ns/credentials/v2"],
    type:["VerifiableCredential","DelegationCredential"],
    id:request.body.credential_id,issuer:"did:thesis:engineer",
    validFrom:request.body.valid_from,
    credentialSubject:{sub:"did:thesis:orchestrator",
      per:request.body.permissions}
   }};
  }
  return {ok:true,result:{
   credential_id:request.body.credential_id,
   status_purpose:"revocation",status_set:request.body.status_set
  }};
 });
 const p=createNativeRustEngineerCredentialPort({
  adapterBaseUrl:"http://should-never-be-used.invalid",
  bearerToken:"TRUSTED_ENGINEER_LOCAL_BEARER",nativeSocketPath:f.path
 });
 const root=await p.issueScopedOrchestratorRoot(issue as never);
 assert.equal(root.id,issue.credential_id);
 assert.deepEqual(root.credentialSubject.per,issue.permissions);
 await p.revokeRoot(root.id);
 assert.equal(f.received.length,2);
 assert.deepEqual((f.received[0] as any).body.permissions,issue.permissions);
 assert.equal((f.received[0] as any).body.delegatee,"orchestrator");
 assert.deepEqual((f.received[1] as any).body,
  {credential_id:issue.credential_id,status_set:true});
});

test("R171 trust boundary rejects a root with unauthorized amplified permissions",async t=>{
 const f=await fixture(t,r=>({ok:true,result:{
  id:r.body.credential_id,issuer:"did:thesis:engineer",
  credentialSubject:{per:[...r.body.permissions,
   {resource:"gitea://untrusted",operation:"merge_pull_request"}]}
 }}));
 const p=createNativeRustEngineerCredentialPort({
  adapterBaseUrl:"http://unused.invalid",bearerToken:"PRIVATE_BEARER",
  nativeSocketPath:f.path
 });
 await assert.rejects(p.issueScopedOrchestratorRoot(issue as never),
  /Trusted Engineer native Rust issuer unavailable/);
});

test("R171 native denial masks Rust details and NEVER falls back to HTTP",async t=>{
 const f=await fixture(t,()=>({
  ok:false,error:"PRIVATE_ENGINEER_SIGNING_KEY_NEVER_LOG"
 }));
 const p=createNativeRustEngineerCredentialPort({
  adapterBaseUrl:"http://localhost:1",bearerToken:"PRIVATE_BEARER",
  nativeSocketPath:f.path
 });
 await assert.rejects(p.issueScopedOrchestratorRoot(issue as never),e=>{
  assert.doesNotMatch(String(e),/PRIVATE_ENGINEER_SIGNING_KEY_NEVER_LOG/);
  return /Trusted Engineer native Rust issuer unavailable/.test(String(e));
 });
 assert.equal(f.received.length,1);
});

test("R171 canonical owner selects native Unix port when explicitly configured",async t=>{
 const f=await fixture(t,r=>({ok:true,result:{
  id:r.body.credential_id,issuer:"did:thesis:engineer",
  credentialSubject:{per:r.body.permissions}
 }}));
 const original=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 try{
  process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=f.path;
  const client=createTrustedEngineerCredentialPort({
   adapterBaseUrl:"http://127.0.0.1:1",bearerToken:"TRUSTED_ENGINEER_LOCAL_BEARER"
  });
  assert.equal((await client.issueScopedOrchestratorRoot(issue as never)).id,
    issue.credential_id);
  assert.equal(f.received.length,1);
 }finally{
  if(original===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=original;
 }
});
