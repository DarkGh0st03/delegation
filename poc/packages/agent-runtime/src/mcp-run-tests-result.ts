import {ControlledToolError,controlledToolErrorPayload} from "./controlled-errors.ts";
import {safeRunnerFailureDetails} from "./safe-runner-failure.ts";

type ErrorKind="authorization_denied"|"invalid_tool_call"|"tool_unavailable"|"tests_failed";
function controlled(kind:ErrorKind,execution?:unknown){
  const details=kind==="tests_failed"
    ?safeRunnerFailureDetails(execution):undefined;
  return controlledToolErrorPayload(new ControlledToolError(
    kind,"MCP "+kind,details?{details}:{}
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
  response:unknown,args:Record<string,unknown>
):{ok:true;result:unknown}|ReturnType<typeof controlledToolErrorPayload>{
  const envelope=record(response);
  const payload=record(envelope?.structuredContent);
  if(envelope?.isError===true || payload?.ok!==true){
    const kind=record(payload?.error)?.kind;
    if(kind==="tests_failed")return controlled("tests_failed");
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
    return controlled("tests_failed",result);
  }
  return {ok:true,result:payload.result};
}
