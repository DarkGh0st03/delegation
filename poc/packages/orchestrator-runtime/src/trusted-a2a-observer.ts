/**
 * Translate a ProtectedA2AClient's ALREADY VALIDATED Task result into
 * an observation for the trusted Coordinator -> Gateway private control.
 *
 * Neither an A2A status nor its artifact proves provider effects.
 * Gateway independently correlates it with verified Gitea/Runner results.
 * Never expose this function as an ADK FunctionTool or generic MCP tool.
 */
import type {DelegatedA2ARoleTaskResult} from "./a2a-workflow.ts";
import type {TrustedCompletionObservation} from
  "../../../apps/gateway/src/trusted-task-observation.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export function observedA2ACompletion(
  result:DelegatedA2ARoleTaskResult
):TrustedCompletionObservation{
  if(!result||!ID.test(result.task_id)||
     !["backend","frontend","test"].includes(result.role)||
     result.artifact?.role!==result.role){
    throw new Error("Trusted A2A observer requires validated Task, role and artifact");
  }
  const a=result.artifact;
  return structuredClone({
    source:"trusted_a2a_poll",
    runtime_task_id:result.task_id,
    state:"completed",role:result.role,
    artifact:{
      branch:a.branch,revision:a.revision,commit_sha:a.commit_sha,
      files_modified:[...a.files_modified],files_created:[...a.files_created],
      test_outcome:a.test_outcome,
      ...(a.tested_commit_sha?{tested_commit_sha:a.tested_commit_sha}:{}),
      ...(a.runner_profile?{runner_profile:a.runner_profile}:{}),
      ...(a.project_tests?{project_tests:a.project_tests}:{}),
      ...(a.researcher_acceptance?{
        researcher_acceptance:a.researcher_acceptance
      }:{})
    }
  }) as TrustedCompletionObservation;
}
/**
 * Orchestrator Tasks (for example create_branch) have no remote A2A result.
 * Gateway still requires its OWN confirmed provider effect for this Task.
 */
export function observedOrchestratorProviderCompletion(
  runtimeTaskId:string
):TrustedCompletionObservation{
  if(typeof runtimeTaskId!=="string"||!ID.test(runtimeTaskId)){
    throw new Error("Invalid trusted Orchestrator runtime Task ID");
  }
  return {
    source:"trusted_orchestrator",runtime_task_id:runtimeTaskId,
    role:"orchestrator",state:"completed"
  };
}
