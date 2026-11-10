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
import {TrustedOwnerEffectStagingRegistry,
 createTrustedOwnerEffectStagingServer,
 connectTrustedEffectAgentBindingClient,
 connectTrustedOwnerEffectStagingClient}
 from "../../../packages/agent-runtime/src/trusted-effect-staging-unix-ipc.ts";

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
 const bindSocketPath=join(dir,"bind.sock");
 const bindSecretFile=join(dir,"bind.hex");
 const stageSocketPath=join(dir,"stage.sock");
 const stageSecretFile=join(dir,"stage.hex");
 for(const file of [modelSecretFile,bindSecretFile,stageSecretFile])
  await writeFile(file,randomBytes(32).toString("hex")+"\n",
   {mode:0o600,flag:"wx"});
 const ownerStageRegistry=new TrustedOwnerEffectStagingRegistry();
 const stageServer=await createTrustedOwnerEffectStagingServer({
  socketPath:stageSocketPath,secretFile:stageSecretFile,
  expectedRole:"backend",registry:ownerStageRegistry
 });
 await stageServer.start();
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
  await stageServer.close().catch(()=>{});
  await rm(dir,{recursive:true,force:true});
 });
 const config={
  role:"backend",port:await port(),task,maxCalls:2,
  modelSocketPath,modelSecretFile,
  bindSocketPath,bindSecretFile,stageSocketPath,stageSecretFile,
  adapterToken:"offline-adapter-token",
  gatewayBaseUrl:"http://127.0.0.1:19121",
  adapterBaseUrl:"http://127.0.0.1:19122"
 };
 return {config,modelCalls:()=>modelCalls,ownerStageRegistry,
  connectBinder:()=>connectTrustedEffectAgentBindingClient({
   socketPath:bindSocketPath,secretFile:bindSecretFile,
   expectedRole:"backend"
  }),
  connectStage:()=>connectTrustedOwnerEffectStagingClient({
   socketPath:stageSocketPath,secretFile:stageSecretFile
  })
 };
}
test("actual specialized Backend A2A server starts in a second sanitized Node PID",async t=>{
 const f=await fixture(t);
 const child=await startDisposableOriginalA2aWorkerSubprocess(f.config);
 t.after(()=>child.close().catch(()=>{}));
 assert.notEqual(child.pid,process.pid);
 assert.equal(child.role,"backend");
 assert.equal(child.osIsolationVerified,false);
 assert.equal(child.originalNativeTaskBindingPresent,false);
 assert.equal(child.originalTaskBindingChannelReady,true);
 const response=await fetch(new URL(AGENT_CARD_PATH,child.baseUrl+'/').href);
 assert.equal(response.status,200);
 const card=await response.json();
 assert.equal(card.supportedInterfaces?.[0]?.url,
  child.baseUrl+"/a2a/rest");
 assert.equal(card.name,"Backend Development Agent");
 await child.close();
 await assert.rejects(fetch(new URL(AGENT_CARD_PATH,child.baseUrl+'/').href));
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

test("ORIGINAL owner HMAC-binds a signed-Task claim into separate Backend A2A PID, stages exactly once and fences it",async t=>{
 const f=await fixture(t);
 const child=await startDisposableOriginalA2aWorkerSubprocess(f.config);
 t.after(()=>child.close().catch(()=>{}));
 const owner=await f.connectBinder();
 const stage=await f.connectStage();
 let staged=0;
 const pins={
  runtimeTaskId:task.runtime_task_id,
  planTaskId:task.task_id,
  childCredentialId:task.credential_id,
  presenterId:"did:thesis:backend-agent",
  branch:"feature/account-suspension",
  role:"backend",operation:"read_file",
  path:"apps/backend/account.ts"
 };
 f.ownerStageRegistry.bindTask(task.runtime_task_id,{
  async stage(requestId){
   assert.equal(requestId,"owner-pinned-original-read-01");
   staged++;
  }
 },"backend");
 await assert.rejects(owner.bindTask({...pins,role:"frontend"}),
  /wrong-role owner Task pins|malformed owner Task pins/u);
 await owner.bindTask(pins); // original HMAC -> worker process registry
 await assert.rejects(owner.bindTask(pins),
  /Authenticated private effect operation denied/u);
 // The parent owner Stage channel remains a distinct authorized RPC.
 await stage.stage(task.runtime_task_id,"owner-pinned-original-read-01");
 assert.equal(staged,1);
 await owner.fence(task.runtime_task_id);
 await assert.rejects(owner.fence(task.runtime_task_id),
  /Authenticated private effect operation denied/u);
 assert.equal(child.osIsolationVerified,false);
 assert.equal(child.originalNativeTaskBindingPresent,false);
 // No Task has been dispatched or model called by this prebind proof.
 assert.equal(f.modelCalls(),0);
});
