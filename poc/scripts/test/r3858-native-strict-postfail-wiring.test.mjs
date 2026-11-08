/** Static CI guard for the disposable native probe; full native proof is
 * accepted ONLY from its own successful no-AI GitHub Actions run. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
test("R385.8 native workflow must use real Rust MCP, postfail root and zero inference",()=>{
 const w=read(".github/workflows/r3858-native-strict-postfail-diagnostic-probe.yml");
 assert.match(w,/R3858_NATIVE_STRICT_POSTFAIL_PROBE: "1"/u);
 assert.match(w,/R3818_CANONICAL_NATIVE_MCP: "1"/u);
 assert.match(w,/ENGINEER_CORE_NATIVE_MODE: "1"/u);
 assert.match(w,/APPROVED_RUNNER_NATIVE_MCP: "1"/u);
 assert.match(w,/GATEWAY_VERIFIER_MODE: core-rust/u);
 assert.match(w,/R233_NATIVE_EVM: "1"/u);
 // R385.8 initially failed BEFORE the owner run because the inherited
 // old workflow lacked this private step-local architecture mode.
 const step=w.split("- name: Native owner signed post-FAIL diagnostic read and first guarded CAS (stop before PR)")[1]?.split("- name: Validate native Gateway root read")[0];
 assert.ok(step,"original native owner step must exist");
 assert.match(step,/env:\n\s+DELEGATION_GATEWAY_ARCHITECTURE: authority-only/u);
 assert.match(step,/test "\$\{DELEGATION_GATEWAY_ARCHITECTURE:-\}" = "authority-only"/u);
 assert.match(step,/grep -Fq .*r3858_strict_native_postfail_read_and_first_repair_no_false_pass/u);
 assert.equal(w.split("DELEGATION_GATEWAY_ARCHITECTURE: authority-only").length,2,
  "authority-only must be on the owner step, not globally on legacy Adapter");
 assert.match(w,/test -z "\$\{GEMINI_API_KEY:-\}"/u);
 assert.doesNotMatch(w,/R376_NATIVE_DIAGNOSIS: "1"|R377_NATIVE_SPECIALIST_STOP_ROLE/u);
 assert.match(w,/r3858-native-strict-postfail-probe-request\.json/u);
 assert.match(w,/r375-native-protected-main-functional-draft-pr-e2e\.mjs/u);
});
test("R385.8 first real native post-failure READ precedes strict owner repair; no false PASS/PR",()=>{
 const s=read("poc/packages/orchestrator-runtime/test/r375-native-protected-main-functional-draft-pr-e2e.mjs");
 assert.match(s,/const strictReadProbe=process\.env\.R3858_NATIVE_STRICT_POSTFAIL_PROBE==="1"/u);
 assert.match(s,/strictReadProbe\?\{requireVerifiedRepairDiagnostic:true\}:\{\}/u);
 assert.match(s,/postFailReadTaskId=testAgentProbe\?"r38512-postfail-test-read":"r3858-postfail-backend-read"/u);
 assert.match(s,/permissions:\[pair\(testAgentProbe\?testRepairPath:sharedPath,"read_file"\)\]/u);
 assert.match(s,/assert\.match\(context,\/independent_runner_failure\/u\)/u);
 assert.match(s,/assert\.match\(context,\/source_observations\/u\)/u);
 assert.match(s,/assert\.equal\(runnerCalls,1,"first real Docker FAIL only; no unverified PASS"\)/u);
 assert.match(s,/assert\.equal\(draftPrCreateAttempts,0\)/u);
 assert.match(s,/further_tests_proven_pass:false/u);
 assert.match(s,/source_code_generated_autonomously_by_model:false/u);
 assert.match(s,/original_root_retired:true/u);
 assert.match(s,/strictReadProbe\?\{\}:\{draftPullRequest:/u);
});

test("R385.12 Test Agent post-failure mode is exclusive and cannot impersonate a PASS",()=>{
 const s=read("poc/packages/orchestrator-runtime/test/r375-native-protected-main-functional-draft-pr-e2e.mjs");
 const w=read(".github/workflows/r38512-native-test-agent-postfail-probe.yml");
 assert.match(s,/R38512_NATIVE_TEST_AGENT_SOURCE_PROBE==="1"/u);
 assert.match(s,/strictReadProbe&&!secondReadProbe&&!diagnosticMode/u);
 assert.match(s,/testAgentProbe\?"test":"backend"/u);
 assert.match(s,/test_agent_signed_project_test_cas:true/u);
 assert.match(w,/R38512_NATIVE_TEST_AGENT_SOURCE_PROBE: "1"/u);
 assert.match(w,/R3858_NATIVE_STRICT_POSTFAIL_PROBE: "1"/u);
 assert.doesNotMatch(w,/R3859_NATIVE_SECOND_REPAIR_PROBE: "1"/u);
 assert.match(w,/r38512_native_test_agent_signed_postfail_read_cas_no_false_pass/u);
 assert.match(w,/further_tests_proven_pass/u);
 assert.match(w,/original_root_retired/u);
 assert.match(w,/paid_model_calls/u);
});
