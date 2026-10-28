/**
 * Account Suspension only: evidence parser for the functional signed-DAG
 * offline E2E. Real Gitea, Rust/VP, OPA, A2A and Docker are checked
 * independently. No raw model output, source bytes or tokens are published.
 *
 * Do NOT claim autonomous software generation, an authenticated real Engineer
 * review, or that the standalone Gitea probe used native DC/VP.
 */
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const SCENARIO="account-suspension";
const EVENT="trusted_security_ci_real_docker_positive_acceptance";
const NATIVE="[trusted-positive-ci] native_disposable_planning ";
const PROBE="[trusted-positive-ci] source_derived_probe ";
function deny(reason){throw Error("Account Suspension functional E2E NO-GO: "+reason);}
function object(x){return x!==null&&typeof x==="object"&&!Array.isArray(x);}
function only(arr,label){
  if(arr.length!==1)deny("exactly one "+label+" required");
  return arr[0];
}
function checked(data,fields,label){
  for(const field of fields)
    if(data[field]!==true)deny(label+" missing "+field);
}
export function extractSignedFunctionalE2EEvidence(log,{
  scenarioId=SCENARIO,sourceSha,runId
}={}){
  if(typeof log!=="string"||!log||
     log.length>10*1024*1024||scenarioId!==SCENARIO||
     !SHA.test(sourceSha??"")||!RUN.test(String(runId??"")))
    deny("account-suspension and GitHub source/run attestation required");
  const natives=[],probes=[],acceptances=[];
  for(const line of log.split(/\r?\n/u)){
    let target=null,payload=null;
    if(line.startsWith(NATIVE)){
      target=natives;payload=line.slice(NATIVE.length);
    }else if(line.startsWith(PROBE)){
      target=probes;payload=line.slice(PROBE.length);
    }else if(line.startsWith('{"event":"'+EVENT+'"')){
      target=acceptances;payload=line;
    }
    if(!target)continue;
    try{target.push(JSON.parse(payload));}
    catch{deny("malformed native/probe/acceptance observation");}
  }
  const native=only(natives,"native signed-DAG report");
  const probe=only(probes,"source-derived provider probe");
  const acceptance=only(acceptances,"real Docker/Gitea acceptance");
  if(!object(native)||native.status!=="PASS"||
     !SHA.test(native.real_gitea_sha??""))
    deny("native signed-DAG identity absent");
  checked(native,[
    "native_rust","live_opa","signed_handoff","operational_root",
    "dispatcher_fail_closed","signed_dag_positive",
    "host_supplied_adk_models","fixture_scripted_payloads_reach_adk_runner",
    "same_signed_dag_docker_acceptance",
    "source_witnessed_native_dag",
    "source_witnessed_still_uses_fixture_code",
    "source_derived_functional_route_verified",
    "source_derived_controller_verified",
    "source_derived_status_verified",
    "source_derived_frontend_api_verified"
  ],"native signed-DAG");
  if(!Array.isArray(native.signed_dag_completed_task_ids)||
     JSON.stringify(native.signed_dag_completed_task_ids)!==
       JSON.stringify(["branch","backend","frontend",
         "test-preparation","test","pr"])||
     native.a2a_tasks_dispatched!==4||
     native.native_rust_child_credentials!==4||
     native.test_runner_runs!==2||
     native.multi_test_a2a_independent_authority_verified!==true||
     native.test_cross_role_repair_denied!==true||
     native.recovery_verified!==true||
     native.signed_dag_pr_unmerged!==true||
     !SHA.test(native.failed_test_sha??"")||
     !SHA.test(native.signed_dag_pr_commit_sha??"")||
     native.failed_test_sha===native.signed_dag_pr_commit_sha||
     native.signed_dag_pr_commit_sha===native.real_gitea_sha)
    deny("multi-Test signed A2A Task, failed/repaired SHA, or PR proof absent");
  if(native.source_derived_functional_file_count!==4||
     native.remaining_prepackaged_application_file_count!==7||
     native.independent_model_software_output_verified!==false||
     native.backend_frontend_a2a_updates!==10||
     native.test_agent_created_e2e!==1||
     native.signed_generic_adk_agents!==3||
     native.a2a_before_branch!==0||native.main_mutations!==0)
    deny("signed execution, provenance, or fixture count inconsistent");
  if(!object(probe)||probe.status!=="PASS"||
     probe.source_derived_tool_output!==true||
     probe.gitea_provider_committed!==true||
     probe.main_unchanged!==true||
     probe.external_model_calls!==0||
     probe.signed_gateway_credential_e2e!==false||
     probe.review_fixture_not_human_signed!==true||
     probe.model_operations_preflight_checked!==true||
     probe.approved_plan_preflight_denials!==4||
     probe.controlled_calls!==2||probe.files_modified!==1||
     !SHA.test(probe.source_sha??"")||
     !SHA.test(probe.feature_sha??"")||
     probe.source_sha!==native.real_gitea_sha||
     probe.source_sha===probe.feature_sha)
    deny("source-derived Gitea-only probe not verified");
  if(!object(acceptance)||acceptance.event!==EVENT||
     acceptance.status!=="PASS"||
     acceptance.scenario_id!==SCENARIO||
     acceptance.pr_source!=="native_signed_dag"||
     !SHA.test(acceptance.tested_commit_sha??"")||
     !SHA.test(acceptance.baseline_sha??"")||
     probe.feature_sha===acceptance.tested_commit_sha||
     native.real_gitea_sha===acceptance.tested_commit_sha||
     acceptance.project_tests!=="pass"||
     acceptance.researcher_acceptance!=="pass"||
     acceptance.merge_calls!==0||acceptance.pr_created!==true||
     acceptance.real_backend_frontend_gitea_edits!==2||
     acceptance.native_approved_source_reads!==4||
     acceptance.persistent_gitea_modified!==false||
     JSON.stringify(acceptance.gitea_statuses)!==
       JSON.stringify(["pending","success"]))
    deny("Account Suspension independent Docker/Gitea acceptance missing");
  checked(acceptance,[
    "real_docker_runner","engineer_approval_ed25519",
    "gateway_signed_test_task_completed","real_a2a_sdk_task_completed",
    "real_opa_signed_plan_policy","native_rust_signed_child_and_vp",
    "runner_via_gateway_http","exact_provider_sha_correlated",
    "approval_created"
  ],"real Docker/Gateway acceptance");
  return Object.freeze({
    schema:"account-suspension-signed-dag-e2e-checkpoint-v2",
    status:"functional_scripted_real_gitea_docker_pass",
    scenario_id:SCENARIO,
    framework_source_sha:sourceSha,github_run_id:String(runId),
    isolated_main_sha:native.real_gitea_sha,
    tested_feature_commit_sha:acceptance.tested_commit_sha,
    // These are the separate native signed-DAG branch SHAs, NOT the
    // independent Security CI acceptance feature-branch SHA above.
    signed_dag_failed_docker_sha:native.failed_test_sha,
    signed_dag_pull_request_commit_sha:native.signed_dag_pr_commit_sha,
    signed_dag_approved_task_sequence:Object.freeze([
      ...native.signed_dag_completed_task_ids]),
    independently_delegated_a2a_task_count:4,
    rust_issued_signed_child_credential_count:4,
    real_signed_dag_docker_runs:2,
    failed_then_repaired_docker_verified:true,
    test_preparation_no_runner_authority_verified:true,
    cross_role_test_repair_denied:true,
    signed_test_fixture_ed25519:true,
    native_rust_vp_and_opa:true,
    three_scripted_adk_a2a_agents:true,
    account_suspension_source_derived_backend_routes:true,
    source_derived_functional_file_count:4,
    remaining_prepackaged_application_file_count:7,
    source_derived_controller_verified:true,
    source_derived_status_verified:true,
    source_derived_frontend_api_verified:true,
    source_witnessed_native_dc_vp_e2e:true,
    independent_model_software_output_verified:false,
    standalone_gitea_probe_uses_native_dc_vp:false,
    standalone_gitea_probe_checked_approved_plan:true,
    created_pull_request_unmerged:true,
    isolated_docker_project_tests:"pass",
    isolated_researcher_acceptance:"pass",
    operational_root_revocation_reported_by_positive_dag:true,
    live_gemini_tested:false,
    genuine_human_engineer_approval_tested:false,
    external_r5_go:false
  });
}
if(process.argv[1]&&
   import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const input=process.argv[2],output=process.argv[3];
    if(!input||!output||process.argv.length!==4)
      deny("input/output paths required");
    const evidence=extractSignedFunctionalE2EEvidence(
      await readFile(input,"utf8"),{
        sourceSha:process.env.GITHUB_SHA,
        runId:process.env.GITHUB_RUN_ID
      });
    await writeFile(output,JSON.stringify(evidence,null,2)+"\n",
      {flag:"wx",mode:0o600});
    process.stdout.write("Account Suspension signed-DAG checkpoint PASS; "+
      "no Gemini, no autonomous feature implementation claim\n");
  }catch{
    process.stderr.write("Account Suspension functional E2E NO-GO\n");
    process.exitCode=1;
  }
}
