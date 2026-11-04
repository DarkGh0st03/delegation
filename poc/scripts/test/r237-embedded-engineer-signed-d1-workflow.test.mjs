import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R237 embedded Engineer D1 runs single Rust owner, signed repair and no paid model",()=>{
 const workflow=read(".github/workflows/engineer-embedded-signed-d1-e2e.yml");
 for(const flag of [
  "ENGINEER_CORE_NATIVE_MODE",
  "APPROVED_RUNNER_NATIVE_EVM",
  "APPROVED_RUNNER_NATIVE_MCP",
  "APPROVED_RUNNER_NATIVE_OWNER_REPAIR_D1",
  "APPROVED_RUNNER_NATIVE_OWNER_ADK_REPAIR_PROPOSAL",
  "APPROVED_RUNNER_SIGNED_DAG_BACKEND_TEST_PROBE",
  "APPROVED_RUNNER_SOURCE_DERIVED_ROUTES",
  "APPROVED_RUNNER_THREE_AGENT_DAG",
  "APPROVED_RUNNER_HOST_SELECTED_ADK_MODELS"
 ]){
  assert.ok(workflow.includes(flag+': "1"'),flag);
 }
 assert.match(workflow,/GATEWAY_VERIFIER_MODE: core-rust/u);
 assert.match(workflow,/'.github\/ci-checkpoints\/engineer-d1-request\.json'/u);
 assert.match(workflow,/\bsecurity-ci:isolated-positive-smoke\b/u);
 assert.match(workflow,/\bengineer-direct-native\/Cargo\.toml\b|services\/delegation-engineer-node\/Cargo\.toml/u);
 assert.match(workflow,/libdelegation_core_node\.so/u);
 assert.match(workflow,/GITEA_IMAGE: docker\.gitea\.com\/gitea:28\.0\.0/u);
 assert.match(workflow,/repaired_docker_pass_verified/u);
 assert.match(workflow,/independently_admitted_repair_epoch/u);
 assert.match(workflow,/original_root_retired/u);
 assert.match(workflow,/draft_pr_review_only/u);
 assert.match(workflow,/automated_merge_calls/u);
 assert.match(workflow,/found\.gemini_calls,0/u);
 assert.match(workflow,/test -z "\$\{GEMINI_API_KEY:-\}"/u);
 assert.match(workflow,/test -z "\$\{OPENAI_API_KEY:-\}"/u);
 assert.doesNotMatch(workflow,/\bcargo run[^\n]*services\/delegation-adapter\/Cargo\.toml/u);
 assert.doesNotMatch(workflow,/secrets\.(?:GEMINI|OPENAI)_API_KEY/u);
 assert.doesNotMatch(workflow,/workflow_dispatch:\s*\{/u);
});

test("R237 recovery is withheld from long CI until explicit same-SHA gate",()=>{
 assert.equal(existsSync(new URL(
  ".github/ci-checkpoints/engineer-d1-request.json",root)),false);
 const old=read(".github/workflows/functional-signed-dag-e2e.yml");
 assert.match(old,/cargo run --manifest-path services\/delegation-adapter\/Cargo\.toml/u);
 const harness=read("poc/apps/test-runner-controller/scripts/isolated-trusted-security-ci-positive-smoke.mjs");
 assert.match(harness,/if\(ownerPasses\.preliminaryReadOnlyProcess\)/u);
 assert.match(harness,/signed_owner_d1_real_backend_test_repair_review/u);
 assert.match(harness,/independently_admitted_repair_epoch:true/u);
 const selector=read("poc/apps/test-runner-controller/scripts/direct-engineer-owner-pass-selector.mjs");
 assert.match(selector,/preliminaryReadOnlyProcess:!direct/u);
 assert.match(selector,/Direct Engineer migration proof forbids paid model pilot/u);
});
