import test from "node:test";
import assert from "node:assert/strict";
import {SIGNED_GEMINI_PILOT,verifySignedGeminiPilotConsent}
  from "../signed-gemini-pilot-consent.mjs";
const valid=()=>({
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_REF:"refs/heads/refactor/post-prof-plan-contracts-20261021",
  GITHUB_SHA:"a".repeat(40),GITHUB_RUN_ID:"40699999999",
  DELEGATION_SIGNED_GEMINI_PILOT:"1",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_GEMINI_MODEL:"gemini-3.8-flash"
});
test("manual pilot produces ONLY a redacted zero-inference receipt",()=>{
  const env={...valid(),GEMINI_API_KEY:"SECRET_NEVER_TO_APPEAR"};
  const receipt=verifySignedGeminiPilotConsent(env,{requireApiKey:true});
  assert.equal(receipt.generation_calls,0);
  assert.equal(receipt.actual_api_access_verified,false);
  assert.equal(receipt.spending_cap_enforced_by_this_check,false);
  assert.equal(receipt.paid_execution_authorized_by_this_receipt,false);
  assert.equal(receipt.engineer_review,"signed_test_fixture_not_human");
  assert.deepEqual(receipt.max_model_turns_per_task,
    {planner:20,backend:17,frontend:11,test:6});
  assert.equal(receipt.max_output_tokens_per_call,8192);
  assert.equal(receipt.max_model_call_ms,120000);
  assert.equal(receipt.model,"gemini-3.8-flash");
  assert.equal(Object.isFrozen(receipt),true);
  assert.equal(Object.isFrozen(SIGNED_GEMINI_PILOT.maxTurnsPerTask),true);
  assert.ok(!JSON.stringify(receipt).includes(env.GEMINI_API_KEY));
});
test("manual consent is fail closed for wrong event, branch, run or model",()=>{
  for(const [field,values] of Object.entries({
    GITHUB_ACTIONS:["false",undefined],GITHUB_EVENT_NAME:["push","pull_request"],
    GITHUB_RUN_ATTEMPT:["2","0"],GITHUB_REPOSITORY:["example/delegation"],
    GITHUB_REF:["refs/heads/main","refs/tags/v1"],
    GITHUB_SHA:["invalid","A".repeat(40)],GITHUB_RUN_ID:["0","x"],
    DELEGATION_SIGNED_GEMINI_PILOT:["0",undefined],
    DELEGATION_GEMINI_CHARGE_CONFIRMATION:["yes","I AUTHORIZE"],
    DELEGATION_GEMINI_MODEL:["gemini-3.8-live","gemini-4-argon"]
  })){
    for(const value of values){
      const env=valid();env[field]=value;
      assert.throws(()=>verifySignedGeminiPilotConsent(env),/NO-GO/u,
        "Invalid consent dimension "+field);
    }
  }
});
test("offline recovery and repeated Test fixtures cannot enter paid pilot",()=>{
  for(const field of [
    "APPROVED_RUNNER_SIGNED_DAG_RECOVERY",
    "APPROVED_RUNNER_SIGNED_DAG_MULTI_TEST_TASKS"
  ]){
    assert.throws(()=>verifySignedGeminiPilotConsent({
      ...valid(),[field]:"1"
    }),/NO-GO/u);
  }
});
test("dry preflight never requires a key, charged path requires a nonempty key",()=>{
  assert.equal(verifySignedGeminiPilotConsent(valid()).generation_calls,0);
  for(const key of [undefined,"","short"]){
    assert.throws(()=>verifySignedGeminiPilotConsent({
      ...valid(),GEMINI_API_KEY:key
    },{requireApiKey:true}),/NO-GO/u);
  }
});
