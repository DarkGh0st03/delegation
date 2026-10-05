import {
  RUNNER_PROFILE,
  type RunnerContractConfig,
  type RunnerRunRequest
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("runner request must be an object");
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject): void {
  const required = ["request_id", "repository", "branch", "commit_sha", "profile"] as const;
  const allowed = new Set<string>(required);

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

function string(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.length > max) {
    throw new Error(`${label} exceeds maximum length ${max}`);
  }
  return value;
}

export function validateRunnerRunRequest(
  raw: unknown,
  config: RunnerContractConfig
): RunnerRunRequest {
  const value = object(raw);
  exactKeys(value);

  const requestId = string(value.request_id, "request_id", 256);
  const repository = string(value.repository, "repository", 512);
  const branch = string(value.branch, "branch", 255);
  const commitSha = string(value.commit_sha, "commit_sha", 64);
  const profile = string(value.profile, "profile", 64);

  if (repository !== config.repository) {
    throw new Error("repository is outside the controlled Runner repository");
  }
  if (branch !== config.branch) {
    throw new Error("branch is outside the controlled Runner branch");
  }
  if (!/^[0-9a-f]{40}$/u.test(commitSha)) {
    throw new Error("commit_sha must be an exact lowercase SHA-1 commit identifier");
  }
  if (profile !== RUNNER_PROFILE) {
    throw new Error(`profile must be ${RUNNER_PROFILE}`);
  }

  return {
    request_id: requestId,
    repository,
    branch,
    commit_sha: commitSha,
    profile: RUNNER_PROFILE
  };
}
