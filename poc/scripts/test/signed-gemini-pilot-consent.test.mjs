import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {SIGNED_GEMINI_PILOT,BILLING_ACK,verifySignedGeminiPilotConsent}
  from "../signed-gemini-pilot-consent.mjs";
const valid=()=>({
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_REF:"refs/heads/refactor/post-prof-plan-contracts-20261021",
  GITHUB_SHA:"a".repeat(40),GITHUB_RUN_ID:"40699999999",
  DELEGATION_PINNED_COMMIT_SHA:"a".repeat(40),
  DELEGATION_BILLING_CAP_ACK:BILLING_ACK,
  DELEGATION_SIGNED_GEMINI_PILOT:"1",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_GEMINI_MODEL:"gemini-3.8-flash"
});
test("manual pilot produces ONLY a redacted zero-inference receipt",()=>{
  const env={...valid(),GEMINI_API_KEY:"SECRET_NEVER_TO_APPEAR"};
  const receipt=verifySignedGeminiPilotConsent(env,{requireApiKey:true});
  assert.equal(receipt.generation_calls,0);
  assert.equal(receipt.pinned_commit_sha,"a".repeat(40));
  assert.equal(receipt.billing_cap_configuration,
    "user_attested_not_programmatically_verified");
  assert.equal(receipt.billing_cap_overage_risk_acknowledged,true);
  assert.equal(receipt.actual_api_access_verified,false);
  assert.equal(receipt.spending_cap_enforced_by_this_check,false);
  assert.equal(receipt.paid_execution_authorized_by_this_receipt,false);
  assert.equal(receipt.engineer_review,"signed_test_fixture_not_human");
  assert.deepEqual(receipt.max_model_turns_per_task,
    {planner:24,backend:20,frontend:14,test:10});
  assert.equal(receipt.max_output_tokens_per_call,20480);
  assert.equal(receipt.planner_max_output_tokens_per_call,12288);
  assert.equal(receipt.max_model_call_ms,180000);
  assert.deepEqual(receipt.max_output_tokens_per_role,{
    backend:20480,frontend:20480,test:12288
  });
  assert.equal(SIGNED_GEMINI_PILOT.maxPlanningMs,600000);
  assert.equal(SIGNED_GEMINI_PILOT.maxA2aTaskMs,1800000);
  assert.equal(SIGNED_GEMINI_PILOT.childCredentialValiditySeconds,2400);
  assert.equal(SIGNED_GEMINI_PILOT.operationalRootValiditySeconds,6300);
  assert.ok(SIGNED_GEMINI_PILOT.childCredentialValiditySeconds*1000 >
    SIGNED_GEMINI_PILOT.maxA2aTaskMs);
  assert.ok(SIGNED_GEMINI_PILOT.operationalRootValiditySeconds*1000 >
    3*SIGNED_GEMINI_PILOT.maxA2aTaskMs+SIGNED_GEMINI_PILOT.maxPlanningMs);
  assert.ok(SIGNED_GEMINI_PILOT.childCredentialValiditySeconds<=7200);
  assert.equal(Object.isFrozen(SIGNED_GEMINI_PILOT.maxOutputTokensPerRole),true);
  assert.equal(receipt.max_model_call_ms,180000);
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
    DELEGATION_PINNED_COMMIT_SHA:["b".repeat(40),undefined,""],
    DELEGATION_BILLING_CAP_ACK:["I CONFIRM",undefined,
      "I VERIFIED PROJECT SPEND CAP"],
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

test("actual relative-path CLI cannot bypass manual consent (zero provider calls)",()=>{
  // Exercise the exact GitHub Actions invocation, not just the exported
  // preflight function. Node commonly passes a resolved relative entrypoint.
  const script=fileURLToPath(new URL("../signed-gemini-pilot-consent.mjs",
    import.meta.url));
  const run=(args,overrides={})=>spawnSync(process.execPath,
    [script,...args],{encoding:"utf8",
      env:{...process.env,...valid(),...overrides},
      timeout:5000});
  const good=run(["--preflight-no-inference"]);
  assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(good.stdout).generation_calls,0);
  const paid=run(["--require-key-no-inference"],{
    GEMINI_API_KEY:"LOCAL_TEST_ONLY_NOT_REAL_KEY"
  });
  assert.equal(paid.status,0,paid.stderr);
  assert.equal(JSON.parse(paid.stdout).actual_api_access_verified,false);
  for(const [args,env] of [
    [["--preflight-no-inference"],{GITHUB_RUN_ATTEMPT:"2"}],
    [["--preflight-no-inference"],{
      DELEGATION_PINNED_COMMIT_SHA:"b".repeat(40)}],
    [["--preflight-no-inference"],{DELEGATION_BILLING_CAP_ACK:""}],
    [["--preflight-no-inference"],{GITHUB_EVENT_NAME:"push"}],
    [["--require-key-no-inference"],{GEMINI_API_KEY:""}],
    [[],{}],
    [["--unknown"],{}]
  ]){
    const result=run(args,env);
    assert.notEqual(result.status,0,
      "CLI must reject invalid configuration instead of silently exiting");
    assert.equal(result.stdout,"");
  }
});
