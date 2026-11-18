import type { AgentArtifactPayload, DeterministicSubtask, SpecializedAgentRole } from "../../src/contracts.ts";

/** Minimal Task result for A2A transport tests (no model, no tools). */
export function taskArtifact(role: SpecializedAgentRole, task: DeterministicSubtask): AgentArtifactPayload {
  return { role, summary: `${role} agent accepted subtask ${task.subtask_id}`, files_modified: [],
    files_created: [], branch: task.branch, revision: null, commit_sha: null,
    test_outcome: "not_run", errors: [] };
}
