import test from "node:test";
import assert from "node:assert/strict";
import {extractSignedFunctionalE2EEvidence}
  from "../functional-signed-dag-evidence.mjs";
const sha="a".repeat(40),gitea="b".repeat(40),head="c".repeat(40);
const pin={scenarioId:"department-directory",sourceSha:sha,runId:"40470012345"};
function fixture(){
  const native={
    status:"PASS",real_gitea_sha:gitea,native_rust:true,live_opa:true,
    signed_handoff:true,operational_root:true,dispatcher_fail_closed:true,
    signed_dag_positive:true,backend_frontend_a2a_updates:10,
    test_agent_created_e2e:1,signed_generic_adk_agents:3,
    same_signed_dag_docker_acceptance:true,a2a_before_branch:0,
    main_mutations:0
  };
  const positive={
    event:"trusted_security_ci_real_docker_positive_acceptance",
    status:"PASS",scenario_id:"department-directory",
    baseline_sha:gitea,tested_commit_sha:head,
    project_tests:"pass",researcher_acceptance:"pass",
    pr_source:"native_signed_dag",merge_calls:0,pr_created:true,
    real_backend_frontend_gitea_edits:2,
    native_approved_source_reads:4,persistent_gitea_modified:false,
    gitea_statuses:["pending","success"],
    real_docker_runner:true,engineer_approval_ed25519:true,
    gateway_signed_test_task_completed:true,
    real_a2a_sdk_task_completed:true,real_opa_signed_plan_policy:true,
    native_rust_signed_child_and_vp:true,runner_via_gateway_http:true,
    exact_provider_sha_correlated:true,approval_created:true
  };
  return {native,positive};
}
function log({native,positive}){
  return "npm prefix noisy log\n"+
    "[trusted-positive-ci] native_disposable_planning "+
    JSON.stringify(native)+"\n"+JSON.stringify(positive)+"\n";
}
test("functional E2E extracts only fixed observed fields without R5 or human claims",()=>{
  const evidence=extractSignedFunctionalE2EEvidence(log(fixture()),pin);
  assert.equal(evidence.status,"functional_scripted_real_gitea_docker_pass");
  assert.equal(evidence.framework_source_sha,sha);
  assert.equal(evidence.isolated_main_sha,gitea);
  assert.equal(evidence.tested_feature_commit_sha,head);
  assert.equal(evidence.live_gemini_tested,false);
  assert.equal(evidence.genuine_human_engineer_approval_tested,false);
  assert.equal(evidence.external_r5_go,false);
  assert.equal(JSON.stringify(evidence).includes("noisy log"),false);
});
test("functional checkpoint rejects missing or duplicate observed stages",()=>{
  const f=fixture();
  assert.throws(()=>extractSignedFunctionalE2EEvidence(
    JSON.stringify(f.positive),pin),/NO-GO/);
  assert.throws(()=>extractSignedFunctionalE2EEvidence(
    log(f)+"\n"+JSON.stringify(f.positive),pin),/NO-GO/);
  assert.throws(()=>extractSignedFunctionalE2EEvidence(
    log(f)+"\n[trusted-positive-ci] native_disposable_planning "+
    JSON.stringify(f.native),pin),/NO-GO/);
});
test("functional checkpoint rejects fake provider effects, missing signed DAG and merged PR",()=>{
  for(const mutate of [
    x=>{x.native.signed_dag_positive=false;},
    x=>{x.native.operational_root=false;},
    x=>{x.native.a2a_before_branch=1;},
    x=>{x.native.main_mutations=1;},
    x=>{x.native.backend_frontend_a2a_updates=9;},
    x=>{x.positive.native_rust_signed_child_and_vp=false;},
    x=>{x.positive.pr_created=false;},
    x=>{x.positive.merge_calls=1;},
    x=>{x.positive.project_tests="fail";},
    x=>{x.positive.scenario_id="account-suspension";},
    x=>{x.positive.tested_commit_sha=gitea;}
  ]){
    const f=fixture();mutate(f);
    assert.throws(()=>extractSignedFunctionalE2EEvidence(log(f),pin),/NO-GO/);
  }
});
test("functional checkpoint requires out-of-band GitHub exact SHA and run",()=>{
  const f=log(fixture());
  assert.throws(()=>extractSignedFunctionalE2EEvidence(f,{
    ...pin,sourceSha:"not-a-git-sha"}),/NO-GO/);
  assert.throws(()=>extractSignedFunctionalE2EEvidence(f,{
    ...pin,runId:"0"}),/NO-GO/);
  assert.throws(()=>extractSignedFunctionalE2EEvidence(f,{
    ...pin,scenarioId:"account-suspension"}),/NO-GO/);
});
