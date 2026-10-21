import type {
  GatewayRepositoryConfig,
  NormalizedToolRequest,
  Permission
} from "./types.ts";

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export function canonicalRepositoryUri(config: GatewayRepositoryConfig): string {
  const authority = config.authority.trim().toLowerCase();
  if (authority.length === 0 || config.owner.trim().length === 0 || config.repository.trim().length === 0) {
    throw new Error("Repository canonicalization config is incomplete");
  }

  return `gitea://${authority}/${encodeSegment(config.owner)}/${encodeSegment(config.repository)}`;
}

export function canonicalBranchUri(
  config: GatewayRepositoryConfig,
  branch: string
): string {
  return `${canonicalRepositoryUri(config)}/branches/${encodeSegment(branch)}`;
}

/**
 * Directory-scoped permission: a distinct URI from a branch-level operation
 * and from a file permission; root uses the literal /directories suffix.
 */
export function canonicalDirectoryUri(
  config: GatewayRepositoryConfig,
  branch: string,
  path: string
): string {
  const prefix = `${canonicalBranchUri(config, branch)}/directories`;
  return path === "" ? prefix : `${prefix}/${path.split("/").map(encodeSegment).join("/")}`;
}

export function canonicalFileUri(
  config: GatewayRepositoryConfig,
  branch: string,
  path: string
): string {
  const encodedPath = path.split("/").map(encodeSegment).join("/");
  return `${canonicalBranchUri(config, branch)}/files/${encodedPath}`;
}

export function deriveRequiredPermission(
  config: GatewayRepositoryConfig,
  request: NormalizedToolRequest
): Permission {
  switch (request.tool) {
    case "read_repository":
      return {
        resource: canonicalRepositoryUri(config),
        operation: "read_repository"
      };
    case "list_directory":
      return {
        resource: canonicalDirectoryUri(config, request.arguments.branch, request.arguments.path),
        operation: "list_directory"
      };
    case "read_file":
      return {
        resource: canonicalFileUri(config, request.arguments.branch, request.arguments.path),
        operation: "read_file"
      };
    case "update_file":
      return {
        resource: canonicalFileUri(config, request.arguments.branch, request.arguments.path),
        operation: "update_file"
      };
    case "create_file":
      return {
        resource: canonicalFileUri(config, request.arguments.branch, request.arguments.path),
        operation: "create_file"
      };
    case "create_branch":
      return {
        resource: canonicalRepositoryUri(config),
        operation: "create_branch"
      };
    case "create_pull_request":
      return {
        resource: canonicalRepositoryUri(config),
        operation: "create_pull_request"
      };
    case "run_tests":
      return {
        resource: canonicalBranchUri(config, request.arguments.branch),
        operation: "run_tests"
      };
  }
}
