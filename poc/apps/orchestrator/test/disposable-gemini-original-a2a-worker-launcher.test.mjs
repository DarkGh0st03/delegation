import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:net";
import {DeterministicA2AOrchestrator}
 from "../../../packages/agent-runtime/src/orchestrator.ts";
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
async function fixture(t,{authorizeSignedTask}={}){
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
  authorizeSignedTask:async input=>authorizeSignedTask?
   authorizeSignedTask(input):
   input.role==="backend"&&
    input.task.runtime_task_id===task.runtime_task_id&&
    input.task.credential_id===task.credential_id,
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
 assert.equal(child.nativeRustSignerVerified,false);
 assert.equal(child.ownerCanaryReadableFromWorker,true);
 if(process.platform==="linux"&&typeof process.getuid==="function")
  assert.equal(child.ownerAndWorkerShareUid,true);
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
 // The ORIGINAL private binder intentionally supports idempotent fencing.
 // A repeated revocation cannot re-enable an already retired Task.
 await owner.fence(task.runtime_task_id);
 await assert.rejects(stage.stage(task.runtime_task_id,
  "owner-pinned-original-read-02"),
  /Authenticated private effect operation denied/u);
 assert.equal(staged,1);
 assert.equal(child.osIsolationVerified,false);
 assert.equal(child.originalNativeTaskBindingPresent,false);
 // No Task has been dispatched or model called by this prebind proof.
 assert.equal(f.modelCalls(),0);
});

test("two sequential protected A2A requests reuse the SAME Backend PID and owner model RPC; failed work never stages effects",async t=>{
 // Real A2A HTTP transport, original authenticated Task-binding and
 // owner HMAC model IPC. Child signatures/Gateway responses are intentionally
 // synthetic; this is NOT the paid/native Gitea/Docker E2E.
 const second={...task,task_id:"second-backend-task",
  credential_id:"urn:offline:child:backend:2",
  runtime_task_id:"dispatch_"+"c".repeat(22)};
 const allowed=new Set([task.runtime_task_id,second.runtime_task_id]);
 const f=await fixture(t,{authorizeSignedTask:({role,task:claim})=>
  role==="backend"&&allowed.has(claim.runtime_task_id)&&
  [task,second].some(pin=>pin.runtime_task_id===claim.runtime_task_id&&
   pin.credential_id===claim.credential_id&&
   pin.session_id===claim.session_id&&pin.task_id===claim.task_id)
 });
 const child=await startDisposableOriginalA2aWorkerSubprocess(f.config);
 t.after(()=>child.close().catch(()=>{}));
 const firstPid=child.pid;
 const binder=await f.connectBinder();
 const a2a=new DeterministicA2AOrchestrator({
  deadlineMs:15_000,initialIntervalMs:30,maxIntervalMs:100
 });
 for(const [i,identity] of [task,second].entries()){
  const pins={
   runtimeTaskId:identity.runtime_task_id,
   planTaskId:identity.task_id,
   childCredentialId:identity.credential_id,
   presenterId:"did:thesis:backend-agent",
   branch:"feature/account-suspension",
   role:"backend",operation:"read_file",
   path:"apps/backend/account.ts"
  };
  let staged=0;
  f.ownerStageRegistry.bindTask(identity.runtime_task_id,{
   async stage(){staged++;}
  },"backend");
  await binder.bindTask(pins);
  await assert.rejects(a2a.sendProtectedTask({
   agent_base_url:child.baseUrl,
   subtask:{
    subtask_id:identity.task_id,
    instruction:"Read the approved file only; no changes.",
    branch:pins.branch,relevant_paths:[pins.path],
    approved_file_permissions:[{operation:"read_file",path:pins.path}],
    approved_run_tests:false
   },
   // Offline fixture: synthetic non-secret string, never a real signed DC.
   delegation_evidence:{
    credential:"offline-synthetic-evidence-only",
    credential_id:identity.credential_id,
    presenter_id:pins.presenterId
   },
   trusted_gateway_task_id:identity.runtime_task_id
  }),/without completion/u);
  assert.equal(f.modelCalls(),i+1,
   "the original owner model must be invoked exactly once for each admitted Task");
  assert.equal(staged,0,
   "plain LLM output is never Gateway-approved repository evidence");
  assert.equal(child.pid,firstPid);
  await binder.fence(identity.runtime_task_id);
 }
 await assert.rejects(a2a.sendProtectedTask({
  agent_base_url:child.baseUrl,
  subtask:{
   subtask_id:task.task_id,instruction:"Repeat an already retired Task",
   branch:"feature/account-suspension",
   relevant_paths:["apps/backend/account.ts"],
   approved_file_permissions:[{
    operation:"read_file",path:"apps/backend/account.ts"
   }],approved_run_tests:false
  },
  delegation_evidence:{
   credential:"offline-synthetic-evidence-only",
   credential_id:task.credential_id,
   presenter_id:"did:thesis:backend-agent"
  },
  trusted_gateway_task_id:task.runtime_task_id
 }),/without completion/u);
 assert.equal(f.modelCalls(),2,
  "replaying a retired Task must not initiate an owner model call");
});

test("the actual offline A2A worker can open an owner 0600 canary: PID separation is NOT secret isolation",async t=>{
 const f=await fixture(t);
 const child=await startDisposableOriginalA2aWorkerSubprocess(f.config);
 t.after(()=>child.close().catch(()=>{}));
 assert.notEqual(child.pid,process.pid);
 assert.equal(child.ownerCanaryReadableFromWorker,true);
 assert.equal(child.osIsolationVerified,false);
 assert.equal(child.nativeRustSignerVerified,false);
 assert.equal(f.modelCalls(),0);
 await child.close();
});

test("requesting owner-file UID isolation fails closed on the same-UID CI runner",async t=>{
 const f=await fixture(t);
 await assert.rejects(startDisposableOriginalA2aWorkerSubprocess(
  f.config,{requireOwnerFileIsolation:true}),deny);
 assert.equal(f.modelCalls(),0);
});
