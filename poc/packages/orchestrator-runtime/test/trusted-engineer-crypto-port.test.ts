import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedEngineerCredentialPort}
 from "../src/trusted-engineer-crypto-port.ts";
import {createOwnerPrivateMcpChildCryptographyPort}
 from "../src/trusted-child-crypto-port.ts";
import {createDirectRustEngineerCredentialPort}
 from "../src/trusted-engineer-direct-core-port.ts";

const uri="gitea://gitea.local/thesis/iam-console-poc";
const file=uri+"/branches/feature%2Freview/files/apps/backend/user.ts";
const time="2026-10-21T09:00:00Z";
const root=(id:string,index:string,seconds:number)=>({
 credential_id:id,valid_from:time,validity_seconds:seconds,
 credential_status:{
  type:"BitstringStatusListEntry" as const,
  statusPurpose:"revocation" as const,
  statusListIndex:index,statusListCredential:"https://status.example/root"
 }
});

test("R218 canonical root and child DC fail closed without a native Rust socket",()=>{
 const previousFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 const previousSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 try{
  const transport={
   adapterBaseUrl:"http://127.0.0.1:8090",
   bearerToken:"PRIVATE_ENGINEER_BEARER",
   fetchFn:(async()=>{throw Error("HTTP Adapter must not be called");}) as typeof fetch
  };
  assert.throws(()=>createTrustedEngineerCredentialPort(transport),
    /Canonical Engineer root requires native Rust issuer socket/u);
  assert.throws(()=>createOwnerPrivateMcpChildCryptographyPort(transport),
    /Canonical signed Child DC requires native Rust issuer socket/u);
 }finally{
  if(previousFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=previousFlag;
  if(previousSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=previousSocket;
 }
});

test("R225 Engineer directly calls embedded Rust API for prelim/operational roots and revocation",async()=>{
 const calls:{op:string;token:string;body:Record<string,unknown>}[]=[];
 const secret="PRIVATE_ENGINEER_BEARER";
 const binding={
  start_engineer_core(){throw Error("Injected offline binding must not auto-start");},
  async issue_engineer_root(token:string,payload:string){
   const body=JSON.parse(payload) as Record<string,unknown>;
   calls.push({op:"issue_root",token,body});
   return JSON.stringify({id:body.credential_id,
    credentialSubject:{per:body.permissions}});
  },
  async revoke_engineer_root(token:string,payload:string){
   const body=JSON.parse(payload) as Record<string,unknown>;
   calls.push({op:"revoke_root",token,body});
   return JSON.stringify({credential_id:body.credential_id,
    status_set:true,status_purpose:"revocation"});
  }
 };
 const port=createDirectRustEngineerCredentialPort({
  bearerToken:secret
 },binding);
 const request={...root("urn:r225:preliminary","925",600),
  permissions:[{operation:"read_repository" as const,resource:uri}]};
 const issued=await port.issueScopedOrchestratorRoot(request);
 assert.equal(issued.id,"urn:r225:preliminary");
 assert.deepEqual(calls[0]?.body.permissions,request.permissions);
 assert.equal(calls[0]?.body.delegatee,"orchestrator");
 await port.revokeRoot("urn:r225:preliminary");
 assert.deepEqual(calls[1]?.body,{
  credential_id:"urn:r225:preliminary",status_set:true});
 await port.issueScopedOrchestratorRoot({
  ...root("urn:r225:operational","926",3600),
  permissions:[{operation:"update_file" as const,resource:file}]
 });
 assert.deepEqual(calls.map(c=>c.op),
  ["issue_root","revoke_root","issue_root"]);
 assert.ok(calls.every(c=>c.token===secret));
});

test("R225 direct Rust Engineer rejects changed grants and private signer failures without HTTP fallback",async()=>{
 const config={bearerToken:"PRIVATE_ENGINEER_BEARER"};
 const initial={...root("urn:r225:root","927",600),
  permissions:[{operation:"read_repository" as const,resource:uri}]};
 const altered=createDirectRustEngineerCredentialPort(config,{
  start_engineer_core(){},
  async issue_engineer_root(){return JSON.stringify({
   id:initial.credential_id,
   credentialSubject:{per:[{operation:"update_file",resource:uri}]}
  });},
  async revoke_engineer_root(){throw Error("PRIVATE_SIGNER_KEY");}
 });
 await assert.rejects(()=>altered.issueScopedOrchestratorRoot(initial),
  /Trusted Software Engineer direct Rust Core unavailable/u);
 await assert.rejects(()=>altered.revokeRoot(initial.credential_id),
  error=>{
   assert.match(String(error),/Trusted Software Engineer direct Rust Core unavailable/u);
   assert.doesNotMatch(String(error),/PRIVATE_SIGNER_KEY/u);
   return true;
  });
});

test("R225 direct Engineer selector never silently downgrades when native addon is unavailable",()=>{
 const previousMode=process.env.ENGINEER_CORE_NATIVE_MODE;
 const previousSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 try{
  process.env.ENGINEER_CORE_NATIVE_MODE="1";
  process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="relative.sock";
  assert.throws(()=>createTrustedEngineerCredentialPort({
   bearerToken:"PRIVATE_ENGINEER_BEARER"
  }),/Direct Engineer Core requires sole native Rust delegate socket/u);
 }finally{
  if(previousMode===undefined)delete process.env.ENGINEER_CORE_NATIVE_MODE;
  else process.env.ENGINEER_CORE_NATIVE_MODE=previousMode;
  if(previousSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=previousSocket;
 }
});

test("R415 canonical Engineer never chooses HTTP, native direct still needs a socket",()=>{
 const priorMode=process.env.ENGINEER_CORE_NATIVE_MODE;
 const priorSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 const priorFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 try{
  delete process.env.ENGINEER_CORE_NATIVE_MODE;
  delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  assert.throws(()=>createTrustedEngineerCredentialPort({
   bearerToken:"PRIVATE_ENGINEER_BEARER"
  }),/Canonical Engineer root requires native Rust issuer socket/u);
  process.env.ENGINEER_CORE_NATIVE_MODE="1";
  process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="relative.sock";
  assert.throws(()=>createTrustedEngineerCredentialPort({
   bearerToken:"PRIVATE_ENGINEER_BEARER"
  }),/Direct Engineer Core requires sole native Rust delegate socket/u);
 }finally{
  if(priorMode===undefined)delete process.env.ENGINEER_CORE_NATIVE_MODE;
  else process.env.ENGINEER_CORE_NATIVE_MODE=priorMode;
  if(priorSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=priorSocket;
  if(priorFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=priorFlag;
 }
});

// R428.2: the operator-owned socket must not be overridden by ambient state.
test("R428.2 pinned native Engineer socket is accepted only without conflicting global mode",()=>{
 const keys=["ADAPTER_ENGINEER_NATIVE_SOCKET","ENGINEER_CORE_NATIVE_MODE"];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  for(const key of keys)delete process.env[key];
  const owner={bearerToken:"PRIVATE_ENGINEER_BEARER",
   nativeSocketPath:"/tmp/r4282-native-operator.sock"};
  const port=createTrustedEngineerCredentialPort(owner);
  assert.equal(typeof port.revokeRoot,"function");
  process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="/tmp/untrusted-other.sock";
  assert.throws(()=>createTrustedEngineerCredentialPort(owner),
   /Conflicting trusted Engineer native Rust socket selection/u);
  delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  process.env.ENGINEER_CORE_NATIVE_MODE="1";
  assert.throws(()=>createTrustedEngineerCredentialPort(owner),
   /Direct Engineer Core requires sole native Rust delegate socket/u);
 }finally{
  for(const key of keys){
   if(old[key]===undefined)delete process.env[key];
   else process.env[key]=old[key];
  }
 }
});
