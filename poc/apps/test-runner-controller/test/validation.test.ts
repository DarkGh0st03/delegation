import {IAM_CONSOLE_PROJECT_PROFILE,projectProfileDigest} from "../../../packages/plan-contracts/src/project-profile.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { validateRunnerRunRequest } from "../src/validation.ts";

const config = {
  repository: "gitea://gitea.local/thesis/iam-console-poc",
  branch: "feature/account-suspension"
};

const valid = {
  request_id: "req-run-1",
  repository: config.repository,
  branch: config.branch,
  commit_sha: "a".repeat(40),
  profile: "poc-default",
  project_profile: IAM_CONSOLE_PROJECT_PROFILE,
  project_profile_sha256: projectProfileDigest(IAM_CONSOLE_PROJECT_PROFILE)
};

test("Runner contract accepts only the frozen repository, branch, exact SHA and profile", () => {
  assert.deepEqual(validateRunnerRunRequest(valid, config), valid);
});

test("Runner contract rejects caller-controlled command and shell fields", () => {
  assert.throws(
    () => validateRunnerRunRequest({ ...valid, command: "rm -rf /" }, config),
    /Unexpected field: command/u
  );
  assert.throws(
    () => validateRunnerRunRequest({ ...valid, shell: "bash" }, config),
    /Unexpected field: shell/u
  );
});

test("Runner contract rejects moving refs, foreign repositories and profiles", () => {
  assert.throws(
    () => validateRunnerRunRequest({ ...valid, commit_sha: "feature/account-suspension" }, config),
    /commit_sha/u
  );
  assert.throws(
    () => validateRunnerRunRequest({ ...valid, repository: "gitea://other/repo" }, config),
    /repository/u
  );
  assert.throws(
    () => validateRunnerRunRequest({ ...valid, branch: "main" }, config),
    /branch/u
  );
  assert.throws(
    () => validateRunnerRunRequest({ ...valid, profile: "custom-shell" }, config),
    /profile/u
  );
});

test("Runner branch prefix accepts per-session branches and nothing else", () => {
  const prefixed = { ...config, branch_prefix: "feature/" };
  assert.equal(validateRunnerRunRequest({ ...valid, branch: "feature/s-0123456789ab" }, prefixed).branch,
    "feature/s-0123456789ab");
  for (const branch of ["main", "feature/", "feature/a/b", "feature/../main", "feature/x.lock",
    "featurex/s-1", "agent/s-1"]) {
    assert.throws(() => validateRunnerRunRequest({ ...valid, branch }, prefixed), /branch/u, branch);
  }
});

test("Runner runs only the Engineer-approved profile it was sent, bound by digest", () => {
  assert.throws(() => validateRunnerRunRequest({ ...valid, project_profile_sha256: "0".repeat(64) }, config),
    /does not match the project profile/u);
  const weakened = structuredClone(IAM_CONSOLE_PROJECT_PROFILE) as {phases: {command: string}[]};
  weakened.phases[2].command = "true";
  assert.throws(() => validateRunnerRunRequest({ ...valid, project_profile: weakened }, config),
    /does not match the project profile/u, "a changed command no longer matches the signed digest");
  assert.throws(() => validateRunnerRunRequest({ ...valid, project_profile: {version: 1} }, config),
    /Invalid project profile/u);
  const { project_profile: _omitted, ...missing } = valid;
  assert.throws(() => validateRunnerRunRequest(missing, config), /Missing required field: project_profile/u);
});

test("an organization-wide Runner accepts every repository of that organization only", () => {
  const org = { ...config, repository_prefix: "gitea://gitea.local/thesis/" };
  const other = { ...valid, repository: "gitea://gitea.local/thesis/another-project" };
  assert.equal(validateRunnerRunRequest(other, org).repository, other.repository);
  for (const repository of ["gitea://gitea.local/other-org/x", "gitea://gitea.local/thesis/a/b",
    "gitea://gitea.local/thesis/..", "gitea://gitea.local/thesis/"])
    assert.throws(() => validateRunnerRunRequest({ ...valid, repository }, org), /outside/u, repository);
  assert.throws(() => validateRunnerRunRequest(other, config), /outside/u);
});
