/** Static CI guard for the disposable native probe; full native proof is
 * accepted ONLY from its own successful no-AI GitHub Actions run. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
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
 assert.match(w,/test -z "\$\{GEMINI_API_KEY:-\}"/u);
 assert.doesNotMatch(w,/R376_NATIVE_DIAGNOSIS: "1"|R377_NATIVE_SPECIALIST_STOP_ROLE/u);
 assert.match(w,/r3858-native-strict-postfail-probe-request\.json/u);
 assert.match(w,/r375-native-protected-main-functional-draft-pr-e2e\.mjs/u);
});
test("R385.8 first real native post-failure READ precedes strict owner repair; no false PASS/PR",()=>{
 const s=read("poc/packages/orchestrator-runtime/test/r375-native-protected-main-functional-draft-pr-e2e.mjs");
 assert.match(s,/const strictReadProbe=process\.env\.R3858_NATIVE_STRICT_POSTFAIL_PROBE==="1"/u);
 assert.match(s,/strictReadProbe\?\{requireVerifiedRepairDiagnostic:true\}:\{\}/u);
 assert.match(s,/postFailReadTaskId="r3858-postfail-backend-read"/u);
 assert.match(s,/permissions:\[pair\(sharedPath,"read_file"\)\]/u);
 assert.match(s,/assert\.match\(context,\/independent_runner_failure\/u\)/u);
 assert.match(s,/assert\.match\(context,\/source_observations\/u\)/u);
 assert.match(s,/assert\.equal\(runnerCalls,1,"first real Docker FAIL only; no unverified PASS"\)/u);
 assert.match(s,/assert\.equal\(draftPrCreateAttempts,0\)/u);
 assert.match(s,/further_tests_proven_pass:false/u);
 assert.match(s,/source_code_generated_autonomously_by_model:false/u);
 assert.match(s,/original_root_retired:true/u);
 assert.match(s,/strictReadProbe\?\{\}:\{draftPullRequest:/u);
});
