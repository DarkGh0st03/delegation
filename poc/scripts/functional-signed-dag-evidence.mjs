/**
 * Nonbillable, standalone FUNCTIONAL checkpoint for the REAL signed-plan
 * Gitea/Docker E2E. Parse ONLY fixed, internally generated summary events.
 * This is NOT raw trace publication, independent runtime attestation,
 * authentic human consent, Gemini inference or distributed R5 GO.
 *
 * No untrusted stdout/stderr text is retained in the artifact.
 */
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const SHA=/^[0-9a-f]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const EVENT="trusted_security_ci_real_docker_positive_acceptance";
const NATIVE_PREFIX="[trusted-positive-ci] native_disposable_planning ";
const F1_PREFIX="[trusted-positive-ci] f1_real_gitea_baseline ";
const F1_PORT_PREFIX="[trusted-positive-ci] f1_real_gitea_read_port ";
const F1_DRY_PREFIX="[trusted-positive-ci] f1_gemini_probe_dry_run ";
const F1_ADK_PREFIX="[trusted-positive-ci] f1_real_gitea_adk_rehearsal ";
const SOURCE_PROBE_PREFIX="[trusted-positive-ci] source_derived_probe ";
function deny(message){
  throw Error("Functional signed-DAG E2E NO-GO: "+message);
}
function record(value){
  return value!==null&&typeof value==="object"&&!Array.isArray(value);
}
function exactlyOne(array,label){
  if(array.length!==1)deny("expected exactly one "+label+" from real process");
  return array[0];
}
function requireTrue(data,fields,label){
  for(const field of fields)
    if(data[field]!==true)deny(label+" missing: "+field);
}
export function extractSignedFunctionalE2EEvidence(text,{
  scenarioId="department-directory",sourceSha,runId
}={}){
  if(typeof text!=="string"||text.length===0||
     text.length>10*1024*1024||
     !SHA.test(sourceSha??"")||!RUN.test(String(runId??""))||
     scenarioId!=="department-directory")
    deny("one fixed scenario, exact checked-out SHA and GitHub run required");
  const positives=[],natives=[],f1Events=[],f1PortEvents=[],f1DryEvents=[],
    f1AdkEvents=[],sourceProbes=[];
  for(const line of text.split(/\r?\n/u)){
    let data;
    if(line.startsWith(NATIVE_PREFIX)){
      try{data=JSON.parse(line.slice(NATIVE_PREFIX.length));}
      catch{deny("malformed original signed-DAG summary");}
      natives.push(data);
    }else if(line.startsWith(SOURCE_PROBE_PREFIX)){
      try{data=JSON.parse(line.slice(SOURCE_PROBE_PREFIX.length));}
      catch{deny("malformed source-derived real Gitea ADK summary");}
      sourceProbes.push(data);
    }else if(line.startsWith(F1_ADK_PREFIX)){
      try{data=JSON.parse(line.slice(F1_ADK_PREFIX.length));}
      catch{deny("malformed F1 scripted ADK Planning summary");}
      f1AdkEvents.push(data);
    }else if(line.startsWith(F1_DRY_PREFIX)){
      try{data=JSON.parse(line.slice(F1_DRY_PREFIX.length));}
      catch{deny("malformed F1 Gemini probe dry-run summary");}
      f1DryEvents.push(data);
    }else if(line.startsWith(F1_PORT_PREFIX)){
      try{data=JSON.parse(line.slice(F1_PORT_PREFIX.length));}
      catch{deny("malformed real Gitea planning port summary");}
      f1PortEvents.push(data);
    }else if(line.startsWith(F1_PREFIX)){
      try{data=JSON.parse(line.slice(F1_PREFIX.length));}
      catch{deny("malformed real Gitea F1 summary");}
      f1Events.push(data);
    }else if(line.startsWith('{"event":"'+EVENT+'"')){
      try{data=JSON.parse(line);}
      catch{deny("malformed real Docker acceptance summary");}
      positives.push(data);
    }
  }
  const f1=exactlyOne(f1Events,"real Gitea F1 readiness");
  const port=exactlyOne(f1PortEvents,"real Gitea F1 read-only Planning port");
  const dry=exactlyOne(f1DryEvents,"real Gitea Gemini operator dry-run");
  const adk=exactlyOne(f1AdkEvents,"real Gitea scripted ADK Planner");
  const sourceProbe=exactlyOne(sourceProbes,
    "source-derived real Gitea ADK observation");
  const native=exactlyOne(natives,"original signed-DAG observation");
  const acceptance=exactlyOne(positives,"real Docker/Gitea acceptance");
  if(!record(f1)||
     f1.schema!=="f1-real-disposable-gitea-readonly-baseline-v1"||
     f1.status!=="unsolved_pinned_real_gitea_baseline_verified"||
     f1.scenario_id!==scenarioId||
     f1.repository!=="thesis/iam-console-poc"||
     !SHA.test(f1.base_revision??"")||
     f1.verified_source_files!==4||
     f1.provider_model_inference_calls!==0||
     f1.executable_gemini_plan_produced!==false||
     f1.external_r5_go!==false)
    deny("F1 real Gitea source readiness missing");
  requireTrue(f1,["main_unchanged","novel_unsolved_requirement",
    "read_only_api_operations","actual_gitea_source_contents_excluded",
    "golden_solution_excluded"],"real Gitea F1 baseline");
  if(!record(port)||port.status!=="PASS"||
     !SHA.test(port.base_revision??"")||
     port.base_revision!==f1.base_revision||
     !Number.isSafeInteger(port.discovered_files)||port.discovered_files<4||
     !Number.isSafeInteger(port.discovered_directories)||
     port.discovered_directories<1||
     port.pinned_source_read!==true||port.model_calls!==0||
     port.native_gateway_attested_by_this_port!==false)
    deny("complete real Gitea read-only Planning port not observed");
  if(!record(dry)||dry.status!=="PASS"||
     !SHA.test(dry.base_revision??"")||
     dry.base_revision!==f1.base_revision||
     dry.base_revision!==port.base_revision||
     dry.source_kind!=="real_disposable_gitea"||
     !Number.isSafeInteger(dry.discovered_files)||
     dry.discovered_files!==port.discovered_files||
     dry.model_calls!==0||
     dry.billable_model_inference!==false||
     dry.execution_permitted!==false)
    deny("F1 Gemini operator dry-run on real Gitea not verified");
  if(!record(adk)||
     adk.schema!=="f1-scripted-adk-real-gitea-rehearsal-v1"||
     adk.status!=="actual_adk_planner_scripted_proposal_on_real_gitea_pass"||
     adk.scenario_id!==scenarioId||
     adk.base_revision!==f1.base_revision||
     adk.discovered_files!==port.discovered_files||
     adk.verified_source_reads!==4||adk.model_turns!==7||
     adk.compiled_task_count!==5||
     !Number.isSafeInteger(adk.compiled_permission_count)||
     adk.compiled_permission_count<9||
     adk.technical_preflight_pass!==true||
     adk.functional_design_plausible!==false||
     !Array.isArray(adk.functional_review_failed_checks)||
     JSON.stringify(adk.functional_review_failed_checks)!==
       JSON.stringify(["explicit_test_implementation"])||
     adk.human_engineer_review_still_required!==true||
     adk.proposal_digest_verified!==true||
     adk.no_approval_or_credential!==true||
     adk.scripted_model_only!==true||adk.real_gemini_calls!==0||
     adk.gemini_billing_incurred!==false||
     adk.direct_gitea_research_only!==true||
     adk.gateway_vp_opa_attested_by_this_rehearsal!==false||
     adk.execution_permitted!==false||adk.external_r5_go!==false)
    deny("actual ADK proposal compilation on pinned real Gitea missing");
  if(!record(sourceProbe)||sourceProbe.status!=="PASS"||
     sourceProbe.source_derived_tool_output!==true||
     sourceProbe.gitea_provider_committed!==true||
     sourceProbe.main_unchanged!==true||
     sourceProbe.external_model_calls!==0||
     sourceProbe.signed_gateway_credential_e2e!==false||
     sourceProbe.review_fixture_not_human_signed!==true||
     sourceProbe.model_operations_preflight_checked!==true||
     sourceProbe.approved_plan_preflight_denials!==4||
     sourceProbe.controlled_calls!==2||
     sourceProbe.files_modified!==1||
     !SHA.test(sourceProbe.source_sha??"")||
     !SHA.test(sourceProbe.feature_sha??"")||
     sourceProbe.source_sha!==f1.base_revision||
     sourceProbe.feature_sha===f1.base_revision)
    deny("independent source-derived Gitea ADK preflight evidence missing");
  if(!record(native)||native.status!=="PASS"||
     !SHA.test(native.real_gitea_sha??"")||
     native.real_gitea_sha===acceptance.tested_commit_sha)
    deny("original signed plan baseline SHA unavailable");
  if(f1.base_revision!==native.real_gitea_sha)
    deny("F1 pinned main differs from signed DAG source");
  if(sourceProbe.feature_sha===acceptance.tested_commit_sha)
    deny("source-derived probe branch incorrectly shares signed DAG commit");
  requireTrue(native,[
    "native_rust","live_opa","signed_handoff","operational_root",
    "dispatcher_fail_closed","signed_dag_positive",
    "host_supplied_adk_models",
    "fixture_scripted_payloads_reach_adk_runner",
    "same_signed_dag_docker_acceptance",
    "source_witnessed_native_dag",
    "source_witnessed_still_uses_fixture_code",
    "source_derived_functional_route_verified"
  ],"original signed-DAG process");
  if(native.source_derived_functional_file_count!==1||
     native.remaining_prepackaged_application_file_count!==10)
    deny("source-derived file count or fixture count differs");
  if(native.independent_model_software_output_verified!==false)
    deny("offline scripted run cannot claim independent model-produced code");
  if(native.backend_frontend_a2a_updates!==10||
     native.test_agent_created_e2e!==1||
     native.signed_generic_adk_agents!==3||
     native.a2a_before_branch!==0||native.main_mutations!==0)
    deny("native signed DAG provider effects or branch isolation absent");
  if(!record(acceptance)||acceptance.event!==EVENT||
     acceptance.status!=="PASS"||acceptance.scenario_id!==scenarioId||
     acceptance.pr_source!=="native_signed_dag"||
     !SHA.test(acceptance.tested_commit_sha??"")||
     !SHA.test(acceptance.baseline_sha??"")||
     acceptance.project_tests!=="pass"||
     acceptance.researcher_acceptance!=="pass"||
     acceptance.merge_calls!==0||
     acceptance.pr_created!==true||
     acceptance.real_backend_frontend_gitea_edits!==2||
     acceptance.native_approved_source_reads!==4||
     acceptance.persistent_gitea_modified!==false||
     JSON.stringify(acceptance.gitea_statuses)!==
       JSON.stringify(["pending","success"]))
    deny("real signed-DAG Gitea/Docker acceptance incomplete");
  requireTrue(acceptance,[
    "real_docker_runner","engineer_approval_ed25519",
    "gateway_signed_test_task_completed","real_a2a_sdk_task_completed",
    "real_opa_signed_plan_policy","native_rust_signed_child_and_vp",
    "runner_via_gateway_http","exact_provider_sha_correlated",
    "approval_created"
  ],"real positive runner");
  return Object.freeze({
    schema:"functional-signed-dag-e2e-checkpoint-v1",
    status:"functional_scripted_real_gitea_docker_pass",
    scenario_id:scenarioId,
    framework_source_sha:sourceSha,github_run_id:String(runId),
    isolated_main_sha:native.real_gitea_sha,
    f1_real_gitea_unsolved_baseline_verified:true,
    f1_gemini_operator_dry_run_real_gitea_verified:true,
    f1_actual_adk_scripted_planner_real_gitea_verified:true,
    f1_scripted_model_turns:adk.model_turns,
    f1_adk_compiled_task_count:adk.compiled_task_count,
    f1_scripted_proposal_functionally_complete:false,
    f1_scripted_plan_missing_concrete_test_implementation:true,
    f1_real_gemini_plan_quality_not_yet_measured:true,
    f1_actual_full_repo_snapshot_readonly_verified:true,
    f1_discovered_files:port.discovered_files,
    f1_discovered_directories:port.discovered_directories,
    f1_source_revision:f1.base_revision,
    f1_genuine_gemini_proposal_produced:false,
    tested_feature_commit_sha:acceptance.tested_commit_sha,
    approved_dag_implemented_in_disposable_gitea:true,
    signed_test_fixture_ed25519:true,
    native_rust_vp_and_opa:true,
    three_scripted_adk_a2a_agents:true,
    block_b_host_selected_scripted_adk_models_with_fixture_payloads:true,
    block_b_independent_model_software_output_verified:false,
    block_b_source_derived_real_gitea_probe_verified:true,
    block_b_source_derived_approved_plan_preflight_denials:4,
    block_b_source_derived_external_model_calls:0,
    block_b_source_derived_native_dc_vp_e2e:false,
    block_b_hybrid_source_witness_native_dc_vp_e2e_verified:true,
    block_b_hybrid_still_uses_prepackaged_implementation:true,
    block_b_functional_backend_route_derived_from_real_source:true,
    block_b_source_derived_functional_file_count:1,
    block_b_remaining_prepackaged_application_file_count:10,
    created_pull_request_unmerged:true,
    isolated_docker_project_tests:"pass",
    isolated_researcher_acceptance:"pass",
    operational_root_revocation_reported_by_positive_dag:true,
    live_gemini_tested:false,
    genuine_human_engineer_approval_tested:false,
    private_distributed_r5_tested:false,
    external_r5_go:false
  });
}
if(process.argv[1]&&import.meta.url===
   pathToFileURL(resolve(process.argv[1])).href){
  try{
    const file=process.argv[2],out=process.argv[3];
    if(!file||!out||process.argv.length!==4)deny("exact log and output paths required");
    const raw=await readFile(file,"utf8");
    const evidence=extractSignedFunctionalE2EEvidence(raw,{
      scenarioId:"department-directory",
      sourceSha:process.env.GITHUB_SHA,
      runId:process.env.GITHUB_RUN_ID
    });
    await writeFile(out,JSON.stringify(evidence,null,2)+"\n",
      {flag:"wx",mode:0o600});
    process.stdout.write("Functional signed DAG E2E checkpoint PASS "+
      "("+evidence.scenario_id+"); no Gemini, no R5 GO\n");
  }catch{
    process.stderr.write("Functional signed-DAG E2E NO-GO\n");
    process.exitCode=1;
  }
}
