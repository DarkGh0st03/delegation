import test from "node:test";
import assert from "node:assert/strict";
import {assertDisposableGeminiCiPreflight}
 from "../src/disposable-gemini-ci-preflight.mjs";

const SHA="a".repeat(40);
const REPO="DarkGh0st03/delegation";
const REF="refs/heads/experiment/disposable-gemini-live-20261109";
function admission(){
 return {
  GITHUB_ACTIONS:"true",
  GITHUB_REPOSITORY:REPO,
  GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_REF:REF,
  GITHUB_WORKFLOW_REF:REPO+
   "/.github/workflows/gemini-authority-only-live-ci-pilot.yml@"+REF,
  GITHUB_RUN_ID:"42781831855",GITHUB_RUN_ATTEMPT:"1",GITHUB_SHA:SHA,
  DELEGATION_LIVE_CI_PREFLIGHT_MODE:"preflight-only"
 };
}
const DENY=/Disposable Gemini CI preflight NO-GO/u;
test("manual experimental GitHub preflight guarantees NO inference or approval",()=>{
 const v=assertDisposableGeminiCiPreflight(admission(),SHA);
 assert.equal(v.status,"disposable_manual_ci_preflight_only");
 assert.equal(v.source_sha,SHA);
 assert.equal(v.gemini_api_calls,0);
 assert.equal(v.billed_execution_authorized,false);
 assert.equal(v.model_generated_code_proven,false);
 assert.equal(v.isolated_owner_execution_proven,false);
 assert.equal(v.monetary_cap_enforced,false);
 assert.equal(Object.isFrozen(v),true);
});

test("all foreign, paid, replay, scripted or unpinned preflight origins deny",()=>{
 const variants=[
  ["GITHUB_ACTIONS","false"],["GITHUB_REPOSITORY","attacker/repo"],
  ["GITHUB_EVENT_NAME","push"],["GITHUB_REF","refs/heads/main"],
  ["GITHUB_WORKFLOW_REF","untrusted/other.yml@"+REF],
  ["GITHUB_RUN_ID","0"],["GITHUB_RUN_ATTEMPT","2"],
  ["GITHUB_SHA","not-a-sha"],
  ["DELEGATION_LIVE_CI_PREFLIGHT_MODE","gemini-real"],
  ["DELEGATION_GEMINI_CHARGE_CONFIRMATION","I AUTHORIZE GEMINI API CHARGES"],
  ["DELEGATION_BILLING_CAP_ACK","I VERIFIED PROJECT SPEND CAP"],
  ["DELEGATION_DISPOSABLE_LIVE_MODE","gemini-real"],
  ["DELEGATION_SIGNED_GEMINI_PILOT","1"],
  ["GEMINI_API_KEY","fake"],["GOOGLE_API_KEY","fake"],
  ["OPENAI_API_KEY","fake"]
 ];
 for(const [field,value] of variants){
  assert.throws(()=>assertDisposableGeminiCiPreflight({
   ...admission(),[field]:value
  },SHA),DENY,field);
 }
 assert.throws(()=>assertDisposableGeminiCiPreflight(admission(),
  "b".repeat(40)),DENY);
});
