import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:net";
import {BaseLlm} from "@google/adk";
import {startTrustedAuthorityOnlyLocalA2AWorkers}
 from "../src/trusted-authority-only-local-a2a-workers.mjs";
import {assertTrustedApprovedA2AStartup}
 from "../../../packages/orchestrator-runtime/src/trusted-a2a-startup-probe.ts";

class NoInference extends BaseLlm{
 constructor(){super({model:"owner-read-only-offline"});}
 async *generateContentAsync(){throw Error("Provider inference forbidden");}
 connect(){throw Error("Provider connection forbidden");}
}
async function port(){
 const server=createServer();
 await new Promise((ok,bad)=>{
  server.once("error",bad);server.listen(0,"127.0.0.1",ok);
 });
 const address=server.address();
 if(!address||typeof address==="string")throw Error("No ephemeral port");
 await new Promise((ok,bad)=>server.close(error=>error?bad(error):ok()));
 return address.port;
}
test("Canonical local A2A bootstrap starts fourth native read-only Worker with pinned Card and private channels",async t=>{
 const dir=await mkdtemp(join(tmpdir(),"r452-a2a-"));
 const names=["DELEGATION_GATEWAY_ARCHITECTURE","APPROVED_RUNNER_NATIVE_MCP",
  "ADAPTER_ENGINEER_NATIVE_SOCKET",
  ...["backend","frontend","test","reviewer"].map(role=>
   "ADAPTER_ID_"+role.toUpperCase())];
 const original=new Map(names.map(name=>[name,process.env[name]]));
 let handle;
 t.after(async()=>{
  await handle?.close();
  await rm(dir,{recursive:true,force:true});
  for(const [name,value] of original)
   if(value===undefined)delete process.env[name];
   else process.env[name]=value;
 });
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=join(dir,"owner-rust.sock");
 const roles=["backend","frontend","test","reviewer"];
 const didFor=(i)=>"did:ethr:0x7a69:0x"+String(i+1).padStart(40,"0");
 const registry={};
 const workers={};
 const ports=new Set();
 for(const [i,role] of roles.entries()){
  const did=didFor(i);
  process.env["ADAPTER_ID_"+role.toUpperCase()]=did;
  const capabilities=role==="reviewer"?["read_file"]:
   role==="test"?["read_file","run_tests"]:["read_file","update_file"];
  registry[role]={did,card_ref:"trusted:"+role,capabilities};
  let p=await port();
  while(ports.has(p))p=await port();
  ports.add(p);
  workers[role]={port:p,adk:{
   model:new NoInference(),gatewayBaseUrl:"http://127.0.0.1:8130",
   adapterToken:"PRIVATE_ADAPTER_TOKEN"
  },...(role==="reviewer"?{ownerAdditionalCardPin:{
   did,name:"Read-only Source Reviewer",skillId:"source-review",
   capabilities:["read_file"]
  }}:{})};
 }
 registry.orchestrator={did:didFor(10),card_ref:"trusted:orchestrator",
  capabilities:["create_branch"]};
 const options={directory:dir,workers,native:true,trustedAgentRegistry:registry};
 await assert.rejects(startTrustedAuthorityOnlyLocalA2AWorkers({
  ...options,workers:{...workers,reviewer:{
   ...workers.reviewer,ownerAdditionalCardPin:{
    ...workers.reviewer.ownerAdditionalCardPin,capabilities:["run_tests"]
   }
  }}
 }),/Invalid private local A2A worker configuration/u);
 await assert.rejects(startTrustedAuthorityOnlyLocalA2AWorkers({
  ...options,trustedAgentRegistry:{...registry,reviewer:{
   ...registry.reviewer,did:"did:thesis:forged"
  }}
 }),/Invalid private local A2A worker configuration/u);
 handle=await startTrustedAuthorityOnlyLocalA2AWorkers(options);
 assert.deepEqual(Object.keys(handle.sdk.agentBaseUrls).sort(),[...roles].sort());
 assert.deepEqual(handle.sdk.additionalRolePins.reviewer.capabilities,["read_file"]);
 const verified=await assertTrustedApprovedA2AStartup({
  endpoints:handle.sdk.agentBaseUrls,
  additionalRolePins:handle.sdk.additionalRolePins
 });
 assert.equal(verified.reviewer.did,registry.reviewer.did);
 assert.deepEqual(verified.reviewer.capabilities,["read_file"]);
 for(const role of roles){
  assert.ok(handle.sdk.stageChannels[role]?.secretFile);
  assert.ok(handle.sdk.agentBindingChannels[role]?.secretFile);
 }
 const paths=roles.flatMap(role=>[
  handle.sdk.stageChannels[role].secretFile,
  handle.sdk.agentBindingChannels[role].secretFile
 ]);
 assert.equal(new Set(paths).size,8);
});
