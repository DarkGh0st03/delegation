import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildSafeDelegationFailureLedger as report,
 safePublishedNativeTrace} from "../safe-delegation-failure-ledger.mjs";
const diagnostic={stage:"delegated_agents_gitea_docker",
 category:"unclassified_failure",delegated_phase:"d1_editor_preparation",
 delegated_failure:"none",source:"PRIVATE_SOURCE"};
const agent={schema:"signed-gemini-agent-failure-v1",role_evidence:{
 test:{failed_operations:{run_tests:{unclassified:1}},
  last_function_tool_error:{tool:"run_tests",error_kind:"tests_failed"},
  agent_failure:{category:"controlled_tool_failures",model_turns:2}},
 frontend:{d1_revision_failure:"no_confirmed_editor_write",
  d1_revision_evidence:{read_attempts:2,read_confirmed:2,
   update_attempts:0,head_changed:false}}
}};
test("Real D0+D1 failure has Test trigger and Frontend no-write blocker, not invented blame",()=>{
 const r=report({gemini_pilot_diagnostic:diagnostic,agent_failure_evidence:agent});
 const blocker=r.observed_events.find(x=>x.observed_code==="no_confirmed_editor_write");
 const testFailed=r.observed_events.find(x=>x.observed_code==="tests_failed");
 assert.equal(r.primary_blocker_event_id,blocker.event_id);
 assert.deepEqual([blocker.phase,blocker.affected_role,blocker.operation],
  ["recovery_d1","frontend","update_file"]);
 assert.deepEqual([testFailed.affected_role,testFailed.operation],["test","run_tests"]);
 assert.equal(blocker.operation_evidence.read_confirmed,2);
 assert.equal(blocker.operation_evidence.update_attempts,0);
 assert.equal(r.causal_attribution,"not_established");
 assert.ok(r.missing_evidence.includes("model_reason_for_no_edit_not_independently_verified"));
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SOURCE/);
});
test("Every Docker phase is localized without attributing code culpability",()=>{
 const phases=["dependency_install","typecheck","backend_tests",
  "frontend_tests","build","playwright_e2e","researcher_acceptance"];
 for(const failure of phases){
  const receipt={status:"fail",first_failed_phase:failure,
   phases:phases.map(p=>({phase:p,status:p===failure?"fail":
    phases.indexOf(p)<phases.indexOf(failure)?"pass":"skipped"}))};
  const r=report({docker_phase_evidence:receipt});
  assert.equal(r.observed_events[0].observed_code,failure);
  assert.equal(r.observed_events[0].reporting_component,"trusted_runner");
 }
});
test("Planner, approval, activation, provider and orchestrator have distinct reporters",()=>{
 for(const [stage,component] of [
  ["gemini_planning","trusted_planner"],
  ["signed_test_review","signed_approval"],
  ["activation_dc_vp","rust_gateway"],
  ["delegated_agents_gitea_docker","trusted_orchestrator"],
  ["complete","workflow"]]){
  const r=report({gemini_pilot_diagnostic:{stage,category:"test_assertion"}});
  assert.equal(r.observed_events[0].reporting_component,component);
 }
 const r=report({gemini_pilot_diagnostic:{
  stage:"delegated_agents_gitea_docker",category:"unclassified_failure",
  delegated_phase:"d1_gateway_admission",delegated_failure:"approved_plan_denied"}});
 assert.ok(r.observed_events.some(x=>x.phase==="recovery_d1"&&
  x.observed_code==="approved_plan_denied"));
});
test("Model, tool and D1 causes remain distinct observed codes",()=>{
 const r=report({agent_failure_evidence:{schema:"signed-gemini-agent-failure-v1",
  role_evidence:{backend:{
   agent_failure:{category:"api_inference_timeout",model_turns:5},
   failed_operations:{update_file:{signed_permission_rejected:1}},
   last_function_tool_error:{tool:"update_file",error_kind:"authorization_denied"},
   d1_revision_failure:"provider_head_mismatch",
   d1_revision_evidence:{head_changed:true}
  }}}});
 for(const c of ["api_inference_timeout","signed_permission_rejected",
   "authorization_denied","provider_head_mismatch"])
  assert.ok(r.observed_events.some(x=>x.observed_code===c));
});
test("Unknown strings, paths, source and model text never escape the public ledger",()=>{
 const secret="PRIVATE_BEARER_MODEL_OUTPUT";
 const r=report({gemini_pilot_diagnostic:{stage:secret,category:secret},
  agent_failure_evidence:{schema:"signed-gemini-agent-failure-v1",
   role_evidence:{backend:{d1_revision_failure:secret,
    agent_failure:{category:secret},failed_operations:{
     update_file:{[secret]:1}}}}},
  docker_phase_evidence:{status:"fail",first_failed_phase:"typecheck",
   phases:[{phase:secret,status:"fail"}]}});
 assert.equal(r.observed_events[0].observed_code,"unclassified");
 assert.equal(r.observed_events.length,1);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
 for(const unsafe of [
  [{category:"unclassified",kind:"Error",code:"unknown",site:{module:secret,line:9}}],
  [{category:"unclassified",kind:"Error",code:secret,site:null}]
 ])assert.deepEqual(safePublishedNativeTrace(unsafe),[]);
});
test("Code site is a known module/line, never arbitrary stack content",()=>{
 const trace=[{category:"no_confirmed_revision",kind:"Error",code:"unknown",
  site:{module:"adk-a2a-handler.ts",line:213}}];
 assert.deepEqual(safePublishedNativeTrace(trace),trace);
 assert.deepEqual(report({gemini_pilot_diagnostic:{
  stage:"delegated_agents_gitea_docker",category:"unclassified_failure",
  failure_trace:trace}}).observed_events.at(-1).source_sites,trace);
});
test("Paid workflow actually constructs the common ledger and runs without source leakage",()=>{
 const root=new URL("../../../",import.meta.url);
 const workflow=readFileSync(new URL(
  ".github/workflows/gemini-paid-shared-mcp-final.yml",root),"utf8");
 const child=readFileSync(new URL(
  "poc/apps/test-runner-controller/scripts/isolated-trusted-security-ci-positive-smoke.mjs",root),"utf8");
 assert.match(workflow,/buildSafeDelegationFailureLedger/);
 assert.match(workflow,/failure_ledger:failureLedger/);
 assert.match(child,/safePublishedNativeTrace/);
});
