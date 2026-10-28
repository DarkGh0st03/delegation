import {sanitizeTypecheckLocations,type TypecheckLocation}
  from "../../../apps/test-runner-controller/src/typecheck-diagnostics.ts";

/**
 * The Test Agent sees compiler locations only when the current signed Task
 * has an exact read_file grant for the path. Never return source/log text.
 */
const PHASES=new Set([
  "dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"
]);
export interface SafeRunnerFailureHint {
  first_failed_phase:string;
  typecheck_diagnostics?:TypecheckLocation[];
}
function authorizedLocations(raw:unknown,approved:readonly string[]){
  const paths=new Set(approved.filter(p=>typeof p==="string"));
  return paths.size>0
    ?sanitizeTypecheckLocations(raw).filter(row=>paths.has(row.path)):[];
}
export function safeRunnerFailureDetails(execution:unknown,
  approvedReadPaths:readonly string[]=[]):SafeRunnerFailureHint|undefined{
  if(!execution||typeof execution!=="object")return undefined;
  const x=execution as {phases?:unknown;typecheck_diagnostics?:unknown};
  if(!Array.isArray(x.phases))return undefined;
  const failed=x.phases.find(e=>e&&typeof e==="object"&&
    e.status==="fail"&&PHASES.has(e.phase));
  if(!failed)return undefined;
  const locations=failed.phase==="typecheck"
    ?authorizedLocations(x.typecheck_diagnostics,approvedReadPaths):[];
  return {first_failed_phase:failed.phase,
    ...(locations.length?{typecheck_diagnostics:locations}:{})};
}
/** Additional worker-side whitelist: no uncontrolled error fields. */
export function safeRunnerFailedPhaseHint(value:unknown):SafeRunnerFailureHint|undefined{
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  const x=value as {first_failed_phase?:unknown;typecheck_diagnostics?:unknown};
  if(typeof x.first_failed_phase!=="string"||!PHASES.has(x.first_failed_phase))
    return undefined;
  const locations=x.first_failed_phase==="typecheck"
    ?sanitizeTypecheckLocations(x.typecheck_diagnostics):[];
  return {first_failed_phase:x.first_failed_phase,
    ...(locations.length?{typecheck_diagnostics:locations}:{})};
}
