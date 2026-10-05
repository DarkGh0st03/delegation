import assert from "node:assert/strict";
import test from "node:test";
import { buildPolicyInput } from "../src/policy-input.ts";
import type { PreparedRequestRecord, VerifiedDelegation } from "../src/types.ts";

const repository = {
  authority: "gitea.local",
  owner: "thesis",
  repository: "iam-console-poc"
};

const verified: VerifiedDelegation = {
  presenter_id: "did:thesis:backend-agent",
  credential_id: "urn:credential:backend",
  issuer_id: "did:thesis:orchestrator",
  permissions: [
    {
      resource:
        "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",
      operation: "update_file"
    }
  ],
  hierarchy_depth: 1,
  expiration: "999999999999999999"
};

test("policy input is built from server state and strips source content", () => {
  const record: PreparedRequestRecord = {
    request_id: "req-1",
    task_id: "task-1",
    agent_role: "backend",
    request: {
      tool: "update_file",
      arguments: {
        branch: "feature/account-suspension",
        path: "apps/backend/src/users/user.service.ts",
        content: "sensitive source body"
      }
    },
    required_permission: verified.permissions[0],
    audience: "cloud-access-gateway",
    challenge: "challenge",
    request_fingerprint: "fingerprint",
    created_at_ms: 1,
    expires_at_ms: 2,
    consumed: true
  };

  const input = buildPolicyInput(record, repository, verified);

  assert.deepEqual(input.arguments, {
    branch: "feature/account-suspension",
    path: "apps/backend/src/users/user.service.ts"
  });
  assert.equal("content" in input.arguments, false);
  assert.deepEqual(input.repository, repository);
  assert.deepEqual(input.verified_delegation, {
    presenter_id: verified.presenter_id,
    credential_id: verified.credential_id,
    issuer_id: verified.issuer_id,
    hierarchy_depth: 1
  });
});

test("pull request policy input omits title and body", () => {
  const record: PreparedRequestRecord = {
    request_id: "req-pr",
    task_id: "task-pr",
    agent_role: "orchestrator",
    request: {
      tool: "create_pull_request",
      arguments: {
        head_branch: "feature/account-suspension",
        base_branch: "main",
        title: "Sensitive title",
        body: "Sensitive description"
      }
    },
    required_permission: {
      resource: "gitea://gitea.local/thesis/iam-console-poc",
      operation: "create_pull_request"
    },
    audience: "cloud-access-gateway",
    challenge: "challenge",
    request_fingerprint: "fingerprint",
    created_at_ms: 1,
    expires_at_ms: 2,
    consumed: true
  };

  const input = buildPolicyInput(record, repository, verified);
  assert.deepEqual(input.arguments, {
    head_branch: "feature/account-suspension",
    base_branch: "main"
  });
});
