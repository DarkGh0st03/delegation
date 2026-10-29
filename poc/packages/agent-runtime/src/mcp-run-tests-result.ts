import {ControlledToolError,controlledToolErrorPayload} from "./controlled-errors.ts";
import {safeRunnerFailureDetails,safeRunnerFailedPhaseHint,
  type TypecheckScopeSummary} from "./safe-runner-failure.ts";

type ErrorKind="authorization_denied"|"invalid_tool_call"|"tool_unavailable"|"tests_failed";
function controlled(kind:ErrorKind,execution?:unknown,
  approvedPaths:readonly string[]=[],approvedWrites:readonly string[]=[],
  upstreamScope?:TypecheckScopeSummary){
  const details=kind==="tests_failed"
    ?safeRunnerFailureDetails(execution,approvedPaths,approvedWrites):undefined;
  // Preserve only a previously whitelisted numeric summary. Filtering the
  // Runner's file paths twice must not erase counts of unapproved locations.
  const safeDetails=details?.repair_requires_new_approval===true&&
    details.first_failed_phase==="typecheck"&&upstreamScope
    ?{...details,typecheck_scope_summary:upstreamScope}:details;
  return controlledToolErrorPayload(new ControlledToolError(
    kind,"MCP "+kind,safeDetails?{details:safeDetails}:{}
  ));
}
function record(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)
    ? value as Record<string,unknown>:null;
}
/**
 * Trusted Test Runner evidence, not model prose: validate exact branch,
 * SHA and both mandatory acceptance gates before reporting PASS.
 */
export function normalizeMcpRunTestsOutcome(
  response:unknown,args:Record<string,unknown>,
  approvedReadPaths:readonly string[]=[],
  approvedWritePaths:readonly string[]=[]
):{ok:true;result:unknown}|ReturnType<typeof controlledToolErrorPayload>{
  const envelope=record(response);
  const payload=record(envelope?.structuredContent);
  if(envelope?.isError===true || payload?.ok!==true){
    const kind=record(payload?.error)?.kind;
    if(kind==="tests_failed"){
      // The worker may include a provider-corrobated failed phase in its
      // controlled error. Accept only the existing fixed enum, never logs.
      const hint=safeRunnerFailedPhaseHint(record(payload?.error)?.details);
      const reason=hint?.first_failed_phase;
      const allowed=new Set(["dependency_install","typecheck",
        "backend_tests","frontend_tests","build","playwright_e2e",
        "researcher_acceptance"]);
      if(typeof reason==="string"&&allowed.has(reason))
        return controlled("tests_failed",{
          phases:[{phase:reason,status:"fail"}],
          ...(reason==="typecheck"
            ?{typecheck_diagnostics:hint?.typecheck_diagnostics,
               repair_requires_new_approval:hint?.repair_requires_new_approval}
            :reason==="frontend_tests"||reason==="backend_tests"
              ?{failing_test_files:hint?.failing_test_files,
                 repair_requires_new_approval:hint?.repair_requires_new_approval}
              :{})
        },approvedReadPaths,approvedWritePaths,hint?.typecheck_scope_summary);
      return controlled("tests_failed");
    }
    if(kind==="authorization_denied")return controlled("authorization_denied");
    if(kind==="invalid_tool_call")return controlled("invalid_tool_call");
    return controlled("tool_unavailable");
  }
  const result=record(payload.result);
  const sha=/^[a-f0-9]{40}$/u;
  const project=record(result?.project_tests);
  const acceptance=record(result?.researcher_acceptance);
  const phases=result?.phases;
  if(result?.provider!=="runner"||result?.performed!==true||
     result?.tool!=="run_tests"||result?.branch!==args.branch||
     result?.runner_profile!==args.profile||
     typeof result?.tested_commit_sha!=="string"||
     !sha.test(result.tested_commit_sha)||
     result.revision!==result.tested_commit_sha||
     !Array.isArray(phases)||!Array.isArray(project?.phases)||
     acceptance?.phase!=="researcher_acceptance"||
     !["pass","fail"].includes(String(result.status))||
     !["pass","fail"].includes(String(project?.status))||
     !["pass","fail","skipped"].includes(String(acceptance?.status))){
    return controlled("tool_unavailable");
  }
  if(result.status!=="pass"||project?.status!=="pass"||acceptance?.status!=="pass"){
    return controlled("tests_failed",result,approvedReadPaths,approvedWritePaths);
  }
  return {ok:true,result:payload.result};
}
