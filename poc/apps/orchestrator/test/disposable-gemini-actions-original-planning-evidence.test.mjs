/** Zero-inference, no network, no original Root, no Engineer signature. */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {DisposablePrivateBudgetedAdkModel}
 from "../src/disposable-gemini-live-budgeted-model.mjs";
import {attestDisposableActionsOriginalPlanningCompletion}
 from "../src/disposable-gemini-actions-original-planning-evidence.mjs";

const DENY=/Disposable Actions original Planning evidence NO-GO/u;
class OfflinePlanning extends BaseLlm{
 calls=0;
 constructor(generator,model="gemini-3.8-flash"){
  super({model});this.generator=generator;
 }
 async *generateContentAsync(request,stream,signal){
  this.calls++;yield* this.generator(request,stream,signal);
 }
 connect(){throw Error("Provider disabled in offline test");}
}
const response=(usage)=>({
 content:{role:"model",parts:[{text:"synthetic owner Planning response"}]},
 ...(usage?{usageMetadata:usage}:{})
});
const usage=(input,output)=>({
 promptTokenCount:input,candidatesTokenCount:output,
 totalTokenCount:input+output
});
const create=(generator,phase="planning",model="gemini-3.8-flash")=>{
 const delegate=new OfflinePlanning(generator,model);
 const wrapped=new DisposablePrivateBudgetedAdkModel({
  delegate,phase,maxCalls:3,maxReportedTokens:1000,maxPerCallTokens:300
 });
 return {delegate,wrapped,authority:{planner:{model:wrapped}}};
};
const collect=async model=>{
 const seen=[];
 for await(const chunk of model.generateContentAsync({contents:[]}))
  seen.push(chunk);
 return seen;
};
test("a started but uncompleted owner Planner call cannot authorize CI Engineer signing",async()=>{
 const f=create(async function*(){yield response(usage(7,3));});
 assert.throws(()=>attestDisposableActionsOriginalPlanningCompletion(
  f.authority),DENY);
 assert.equal(f.delegate.calls,0);
 assert.deepEqual(await collect(f.wrapped),[response(usage(7,3))]);
 const proof=attestDisposableActionsOriginalPlanningCompletion(f.authority);
 assert.equal(f.delegate.calls,1);
 assert.equal(proof.calls_started,1);
 assert.equal(proof.reported_total_tokens,10);
 assert.equal(proof.model_authored_code_proven,false);
 assert.equal(proof.actual_provider_billing_verified,false);
 assert.equal(proof.monetary_cap_enforced,false);
 assert.equal(proof.original_backend_signed_checkpoint_verified_here,false);
 assert.equal(proof.authenticated_engineer_review_verified_here,false);
 assert.equal(proof.root_issued_here,false);
 assert.ok(Object.isFrozen(proof));
});
test("failed, truncated or missing usage must never be considered completed Planning",async()=>{
 for(const generator of [
  async function*(){yield response();},
  async function*(){throw Error("synthetic network failure");},
  async function*(){yield response({promptTokenCount:2,
   candidatesTokenCount:1,totalTokenCount:1});}
 ]){
  const f=create(generator);
  await assert.rejects(collect(f.wrapped));
  assert.equal(f.wrapped.publicSummary().blocked,true);
  assert.throws(()=>attestDisposableActionsOriginalPlanningCompletion(
   f.authority),DENY);
 }
});
test("untrusted objects, wrong specialist role or model name cannot manufacture Planning provenance",async()=>{
 for(const obj of [
  undefined,null,{}, {planner:{}},
  {planner:{model:{phase:"planning",publicSummary(){return {
   profile:"private-gemini-model-budget-not-proof-of-billing",
   phase:"planning",model_name:"gemini-3.8-flash",
   calls_started:1,reported_total_tokens:10
  };}}}
 ])assert.throws(()=>attestDisposableActionsOriginalPlanningCompletion(obj),DENY);
 const specialist=create(async function*(){yield response(usage(2,2));},"backend");
 await collect(specialist.wrapped);
 assert.throws(()=>attestDisposableActionsOriginalPlanningCompletion(
  specialist.authority),DENY);
 const wrongName=create(async function*(){yield response(usage(2,2));},
  "planning","offline-synthetic-no-provider");
 await collect(wrongName.wrapped);
 assert.throws(()=>attestDisposableActionsOriginalPlanningCompletion(
  wrongName.authority),DENY);
});
