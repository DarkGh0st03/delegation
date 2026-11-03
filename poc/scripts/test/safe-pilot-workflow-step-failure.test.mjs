import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {safePaidWorkflowStepFailure as classify}
 from "../safe-pilot-workflow-step-failure.mjs";

test("failure is assigned to each trusted workflow component without speculation",()=>{
 const cases=[
  ["dependencies","dependency_install","workflow_runner"],
  ["billing_consent","manual_billing_consent","billing_gate"],
  ["offline_ci_gate","same_sha_ci_validation","billing_gate"],
  ["anvil_opa","isolated_anvil_opa","infrastructure"],
  ["adapter_start","adapter_start","evm_adapter"],
  ["gateway_start","rust_gateway_start","rust_gateway"],
  ["provider_preflight","gemini_key_model_probe","gemini_provider"],
  ["signed_pilot","gemini_signed_dag_execution","trusted_orchestrator"],
  ["seal_private","private_runner_evidence_seal","private_evidence"]
 ];
 for(const [id,phase,component] of cases){
  const x=classify({[id]:"failure",checkout:"success"});
  assert.deepEqual([x.failed_step_id,x.observed_phase,x.reporting_component],
   [id,phase,component]);
  assert.equal(x.root_cause,"not_established_by_public_step_status");
  assert.equal(x.causal_attribution,"not_established");
 }
});
test("first known failed step wins; skipped and absent are not success",()=>{
 const x=classify({checkout:"success",dependencies:"failure",
  gateway_start:"failure",signed_pilot:"skipped"});
 assert.equal(x.failed_step_id,"dependencies");
 assert.equal(x.skipped_step_count,1);
 assert.ok(x.unreported_step_count>0);
 assert.equal(classify({checkout:"success"}).observed_failure,"no_failure_observed");
});
test("private values cannot be represented as public step status",()=>{
 const secret="PRIVATE_MODEL_PAYLOAD_SECRET";
 for(const bad of [null,[],{signed_pilot:secret}])
  assert.throws(()=>classify(bad),/required|Invalid/);
 const x=classify({adapter_start:"failure",private_message:secret});
 assert.ok(!JSON.stringify(x).includes(secret));
});
test("manual paid D0 uploads sanitized fallback with explicit step IDs",()=>{
 const w=readFileSync(new URL("../../../.github/workflows/gemini-paid-shared-mcp-final.yml",
  import.meta.url),"utf8");
 const d0=w.split("\n  f1-real-gitea-planning:")[0];
 assert.match(d0,/safe-pilot-workflow-step-failure\.mjs/);
 assert.match(d0,/four-gemini-pilot-step-failure\.json/);
 for(const id of ["billing_consent","offline_ci_gate","adapter_start",
  "gateway_start","signed_pilot","seal_private"]){
  assert.match(d0,new RegExp("id: "+id+"\\n"));
  assert.ok(d0.includes("steps."+id+".outcome"));
 }
});
