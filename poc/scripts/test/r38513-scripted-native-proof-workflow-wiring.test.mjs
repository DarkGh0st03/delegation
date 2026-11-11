/**
 * Free-only test: keep R385.13 opt-in and preserve the original proof gate.
 * These static guards CANNOT substitute for a manually dispatched Rust E2E.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const root=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const read=path=>readFileSync(resolve(root,path),"utf8");
const workflow=read(".github/workflows/r38513-native-strict-full-recovery.yml");
const nativeFixture=read("poc/packages/orchestrator-runtime/test/r375-native-protected-main-functional-draft-pr-e2e.mjs");
const verifier=read("poc/scripts/verify-disposable-native-e2e-proof.mjs");

test("full Rust/Gitea/Docker E2E stays opt-in and never auto-dispatches a paid provider",()=>{
 assert.match(workflow,/^\s{2}workflow_dispatch:\s*$/mu);
 assert.match(workflow,/^\s{2}workflow_call:\s*$/mu);
 assert.doesNotMatch(workflow,/^\s{2}(push|pull_request|schedule):/mu);
 assert.match(workflow,/DELEGATION_SIGNED_GEMINI_PILOT:-0/u);
 assert.doesNotMatch(workflow,/secrets\.(?:GOOGLE|GEMINI|OPENAI)_API_KEY/u);
 assert.match(workflow,/R38513_NATIVE_STRICT_FULL_RECOVERY:\s*"1"/u);
});

test("all provider guards reject GOOGLE_API_KEY as well as GEMINI and OPENAI keys",()=>{
 for(const name of ["GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY"]){
  const phrase='test -z "\${'+name+':-}"';
  assert.ok(workflow.split(phrase).length>=5,
   "At least four independent paid-provider guards needed: "+name);
 }
 const envLoad=workflow.indexOf("source poc/infra/runtime/runner.env");
 assert.ok(envLoad>0);
 const postEnv=workflow.slice(envLoad);
 for(const name of ["GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY"])
  assert.ok(postEnv.includes('test -z "\${'+name+':-}"'),
   "Reject inherited/provider key after runtime env is loaded: "+name);
});

test("original native E2E produces proof BEFORE the verifier reads it",()=>{
 const native=workflow.indexOf("poc/packages/orchestrator-runtime/test/r375-native-protected-main-functional-draft-pr-e2e.mjs | tee");
 const result=workflow.indexOf("r38513_native_ten_signed_reads_ten_cas_docker_pass_draft_pr");
 const verifierCall=workflow.indexOf("node poc/scripts/verify-disposable-native-e2e-proof.mjs");
 assert.ok(native>=0&&result>native&&verifierCall>result,
  "Do not validate synthetic proof in place of a successful native run");
 assert.match(workflow,/set -euo pipefail/u);
 assert.match(workflow,/Docker PASS and Draft PR/iu);
 assert.match(workflow,/node --experimental-strip-types --test poc\/apps\/gateway\/test\/trusted-gateway-native-root-ipc\.test\.ts/u);
});

test("original E2E and verifier agree source provenance is always SCRIPTED",()=>{
 for(const event of [
  "canonical_deployment_native_preflight",
  "r38513_final_test_decision_preflight",
  "canonical_signed_handoff_native",
  "r38513_native_ten_signed_reads_ten_cas_docker_pass_draft_pr"
 ]){
  assert.ok(verifier.includes(event),event+" missing in verifier");
  assert.ok(nativeFixture.includes(event),event+" missing in native fixture");
 }
 assert.ok(verifier.includes("r399_native_draft_pr_exact_head_security_ci"));
 for(const sourceClaim of [
  "source_code_generated_autonomously_by_model:false",
  'observed_model_source:"scripted-offline"',
  "recovery_source_code_authored_by_scripted_fixture:true",
  "paid_model_calls:0"
 ])assert.ok(nativeFixture.includes(sourceClaim),
  "Original source may not be relabeled as Gemini-generated: "+sourceClaim);
 assert.ok(verifier.includes("permission_to_start_paid_gemini:false"));
});
