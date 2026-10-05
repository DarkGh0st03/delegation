import assert from "node:assert/strict";
import test from "node:test";
import {
  DC_BACKEND,
  DC_FRONTEND,
  DC_TEST,
  DELEGATION_TEMPLATES,
  ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY,
  ORCHESTRATOR_WORKFLOW_PERMISSIONS,
  POC_REPOSITORY,
  resolveDelegationTemplate,
  templatePermissionKey
} from "../src/index.ts";
import { SPECIALIZED_AGENT_PROFILES } from "@thesis/agent-runtime";
import {
  canonicalBranchUri,
  canonicalFileUri,
  canonicalRepositoryUri
} from "../../../apps/gateway/src/canonical.ts";

const repository = {
  authority: POC_REPOSITORY.authority,
  owner: POC_REPOSITORY.owner,
  repository: POC_REPOSITORY.repository
};

function keys(values: readonly { resource: string; operation: string }[]): string[] {
  return values
    .map((value) => `${value.operation}\u0000${value.resource}`)
    .sort();
}

function file(path: string, operation: "read_file" | "update_file" | "create_file") {
  return {
    resource: canonicalFileUri(repository, POC_REPOSITORY.branch, path),
    operation
  };
}

const expectedBackend = [
  file("packages/shared/src/account-status.ts", "read_file"),
  file("packages/shared/src/account-status.ts", "update_file"),
  file("apps/backend/src/users/user.service.ts", "read_file"),
  file("apps/backend/src/users/user.service.ts", "update_file"),
  file("apps/backend/src/users/user.controller.ts", "read_file"),
  file("apps/backend/src/users/user.controller.ts", "update_file"),
  file("apps/backend/src/users/user.routes.ts", "read_file"),
  file("apps/backend/src/users/user.routes.ts", "update_file"),
  file("apps/backend/src/users/user.model.ts", "read_file"),
  file("apps/backend/src/users/user.repository.ts", "read_file"),
  file("packages/shared/src/user-contracts.ts", "read_file"),
  file("apps/backend/src/app.ts", "read_file")
];

const expectedFrontend = [
  file("apps/frontend/src/api/users-api.ts", "read_file"),
  file("apps/frontend/src/api/users-api.ts", "update_file"),
  file("apps/frontend/src/pages/UserDetailPage.tsx", "read_file"),
  file("apps/frontend/src/pages/UserDetailPage.tsx", "update_file"),
  file("apps/frontend/src/styles.css", "read_file"),
  file("apps/frontend/src/styles.css", "update_file"),
  file("packages/shared/src/account-status.ts", "read_file"),
  file("packages/shared/src/user-contracts.ts", "read_file"),
  file("apps/frontend/src/components/UserStatusBadge.tsx", "read_file")
];

const expectedTest = [
  file("tests/backend/user.service.test.ts", "read_file"),
  file("tests/backend/user.service.test.ts", "update_file"),
  file("tests/backend/user.routes.test.ts", "read_file"),
  file("tests/backend/user.routes.test.ts", "update_file"),
  file("tests/frontend/UserDetailPage.test.tsx", "read_file"),
  file("tests/frontend/UserDetailPage.test.tsx", "update_file"),
  file("tests/e2e/account-suspension.spec.ts", "create_file"),
  file("tests/e2e/user-profile.spec.ts", "read_file"),
  file("packages/shared/src/account-status.ts", "read_file"),
  file("packages/shared/src/user-contracts.ts", "read_file"),
  file("apps/backend/src/users/user.model.ts", "read_file"),
  file("apps/backend/src/users/user.repository.ts", "read_file"),
  file("apps/backend/src/users/user.service.ts", "read_file"),
  file("apps/backend/src/users/user.controller.ts", "read_file"),
  file("apps/backend/src/users/user.routes.ts", "read_file"),
  file("apps/frontend/src/api/users-api.ts", "read_file"),
  file("apps/frontend/src/pages/UserDetailPage.tsx", "read_file"),
  file("apps/frontend/src/styles.css", "read_file"),
  file("apps/frontend/src/components/UserStatusBadge.tsx", "read_file"),
  {
    resource: canonicalBranchUri(repository, POC_REPOSITORY.branch),
    operation: "run_tests"
  }
];

test("DC_Backend exactly matches the frozen permission matrix", () => {
  assert.deepEqual(keys(DC_BACKEND), keys(expectedBackend));
});

test("DC_Frontend exactly matches the frozen permission matrix", () => {
  assert.deepEqual(keys(DC_FRONTEND), keys(expectedFrontend));
});

test("DC_Test exactly matches the frozen permission matrix", () => {
  assert.deepEqual(keys(DC_TEST), keys(expectedTest));
});

test("static permission templates remain aligned with Phase 8B prompt profiles", () => {
  const expectedByRole = {
    backend: expectedBackend,
    frontend: expectedFrontend,
    test: expectedTest
  } as const;

  for (const role of ["backend", "frontend", "test"] as const) {
    assert.deepEqual(keys(DELEGATION_TEMPLATES[role]), keys(expectedByRole[role]));

    const profile = SPECIALIZED_AGENT_PROFILES[role];
    const template = DELEGATION_TEMPLATES[role];

    for (const path of profile.writable_paths) {
      assert.ok(
        template.some(
          (permission) =>
            permission.resource ===
              canonicalFileUri(repository, POC_REPOSITORY.branch, path) &&
            permission.operation === "update_file"
        )
      );
    }

    for (const path of profile.read_only_paths) {
      assert.ok(
        template.some(
          (permission) =>
            permission.resource ===
              canonicalFileUri(repository, POC_REPOSITORY.branch, path) &&
            permission.operation === "read_file"
        )
      );
    }
  }
});

test("Engineer root authority is the exact union of all child templates plus Orchestrator workflow authority", () => {
  const expected = new Map<string, { resource: string; operation: string }>();
  for (const permission of [
    ...expectedBackend,
    ...expectedFrontend,
    ...expectedTest,
    {
      resource: canonicalRepositoryUri(repository),
      operation: "create_branch"
    },
    {
      resource: canonicalRepositoryUri(repository),
      operation: "create_pull_request"
    }
  ]) {
    expected.set(
      `${permission.operation}\u0000${permission.resource}`,
      permission
    );
  }

  assert.deepEqual(
    keys(ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY),
    [...expected.keys()].sort()
  );
  assert.deepEqual(
    keys(ORCHESTRATOR_WORKFLOW_PERMISSIONS),
    keys([
      {
        resource: canonicalRepositoryUri(repository),
        operation: "create_branch"
      },
      {
        resource: canonicalRepositoryUri(repository),
        operation: "create_pull_request"
      }
    ])
  );
  assert.equal(
    ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY.some(
      (permission) => permission.operation === ("merge_pull_request" as never)
    ),
    false
  );
});

test("role and skill selections map to immutable deterministic templates", () => {
  const byRole = resolveDelegationTemplate({ role: "backend" });
  const bySkill = resolveDelegationTemplate({ skill: "backend-account-lifecycle" });

  assert.equal(byRole.role, "backend");
  assert.equal(bySkill.role, "backend");
  assert.deepEqual(keys(byRole.permissions), keys(DC_BACKEND));
  assert.deepEqual(keys(bySkill.permissions), keys(DC_BACKEND));

  byRole.permissions[0]!.resource = "gitea://invalid/escalation";
  assert.notEqual(
    templatePermissionKey(DC_BACKEND[0]!),
    templatePermissionKey(byRole.permissions[0]!)
  );
});

test("LLM-style selection cannot inject arbitrary permissions", () => {
  assert.throws(
    () =>
      resolveDelegationTemplate({
        role: "backend",
        permissions: [
          {
            resource: canonicalRepositoryUri(repository),
            operation: "create_pull_request"
          }
        ]
      }),
    /unsupported fields/u
  );

  assert.throws(
    () => resolveDelegationTemplate({ role: "backend", skill: "backend-account-lifecycle" }),
    /exactly one/u
  );
});
