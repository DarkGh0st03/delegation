/** Only fixed classifications leave the isolated native A2A executor. */
export function classifyApprovedDagFailure(error){
  const m=typeof error?.message==="string"?error.message:"";
  if(m.startsWith("Trusted dispatch failed;"))return "a2a_dispatch_failed";
  if(m.startsWith("Trusted Orchestrator Task failed;"))return "orchestrator_task_failed";
  if(m.startsWith("Trusted DAG termination or revocation not confirmed"))return "root_revocation_unconfirmed";
  if(m.startsWith("Approved Task dependencies not verified"))return "dependency_denied";
  if(m.startsWith("ADK protected model failure:"))return "adk_model_failure";
  if(m.startsWith("ADK controlled task failed:"))return "controlled_tool_failure";
  if(m.startsWith("ADK task produced no confirmed repository revision"))return "no_confirmed_revision";
  if(/^Remote A2A Task [^\r\n]{1,120} is not completed$/u.test(m))return "a2a_task_not_completed";
  if(/^Remote A2A Task [^\r\n]{1,120} must return exactly one Artifact$/u.test(m)||
     m==="Remote A2A Artifact must contain exactly one JSON data part")return "a2a_artifact_invalid";
  if(m.startsWith("Protected A2A result does not match"))return "a2a_result_mismatch";
  if(m.startsWith("Gateway provider effects changed"))return "attestation_effect_race";
  if(error?.code==="approved_plan_denied")return "approved_plan_denied";
  if(error?.code==="ERR_ASSERTION")return "test_assertion";
  return "unclassified";
}
