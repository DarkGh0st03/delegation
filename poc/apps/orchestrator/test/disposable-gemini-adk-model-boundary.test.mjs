import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {runTrustedAuthorityOnlyAdaptiveWorkLoop}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-adaptive-work-loop.mjs";
import {DisposableCIMeteredAdkModel}
 from "../src/disposable-gemini-adk-model-boundary.mjs";

const BRANCH="feature/account-suspension";
const ROOT="gitea://gitea.local/thesis/iam-console-poc";
const TASK_SCOPE=ROOT+"/branches/feature%2Faccount-suspension";
const TEST={operation:"run_tests",resource:TASK_SCOPE};
const UPDATE={operation:"update_file",resource:TASK_SCOPE+"/files/apps/backend/unsafe.ts"};
function task(permission=TEST){
 return {action:"delegate",task:{
  task_id:"model-selected-test-1",agent_id:"test",depends_on:[],
  permissions:[permission],instruction:"Run the authorized disposable test"
 }};
}
class OfflineRecordedAdk extends BaseLlm{
 calls=0;requests=[];
 constructor(choices,{metadata=true}={}){
  super({model:"offline-adk-proof-no-provider"});this.choices=choices;
  this.metadata=metadata;
 }
 async *generateContentAsync(request){
  this.requests.push(request);
  const index=this.calls++;
  if(index>=this.choices.length)throw Error("No scripted response available");
  yield {
   content:{role:"model",parts:[{text:JSON.stringify(this.choices[index])}]},
   ...(this.metadata?{usageMetadata:{
    promptTokenCount:5,candidatesTokenCount:9,totalTokenCount:14
   }}:{})
  };
 }
 connect(){throw Error("Offline model cannot connect to any provider");}
}
function ownerFixture(){
 const completed=[];let retired=false;const effects=[];
 const hooks={
  async readContext(){
   if(retired)throw Error("Owner retired");
   return {
    requirement:"Implement Account Suspension in disposable source",
    branch:BRANCH,
    rootPermissions:[TEST],
    agents:{test:{capabilities:["run_tests"]}},
    previousTasks:completed.map(t=>({task_id:t.task_id,agent_id:t.agent_id})),
    nextEpoch:completed.length+1,
    executionProgress:{
     current_head_sha:"a".repeat(40),
     completed_work:completed.map(t=>({
      task_id:t.task_id,agent_id:t.agent_id,
      operation:"run_tests",instruction:t.instruction
     }))
    }
   };
  },
  async beforeDecision(){effects.push("owner_before_decision");},
  async executeTask(t){
   effects.push("fixture_effect:"+t.agent_id);
   completed.push(t);
  },
  async confirmReady(){
   effects.push("fixture_independent_test_proof");
   return {
    status:"owner_verified_tested_head_not_pr_authorized",
    task_id:"model-selected-test-1",
    runtime_task_id:"runtime-model-selected-test-1",
    tested_commit_sha:"a".repeat(40)
   };
  },
  async retire(){retired=true;effects.push("owner_retired");}
 };
 return {hooks,completed,effects,get retired(){return retired;}};
}
test("research metering forwards actual BaseLlm model output into ORIGINAL adaptive loop",async()=>{
 const scripted=new OfflineRecordedAdk([task(),{
  action:"ready_for_pr",reason:"The independently verified Test is complete"
 }]);
 const metered=new DisposableCIMeteredAdkModel({
  delegate:scripted,phase:"adaptive-execution",maxCalls:2,
  maxReportedTokens:50
 });
 const owner=ownerFixture();
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({
  model:metered,hooks:owner.hooks,maxSteps:2
 });
 assert.equal(result.status,"owner_adaptive_work_ready_for_pr");
 assert.equal(result.pr_created,false);
 assert.equal(result.executed_tasks,1);
 assert.deepEqual(owner.effects.filter(x=>x.startsWith("fixture_effect")),
  ["fixture_effect:test"]);
 assert.equal(scripted.calls,2);
 const s=metered.publicSummary();
 assert.equal(s.calls_started,2);
 assert.equal(s.calls_with_provider_usage,2);
 assert.equal(s.reported_input_tokens,10);
 assert.equal(s.reported_output_tokens,18);
 assert.equal(s.reported_total_tokens,28);
 assert.equal(s.usage_complete,true);
 assert.equal(s.real_model_decisions_verified,false);
 assert.equal(s.billed_amount_measured,false);
 assert.equal(s.approval_by_human,false);
 assert.equal(JSON.stringify(s).includes("Run the authorized"),false);
 assert.equal(owner.retired,false);
});
test("a model's out-of-scope proposal never reaches effects even with token reports",async()=>{
 const scripted=new OfflineRecordedAdk([task(UPDATE)]);
 const metered=new DisposableCIMeteredAdkModel({
  delegate:scripted,phase:"adaptive-execution",maxCalls:1
 });
 const owner=ownerFixture();
 await assert.rejects(
  runTrustedAuthorityOnlyAdaptiveWorkLoop({
   model:metered,hooks:owner.hooks,maxSteps:1
  }),/R351 authority-only model Task choice denied/u);
 assert.equal(owner.completed.length,0);
 assert.equal(owner.retired,true);
 assert.equal(metered.publicSummary().calls_started,1);
});
test("metering refuses extra calls, missing provider labels, fake live Gemini, malformed metadata",async()=>{
 const model=new OfflineRecordedAdk([task()]);
 const meter=new DisposableCIMeteredAdkModel({
  delegate:model,phase:"planning",maxCalls:1,maxReportedTokens:20
 });
 const res=[];
 for await(const item of meter.generateContentAsync({}))res.push(item);
 assert.equal(res.length,1);
 await assert.rejects(async()=>{
  for await(const _ of meter.generateContentAsync({})){}
 },/Disposable ADK research model boundary NO-GO/u);
 assert.throws(()=>new DisposableCIMeteredAdkModel({
  delegate:model,source:"gemini-live",phase:"planning",maxCalls:1,
  permitLiveCall:()=>true
 }),/Disposable ADK research model boundary NO-GO/u);
 assert.throws(()=>new DisposableCIMeteredAdkModel({
  delegate:model,phase:"adversarial-AI",maxCalls:1
 }),/Disposable ADK research model boundary NO-GO/u);
 assert.throws(()=>new DisposableCIMeteredAdkModel({
  delegate:model,phase:"planning",maxCalls:0
 }),/Disposable ADK research model boundary NO-GO/u);
 const noUsage=new DisposableCIMeteredAdkModel({
  delegate:new OfflineRecordedAdk([task()],{metadata:false}),
  phase:"planning",maxCalls:1
 });
 for await(const _ of noUsage.generateContentAsync({})){}
 assert.equal(noUsage.publicSummary().usage_complete,false);
 assert.equal(noUsage.publicSummary().reported_total_tokens,0);
});
test("metered research no raw token, source, private model output or receipt in snapshots",()=>{
 const fake=new OfflineRecordedAdk([{action:"blocked",reason:"hidden source"}]);
 const metered=new DisposableCIMeteredAdkModel({
  delegate:fake,phase:"backend",maxCalls:1
 });
 const roles=metered.allowedRoles;
 assert.deepEqual(roles,["backend","frontend","test"]);
 roles.push("reviewer");
 assert.deepEqual(metered.allowedRoles,["backend","frontend","test"]);
 assert.throws(()=>metered.connect(),/NO-GO/u);
 const summary=JSON.stringify(metered.publicSummary());
 for(const forbidden of ["signed_vp","BEGIN PRIVATE KEY",
  "read_repository","hidden source","GEMINI_API_KEY"])
  assert.equal(summary.includes(forbidden),false,forbidden);
});


test("no model output escapes if cumulative token usage exceeds owner budget",async()=>{
 class OverBudget extends BaseLlm{
  constructor(){super({model:"scripted-over-budget-no-provider"});}
  async *generateContentAsync(){
   yield {content:{role:"model",parts:[{text:JSON.stringify(task())}]},
    usageMetadata:{promptTokenCount:9,candidatesTokenCount:9,totalTokenCount:18}};
  }
  connect(){throw Error("No provider");}
 }
 const meter=new DisposableCIMeteredAdkModel({
  delegate:new OverBudget(),phase:"adaptive-execution",
  maxCalls:2,maxReportedTokens:16
 });
 const forwarded=[];
 await assert.rejects(async()=>{
  for await(const response of meter.generateContentAsync({}))
   forwarded.push(response);
 },/Disposable ADK research model boundary NO-GO/u);
 assert.equal(forwarded.length,0,
  "No untrusted Task may reach ADK before a final usage budget check");
 assert.equal(meter.publicSummary().usage_complete,false);
 await assert.rejects(async()=>{
  for await(const _ of meter.generateContentAsync({})){}
 },/NO-GO/u);
});
test("no partially streamed decision can escape an upstream failure",async()=>{
 class FailingStream extends BaseLlm{
  constructor(){super({model:"scripted-failing-stream-no-provider"});}
  async *generateContentAsync(){
   yield {content:{role:"model",parts:[{text:JSON.stringify(task())}]}};
   throw Error("Model transport stopped");
  }
  connect(){throw Error("No provider");}
 }
 const meter=new DisposableCIMeteredAdkModel({
  delegate:new FailingStream(),phase:"planning",
  maxCalls:2
 });
 const forwarded=[];
 await assert.rejects(async()=>{
  for await(const response of meter.generateContentAsync({}))
   forwarded.push(response);
 },/Model transport stopped/u);
 assert.deepEqual(forwarded,[],
  "A model response must never be admitted until stream completion");
 assert.equal(meter.publicSummary().usage_complete,false);
 await assert.rejects(async()=>{
  for await(const _ of meter.generateContentAsync({})){}
 },/NO-GO/u);
});
