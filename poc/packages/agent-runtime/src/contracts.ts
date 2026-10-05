export const DELEGATED_AUTHORIZATION_EXTENSION_URI =
  "urn:thesis:a2a:delegated-authorization:v1" as const;

export const SPECIALIZED_AGENT_ROLES = ["backend", "frontend", "test"] as const;
export type SpecializedAgentRole = (typeof SPECIALIZED_AGENT_ROLES)[number];

export interface DelegationEvidence {
  credential: string;
  credential_id: string;
  presenter_id: string;
}

export interface DeterministicSubtask {
  subtask_id: string;
  instruction: string;
  branch: "feature/account-suspension";
  relevant_paths: string[];
}

export interface AgentTaskContext {
  task_id: string;
  context_id: string;
  role: SpecializedAgentRole;
  subtask: DeterministicSubtask;
  delegation_evidence: DelegationEvidence;
}

export interface AgentArtifactPayload {
  role: SpecializedAgentRole;
  summary: string;
  files_modified: string[];
  files_created: string[];
  branch: "feature/account-suspension";
  revision: string | null;
  commit_sha: string | null;
  test_outcome: "not_run" | "pass" | "fail";
  errors: string[];
  model_id?: string;
  model_iterations?: number;
}
