/**
 * Parse *only* fixed-enum Docker outcomes already filtered by the native
 * child process and emitted via the trusted CI wrapper.
 *
 * This must never re-publish raw Gemini prompts, source, logs, tokens,
 * credentials, paths or provider exception messages.
 */
import {safeNativeDockerFailureDiagnostic} from "./native-dag-result-diagnostic.mjs";

const NATIVE_PREFIX="[trusted-positive-ci] native_dag_failure ";
const DOCKER_PREFIX="[native-dag-adk] docker_phase_status ";
const MAX_TAIL=256*1024;
const MAX_EVENT_LINE=4096;

/** Null means no validated Docker evidence, not that Docker passed. */
export function extractSafeGeminiPilotDockerEvidence(log){
  if(typeof log!=="string")return null;
  const lines=log.slice(-MAX_TAIL).split(/\r?\n/u);
  for(let i=lines.length-1;i>=0;i--){
    const line=lines[i];
    const offset=line.indexOf(NATIVE_PREFIX);
    if(offset<0||line.length-offset>MAX_EVENT_LINE)continue;
    try{
      const data=JSON.parse(line.slice(offset+NATIVE_PREFIX.length));
      if(!data||typeof data!=="object"||Array.isArray(data)||
         data.stage!=="signed_dag_disposable_docker_acceptance")continue;
      // Revalidate and reconstruct through the existing strict whitelist,
      // ignoring all other data, including possible attacker-supplied fields.
      const payload={
        status:data.status,
        phases:data.phases,
        project_tests:data.project_tests,
        researcher_acceptance:data.researcher_acceptance,
        ...(data.typecheck_error_codes!==undefined
          ?{typecheck_error_codes:data.typecheck_error_codes}:{}),
        ...(data.typecheck_permission_scope_audit!==undefined
          ?{typecheck_permission_scope_audit:data.typecheck_permission_scope_audit}:{}),
        ...(data.typecheck_revision_comparison!==undefined
          ?{typecheck_revision_comparison:data.typecheck_revision_comparison}:{}),
        ...(data.typecheck_repair_nomination!==undefined
          ?{typecheck_repair_nomination:data.typecheck_repair_nomination}:{})
      };
      const safe=safeNativeDockerFailureDiagnostic(
        DOCKER_PREFIX+JSON.stringify(payload));
      if(safe)return safe;
    }catch{/* Untrusted logs never escape into user-visible artifacts. */}
  }
  return null;
}
