import test from "node:test";
import assert from "node:assert/strict";
import {extractSignedFunctionalE2EEvidence}
  from "../functional-signed-dag-evidence.mjs";

const SHA="a".repeat(40),MAIN="b".repeat(40),
  COMMIT="c".repeat(40),PROBE="d".repeat(40);
const source={scenarioId:"account-suspension",sourceSha:SHA,runId:"4051234001"};
const native=()=>({
  status:"PASS",real_gitea_sha:MAIN,
  native_rust:true,live_opa:true,signed_handoff:true,
  operational_root:true,dispatcher_fail_closed:true,
  signed_dag_positive:true,host_supplied_adk_models:true,
  fixture_scripted_payloads_reach_adk_runner:true,
  same_signed_dag_docker_acceptance:true,
  source_witnessed_native_dag:true,
  source_witnessed_still_uses_fixture_code:true,
  source_derived_functional_route_verified:true,
  source_derived_controller_verified:true,
  source_derived_status_verified:true,
  source_derived_frontend_api_verified:true,
  source_derived_functional_file_count:4,
  remaining_prepackaged_application_file_count:7,
  independent_model_software_output_verified:false,
  backend_frontend_a2a_updates:10,test_agent_created_e2e:1,
  signed_generic_adk_agents:3,a2a_before_branch:0,main_mutations:0
});
const probe=()=>({
  status:"PASS",source_derived_tool_output:true,
  gitea_provider_committed:true,main_unchanged:true,
  external_model_calls:0,signed_gateway_credential_e2e:false,
  review_fixture_not_human_signed:true,
  model_operations_preflight_checked:true,
  approved_plan_preflight_denials:4,
  controlled_calls:2,files_modified:1,
  source_sha:MAIN,feature_sha:PROBE
});
const acceptance=()=>({
  event:"trusted_security_ci_real_docker_positive_acceptance",
  status:"PASS",scenario_id:"account-suspension",
  pr_source:"native_signed_dag",tested_commit_sha:COMMIT,
  baseline_sha:MAIN,project_tests:"pass",researcher_acceptance:"pass",
  merge_calls:0,pr_created:true,
  real_backend_frontend_gitea_edits:2,
  native_approved_source_reads:4,persistent_gitea_modified:false,
  gitea_statuses:["pending","success"],real_docker_runner:true,
  engineer_approval_ed25519:true,gateway_signed_test_task_completed:true,
  real_a2a_sdk_task_completed:true,real_opa_signed_plan_policy:true,
  native_rust_signed_child_and_vp:true,runner_via_gateway_http:true,
  exact_provider_sha_correlated:true,approval_created:true
});
function fixture(){return {native:native(),probe:probe(),acceptance:acceptance()};}
function log(v){
  return "ignored noisy runner output\n"+
    "[trusted-positive-ci] source_derived_probe "+JSON.stringify(v.probe)+"\n"+
    "[trusted-positive-ci] native_disposable_planning "+
    JSON.stringify(v.native)+"\n"+JSON.stringify(v.acceptance)+"\n";
}
test("Account Suspension offline E2E reports actual signed DAG without Gemini or false autonomy",()=>{
  const evidence=extractSignedFunctionalE2EEvidence(log(fixture()),source);
  assert.equal(evidence.scenario_id,"account-suspension");
  assert.equal(evidence.account_suspension_source_derived_backend_routes,true);
  assert.equal(evidence.source_derived_functional_file_count,4);
  assert.equal(evidence.remaining_prepackaged_application_file_count,7);
  assert.equal(evidence.source_derived_frontend_api_verified,true);
  assert.equal(evidence.source_derived_controller_verified,true);
  assert.equal(evidence.source_derived_status_verified,true);
  assert.equal(evidence.source_witnessed_native_dc_vp_e2e,true);
  assert.equal(evidence.independent_model_software_output_verified,false);
  assert.equal(evidence.standalone_gitea_probe_uses_native_dc_vp,false);
  assert.equal(evidence.created_pull_request_unmerged,true);
  assert.equal(evidence.framework_source_sha,SHA);
  assert.equal(evidence.isolated_main_sha,MAIN);
  assert.equal(evidence.tested_feature_commit_sha,COMMIT);
  assert.equal(evidence.live_gemini_tested,false);
  assert.equal(evidence.genuine_human_engineer_approval_tested,false);
  assert.equal(evidence.external_r5_go,false);
  assert.equal(JSON.stringify(evidence).includes("noisy"),false);
  assert.equal(JSON.stringify(evidence).includes("department-directory"),false);
});
test("Account Suspension checkpoint fails on missing or duplicated proof",()=>{
  const f=fixture();
  for(const corrupt of [
    JSON.stringify(f.acceptance),
    log(f)+JSON.stringify(f.acceptance),
    log(f)+"[trusted-positive-ci] native_disposable_planning "+
      JSON.stringify(f.native),
    log(f)+"[trusted-positive-ci] source_derived_probe "+
      JSON.stringify(f.probe)
  ])assert.throws(()=>extractSignedFunctionalE2EEvidence(corrupt,source),/NO-GO/);
});
test("Account Suspension checkpoint fail-closed on fabricated approvals, provider effects or fixture claims",()=>{
  const mutate=[
    x=>{x.native.native_rust=false;},
    x=>{x.native.operational_root=false;},
    x=>{x.native.dispatcher_fail_closed=false;},
    x=>{x.native.source_derived_functional_route_verified=false;},
    x=>{x.native.source_derived_controller_verified=false;},
    x=>{x.native.source_derived_status_verified=false;},
    x=>{x.native.source_derived_frontend_api_verified=false;},
    x=>{x.native.source_derived_functional_file_count=0;},
    x=>{x.native.remaining_prepackaged_application_file_count=11;},
    x=>{x.native.source_witnessed_native_dag=false;},
    x=>{x.native.independent_model_software_output_verified=true;},
    x=>{x.native.backend_frontend_a2a_updates=9;},
    x=>{x.native.main_mutations=1;},
    x=>{x.probe.source_sha=SHA;},
    x=>{x.probe.feature_sha=COMMIT;},
    x=>{x.probe.gitea_provider_committed=false;},
    x=>{x.probe.external_model_calls=1;},
    x=>{x.probe.signed_gateway_credential_e2e=true;},
    x=>{x.probe.approved_plan_preflight_denials=3;},
    x=>{x.acceptance.scenario_id="department-directory";},
    x=>{x.acceptance.merge_calls=1;},
    x=>{x.acceptance.project_tests="fail";},
    x=>{x.acceptance.native_rust_signed_child_and_vp=false;},
    x=>{x.acceptance.pr_created=false;},
    x=>{x.acceptance.tested_commit_sha=MAIN;}
  ];
  for(const m of mutate){
    const f=fixture();m(f);
    assert.throws(()=>extractSignedFunctionalE2EEvidence(log(f),source),/NO-GO/);
  }
});
test("Account Suspension alone is accepted; wrong scenarios, SHAs and run IDs are rejected",()=>{
  const s=log(fixture());
  for(const options of [
    {...source,scenarioId:"department-directory"},
    {...source,sourceSha:"bad"},
    {...source,runId:"0"}
  ])assert.throws(()=>extractSignedFunctionalE2EEvidence(s,options),/NO-GO/);
});
