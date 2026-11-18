import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalBranchUri,
  canonicalFileUri,
  canonicalRepositoryUri,
  deriveRequiredPermission
} from "../src/canonical.ts";
import {
  assertNoCallerSuppliedAuthority,
  validatePrepareAuthorizationRequest
} from "../src/validation.ts";

const repository = {
  authority: "gitea.local",
  owner: "thesis",
  repository: "sample-app"
};

test("builds the frozen canonical repository, branch and file URIs", () => {
  assert.equal(
    canonicalRepositoryUri(repository),
    "gitea://gitea.local/thesis/sample-app"
  );
  assert.equal(
    canonicalBranchUri(repository, "feature/sample-change"),
    "gitea://gitea.local/thesis/sample-app/branches/feature%2Fsample-change"
  );
  assert.equal(
    canonicalFileUri(
      repository,
      "feature/sample-change",
      "apps/backend/src/users/user.service.ts"
    ),
    "gitea://gitea.local/thesis/sample-app/branches/feature%2Fsample-change/files/apps/backend/src/users/user.service.ts"
  );
});

test("maps tools to Gateway-derived operations and resource scopes", () => {
  const read = validatePrepareAuthorizationRequest({
    task_id: "task-1",
    agent_role: "backend",
    tool: "read_file",
    arguments: {
      branch: "feature/sample-change",
      path: "apps/backend/src/users/user.service.ts"
    }
  });
  assert.deepEqual(deriveRequiredPermission(repository, read.request), {
    resource:
      "gitea://gitea.local/thesis/sample-app/branches/feature%2Fsample-change/files/apps/backend/src/users/user.service.ts",
    operation: "read_file"
  });

  const createBranch = validatePrepareAuthorizationRequest({
    task_id: "task-2",
    agent_role: "orchestrator",
    tool: "create_branch",
    arguments: { base_branch: "main", branch: "feature/sample-change" }
  });
  assert.deepEqual(deriveRequiredPermission(repository, createBranch.request), {
    resource: "gitea://gitea.local/thesis/sample-app",
    operation: "create_branch"
  });

  const tests = validatePrepareAuthorizationRequest({
    task_id: "task-3",
    agent_role: "test",
    tool: "run_tests",
    arguments: { branch: "feature/sample-change" }
  });
  assert.deepEqual(deriveRequiredPermission(repository, tests.request), {
    resource:
      "gitea://gitea.local/thesis/sample-app/branches/feature%2Fsample-change",
    operation: "run_tests"
  });
});

test("rejects traversal, malformed branches and unknown argument fields", () => {
  assert.throws(() =>
    validatePrepareAuthorizationRequest({
      task_id: "task-1",
      agent_role: "backend",
      tool: "read_file",
      arguments: {
        branch: "feature/sample-change",
        path: "../security/security-config.ts"
      }
    })
  );

  assert.throws(() =>
    validatePrepareAuthorizationRequest({
      task_id: "task-1",
      agent_role: "backend",
      tool: "read_file",
      arguments: {
        branch: "feature//sample-change",
        path: "apps/backend/src/app.ts"
      }
    })
  );

  assert.throws(() =>
    validatePrepareAuthorizationRequest({
      task_id: "task-1",
      agent_role: "backend",
      tool: "read_file",
      arguments: {
        branch: "feature/sample-change",
        path: "apps/backend/src/app.ts",
        operation: "update_file"
      }
    })
  );
});

test("rejects caller-supplied authority fields", () => {
  assert.throws(
    () =>
      assertNoCallerSuppliedAuthority({
        task_id: "task-1",
        agent_role: "backend",
        tool: "read_file",
        arguments: {
          branch: "feature/sample-change",
          path: "apps/backend/src/app.ts"
        },
        resource_uri: "gitea://attacker/repo"
      }),
    /Gateway-derived/
  );
});
