import {
  AGENT_ROLES,
  TOOL_NAMES,
  type AgentRole,
  type NormalizedToolRequest,
  type PrepareAuthorizationRequest,
  type ToolName
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Unexpected field: ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
}

function string(value: unknown, label: string, options: { allowEmpty?: boolean; max?: number } = {}): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (!options.allowEmpty && value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  if (options.max !== undefined && value.length > options.max) {
    throw new Error(`${label} exceeds maximum length ${options.max}`);
  }
  return value;
}

export function validateBranchName(value: unknown, label = "branch"): string {
  const branch = string(value, label, { max: 255 });

  if (
    branch === "@" ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{") ||
    /[\\\s~^:?*\[\]\x00-\x1f\x7f]/u.test(branch)
  ) {
    throw new Error(`${label} is not a canonical Git branch name`);
  }

  for (const segment of branch.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new Error(`${label} contains an invalid path segment`);
    }
  }

  return branch;
}

export function validateRepositoryPath(value: unknown): string {
  const path = string(value, "path", { max: 2048 });

  if (path.startsWith("/") || path.endsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error("path must be repository-relative and use forward slashes");
  }

  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\0")
    )
  ) {
    throw new Error("path contains an invalid or traversing segment");
  }

  return segments.join("/");
}

function role(value: unknown): AgentRole {
  if (typeof value !== "string" || !(AGENT_ROLES as readonly string[]).includes(value)) {
    throw new Error("agent_role is not supported");
  }
  return value as AgentRole;
}

function toolName(value: unknown): ToolName {
  if (typeof value !== "string" || !(TOOL_NAMES as readonly string[]).includes(value)) {
    throw new Error("tool is not supported");
  }
  return value as ToolName;
}

function normalizeArguments(tool: ToolName, raw: unknown): NormalizedToolRequest {
  const args = object(raw, "arguments");

  switch (tool) {
    case "read_file": {
      exactKeys(args, ["branch", "path"]);
      return {
        tool,
        arguments: {
          branch: validateBranchName(args.branch),
          path: validateRepositoryPath(args.path)
        }
      };
    }
    case "update_file":
    case "create_file": {
      exactKeys(args, ["branch", "path", "content"]);
      return {
        tool,
        arguments: {
          branch: validateBranchName(args.branch),
          path: validateRepositoryPath(args.path),
          content: string(args.content, "content", { allowEmpty: true, max: 2_000_000 })
        }
      };
    }
    case "create_branch": {
      exactKeys(args, ["base_branch", "branch"]);
      return {
        tool,
        arguments: {
          base_branch: validateBranchName(args.base_branch, "base_branch"),
          branch: validateBranchName(args.branch, "branch")
        }
      };
    }
    case "create_pull_request": {
      exactKeys(args, ["head_branch", "base_branch", "title"], ["body"]);
      const body =
        args.body === undefined
          ? undefined
          : string(args.body, "body", { allowEmpty: true, max: 20_000 });
      return {
        tool,
        arguments: {
          head_branch: validateBranchName(args.head_branch, "head_branch"),
          base_branch: validateBranchName(args.base_branch, "base_branch"),
          title: string(args.title, "title", { max: 512 }),
          ...(body === undefined ? {} : { body })
        }
      };
    }
    case "run_tests": {
      exactKeys(args, ["branch"], ["profile"]);
      const profile = args.profile === undefined ? "poc-default" : string(args.profile, "profile");
      if (profile !== "poc-default") {
        throw new Error("run_tests profile must be poc-default");
      }
      return {
        tool,
        arguments: {
          branch: validateBranchName(args.branch),
          profile
        }
      };
    }
  }
}

export function validatePrepareAuthorizationRequest(raw: unknown): {
  task_id: string;
  agent_role: AgentRole;
  request: NormalizedToolRequest;
} {
  const value = object(raw, "prepare request");
  exactKeys(value, ["task_id", "agent_role", "tool", "arguments"]);

  const tool = toolName(value.tool);
  return {
    task_id: string(value.task_id, "task_id", { max: 256 }),
    agent_role: role(value.agent_role),
    request: normalizeArguments(tool, value.arguments)
  };
}

export function assertNoCallerSuppliedAuthority(raw: PrepareAuthorizationRequest | unknown): void {
  const value = object(raw, "prepare request");
  if ("resource" in value || "resource_uri" in value || "operation" in value || "permission" in value) {
    throw new Error("Authority fields are Gateway-derived and must not be supplied by callers");
  }
}
