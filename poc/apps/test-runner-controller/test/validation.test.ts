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
  profile: "poc-default"
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
