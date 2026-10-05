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
  provider_ms: number;
  total_ms: number;
  vp_size_bytes: number;
  chain_depth?: number;
  disclosed_permission_count?: number;
  provider: "mock";
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

export interface ExecutionPort {
  execute(record: PreparedRequestRecord): Promise<MockExecutionResult>;
}

export interface ExecuteAuthorizationResponse {
  request_id: string;
  decision: "allow";
  verified_delegation: VerifiedDelegation;
  execution: MockExecutionResult;
}
