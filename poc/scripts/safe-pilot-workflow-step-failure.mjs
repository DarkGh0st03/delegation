/** Bounded public GitHub Actions step attribution. No logs or model content.
 * A failing step identifies the observer, NOT the root cause of a code defect. */
import {writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const STEPS=Object.freeze([["checkout","source_checkout","workflow_runner"],["rust_toolchain","toolchain_setup","workflow_runner"],["node_setup","toolchain_setup","workflow_runner"],["private_evidence","private_evidence_preflight","workflow_runner"],["foundry_setup","toolchain_setup","workflow_runner"],["dependencies","dependency_install","workflow_runner"],["billing_consent","manual_billing_consent","billing_gate"],["offline_ci_gate","same_sha_ci_validation","billing_gate"],["anvil_opa","isolated_anvil_opa","infrastructure"],["identities","test_identity_setup","identity_fixture"],["trust_registry","evm_trust_registry","evm_adapter"],["adapter_build","adapter_build","evm_adapter"],["adapter_start","adapter_start","evm_adapter"],["gateway_start","rust_gateway_start","rust_gateway"],["gitea_resources","gitea_docker_assets","isolated_runner"],["provider_preflight","gemini_key_model_probe","gemini_provider"],["signed_pilot","gemini_signed_dag_execution","trusted_orchestrator"],["seal_private","private_runner_evidence_seal","private_evidence"],["upload_encrypted","private_artifact_upload","workflow_runner"]]);
const STATUS=new Set(["success","failure","skipped","cancelled",""]);
export function safePaidWorkflowStepFailure(outcomes){
 if(!outcomes||typeof outcomes!=="object"||Array.isArray(outcomes))
  throw Error("Trusted paid workflow outcome map required");
 let success=0,skipped=0,missing=0,first=null;
 for(const [id,phase,component] of STEPS){
  const status=outcomes[id]??"";
  if(!STATUS.has(status))throw Error("Invalid trusted workflow step status");
  if(status==="success")success++;
  else if(status==="skipped")skipped++;
  else if(status==="")missing++;
  else if(!first)first={id,phase,component,status};
 }
 return Object.freeze({
  schema:"delegation-workflow-stop-v1",
  observed_failure:first?"workflow_step_failed":"no_failure_observed",
  ...(first?{
   failed_step_id:first.id,observed_phase:first.phase,
   reporting_component:first.component,
   observed_code:first.status==="failure"
    ?"github_step_failure":"github_step_cancelled",
   verified_stop_condition:"This trusted workflow step did not complete successfully",
   evidence_source:"github_step_outcome",
   root_cause:"not_established_by_public_step_status",
   next_evidence:"inspect_restricted_github_step_log"
  }:{}),
  completed_step_count:success,skipped_step_count:skipped,
  unreported_step_count:missing,causal_attribution:"not_established"
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const statuses=Object.fromEntries(STEPS.map(([id])=>
  [id,process.env["DELEGATION_STEP_"+id.toUpperCase()]??""]));
 const result=safePaidWorkflowStepFailure(statuses);
 if(result.observed_failure==="workflow_step_failed")
  writeFileSync("/tmp/four-gemini-pilot-step-failure.json",
   JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
}
