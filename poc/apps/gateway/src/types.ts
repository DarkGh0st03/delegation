export const AGENT_ROLES = ["orchestrator", "backend", "frontend", "test"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const TOOL_NAMES = [
  "read_file",
  "update_file",
  "create_file",
  "create_branch",
  "create_pull_request",
  "run_tests"
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type Operation =
  | "read_file"
  | "update_file"
  | "create_file"
  | "create_branch"
  | "create_pull_request"
  | "run_tests";

export interface Permission {
  resource: string;
  operation: Operation;
}

export type NormalizedToolRequest =
  | {
      tool: "read_file";
      arguments: { branch: string; path: string };
    }
  | {
      tool: "update_file";
      arguments: { branch: string; path: string; content: string };
    }
  | {
      tool: "create_file";
      arguments: { branch: string; path: string; content: string };
    }
  | {
      tool: "create_branch";
      arguments: { base_branch: string; branch: string };
    }
  | {
      tool: "create_pull_request";
      arguments: {
        head_branch: string;
        base_branch: string;
        title: string;
        body?: string;
      };
    }
  | {
      tool: "run_tests";
      arguments: { branch: string; profile: "poc-default" };
    };

export interface PrepareAuthorizationRequest {
  task_id: string;
  agent_role: AgentRole;
  tool: ToolName;
  arguments: unknown;
}

export interface PreparedAuthorizationResponse {
  request_id: string;
  audience: string;
  challenge: string;
  required_permission: Permission;
  expires_at: string;
}

export interface PreparedRequestRecord {
  request_id: string;
  task_id: string;
  agent_role: AgentRole;
  request: NormalizedToolRequest;
  required_permission: Permission;
  audience: string;
  challenge: string;
  request_fingerprint: string;
  created_at_ms: number;
  expires_at_ms: number;
  consumed: boolean;
}

export interface GatewayRepositoryConfig {
  authority: string;
  owner: string;
  repository: string;
}

export interface GatewayPrepareConfig {
  audience: string;
  request_ttl_ms: number;
  repository: GatewayRepositoryConfig;
}

export interface PrepareAuditEvent {
  event: "authorization_prepared";
  timestamp: string;
  request_id: string;
  task_id: string;
  agent_role: AgentRole;
  tool: ToolName;
  resource_uri: string;
  operation: Operation;
  prepare_ms: number;
}

export interface ExecuteAuditEvent {
  event: "authorization_executed";
  timestamp: string;
  request_id: string;
  task_id: string;
  agent_role: AgentRole;
  tool: ToolName;
  resource_uri: string;
  operation: Operation;
  decision: "allow" | "deny";
  reason: string;
  verification_ms: number;
  opa_ms: number;
  policy_decision: "allow" | "deny" | "error" | "not_evaluated";
  policy_version?: string;
  provider_ms: number;
  provider_result: "success" | "error" | "not_called";
  total_ms: number;
  vp_size_bytes: number;
  chain_depth?: number;
  disclosed_permission_count?: number;
  provider_revision?: string;
  provider_commit_sha?: string;
  provider_blob_sha?: string;
  provider_pull_request_id?: number;
  provider_pull_request_number?: number;
  provider_pull_request_url?: string;
  runner_tested_commit_sha?: string;
  runner_profile?: "poc-default";
  runner_status?: "pass" | "fail";
  runner_log_reference?: string;
  provider: "mock" | "gitea" | "runner";
}

export type AuditEvent = PrepareAuditEvent | ExecuteAuditEvent;

export interface AuditSink {
  emit(event: AuditEvent): void;
}

export interface ExecuteAuthorizationRequest {
  request_id: string;
  signed_vp: string;
}

export interface VerifiedDelegation {
  presenter_id: string;
  credential_id: string;
  issuer_id: string;
  permissions: Permission[];
  hierarchy_depth: number;
  expiration: string | number;
}

export interface VerificationRequest {
  presenter: AgentRole;
  audience: string;
  challenge: string;
  required_permission: Permission;
  signed_vp: string;
}

export interface VerifierPort {
  verify(request: VerificationRequest): Promise<VerifiedDelegation>;
}

export interface MockExecutionResult {
  provider: "mock";
  performed: false;
  tool: ToolName;
  request_fingerprint: string;
}

export interface GiteaReadFileExecutionResult {
  provider: "gitea";
  performed: true;
  tool: "read_file";
  branch: string;
  path: string;
  revision: string;
  blob_sha: string;
  last_commit_sha: string;
  size: number;
  encoding: "utf-8";
  content: string;
}

export interface GiteaCreateBranchExecutionResult {
  provider: "gitea";
  performed: true;
  tool: "create_branch";
  branch: string;
  base_branch: string;
  revision: string;
  commit_sha: string;
}

export interface GiteaCreateFileExecutionResult {
  provider: "gitea";
  performed: true;
  tool: "create_file";
  branch: string;
  path: string;
  revision: string;
  commit_sha: string;
  blob_sha: string;
}

export interface GiteaUpdateFileExecutionResult {
  provider: "gitea";
  performed: true;
  tool: "update_file";
  branch: string;
  path: string;
  revision: string;
  commit_sha: string;
  blob_sha: string;
  precondition_blob_sha: string;
}

export interface GiteaCreatePullRequestExecutionResult {
  provider: "gitea";
  performed: true;
  tool: "create_pull_request";
  pull_request_id: number;
  pull_request_number: number;
  url?: string;
  head_branch: string;
  base_branch: string;
  revision: string;
}

export interface RunnerPhaseExecutionResult {
  phase:
    | "dependency_install"
    | "typecheck"
    | "backend_tests"
    | "frontend_tests"
    | "build"
    | "playwright_e2e"
    | "researcher_acceptance";
  status: "pass" | "fail" | "skipped";
  passed?: number;
  failed?: number;
  errors?: string[];
}

export interface RunnerExecutionResult {
  provider: "runner";
  performed: true;
  tool: "run_tests";
  branch: string;
  revision: string;
  tested_commit_sha: string;
  runner_profile: "poc-default";
  status: "pass" | "fail";
  phases: RunnerPhaseExecutionResult[];
  log_reference?: string;
}

export type ExecutionResult =
  | MockExecutionResult
  | GiteaReadFileExecutionResult
  | GiteaCreateBranchExecutionResult
  | GiteaCreateFileExecutionResult
  | GiteaUpdateFileExecutionResult
  | GiteaCreatePullRequestExecutionResult
  | RunnerExecutionResult;

export interface ExecutionPort {
  readonly provider: "mock" | "gitea";
  providerFor?(record: PreparedRequestRecord): "mock" | "gitea" | "runner";
  execute(record: PreparedRequestRecord): Promise<ExecutionResult>;
}

export interface ExecuteAuthorizationResponse {
  request_id: string;
  decision: "allow";
  verified_delegation: VerifiedDelegation;
  policy: PolicyDecision;
  execution: ExecutionResult;
}

export interface PolicyInput {
  request_id: string;
  task_id: string;
  agent_role: AgentRole;
  tool: ToolName;
  arguments: Record<string, unknown>;
  required_permission: Permission;
  repository: GatewayRepositoryConfig;
  verified_delegation: {
    presenter_id: string;
    credential_id: string;
    issuer_id: string;
    hierarchy_depth: number;
  };
}

export interface PolicyDecision {
  allow: boolean;
  policy_version: string;
}

export interface PolicyPort {
  evaluate(input: PolicyInput): Promise<PolicyDecision>;
}
