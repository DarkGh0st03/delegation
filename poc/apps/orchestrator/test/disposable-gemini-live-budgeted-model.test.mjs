import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {
 DisposablePrivateBudgetedAdkModel,
 DisposablePrivateSessionUsageBudget,
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

test("simultaneous ADK requests on one specialist terminally fence both outputs",async()=>{
 let unblock;
 const wait=new Promise(resolve=>{unblock=resolve;});
 const delegate=new OfflineDelegate(async function*(){
  await wait;
  yield response("MUST-NOT-REACH-AGENT",reported(3,4));
 });
 const model=wrapped(delegate);
 const first=model.generateContentAsync({}),second=model.generateContentAsync({});
 const firstNext=first.next();
 await assert.rejects(second.next(),DENY);
 assert.equal(delegate.calls,1);
 unblock();
 await assert.rejects(firstNext,DENY);
 assert.equal(model.publicSummary().reported_total_tokens,0);
 assert.equal(model.publicSummary().blocked,true);
 await assert.rejects(collect(model),DENY);
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


test("a single private-session call budget is shared across Planner, Orchestrator and every worker",async()=>{
 const budget=new DisposablePrivateSessionUsageBudget();
 const model=phase=>new DisposablePrivateBudgetedAdkModel({
  delegate:new OfflineDelegate(async function*(){
   yield response("verified only after metered",reported(7,8));
  }),
  phase,maxCalls:20,maxReportedTokens:200000,
  maxPerCallTokens:32000,sessionBudget:budget
 });
 const planner=model("planning"),adaptive=model("adaptive-execution"),
  backend=model("backend"),frontend=model("frontend"),workerTest=model("test");
 for(const each of [planner,adaptive,backend,frontend,workerTest]){
  const out=await collect(each);
  assert.equal(out.length,1);
 }
 assert.equal(budget.publicSummary().calls_started,5);
 assert.equal(budget.publicSummary().reported_total_tokens,75);
 assert.equal(budget.publicSummary().blocked,false);
 assert.equal(budget.publicSummary().max_calls,45);
 assert.equal(budget.publicSummary().max_reported_tokens,200000);
 assert.equal(budget.publicSummary().monetary_cap_enforced,false);
});

test("global session budget is independent of per-model token counters and fails closed on overflow",async()=>{
 const budget=new DisposablePrivateSessionUsageBudget();
 const mk=phase=>new DisposablePrivateBudgetedAdkModel({
  delegate:new OfflineDelegate(async function*(){
   yield response("never execute unverified proposal",reported(56000,0));
  }),
  phase,maxCalls:10,maxReportedTokens:250000,
  maxPerCallTokens:60000,sessionBudget:budget
 });
 const planner=mk("planning"),backend=mk("backend");
 for(const m of [planner,backend,planner]){
  const responseList=await collect(m);
  assert.equal(responseList.length,1);
 }
 const output=[];
 await assert.rejects(async()=>{
  for await(const message of backend.generateContentAsync({}))
   output.push(message);
 },DENY);
 assert.equal(output.length,0);
 assert.equal(budget.publicSummary().calls_started,4);
 assert.equal(budget.publicSummary().reported_total_tokens,168000);
 assert.equal(budget.publicSummary().blocked,true);
 await assert.rejects(collect(planner),DENY);
});

test("global call cap stops switching roles after 45 calls even when each model is below its local cap",async()=>{
 const budget=new DisposablePrivateSessionUsageBudget();
 const build=phase=>new DisposablePrivateBudgetedAdkModel({
  delegate:new OfflineDelegate(async function*(){
   yield response("normal",reported(1,0));
  }),
  phase,maxCalls:64,maxReportedTokens:250000,
  maxPerCallTokens:60000,sessionBudget:budget
 });
 const models=["planning","adaptive-execution","backend","frontend","test"].map(build);
 for(let i=0;i<45;i++)await collect(models[i%5]);
 assert.equal(budget.publicSummary().calls_started,45);
 assert.equal(budget.publicSummary().reported_total_tokens,45);
 await assert.rejects(collect(models[0]),DENY);
 assert.equal(models[0].publicSummary().blocked,true);
});

test("an ambiguous provider failure blocks all other original roles in the same session",async()=>{
 const budget=new DisposablePrivateSessionUsageBudget();
 const failed=new DisposablePrivateBudgetedAdkModel({
  delegate:new OfflineDelegate(async function*(){
   yield response("partial call",reported(1,2));
   throw Error("synthetic provider connection lost");
  }),
  phase:"backend",maxCalls:2,maxReportedTokens:2000,
  maxPerCallTokens:1000,sessionBudget:budget
 });
 const healthy=new DisposablePrivateBudgetedAdkModel({
  delegate:new OfflineDelegate(async function*(){
   yield response("no more provider charges",reported(1,2));
  }),
  phase:"test",maxCalls:2,maxReportedTokens:2000,
  maxPerCallTokens:1000,sessionBudget:budget
 });
 await assert.rejects(collect(failed),/synthetic provider connection lost/u);
 assert.equal(budget.publicSummary().blocked,true);
 await assert.rejects(collect(healthy),DENY);
 assert.equal(healthy.publicSummary().calls_started,0);
});

test("cross-role overlap permanently invalidates both private Gemini requests",async()=>{
 const budget=new DisposablePrivateSessionUsageBudget();
 let unblock;
 const signal=new Promise(resolve=>{unblock=resolve;});
 const waiting=new DisposablePrivateBudgetedAdkModel({
  delegate:new OfflineDelegate(async function*(){
   await signal;
   yield response("MUST-NOT-REACH-AGENT",reported(1,2));
  }),
  phase:"adaptive-execution",maxCalls:2,
  maxReportedTokens:1000,maxPerCallTokens:100,sessionBudget:budget
 });
 const competing=new DisposablePrivateBudgetedAdkModel({
  delegate:new OfflineDelegate(async function*(){
   yield response("second model",reported(1,2));
  }),
  phase:"frontend",maxCalls:2,
  maxReportedTokens:1000,maxPerCallTokens:100,sessionBudget:budget
 });
 const flight=waiting.generateContentAsync({}),pending=flight.next();
 await assert.rejects(collect(competing),DENY);
 assert.equal(budget.publicSummary().calls_started,1);
 assert.equal(budget.publicSummary().blocked,true);
 unblock();
 await assert.rejects(pending,DENY);
 assert.equal(budget.publicSummary().reported_total_tokens,0);
 await assert.rejects(collect(waiting),DENY);
 await assert.rejects(collect(competing),DENY);
});

test("same-model overlap poisons the shared budget for every other original role",async()=>{
 const budget=new DisposablePrivateSessionUsageBudget();
 let release;
 const waiting=new Promise(resolve=>{release=resolve;});
 const backend=wrapped(new OfflineDelegate(async function*(){
  await waiting;
  yield response("MUST-NOT-REACH-AGENT",reported(1,2));
 }),{sessionBudget:budget});
 const workerTest=wrapped(new OfflineDelegate(async function*(){
  yield response("MUST-NOT-BE-CHARGED",reported(1,2));
 }),{phase:"test",sessionBudget:budget});
 const active=backend.generateContentAsync({}).next();
 await assert.rejects(backend.generateContentAsync({}).next(),DENY);
 assert.equal(budget.publicSummary().blocked,true);
 release();
 await assert.rejects(active,DENY);
 assert.equal(budget.publicSummary().reported_total_tokens,0);
 await assert.rejects(collect(workerTest),DENY);
});
