import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:net";
import {AGENT_CARD_PATH} from "@a2a-js/sdk";
import {startDisposableOwnerModelIpcServer}
 from "../src/disposable-gemini-owner-worker-ipc.mjs";
import {startDisposableOriginalA2aWorkerSubprocess}
 from "../src/disposable-gemini-original-a2a-worker-launcher.mjs";

const task=Object.freeze({
 session_id:"offline-owner-session-1",
 task_id:"offline-backend-original-task-1",
 credential_id:"urn:offline:child:backend:1",
 runtime_task_id:"dispatch_"+"b".repeat(22)
});
const deny=/Disposable original A2A subprocess launcher NO-GO/u;
async function port(){
 const server=createServer();
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const p=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return p;
}
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),"disposable-worker-a2a-"));
 const modelSocketPath=join(dir,"model.sock");
 const modelSecretFile=join(dir,"model.hex");
 await writeFile(modelSecretFile,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 let modelCalls=0;
 const owner=await startDisposableOwnerModelIpcServer({
  role:"backend",socketPath:modelSocketPath,secretFile:modelSecretFile,
  authorizeSignedTask:async({role,task:claim})=>
   role==="backend"&&claim.runtime_task_id===task.runtime_task_id&&
   claim.credential_id===task.credential_id,
  invokeModel:async()=>({
   chunks:[{content:{role:"model",
    parts:[{text:"offline only; no authorized Gateway file writes"}]},
    usageMetadata:{promptTokenCount:9,candidatesTokenCount:6,
     totalTokenCount:15}}],
   metered_calls_started:++modelCalls,
   metered_total_tokens:modelCalls*15,
   owner_original_signed_task_verified_here:false,
   provider_billed_amount_verified:false,
   model_generated_source_proven:false
  })
 });
 t.after(async()=>{
  await owner.close().catch(()=>{});
  await rm(dir,{recursive:true,force:true});
 });
 const config={
  role:"backend",port:await port(),task,maxCalls:2,
  modelSocketPath,modelSecretFile,
  adapterToken:"offline-adapter-token",
  gatewayBaseUrl:"http://127.0.0.1:19121",
  adapterBaseUrl:"http://127.0.0.1:19122"
 };
 return {config,modelCalls:()=>modelCalls};
}
test("actual specialized Backend A2A server starts in a second sanitized Node PID",async t=>{
 const f=await fixture(t);
 const child=await startDisposableOriginalA2aWorkerSubprocess(f.config);
 t.after(()=>child.close().catch(()=>{}));
 assert.notEqual(child.pid,process.pid);
 assert.equal(child.role,"backend");
 assert.equal(child.osIsolationVerified,false);
 assert.equal(child.originalNativeTaskBindingPresent,false);
 const response=await fetch(child.baseUrl+AGENT_CARD_PATH);
 assert.equal(response.status,200);
 const card=await response.json();
 assert.equal(card.url,child.baseUrl);
 assert.equal(card.name.includes("Backend"),true);
 await child.close();
 await assert.rejects(fetch(child.baseUrl+AGENT_CARD_PATH));
 assert.equal(f.modelCalls(),0);
});
test("offline A2A subprocess refuses paid mode and forged specialist role",async()=>{
 await assert.rejects(startDisposableOriginalA2aWorkerSubprocess({
  role:"orchestrator",port:18001,
  adapterToken:"offline-adapter-token",
  modelSocketPath:"/tmp/a",modelSecretFile:"/tmp/b",
  gatewayBaseUrl:"http://127.0.0.1:19121",
  adapterBaseUrl:"http://127.0.0.1:19122",maxCalls:1,task
 }),deny);
 const previous=process.env.DELEGATION_DISPOSABLE_LIVE_MODE;
 process.env.DELEGATION_DISPOSABLE_LIVE_MODE="gemini-real";
 try{
  await assert.rejects(startDisposableOriginalA2aWorkerSubprocess({
   role:"backend",port:18001,
   adapterToken:"offline-adapter-token",
   modelSocketPath:"/tmp/a",modelSecretFile:"/tmp/b",
   gatewayBaseUrl:"http://127.0.0.1:19121",
   adapterBaseUrl:"http://127.0.0.1:19122",maxCalls:1,task
  }),deny);
 }finally{
  if(previous===undefined)delete process.env.DELEGATION_DISPOSABLE_LIVE_MODE;
  else process.env.DELEGATION_DISPOSABLE_LIVE_MODE=previous;
 }
});
