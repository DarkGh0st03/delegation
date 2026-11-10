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
 let admitted=0,calls=0,lastTask;
 const server=await startDisposableOwnerModelIpcServer({
  role:"backend",socketPath,secretFile,
  authorizeSignedTask:async input=>{
   admitted++;
   lastTask=input.task;
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
  admitted:()=>admitted,calls:()=>calls,lastTask:()=>lastTask};
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
