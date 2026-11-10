import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {startDisposableOwnerModelIpcServer,
 connectDisposableWorkerModelIpcClient}
 from "../src/disposable-gemini-owner-worker-ipc.mjs";
import {createDisposableOriginalWorkerIpcAdkModel}
 from "../src/disposable-gemini-original-worker-ipc-adk-model.mjs";

const DENY=/Disposable original worker ADK IPC model NO-GO/u;
const task=Object.freeze({
 session_id:"original-signed-session-1",
 task_id:"original-backend-task-1",
 credential_id:"urn:child:backend:1",
 runtime_task_id:"dispatch_"+"A".repeat(22)
});
const request={contents:[{role:"user",parts:[{text:"offline model RPC"}]}]};
const response={
 content:{role:"model",parts:[{text:"synthetic original owner answer"}]},
 usageMetadata:{promptTokenCount:3,candidatesTokenCount:2,
  totalTokenCount:5}
};
const collect=async model=>{
 const chunks=[];
 for await(const chunk of model.generateContentAsync(request))
  chunks.push(chunk);
 return chunks;
};
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),"dgm-worker-model-"));
 const socketPath=join(dir,"backend.sock");
 const secretFile=join(dir,"backend.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 let admitted=0,calls=0,lastTask,lastPayload;
 const server=await startDisposableOwnerModelIpcServer({
  role:"backend",socketPath,secretFile,
  authorizeSignedTask:async input=>{
   admitted++;
   lastTask=input.task;
   lastPayload=input.payload;
   return options.authorize?options.authorize(input):
    input.task.credential_id===task.credential_id;
  },
  invokeModel:async()=>{
   calls++;
   return {chunks:[response],metered_calls_started:calls,
    metered_total_tokens:calls*5,
    owner_original_signed_task_verified_here:false,
    provider_billed_amount_verified:false,
    model_generated_source_proven:false};
  }
 });
 t.after(async()=>{
  await server.close().catch(()=>{});
  await rm(dir,{recursive:true,force:true});
 });
 const client=await connectDisposableWorkerModelIpcClient({
  role:"backend",socketPath,secretFile
 });
 return {client,server,socketPath,secretFile,
  admitted:()=>admitted,calls:()=>calls,
  lastTask:()=>lastTask,lastPayload:()=>lastPayload};
}
test("actual worker BaseLlm talks to owner via authenticated Unix socket without constructing a Gemini client",async t=>{
 const f=await fixture(t);
 const model=createDisposableOriginalWorkerIpcAdkModel({
  role:"backend",task,client:f.client,maxCalls:2
 });
 assert.equal(model.model,"gemini-3.8-flash");
 assert.deepEqual(await collect(model),[response]);
 assert.equal(model.callsStarted,1);
 assert.equal(f.calls(),1);
 assert.deepEqual(f.lastTask(),task);
 assert.deepEqual(await collect(model),[response]);
 assert.equal(f.calls(),2);
 await assert.rejects(collect(model),DENY);
 assert.equal(f.calls(),2);
 model.retire();
 await assert.rejects(collect(model),DENY);
});
test("forged, unbound, bad-role, over-budget or provider-selecting model requests are rejected",async t=>{
 const f=await fixture(t);
 for(const config of [
  {role:"frontend",task,client:f.client,maxCalls:2},
  {role:"backend",task:{...task,extra:"root"},client:f.client,maxCalls:2},
  {role:"backend",task,client:f.client,maxCalls:30},
  {role:"backend",task,client:{call:async()=>({})},maxCalls:2}
 ])assert.throws(()=>createDisposableOriginalWorkerIpcAdkModel(config),DENY);
 const model=createDisposableOriginalWorkerIpcAdkModel({
  role:"backend",task,client:f.client,maxCalls:2
 });
 await assert.rejects(async()=>{
  for await(const _ of model.generateContentAsync({
   contents:request.contents,apiKey:"forged-provider-key"
  })){}
 },DENY);
 assert.equal(model.retired,true);
 assert.equal(f.calls(),0);
});
test("denied signed Task permanently closes the worker-side model without retry or fallback",async t=>{
 const f=await fixture(t,{authorize:()=>false});
 const model=createDisposableOriginalWorkerIpcAdkModel({
  role:"backend",task,client:f.client,maxCalls:2
 });
 await assert.rejects(collect(model),DENY);
 assert.equal(model.retired,true);
 await assert.rejects(collect(model),DENY);
 assert.equal(f.calls(),0);
 assert.equal(f.admitted(),1);
});
test("real separate Node worker PID runs BaseLlm with sanitized environment and no provider credential",async t=>{
 const f=await fixture(t);
 const script=`
const {connectDisposableWorkerModelIpcClient}=await import(process.argv[1]);
const {createDisposableOriginalWorkerIpcAdkModel}=await import(process.argv[2]);
const client=await connectDisposableWorkerModelIpcClient({
 role:"backend",socketPath:process.argv[3],secretFile:process.argv[4]
});
const model=createDisposableOriginalWorkerIpcAdkModel({
 role:"backend",task:JSON.parse(process.argv[5]),client,maxCalls:1
});
const results=[];
for await(const result of model.generateContentAsync({
 contents:[{role:"user",parts:[{text:"offline separate worker"}]}]
}))results.push(result);
process.stdout.write(JSON.stringify({results,pid:process.pid,
 providerKey:process.env.GEMINI_API_KEY??null,
 googleKey:process.env.GOOGLE_API_KEY??null,
 githubToken:process.env.GITHUB_TOKEN??null,
 nodeOptions:process.env.NODE_OPTIONS??null}));
`;
 const clientUrl=new URL("../src/disposable-gemini-owner-worker-ipc.mjs",
  import.meta.url).href;
 const modelUrl=new URL("../src/disposable-gemini-original-worker-ipc-adk-model.mjs",
  import.meta.url).href;
 const child=spawn(process.execPath,[
  "--input-type=module","-e",script,clientUrl,modelUrl,
  f.socketPath,f.secretFile,JSON.stringify(task)
 ],{
  cwd:process.cwd(),
  env:{PATH:process.env.PATH??"",HOME:process.env.HOME??"/tmp",
   LANG:"C.UTF-8"},
  stdio:["ignore","pipe","pipe"]
 });
 let output="",stderr="";
 child.stdout.on("data",chunk=>output+=chunk);
 child.stderr.on("data",chunk=>stderr+=chunk);
 const code=await new Promise((resolve,reject)=>{
  child.once("error",reject);
  child.once("close",resolve);
 });
 assert.equal(code,0,stderr.slice(0,600));
 const proof=JSON.parse(output);
 assert.notEqual(proof.pid,process.pid);
 assert.equal(proof.results[0].content.parts[0].text,
  "synthetic original owner answer");
 assert.equal(proof.providerKey,null);
 assert.equal(proof.googleKey,null);
 assert.equal(proof.githubToken,null);
 assert.equal(proof.nodeOptions,null);
 assert.equal(f.calls(),1);
 // A separate PID and empty env do not demonstrate OS UID/file isolation.
});

test("real Google ADK Runner -> worker model proxy -> Unix RPC -> original metered owner model, entirely offline",async t=>{
 const {BaseLlm,LlmAgent,Runner,InMemorySessionService}=await import("@google/adk");
 const {DisposablePrivateBudgetedAdkModel}=await import(
  "../src/disposable-gemini-live-budgeted-model.mjs");
 const {createDisposableOriginalOwnerIpcModelAdapter}=await import(
  "../src/disposable-gemini-original-owner-ipc-model-adapter.mjs");
 class OfflineOwnerProvider extends BaseLlm {
  calls=0;
  constructor(){super({model:"gemini-3.8-flash"});}
  async *generateContentAsync(){
   this.calls++;
   yield {content:{role:"model",parts:[{
    text:"ADK Runner completed through private metered owner RPC"
   }]},usageMetadata:{promptTokenCount:10,candidatesTokenCount:7,
    totalTokenCount:17}};
  }
  connect(){throw Error("Offline provider has no network");}
 }
 const dir=await mkdtemp(join(tmpdir(),"dgm-runner-proxy-"));
 const socketPath=join(dir,"model.sock"),secretFile=join(dir,"model.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 const provider=new OfflineOwnerProvider();
 const original=new DisposablePrivateBudgetedAdkModel({
  delegate:provider,phase:"backend",maxCalls:2,
  maxReportedTokens:400,maxPerCallTokens:200
 });
 const ownerAdapter=createDisposableOriginalOwnerIpcModelAdapter({
  role:"backend",model:original
 });
 // The original signed Child/Gateway gate is tested separately in the
 // native R323 integration suite. This test isolates the real ADK Runner
 // and actual owner budgeted wrapper (no signed approval is fabricated).
 let authenticated=0;
 const server=await startDisposableOwnerModelIpcServer({
  role:"backend",socketPath,secretFile,
  authorizeSignedTask:async input=>{
   authenticated++;
   return input.role==="backend"&&
    input.task.session_id===task.session_id&&
    input.task.credential_id===task.credential_id;
  },
  invokeModel:ownerAdapter.invokeModel
 });
 t.after(async()=>{
  ownerAdapter.retire();await server.close().catch(()=>{});
  await rm(dir,{recursive:true,force:true});
 });
 const client=await connectDisposableWorkerModelIpcClient({
  role:"backend",socketPath,secretFile
 });
 const workerModel=createDisposableOriginalWorkerIpcAdkModel({
  role:"backend",task,client,maxCalls:1
 });
 const agent=new LlmAgent({
  name:"disposable_original_backend_ipc_offline",
  model:workerModel,
  instruction:"Answer briefly. Do not invoke any tools."
 });
 const sessionService=new InMemorySessionService();
 const appName="disposable_original_owner_ipc_runner_offline";
 const userId="offline",sessionId="offline-role-task";
 const runner=new Runner({appName,agent,sessionService});
 await sessionService.createSession({appName,userId,sessionId});
 let count=0;
 for await(const event of runner.runAsync({
  userId,sessionId,newMessage:{
   role:"user",parts:[{text:"Run the one authorized offline model call."}]
  }
 })){
  // Content-free diagnostic: only local call counts are exposed, never
  // SDK prompts, provider keys, model output or authorization material.
  assert.equal(event.errorCode,undefined,JSON.stringify({
   workerCalls:workerModel.callsStarted,
   workerRetired:workerModel.retired,
   ownerAuthenticatedCalls:authenticated,
   providerCalls:provider.calls,
   ownerBlocked:original.publicSummary().blocked,
   adapterRetired:ownerAdapter.retired
  }));
  assert.equal(event.errorMessage,undefined);
  count++;
 }
 assert.ok(count>0,"actual ADK Runner emitted one or more events");
 assert.equal(workerModel.callsStarted,1);
 assert.equal(provider.calls,1);
 assert.equal(authenticated,1);
 assert.equal(original.publicSummary().reported_total_tokens,17);
 assert.equal(original.publicSummary().blocked,false);
 assert.equal(ownerAdapter.retired,false);
});

test("ADK local toolsDict and live-connect settings never cross IPC or select a provider",async t=>{
 const f=await fixture(t);
 const model=createDisposableOriginalWorkerIpcAdkModel({
  role:"backend",task,client:f.client,maxCalls:1
 });
 const sentinel="LOCAL_TOOL_SECRET_MUST_NEVER_LEAVE_WORKER";
 const sdkRequest={
  contents:request.contents,model:"forged-other-model",
  toolsDict:{read_file:{ownerPrivateClosure:sentinel}},
  liveConnectConfig:{authToken:sentinel},
  allowedTools:["read_file"],previousInteractionId:"interaction_0001"
 };
 const chunks=[];
 for await(const chunk of model.generateContentAsync(sdkRequest))
  chunks.push(chunk);
 assert.deepEqual(chunks,[response]);
 assert.equal(f.lastPayload().model,undefined);
 assert.equal(f.lastPayload().toolsDict,undefined);
 assert.equal(f.lastPayload().liveConnectConfig,undefined);
 assert.deepEqual(f.lastPayload().allowedTools,["read_file"]);
 assert.equal(f.lastPayload().previousInteractionId,"interaction_0001");
 assert.equal(JSON.stringify(f.lastPayload()).includes(sentinel),false);
});
