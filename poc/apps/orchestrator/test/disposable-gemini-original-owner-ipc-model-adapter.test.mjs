import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DisposablePrivateBudgetedAdkModel}
 from "../src/disposable-gemini-live-budgeted-model.mjs";
import {createDisposableOriginalOwnerIpcModelAdapter}
 from "../src/disposable-gemini-original-owner-ipc-model-adapter.mjs";
import {startDisposableOwnerModelIpcServer,
 connectDisposableWorkerModelIpcClient}
 from "../src/disposable-gemini-owner-worker-ipc.mjs";

const DENY=/Disposable original owner IPC model adapter NO-GO/u;
const RPC_DENY=/Disposable owner-worker model IPC NO-GO/u;
const task={session_id:"session-01",task_id:"task-01",
 credential_id:"urn:signed-child:01",runtime_task_id:"dispatch_01"};
const payload={contents:[{role:"user",parts:[{text:"offline original task"}]}]};
class OfflineAdk extends BaseLlm{
 calls=0;
 constructor(generator){
  super({model:"gemini-3.8-flash"});this.generator=generator;
 }
 async *generateContentAsync(request,stream,signal){
  this.calls++;yield* this.generator(request,stream,signal);
 }
 connect(){throw Error("provider disabled");}
}
const response=(text,usage)=>({
 content:{role:"model",parts:[{text}]},
 ...(usage?{usageMetadata:usage}:{})
});
const metering=(i,o)=>({
 promptTokenCount:i,candidatesTokenCount:o,totalTokenCount:i+o
});
async function setup(t,generator,authorizer=()=>true){
 const dir=await mkdtemp(join(tmpdir(),"dgm-adapter-"));
 const socketPath=join(dir,"backend.sock"),secretFile=join(dir,"backend.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 const delegate=new OfflineAdk(generator);
 const wrapped=new DisposablePrivateBudgetedAdkModel({
  delegate,phase:"backend",maxCalls:2,
  maxReportedTokens:200,maxPerCallTokens:120
 });
 const adapter=createDisposableOriginalOwnerIpcModelAdapter({
  role:"backend",model:wrapped
 });
 const server=await startDisposableOwnerModelIpcServer({
  role:"backend",socketPath,secretFile,
  authorizeSignedTask:authorizer,
  invokeModel:adapter.invokeModel
 });
 t.after(async()=>{
  adapter.retire();
  await server.close().catch(()=>{});
  await rm(dir,{recursive:true,force:true});
 });
 const client=await connectDisposableWorkerModelIpcClient({
  role:"backend",socketPath,secretFile
 });
 return {adapter,server,client,wrapped,delegate};
}
const rpc=(client,patch={})=>client.call({
 task,callId:"call-"+randomBytes(10).toString("hex"),payload,...patch
});

test("owner ADK wraps and meters COMPLETE responses through IPC; no key, model, Root or Task claim returns",async t=>{
 const f=await setup(t,async function*(){
  yield response("buffered first",metering(5,2));
  yield response("buffered final",metering(7,4));
 },input=>input.task.task_id==="task-01");
 const result=await rpc(f.client);
 assert.equal(result.chunks.length,2);
 assert.equal(result.chunks[0].content.parts[0].text,"buffered first");
 assert.equal(result.chunks[1].content.parts[0].text,"buffered final");
 assert.equal(result.metered_calls_started,1);
 assert.equal(result.metered_total_tokens,11);
 assert.equal(result.owner_original_signed_task_verified_here,false);
 assert.equal(result.provider_billed_amount_verified,false);
 assert.equal(result.model_generated_source_proven,false);
 assert.equal(f.wrapped.publicSummary().calls_started,1);
 assert.equal(f.wrapped.publicSummary().reported_total_tokens,11);
 assert.equal(f.delegate.calls,1);
 assert.equal(Object.hasOwn(result,"model"),false);
 assert.equal(Object.hasOwn(result,"apiKey"),false);
 assert.equal(Object.hasOwn(result,"privateKey"),false);
});
test("failed original signed-Task authorizer refuses to invoke the owner ADK",async t=>{
 const f=await setup(t,async function*(){
  yield response("SHOULD NEVER BE SENT",metering(1,1));
 },()=>false);
 await assert.rejects(rpc(f.client),RPC_DENY);
 assert.equal(f.delegate.calls,0);
 assert.equal(f.wrapped.publicSummary().calls_started,0);
});
test("incomplete upstream usage never releases partial model output",async t=>{
 const f=await setup(t,async function*(){
  yield response("UNMETERED TEXT");
 });
 await assert.rejects(rpc(f.client),RPC_DENY);
 assert.equal(f.wrapped.publicSummary().blocked,true);
 assert.equal(f.adapter.retired,true);
 assert.equal(f.delegate.calls,1);
 await assert.rejects(rpc(f.client),RPC_DENY);
 assert.equal(f.delegate.calls,1);
});
test("owner rejects model override, arbitrary privileged headers, wrong role and late reuse",async t=>{
 const f=await setup(t,async function*(){
  yield response("safe",metering(1,1));
 });
 await assert.rejects(rpc(f.client,{
  payload:{...payload,apiKey:"forged",model:"attacker-model"}
 }),RPC_DENY);
 assert.equal(f.delegate.calls,0);
 await assert.rejects(f.adapter.invokeModel({
  role:"frontend",task,callId:"call-12345678",payload
 }),DENY);
 f.adapter.retire();
 await assert.rejects(rpc(f.client),RPC_DENY);
 assert.equal(f.delegate.calls,0);
});
