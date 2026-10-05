import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_SUSPENSION_BRANCH,
  AccountSuspensionWorkflow,
  validateWorkflowArtifact
} from "../src/index.ts";

const sha = (character: string): string => character.repeat(40);

function artifact(
  role: "backend" | "frontend" | "test",
  revision: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    role,
    summary: `${role} completed assigned task`,
    files_modified:
      role === "backend"
        ? ["apps/backend/src/users/user.service.ts"]
        : role === "frontend"
          ? ["apps/frontend/src/pages/UserDetailPage.tsx"]
          : ["tests/backend/user.service.test.ts"],
    files_created:
      role === "test" ? ["tests/e2e/account-suspension.spec.ts"] : [],
    branch: ACCOUNT_SUSPENSION_BRANCH,
    revision,
    commit_sha: revision,
    test_outcome: role === "test" ? "pass" : "not_run",
    errors: [],
    ...(role === "test"
      ? {
          tested_commit_sha: revision,
          runner_profile: "poc-default",
          project_tests: "pass",
          researcher_acceptance: "pass"
        }
      : {}),
    ...overrides
  };
}

test("Phase 9B workflow advances only in Backend -> Frontend -> Test order", () => {
  const workflow = new AccountSuspensionWorkflow();

  workflow.markBranchReady(sha("a"));
  assert.equal(workflow.state, "branch_ready");

  workflow.recordCompletedTask(artifact("backend", sha("b")));
  assert.equal(workflow.state, "backend_completed");

  workflow.recordCompletedTask(artifact("frontend", sha("c")));
  assert.equal(workflow.state, "frontend_completed");

  workflow.recordCompletedTask(artifact("test", sha("d")));
  assert.equal(workflow.state, "test_completed");

  workflow.markPullRequestCreated({
    number: 42,
    head_revision: sha("d")
  });

  const snapshot = workflow.snapshot();
  assert.equal(snapshot.state, "pr_created");
  assert.equal(snapshot.current_revision, sha("d"));
  assert.deepEqual(snapshot.completed_roles, [
    "backend",
    "frontend",
    "test"
  ]);
  assert.equal(snapshot.pull_request?.number, 42);
});

test("workflow rejects a Frontend Artifact before Backend completion", () => {
  const workflow = new AccountSuspensionWorkflow();
  workflow.markBranchReady(sha("a"));

  assert.throws(
    () => workflow.recordCompletedTask(artifact("frontend", sha("b"))),
    /does not match expected role backend/u
  );
  assert.equal(workflow.state, "branch_ready");
});

test("workflow rejects invalid or inconsistent Artifact revisions", () => {
  assert.throws(
    () =>
      validateWorkflowArtifact(
        artifact("backend", sha("b"), { revision: "not-a-sha" }),
        "backend"
      ),
    /Artifact revision/u
  );

  assert.throws(
    () =>
      validateWorkflowArtifact(
        artifact("backend", sha("b"), { commit_sha: sha("c") }),
        "backend"
      ),
    /same branch head/u
  );
});

test("Test Agent must report a passing outcome before PR gating", () => {
  const workflow = new AccountSuspensionWorkflow();
  workflow.markBranchReady(sha("a"));
  workflow.recordCompletedTask(artifact("backend", sha("b")));
  workflow.recordCompletedTask(artifact("frontend", sha("c")));

  assert.throws(
    () =>
      workflow.recordCompletedTask(
        artifact("test", sha("d"), { test_outcome: "fail" })
      ),
    /not acceptable/u
  );
  assert.equal(workflow.state, "frontend_completed");
});

test("Pull Request checkpoint is blocked before Test completion and on wrong head revision", () => {
  const workflow = new AccountSuspensionWorkflow();
  workflow.markBranchReady(sha("a"));

  assert.throws(
    () =>
      workflow.markPullRequestCreated({
        number: 1,
        head_revision: sha("a")
      }),
    /Cannot create Pull Request checkpoint/u
  );

  workflow.recordCompletedTask(artifact("backend", sha("b")));
  workflow.recordCompletedTask(artifact("frontend", sha("c")));
  workflow.recordCompletedTask(artifact("test", sha("d")));

  assert.throws(
    () =>
      workflow.markPullRequestCreated({
        number: 1,
        head_revision: sha("c")
      }),
    /must match the tested workflow revision/u
  );
  assert.equal(workflow.state, "test_completed");
});

test("failed workflow is terminal and cannot accept later Agent Artifacts", () => {
  const workflow = new AccountSuspensionWorkflow();
  workflow.markBranchReady(sha("a"));
  workflow.fail("Backend task failed");

  assert.equal(workflow.snapshot().failure_reason, "Backend task failed");
  assert.equal(workflow.state, "failed");
  assert.throws(
    () => workflow.recordCompletedTask(artifact("backend", sha("b"))),
    /does not accept/u
  );
});
