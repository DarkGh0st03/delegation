import {sanitizeTypecheckLocations,type TypecheckLocation}
  from "../../../apps/test-runner-controller/src/typecheck-diagnostics.ts";
import {sanitizeVitestFailureFiles}
  from "../../../apps/test-runner-controller/src/vitest-failure-files.ts";

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
  /** Only test paths that THIS signed Task may read. */
  failing_test_files?:string[];
  /** Never widens rights; only signals a fresh Engineer approval is needed. */
  repair_requires_new_approval?:true;
}
function authorizedLocations(raw:unknown,approved:readonly string[]){
  const paths=new Set(approved.filter(p=>typeof p==="string"));
  return paths.size>0
    ?sanitizeTypecheckLocations(raw).filter(row=>paths.has(row.path)):[];
}
export function safeRunnerFailureDetails(execution:unknown,
  approvedReadPaths:readonly string[]=[],
  approvedWritePaths:readonly string[]=[]):SafeRunnerFailureHint|undefined{
  if(!execution||typeof execution!=="object")return undefined;
  const x=execution as {phases?:unknown;typecheck_diagnostics?:unknown;
    failing_test_files?:unknown;repair_requires_new_approval?:unknown};
  if(!Array.isArray(x.phases))return undefined;
  const failed=x.phases.find(e=>e&&typeof e==="object"&&
    e.status==="fail"&&PHASES.has(e.phase));
  if(!failed)return undefined;
  const all=failed.phase==="typecheck"
    ?sanitizeTypecheckLocations(x.typecheck_diagnostics):[];
  const locations=authorizedLocations(all,approvedReadPaths);
  const reads=new Set(approvedReadPaths),writes=new Set(approvedWritePaths);
  const vitestPhase=failed.phase==="frontend_tests"||failed.phase==="backend_tests"
    ?failed.phase:null;
  const failedFiles=vitestPhase
    ?sanitizeVitestFailureFiles(x.failing_test_files,vitestPhase):[];
  const scopedFiles=failedFiles.filter(p=>reads.has(p));
  const requiresNewApproval=(failed.phase==="typecheck"&&(
    x.repair_requires_new_approval===true||
    all.some(d=>!reads.has(d.path)||!writes.has(d.path))))||
    (vitestPhase!==null&&(x.repair_requires_new_approval===true||
      failedFiles.some(p=>!reads.has(p))));
  return {first_failed_phase:failed.phase,
    ...(locations.length?{typecheck_diagnostics:locations}:{}),
    ...(scopedFiles.length?{failing_test_files:scopedFiles}:{}),
    ...(requiresNewApproval?{repair_requires_new_approval:true as const}:{})};
}
/** Additional worker-side whitelist: no uncontrolled error fields. */
export function safeRunnerFailedPhaseHint(value:unknown):SafeRunnerFailureHint|undefined{
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  const x=value as {first_failed_phase?:unknown;typecheck_diagnostics?:unknown;
    failing_test_files?:unknown;repair_requires_new_approval?:unknown};
  if(typeof x.first_failed_phase!=="string"||!PHASES.has(x.first_failed_phase))
    return undefined;
  const locations=x.first_failed_phase==="typecheck"
    ?sanitizeTypecheckLocations(x.typecheck_diagnostics):[];
  const failedFiles=(x.first_failed_phase==="frontend_tests"||
    x.first_failed_phase==="backend_tests")
    ?sanitizeVitestFailureFiles(x.failing_test_files,x.first_failed_phase):[];
  return {first_failed_phase:x.first_failed_phase,
    ...(locations.length?{typecheck_diagnostics:locations}:{}),
    ...(failedFiles.length?{failing_test_files:failedFiles}:{}),
    ...((x.first_failed_phase==="typecheck"||
          x.first_failed_phase==="frontend_tests"||
          x.first_failed_phase==="backend_tests")&&
      x.repair_requires_new_approval===true
        ?{repair_requires_new_approval:true as const}:{})};
}
