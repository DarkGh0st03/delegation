/**
 * R74: source-free, NON-CAUSAL interpretation of a failed paid Gemini pilot.
 * Reports what an independently sanitized control plane observed. It MUST
 * NEVER label an error as a model reasoning failure, nor copy arbitrary
 * metadata from model text, Docker logs or provider exceptions.
 *
 * Input values are the already-sanitized final report fields, not raw logs.
 * All output strings are fixed vocabulary; no paths, prompts, messages,
 * code, signed grants or tokens may pass this boundary.
 */
const PHASES=Object.freeze([
  "dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"
]);
const PROVIDER_ERRORS=new Set([
  "authentication","permission_or_billing","quota_or_rate_limit",
  "model_or_endpoint_not_found","invalid_request_or_tool_schema",
  "provider_server_error","transport_or_timeout","unknown"
]);
const record=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);

function observedDockerFailure(raw){
  if(!record(raw)||raw.status!=="fail"||
     !Array.isArray(raw.phases)||raw.phases.length!==PHASES.length)
    return null;
  const states=["pass","fail","skipped"];
  if(!raw.phases.every((x,i)=>record(x)&&x.phase===PHASES[i]&&
      states.includes(x.status)))return null;
  const failed=raw.phases.find(x=>x.status==="fail");
  if(!failed||failed.phase!==raw.first_failed_phase)return null;
  // The native Docker parser has a stricter shape/whitelist; recheck
  // the only signal we need and never return untrusted values.
  return failed.phase;
}

export function classifySafeGeminiPilotFailure({docker_phase_evidence,
  gemini_pilot_diagnostic}={}){
  const observed=observedDockerFailure(docker_phase_evidence);
  if(observed){
    return Object.freeze({
      observed_failure:observed==="typecheck"
        ?"docker_typecheck_failure":"docker_other_phase_failure",
      first_failed_phase:observed,
      causal_attribution:"not_established"
    });
  }
  const diagnostic=record(gemini_pilot_diagnostic)
    ?gemini_pilot_diagnostic:null;
  if(diagnostic?.category==="model_provider_failure"&&
     PROVIDER_ERRORS.has(diagnostic.model_failure)){
    return Object.freeze({
      observed_failure:"model_provider_failure_reported",
      model_failure_category:diagnostic.model_failure,
      causal_attribution:"not_established"
    });
  }
  // Accepted plans can carry historical rejected drafts. Never equate
  // that history with the reason a later delegated execution failed.
  if(diagnostic?.stage==="gemini_planning"&&
     diagnostic.category==="planner_contract_rejected"){
    return Object.freeze({
      observed_failure:"planner_contract_rejection_reported",
      causal_attribution:"not_established"
    });
  }
  if(diagnostic?.stage==="delegated_agents_gitea_docker"){
    return Object.freeze({
      observed_failure:"delegated_execution_failure_unclassified",
      causal_attribution:"not_established"
    });
  }
  return Object.freeze({
    observed_failure:"failure_without_verified_phase",
    causal_attribution:"not_established"
  });
}
