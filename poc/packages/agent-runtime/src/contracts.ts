export const DELEGATED_AUTHORIZATION_EXTENSION_URI =
  "urn:thesis:a2a:delegated-authorization:v1" as const;

export const SPECIALIZED_AGENT_ROLES = ["backend", "frontend", "test"] as const;
export type SpecializedAgentRole = (typeof SPECIALIZED_AGENT_ROLES)[number];

export interface DelegationEvidence {
  credential: string;
  credential_id: string;
  presenter_id: string;
}

/** Non-authoritative model visibility; derived ONLY from signed Task permission rows. */
export interface ApprovedTaskFilePermission {
  path: string;
  operation: "read_file" | "update_file" | "create_file";
}
export interface DeterministicSubtask {
  subtask_id: string;
  instruction: string;
  branch: string;
  relevant_paths: string[];
  /** Present only on trusted approved-plan A2A dispatch. */
  approved_file_permissions?: ApprovedTaskFilePermission[];
  /** Trusted signed-plan Task permission hint, never supplied by the model. */
  approved_run_tests?: boolean;
}

export interface AgentTaskContext {
  task_id: string;
  /** Opt-in private Gateway binding preallocated BEFORE A2A dispatch. */
  trusted_gateway_task_id?: string;
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
  branch: string;
  revision: string | null;
  commit_sha: string | null;
  test_outcome: "not_run" | "pass" | "fail";
  errors: string[];
  tested_commit_sha?: string;
  runner_profile?: "poc-default";
  project_tests?: "pass" | "fail";
  researcher_acceptance?: "pass" | "fail" | "skipped";
  model_id?: string;
  model_iterations?: number;
}
