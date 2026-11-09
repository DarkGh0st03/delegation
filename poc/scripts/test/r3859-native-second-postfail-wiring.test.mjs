import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../../../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
test("R385.9 no paid model; genuine authority-only second signed read proof",()=>{
 const w=read(".github/workflows/r3859-native-second-postfail-diagnostic-probe.yml");
 for(const key of ['R3858_NATIVE_STRICT_POSTFAIL_PROBE: "1"',
  'R3859_NATIVE_SECOND_REPAIR_PROBE: "1"','R3818_CANONICAL_NATIVE_MCP: "1"',
  'DELEGATION_GATEWAY_ARCHITECTURE: authority-only',
  'r3859_native_sequential_postfail_two_read_two_cas_no_false_pass',
  'signed_read_only_diagnostic_tasks":2','gateway_cas_writes":4',
  'further_tests_proven_pass":false','pr_created":false',
  'test -z "${GEMINI_API_KEY:-}"'])assert.ok(w.includes(key),key);
 assert.match(w,/workflow_dispatch:/u);
 assert.doesNotMatch(w,/r3859-native-second-postfail-probe-request\.json|^\s+push:/mu);
});
test("R385.9 sequential new source read precedes second CAS and avoids a false PASS",()=>{
 const s=read("poc/packages/orchestrator-runtime/test/r375-native-protected-main-functional-draft-pr-e2e.mjs");
 for(const key of ['secondReadProbe=process.env.R3859_NATIVE_SECOND_REPAIR_PROBE',
 'secondPostFailReadTaskId="r3859-postfail-backend-second-read"',
 'depends_on:[sourceTasks[0].task_id]',
 'secondReadProbe&&j===1?secondPostFailReadTaskId',
 'secondReadProbe?4:3','secondReadProbe?5:3','secondReadProbe?7:5',
 'signed_read_only_diagnostic_tasks:secondReadProbe?2:1',
 'source_code_generated_autonomously_by_model:false',
 'further_tests_proven_pass:false'])assert.ok(s.includes(key),key);
});
