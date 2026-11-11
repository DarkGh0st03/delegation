/**
 * Per-repository policy PARAMETERS chosen by the Engineer.
 *
 * The Engineer edits data, never Rego source. Default for any repository:
 * its default branch is protected, agents work only on a fresh branch with
 * a fixed prefix, sensitive paths are off-limits and agents never merge.
 * These parameters are later published to OPA as a data document; the
 * Rego rules that consume them are a separate, reviewed artifact.
 */
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/u;
const PREFIX = /^[a-z0-9][a-z0-9._-]{0,30}\/$/u;
const PROFILE = /^[a-z0-9][a-z0-9-]{0,40}$/u;

export const DEFAULT_FORBIDDEN_PATHS = Object.freeze([".github/", "security/"]);

export function defaultPolicy(repository) {
  return {
    version: 1,
    repository: {owner: repository.owner, name: repository.name},
    base_branch: repository.default_branch,
    protected_branches: [repository.default_branch],
    work_branch_prefix: "agent/",
    forbidden_path_prefixes: [...DEFAULT_FORBIDDEN_PATHS],
    runner_profile: "poc-default",
    allow_pull_request: true,
    agents_may_merge: false
  };
}

function safeBranch(value) {
  return typeof value === "string" && BRANCH.test(value) && !value.includes("..") &&
    !value.includes("//") && !value.endsWith("/") && !value.endsWith(".lock");
}

function safePathPrefix(value) {
  if (typeof value !== "string" || !value || value.length > 200) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("%")) return false;
  return value.split("/").every((segment, i, all) =>
    (segment === "" && i === all.length - 1) ||
    (segment !== "" && segment !== "." && segment !== ".."));
}

/** Strict validation: unknown fields and weakening of fixed rules are refused. */
export function validatePolicy(raw, repository) {
  const allowed = ["version", "repository", "base_branch", "protected_branches",
    "work_branch_prefix", "forbidden_path_prefixes", "runner_profile",
    "allow_pull_request", "agents_may_merge"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).some(k => !allowed.includes(k)))
    throw Error("Policy contains unknown fields");
  if (raw.version !== 1) throw Error("Unsupported policy version");
  if (raw.repository?.owner !== repository.owner || raw.repository?.name !== repository.name)
    throw Error("Policy belongs to another repository");
  if (raw.base_branch !== repository.default_branch)
    throw Error("Base branch must be the repository default branch");
  if (!Array.isArray(raw.protected_branches) || raw.protected_branches.length > 16 ||
      !raw.protected_branches.every(safeBranch) ||
      !raw.protected_branches.includes(repository.default_branch) ||
      new Set(raw.protected_branches).size !== raw.protected_branches.length)
    throw Error("Protected branches must be valid and include the default branch");
  if (typeof raw.work_branch_prefix !== "string" || !PREFIX.test(raw.work_branch_prefix) ||
      raw.protected_branches.some(b => b.startsWith(raw.work_branch_prefix)))
    throw Error("Work branch prefix must look like 'agent/' and not match a protected branch");
  if (!Array.isArray(raw.forbidden_path_prefixes) || raw.forbidden_path_prefixes.length > 32 ||
      !raw.forbidden_path_prefixes.every(safePathPrefix))
    throw Error("Forbidden paths must be relative repository paths");
  if (typeof raw.runner_profile !== "string" || !PROFILE.test(raw.runner_profile))
    throw Error("Invalid runner profile");
  if (typeof raw.allow_pull_request !== "boolean") throw Error("allow_pull_request must be boolean");
  if (raw.agents_may_merge !== false) throw Error("Agents can never merge");
  return {
    version: 1,
    repository: {owner: repository.owner, name: repository.name},
    base_branch: raw.base_branch,
    protected_branches: [...raw.protected_branches],
    work_branch_prefix: raw.work_branch_prefix,
    forbidden_path_prefixes: [...raw.forbidden_path_prefixes],
    runner_profile: raw.runner_profile,
    allow_pull_request: raw.allow_pull_request,
    agents_may_merge: false
  };
}

/** Canonical repository URI used by the Gateway and by OPA. */
export const GITEA_AUTHORITY = "gitea.local";
export function repositoryUri(owner, name) {
  return `gitea://${GITEA_AUTHORITY}/${owner}/${name}`;
}

/** The OPA data document for one validated policy (no metadata). */
export function toOpaRepositoryConfig(policy) {
  return {
    base_branch: policy.base_branch,
    protected_branches: [...policy.protected_branches],
    work_branch_prefix: policy.work_branch_prefix,
    forbidden_path_prefixes: [...policy.forbidden_path_prefixes],
    runner_profile: policy.runner_profile,
    allow_pull_request: policy.allow_pull_request
  };
}
