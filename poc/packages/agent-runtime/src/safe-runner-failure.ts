import {sanitizeTypecheckLocations,sanitizeTypecheckErrorCodes,
  type TypecheckLocation}
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
export interface TypecheckScopeSummary {
  /** Only bounded counts of previously sanitized compiler locations. */
  parsed_locations:number;
  missing_read_grants:number;
  missing_write_grants:number;
}
function safeTypecheckScopeSummary(raw:unknown):TypecheckScopeSummary|undefined{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return undefined;
  const x=raw as Record<string,unknown>;
  if(Object.keys(x).sort().join(",")!=="missing_read_grants,missing_write_grants,parsed_locations")return undefined;
  const valid=(n:unknown)=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0&&n<=8;
  if(!valid(x.parsed_locations)||!valid(x.missing_read_grants)||!valid(x.missing_write_grants)||
     (x.missing_read_grants as number)>(x.parsed_locations as number)||
     (x.missing_write_grants as number)>(x.parsed_locations as number))return undefined;
  return {parsed_locations:x.parsed_locations as number,
    missing_read_grants:x.missing_read_grants as number,
    missing_write_grants:x.missing_write_grants as number};
}
export interface SafeRunnerFailureHint {
  first_failed_phase:string;
  typecheck_diagnostics?:TypecheckLocation[];
  /** Source-free compiler codes only; never a signed repair grant. */
  typecheck_error_codes?:string[];
  /** Only test paths that THIS signed Task may read. */
  failing_test_files?:string[];
  /** Never widens rights; only signals a fresh Engineer approval is needed. */
  repair_requires_new_approval?:true;
  typecheck_scope_summary?:TypecheckScopeSummary;
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
    typecheck_error_codes?:unknown;
    failing_test_files?:unknown;repair_requires_new_approval?:unknown};
  if(!Array.isArray(x.phases))return undefined;
  const failed=x.phases.find(e=>e&&typeof e==="object"&&
    e.status==="fail"&&PHASES.has(e.phase));
  if(!failed)return undefined;
  const all=failed.phase==="typecheck"
    ?sanitizeTypecheckLocations(x.typecheck_diagnostics):[];
  const locations=authorizedLocations(all,approvedReadPaths);
  const codes=failed.phase==="typecheck"
    ?sanitizeTypecheckErrorCodes(x.typecheck_error_codes):[];
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
    ...(codes.length?{typecheck_error_codes:codes}:{}),
    ...(scopedFiles.length?{failing_test_files:scopedFiles}:{}),
    ...(requiresNewApproval?{repair_requires_new_approval:true as const}:{}),
    ...(requiresNewApproval&&failed.phase==="typecheck"
      ?{typecheck_scope_summary:{
        parsed_locations:all.length,
        missing_read_grants:all.filter(d=>!reads.has(d.path)).length,
        missing_write_grants:all.filter(d=>!writes.has(d.path)).length
      }}:{})};
}
/** Additional worker-side whitelist: no uncontrolled error fields. */
export function safeRunnerFailedPhaseHint(value:unknown):SafeRunnerFailureHint|undefined{
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  const x=value as {first_failed_phase?:unknown;typecheck_diagnostics?:unknown;
    typecheck_error_codes?:unknown;
    failing_test_files?:unknown;repair_requires_new_approval?:unknown;
    typecheck_scope_summary?:unknown};
  if(typeof x.first_failed_phase!=="string"||!PHASES.has(x.first_failed_phase))
    return undefined;
  const locations=x.first_failed_phase==="typecheck"
    ?sanitizeTypecheckLocations(x.typecheck_diagnostics):[];
  const codes=x.first_failed_phase==="typecheck"
    ?sanitizeTypecheckErrorCodes(x.typecheck_error_codes):[];
  const failedFiles=(x.first_failed_phase==="frontend_tests"||
    x.first_failed_phase==="backend_tests")
    ?sanitizeVitestFailureFiles(x.failing_test_files,x.first_failed_phase):[];
  return {first_failed_phase:x.first_failed_phase,
    ...(locations.length?{typecheck_diagnostics:locations}:{}),
    ...(codes.length?{typecheck_error_codes:codes}:{}),
    ...(failedFiles.length?{failing_test_files:failedFiles}:{}),
    ...((x.first_failed_phase==="typecheck"||
          x.first_failed_phase==="frontend_tests"||
          x.first_failed_phase==="backend_tests")&&
      x.repair_requires_new_approval===true
        ?{repair_requires_new_approval:true as const}:{}),
    ...(x.first_failed_phase==="typecheck"&&
        x.repair_requires_new_approval===true&&
        safeTypecheckScopeSummary(x.typecheck_scope_summary)
      ?{typecheck_scope_summary:safeTypecheckScopeSummary(x.typecheck_scope_summary)}:{})};
}
