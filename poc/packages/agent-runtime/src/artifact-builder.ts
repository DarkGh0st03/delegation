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
