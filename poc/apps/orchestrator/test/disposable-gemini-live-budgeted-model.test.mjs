import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {
 DisposablePrivateBudgetedAdkModel,
 PRIVATE_GEMINI_SESSION_LIMITS
} from "../src/disposable-gemini-live-budgeted-model.mjs";

const DENY=/Disposable private Gemini request budget NO-GO/u;
const reported=(input,output,total=input+output)=>({
 promptTokenCount:input,candidatesTokenCount:output,totalTokenCount:total
});
const response=(text,usageMetadata)=>({
 content:{role:"model",parts:[{text}]},
 ...(usageMetadata?{usageMetadata}:{})
});
class OfflineDelegate extends BaseLlm{
 calls=0;
 constructor(generator){
  super({model:"offline-gemini-budget-test-no-provider"});
  this.generator=generator;
 }
 async *generateContentAsync(request,stream,signal){
  this.calls++;
  yield* this.generator(request,stream,signal);
 }
 connect(){throw Error("No provider should be connected");}
}
const wrapped=(delegate,options={})=>new DisposablePrivateBudgetedAdkModel({
 delegate,phase:"backend",maxCalls:2,maxReportedTokens:40,
 maxPerCallTokens:24,...options
});
async function collect(model){
 const out=[];
 for await(const chunk of model.generateContentAsync({contents:[]}))out.push(chunk);
 return out;
}

test("ADK budget releases complete responses only after final monotonic usage",async()=>{
 const delegate=new OfflineDelegate(async function*(){
  yield response("first protected chunk",reported(5,5));
  yield response("second protected chunk",reported(6,8));
 });
 const model=wrapped(delegate);
 const out=await collect(model);
 assert.equal(out.length,2);
 assert.equal(out[0].content.parts[0].text,"first protected chunk");
 assert.equal(model.publicSummary().calls_started,1);
 assert.equal(model.publicSummary().reported_total_tokens,14);
 assert.equal(model.publicSummary().reported_input_tokens,6);
 assert.equal(model.publicSummary().reported_output_tokens,8);
 assert.equal(model.publicSummary().blocked,false);
 assert.equal(model.publicSummary().monetary_cap_enforced,false);
 assert.equal(delegate.calls,1);
});

test("call cap is global to this model instance, not reset between tasks",async()=>{
 const delegate=new OfflineDelegate(async function*(){
  yield response("irrelevant",reported(1,2));
 });
 const model=wrapped(delegate,{maxCalls:1});
 await collect(model);
 await assert.rejects(collect(model),DENY);
 assert.equal(delegate.calls,1);
 assert.equal(model.publicSummary().calls_started,1);
});

test("over-budget reported tokens never release source or tool actions",async()=>{
 const delegate=new OfflineDelegate(async function*(){
  yield response("MUST-NOT-REACH-AGENT",reported(16,12));
 });
 const model=wrapped(delegate,{maxPerCallTokens:20});
 const out=[];
 await assert.rejects(async()=>{
  for await(const chunk of model.generateContentAsync({}))out.push(chunk);
 },DENY);
 assert.equal(out.length,0);
 assert.equal(model.publicSummary().blocked,true);
 await assert.rejects(collect(model),DENY);
 assert.equal(delegate.calls,1);
});

test("unknown or decreasing provider usage denies instead of treating billing as zero",async()=>{
 const variants=[
  async function*(){yield response("unmetered");},
  async function*(){
   yield response("first",reported(7,8));
   yield response("regressed",reported(6,8));
  },
  async function*(){yield response("broken",{
   promptTokenCount:-1,candidatesTokenCount:3,totalTokenCount:2
  });}
 ];
 for(const generator of variants){
  const model=wrapped(new OfflineDelegate(generator));
  const out=[];
  await assert.rejects(async()=>{
   for await(const item of model.generateContentAsync({}))out.push(item);
  },DENY);
  assert.deepEqual(out,[]);
  assert.equal(model.publicSummary().blocked,true);
 }
});

test("provider exception after an early proposal does not admit any partial action",async()=>{
 const delegate=new OfflineDelegate(async function*(){
  yield response("delegate this tool",reported(1,2));
  throw Error("Synthetic provider failed mid-stream");
 });
 const model=wrapped(delegate),out=[];
 await assert.rejects(async()=>{
  for await(const item of model.generateContentAsync({}))out.push(item);
 },/Synthetic provider failed mid-stream/u);
 assert.deepEqual(out,[]);
 assert.equal(model.publicSummary().blocked,true);
});

test("simultaneous ADK requests on one specialist cannot bypass per-session call checks",async()=>{
 let unblock;
 const wait=new Promise(resolve=>{unblock=resolve;});
 const delegate=new OfflineDelegate(async function*(){
  await wait;
  yield response("complete response",reported(3,4));
 });
 const model=wrapped(delegate);
 const first=model.generateContentAsync({}),second=model.generateContentAsync({});
 const firstNext=first.next();
 await assert.rejects(second.next(),DENY);
 assert.equal(delegate.calls,1);
 unblock();
 const value=await firstNext;
 assert.equal(value.value.content.parts[0].text,"complete response");
 await first.next();
 assert.equal(model.publicSummary().reported_total_tokens,7);
});

test("aborted provider and explicit provider errors block all outputs and further calls",async()=>{
 const controller=new AbortController();
 controller.abort();
 const model=wrapped(new OfflineDelegate(async function*(){
  yield response("should never appear",reported(1,2));
 }));
 const results=[];
 await assert.rejects(async()=>{
  for await(const x of model.generateContentAsync({},false,controller.signal))
   results.push(x);
 },DENY);
 assert.deepEqual(results,[]);
 assert.equal(model.publicSummary().blocked,true);
 const failed=wrapped(new OfflineDelegate(async function*(){
  yield {errorCode:"RESOURCE_EXHAUSTED",errorMessage:"simulated secret provider error"};
 }));
 await assert.rejects(collect(failed),DENY);
 assert.equal(failed.publicSummary().blocked,true);
});

test("session role ceilings are fixed and do not expose billing or secret data",()=>{
 assert.deepEqual(Object.keys(PRIVATE_GEMINI_SESSION_LIMITS).sort(),[
  "adaptive-execution","backend","frontend","planning","test"
 ]);
 for(const [phase,limit] of Object.entries(PRIVATE_GEMINI_SESSION_LIMITS)){
  assert.equal(Object.isFrozen(limit),true,phase);
  assert.ok(limit.maxCalls>0&&limit.maxPerCallTokens<=limit.maxReportedTokens);
 }
 assert.throws(()=>wrapped(new OfflineDelegate(async function*(){yield 1;}),
  {maxCalls:0}),DENY);
 const model=wrapped(new OfflineDelegate(async function*(){
  yield response("hidden",reported(1,2));
 }));
 const snapshot=JSON.stringify(model.publicSummary());
 for(const secret of ["BEGIN PRIVATE KEY","GEMINI_API_KEY","gateway bearer",
  "hidden","MODEL_RESPONSE","original workbranch"])
  assert.equal(snapshot.includes(secret),false,secret);
 assert.throws(()=>model.connect(),DENY);
});
