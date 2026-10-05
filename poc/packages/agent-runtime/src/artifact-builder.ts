import type { AgentControllerRunResult } from "./agent-controller.ts";
import type {
  AgentArtifactPayload,
  DeterministicSubtask,
  SpecializedAgentRole
} from "./contracts.ts";

export function buildDeterministicArtifactPayload(
  role: SpecializedAgentRole,
  task: DeterministicSubtask
): AgentArtifactPayload {
  return {
    role,
    summary: `${role} agent accepted deterministic subtask ${task.subtask_id}`,
    files_modified: [],
    files_created: [],
    branch: task.branch,
    revision: null,
    commit_sha: null,
    test_outcome: "not_run",
    errors: []
  };
}


export function buildLlmArtifactPayload(
  role: SpecializedAgentRole,
  task: DeterministicSubtask,
  result: AgentControllerRunResult
): AgentArtifactPayload {
  return {
    role,
    summary: result.summary,
    files_modified: [],
    files_created: [],
    branch: task.branch,
    revision: null,
    commit_sha: null,
    test_outcome: "not_run",
    errors: result.controlled_failures.map(
      (failure) => `${failure.kind}: ${failure.message}`
    ),
    ...(result.model_id === null ? {} : { model_id: result.model_id }),
    model_iterations: result.iterations
  };
}
