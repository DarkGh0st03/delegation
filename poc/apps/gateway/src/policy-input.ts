import type {
  GatewayRepositoryConfig,
  PolicyInput,
  PreparedRequestRecord,
  VerifiedDelegation
} from "./types.ts";

function policyArguments(record: PreparedRequestRecord): Record<string, unknown> {
  switch (record.request.tool) {
    case "read_file":
      return {
        branch: record.request.arguments.branch,
        path: record.request.arguments.path
      };
    case "update_file":
    case "create_file":
      return {
        branch: record.request.arguments.branch,
        path: record.request.arguments.path
      };
    case "create_branch":
      return {
        base_branch: record.request.arguments.base_branch,
        branch: record.request.arguments.branch
      };
    case "create_pull_request":
      return {
        head_branch: record.request.arguments.head_branch,
        base_branch: record.request.arguments.base_branch
      };
    case "run_tests":
      return {
        branch: record.request.arguments.branch,
        profile: record.request.arguments.profile
      };
  }
}

export function buildPolicyInput(
  record: PreparedRequestRecord,
  repository: GatewayRepositoryConfig,
  verified: VerifiedDelegation
): PolicyInput {
  return {
    request_id: record.request_id,
    task_id: record.task_id,
    agent_role: record.agent_role,
    tool: record.request.tool,
    arguments: policyArguments(record),
    required_permission: record.required_permission,
    repository: {
      authority: repository.authority,
      owner: repository.owner,
      repository: repository.repository
    },
    verified_delegation: {
      presenter_id: verified.presenter_id,
      credential_id: verified.credential_id,
      issuer_id: verified.issuer_id,
      hierarchy_depth: verified.hierarchy_depth
    }
  };
}
