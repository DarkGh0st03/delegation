import type { AgentControllerRunResult } from "./agent-controller.ts";
import type { AgentArtifactPayload, DeterministicSubtask, SpecializedAgentRole } from "./contracts.ts";

export function buildDeterministicArtifactPayload(role: SpecializedAgentRole, task: DeterministicSubtask): AgentArtifactPayload {
  return { role, summary: `${role} agent accepted deterministic subtask ${task.subtask_id}`, files_modified: [], files_created: [], branch: task.branch, revision: null, commit_sha: null, test_outcome: "not_run", errors: [] };
}

export function buildLlmArtifactPayload(role: SpecializedAgentRole, task: DeterministicSubtask, result: AgentControllerRunResult): AgentArtifactPayload {
  const testOutcome = result.project_tests === "fail" || result.researcher_acceptance === "fail"
    ? "fail"
    : result.project_tests === "pass" && result.researcher_acceptance === "pass" ? "pass" : "not_run";
  return {
    role, summary: result.summary, files_modified: result.files_modified, files_created: result.files_created,
    branch: task.branch, revision: result.revision, commit_sha: result.revision, test_outcome: testOutcome,
    errors: result.controlled_failures.map((failure) => `${failure.kind}: ${failure.message}`),
    ...(result.tested_commit_sha ? { tested_commit_sha: result.tested_commit_sha } : {}),
    ...(result.runner_profile ? { runner_profile: result.runner_profile } : {}),
    ...(result.project_tests ? { project_tests: result.project_tests } : {}),
    ...(result.researcher_acceptance ? { researcher_acceptance: result.researcher_acceptance } : {}),
    ...(result.model_id === null ? {} : { model_id: result.model_id }), model_iterations: result.iterations
  };
}
