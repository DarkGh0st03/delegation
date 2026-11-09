import test from "node:test";
import assert from "node:assert/strict";
import {Gemini} from "@google/adk";
import {
 assertDisposableLiveGeminiAdmission,
 createDisposableLiveGeminiModelSet,
 describeDisposableLiveGeminiContract
} from "../src/disposable-gemini-live-model-set.mjs";

const SHA="a".repeat(40);
const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
function admitted(){
 return {
  GITHUB_ACTIONS:"true",
  GITHUB_REPOSITORY:REPO,
  GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_REF:REF,
  GITHUB_WORKFLOW_REF:REPO+
   "/.github/workflows/gemini-authority-only-live-ci-pilot.yml@"+REF,
  GITHUB_RUN_ATTEMPT:"1",
  GITHUB_RUN_ID:"42676276171",
  GITHUB_SHA:SHA,
  DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:
   "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  };
}

test("live admission is manual, pinned, consented and separate from no-billing CI",()=>{
 const env=admitted();
 const state=assertDisposableLiveGeminiAdmission(env,SHA);
 assert.equal(state.source_sha,SHA);
 assert.equal(state.gemini_inference_started,false);
 assert.equal(state.billing_cap_automatically_enforced,false);
 assert.equal(state.human_review_simulated,true);
});

test("live admission denies every unsanctioned source, replay, mode and billing case",()=>{
 const invalid=[
  ["GITHUB_ACTIONS","false"],
  ["GITHUB_REPOSITORY","attacker/repository"],
  ["GITHUB_EVENT_NAME","push"],
  ["GITHUB_REF","refs/heads/main"],
  ["GITHUB_WORKFLOW_REF","attacker/alternate-workflow@"+REF],
  ["GITHUB_RUN_ATTEMPT","2"],
  ["GITHUB_RUN_ID","0"],
  ["GITHUB_SHA","not-a-commit"],
  ["DELEGATION_DISPOSABLE_LIVE_MODE","scripted-offline"],
  ["DELEGATION_GEMINI_CHARGE_CONFIRMATION","yes"],
  ["DELEGATION_BILLING_CAP_ACK","I think this is safe"],
  ["DELEGATION_DISPOSABLE_CI_MODE","scripted-offline"],
  ["DELEGATION_SIGNED_GEMINI_PILOT","1"],
  ["OPENAI_API_KEY","mock"],
  ["GEMINI_API_KEY","short"],
  ["GEMINI_API_KEY","fake key with spaces"]
 ];
 for(const [key,value] of invalid){
  const env=admitted();env[key]=value;
  assert.throws(
   ()=>assertDisposableLiveGeminiAdmission(env,SHA),
   /Disposable live Gemini model admission NO-GO/u,key
  );
 }
 assert.throws(
  ()=>assertDisposableLiveGeminiAdmission(admitted(),"b".repeat(40)),
  /NO-GO/u
 );
 assert.throws(
  ()=>createDisposableLiveGeminiModelSet({
   env:{...admitted(),GITHUB_EVENT_NAME:"pull_request"},checkoutSha:SHA
  }),/NO-GO/u
 );
});

test("real ADK Gemini instances bind to ORIGINAL Planner, adaptive loop and exactly three A2A roles without making a request",()=>{
 // The synthetic key is never sent to Google: only Gemini constructors run.
 const models=createDisposableLiveGeminiModelSet({
  env:admitted(),checkoutSha:SHA,
  privateApiKey:"synthetic-not-a-real-provider-key"
 });
 assert.equal(Object.isFrozen(models),true);
 assert.deepEqual(Object.keys(models),[]);
 assert.ok(models.planner.model instanceof Gemini);
 assert.ok(models.adaptive.model instanceof Gemini);
 assert.deepEqual(Object.keys(models.workers).sort(),
  ["backend","frontend","test"]);
 for(const role of ["backend","frontend","test"]){
  assert.ok(models.workers[role].model instanceof Gemini);
  assert.notEqual(models.workers[role].model,models.planner.model);
  assert.equal(models.workers[role].model.model,"gemini-3.8-flash");
  assert.equal(models.workers[role].maxModelCallMs,60000);
 }
 assert.notEqual(models.planner.model,models.adaptive.model);
 assert.equal(models.planner.maxModelTurns,20);
 assert.equal(models.planner.maxPlanningMs,180000);
 assert.equal(models.adaptive.maxSteps,25);
 assert.equal(models.adaptive.maxVerifiedFailures,2);
 assert.equal(models.workers.test.generateContentConfig.maxOutputTokens,12288);
 assert.throws(()=>JSON.stringify(models),/must not be serialized/u);
 assert.equal("apiKey" in describeDisposableLiveGeminiContract(),false);
});

test("Gemini secrets are never accepted from the shared GitHub Actions environment",()=>{
 const env=admitted();
 for(const name of ["GEMINI_API_KEY","GOOGLE_API_KEY"]){
  assert.throws(()=>assertDisposableLiveGeminiAdmission({
   ...env,[name]:"synthetic-secret-must-not-be-inherited"
  },SHA),/NO-GO/u);
 }
 assert.throws(()=>createDisposableLiveGeminiModelSet({
  env,checkoutSha:SHA
 }),/NO-GO/u);
 assert.throws(()=>createDisposableLiveGeminiModelSet({
  env,checkoutSha:SHA,privateApiKey:"too-short"
 }),/NO-GO/u);
 assert.throws(()=>createDisposableLiveGeminiModelSet({
  env,checkoutSha:SHA,privateApiKey:"invalid with spaces"
 }),/NO-GO/u);
});

test("safe evidence says no Gemini decisions or generative code have been proved",()=>{
 const result=describeDisposableLiveGeminiContract();
 assert.deepEqual(result.specialist_roles,["backend","frontend","test"]);
 assert.equal(result.provider_calls,0);
 assert.equal(result.model_generated_code_proven,false);
 assert.equal(result.spend_cap_proven,false);
 assert.equal(result.requires_isolated_api_secret,true);
 assert.ok(!JSON.stringify(result).includes("synthetic-not-a-real-provider-key"));
});
