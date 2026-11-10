import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
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
 assert.equal(v.scripted_native_e2e_requested,false);
 assert.equal(v.scripted_native_e2e_proven_here,false);
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

test("scripted-native admission remains strictly free, with no claim of execution",()=>{
 const value=assertDisposableGeminiCiPreflight({
  ...admission(),DELEGATION_LIVE_CI_PREFLIGHT_MODE:"scripted-native"
 },SHA);
 assert.equal(value.scripted_native_e2e_requested,true);
 assert.equal(value.scripted_native_e2e_proven_here,false);
 assert.equal(value.gemini_api_calls,0);
 assert.equal(value.signed_engineer_approval_created,false);
 assert.equal(value.native_root_created,false);
 assert.equal(value.billed_execution_authorized,false);
 for(const mode of ["gemini-real","paid","scripted-live",""]){
  assert.throws(()=>assertDisposableGeminiCiPreflight({
   ...admission(),DELEGATION_LIVE_CI_PREFLIGHT_MODE:mode
  },SHA),DENY,mode);
 }
});

test("live CI manual scripted-native route reuses ORIGINAL signed native job",()=>{
 const workflow=readFileSync(new URL(
  "../../../../.github/workflows/gemini-authority-only-live-ci-pilot.yml",
  import.meta.url),"utf8");
 const native=readFileSync(new URL(
  "../../../../.github/workflows/r38513-native-strict-full-recovery.yml",
  import.meta.url),"utf8");
 const onBlock=workflow.match(/^on:\\n([\\s\\S]*?)^permissions:/mu)?.[1];
 assert.ok(onBlock);
 assert.match(onBlock,/^  workflow_dispatch:/mu);
 assert.doesNotMatch(onBlock,/^  (?:push|pull_request|schedule):/mu);
 assert.match(workflow,/          - preflight-only\\n          - scripted-native/u);
 assert.match(workflow,/DELEGATION_LIVE_CI_PREFLIGHT_MODE: \\$\\{\\{ inputs.mode \\}\\}/u);
 assert.match(workflow,/github.run_attempt == 1/u);
 assert.match(workflow,/    needs: preflight\\n    if:/u);
 assert.match(workflow,/inputs.mode == 'scripted-native'/u);
 assert.match(workflow,/uses: \\.\\/\\.github\\/workflows\\/r38513-native-strict-full-recovery\\.yml/u);
 assert.match(workflow,/original_ci_engineer_after_planning: true/u);
 assert.match(native,/workflow_call:/u);
 assert.match(native,/R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING: \\$\\{\\{ inputs.original_ci_engineer_after_planning/u);
 assert.match(native,/verify-disposable-native-e2e-proof\\.mjs/u);
 assert.match(workflow,/permissions:\\n  contents: read/u);
 assert.doesNotMatch(workflow,/secrets:|GEMINI_API_KEY:|GOOGLE_API_KEY:|OPENAI_API_KEY:/u);
});
