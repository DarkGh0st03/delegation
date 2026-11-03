/**
 * R155: exercise the ACTUAL isolated Runner parser, paid-CI double filter,
 * ADK fixed-event filters, and final ledger. No model/network/Docker required.
 * Faults and leaked values are synthetic; this does not prove full E2E recovery.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {safeNativeDockerFailureDiagnostic}
 from "../../apps/test-runner-controller/scripts/native-dag-result-diagnostic.mjs";
import {extractSafeGeminiPilotDockerEvidence}
 from "../../apps/test-runner-controller/scripts/gemini-pilot-safe-docker-evidence.mjs";
import {safeGeminiPilotAgentObservations,extractSafeGeminiPilotAgentSummary}
 from "../signed-gemini-pilot-usage.mjs";
import {classifyApprovedDagFailure,safeApprovedDagFailureTrace}
 from "../../apps/gateway/native-test/native-approved-dag-failure-category.mjs";
import {buildSafeDelegationFailureLedger as ledger}
 from "../safe-delegation-failure-ledger.mjs";
const PHASES=["dependency_install","typecheck","backend_tests",
 "frontend_tests","build","playwright_e2e","researcher_acceptance"];
const NATIVE="[native-dag-adk] docker_phase_status ";
const TRUSTED="[trusted-positive-ci] native_dag_failure ";
const AGENT="[trusted-positive-ci] gemini_agent_observation ";
const SECRET="PRIVATE_SOURCE_TOKEN_PROMPT_CREDENTIAL_SHOULD_NOT_ESCAPE";
const summaries={
 typecheck:{typecheck_error_codes:["TS2304","TS2322"]},
 backend_tests:{project_test_failure:{
  phase:"backend_tests",failed_test_file_count:2}},
 frontend_tests:{project_test_failure:{
  phase:"frontend_tests",failed_test_file_count:1}},
 playwright_e2e:{project_e2e_failure:{
  locations:[{check_id:"account_suspension",line:35,column:7}],
  failure_kinds:["visibility"],timed_out:false,unclassified_failure:false}},
 researcher_acceptance:{acceptance_failure:{
  failed_checks:["ui_pending_actions"],timed_out:false,
  unclassified_failure:false}}
};
function dockerFailure(phase){
 const first=PHASES.indexOf(phase);
 return {
  status:"fail",
  phases:PHASES.map((p,i)=>({phase:p,status:i<first?"pass":
   i===first?"fail":"skipped",private_source:SECRET})),
  project_tests:phase==="researcher_acceptance"?"pass":"fail",
  researcher_acceptance:phase==="researcher_acceptance"?"fail":"skipped",
  ...(summaries[phase]??{}),
  raw_assertion:SECRET
 };
}
function throughDockerBoundary(payload){
 const native=safeNativeDockerFailureDiagnostic(NATIVE+JSON.stringify(payload));
 if(!native)return null;
 const log=SECRET+"\n"+TRUSTED+JSON.stringify({
  stage:"signed_dag_disposable_docker_acceptance",...native,
  private_gemini_response:SECRET
 })+"\n";
 return extractSafeGeminiPilotDockerEvidence(log);
}
test("R155 all seven Runner failures reach the final ledger via both real sanitizers",()=>{
 for(const phase of PHASES){
  const verified=throughDockerBoundary(dockerFailure(phase));
  assert.equal(verified?.first_failed_phase,phase);
  const x=ledger({docker_phase_evidence:verified});
  const event=x.observed_events.find(y=>y.phase==="docker_runner");
  assert.equal(event?.observed_code,phase);
  assert.equal(event.reporting_component,"trusted_runner");
  assert.equal(event.operation,"run_tests");
  assert.equal(x.primary_blocker_event_id,event.event_id);
  assert.equal(x.causal_attribution,"not_established");
  assert.doesNotMatch(JSON.stringify(x),/PRIVATE_SOURCE_TOKEN|raw_assertion|private_source/u);
 }
});
test("R155 precise bounded TypeScript, project tests, E2E and acceptance evidence survives",()=>{
 for(const [phase,key] of [
  ["typecheck","typecheck_error_codes"],
  ["backend_tests","project_test_failure"],
  ["frontend_tests","project_test_failure"],
  ["playwright_e2e","project_e2e_failure"],
  ["researcher_acceptance","acceptance_failure"]
 ]){
  const x=ledger({docker_phase_evidence:
    throughDockerBoundary(dockerFailure(phase))});
  const event=x.observed_events.find(y=>y.phase==="docker_runner");
  assert.deepEqual(event?.[key],summaries[phase][key]);
  assert.equal(x.evidence_completeness,"classified_public_observation");
  assert.doesNotMatch(JSON.stringify(x),/PRIVATE_SOURCE_TOKEN/u);
 }
});
test("R155 an absent or invalid detailed receipt is explicitly not a complete diagnosis",()=>{
 for(const phase of ["typecheck","backend_tests","frontend_tests",
   "playwright_e2e","researcher_acceptance"]){
  const payload=dockerFailure(phase);
  for(const key of Object.keys(summaries[phase]))delete payload[key];
  const x=ledger({docker_phase_evidence:throughDockerBoundary(payload)});
  assert.equal(x.evidence_completeness,"partial_public_evidence");
  assert.ok(x.missing_evidence.some(m=>m.startsWith("runner_")));
 }
 const bad=dockerFailure("backend_tests");
 bad.project_test_failure={phase:"backend_tests",failed_test_file_count:2,
  private_path:SECRET};
 assert.equal(throughDockerBoundary(bad),null);
 assert.equal(ledger({docker_phase_evidence:null}).observed_events[0].observed_code,
  "unclassified");
});
test("R155 A2A dispatch cause-chain is classified and propagated without stack or text",()=>{
 const child=Error(SECRET);
 child.code="ECONNREFUSED";
 child.stack="Error: "+SECRET+"\n  at remote (file:///repo/poc/packages/orchestrator-runtime/src/a2a-workflow.ts:77:5)";
 const outer=new Error("Trusted dispatch failed; "+SECRET,{cause:child});
 outer.stack="Error: "+SECRET+"\n  at dispatch (file:///repo/poc/packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts:91:5)";
 assert.equal(classifyApprovedDagFailure(outer),"a2a_dispatch_failed");
 const trace=safeApprovedDagFailureTrace(outer);
 const report=ledger({gemini_pilot_diagnostic:{
  stage:"delegated_agents_gitea_docker",category:"unclassified_failure",
  delegated_phase:"a2a_dispatch",delegated_failure:"a2a_dispatch_failed",
  failure_trace:trace,model_response:SECRET
 }});
 const event=report.observed_events.find(e=>e.evidence_source===
   "allowlisted_source_trace");
 assert.equal(event.source_sites.length,2);
 assert.deepEqual(event.source_sites[0].site,{
  module:"trusted-approved-a2a-dispatcher.ts",line:91});
 assert.equal(event.source_sites[1].code,"ECONNREFUSED");
 assert.ok(report.observed_events.some(e=>e.observed_code==="a2a_dispatch_failed"));
 assert.doesNotMatch(JSON.stringify(report),/PRIVATE_SOURCE_TOKEN|file:\/\/\/|\/repo\/poc/u);
});
test("R155 signed D1 read-only stop survives ADK filter, public summary and ledger",()=>{
 const frontend="a".repeat(16),testing="b".repeat(16);
 const raw=[
  {event:"adk_llm_timing",role:"frontend",task_ref:frontend,turn:1,
   function_call_parts:1,text_parts:0,finish_reason:"STOP",private_prompt:SECRET},
  {event:"adk_tool_timing",role:"frontend",task_ref:frontend,tool:"read_file",
   success:true,error_kind:null,source:SECRET},
  {event:"d1_editor_revision",role:"frontend",task_ref:frontend,
   category:"no_confirmed_editor_write",read_attempts:1,read_confirmed:1,
   update_attempts:0,head_changed:false,private_failure:SECRET},
  {event:"adk_tool_timing",role:"test",task_ref:testing,tool:"run_tests",
   success:false,error_kind:"tests_failed",reason:"unclassified",
   failed_assertion:SECRET}
 ];
 const sanitized=safeGeminiPilotAgentObservations(
  raw.map(x=>JSON.stringify(x)).join("\n"));
 assert.equal(sanitized.length,raw.length);
 const doubleFiltered=extractSafeGeminiPilotAgentSummary(
  sanitized.map(x=>AGENT+JSON.stringify(x)).join("\n"));
 const x=ledger({agent_failure_evidence:doubleFiltered});
 const d1=x.observed_events.find(e=>e.phase==="recovery_d1");
 assert.deepEqual([d1.affected_role,d1.task_ref,d1.observed_code],
  ["frontend",frontend,"no_confirmed_editor_write"]);
 assert.equal(x.signed_task_observations.find(t=>t.task_ref===frontend)
  .tool_operations.update_file.attempted,0);
 assert.ok(x.observed_events.some(e=>e.affected_role==="test"&&
  e.operation==="run_tests"));
 assert.ok(x.missing_evidence.includes(
  "model_reason_for_no_edit_not_independently_verified"));
 assert.doesNotMatch(JSON.stringify(x),/PRIVATE_SOURCE_TOKEN|private_prompt/u);
});
