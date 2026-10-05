import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryAuditSink,
  InMemoryRequestStore,
  prepareAuthorization
} from "../src/prepare.ts";

const config = {
  audience: "cloud-access-gateway",
  request_ttl_ms: 120_000,
  repository: {
    authority: "gitea.local",
    owner: "thesis",
    repository: "iam-console-poc"
  }
};

test("prepare binds task, role, tool arguments, permission, audience and challenge", () => {
  const store = new InMemoryRequestStore();
  const audit = new InMemoryAuditSink();

  const response = prepareAuthorization(
    {
      task_id: "task-backend-1",
      agent_role: "backend",
      tool: "update_file",
      arguments: {
        branch: "feature/account-suspension",
        path: "apps/backend/src/users/user.service.ts",
        content: "updated source"
      }
    },
    config,
    {
      store,
      audit,
      nowMs: () => 1_800_000_000_000,
      durationNowMs: (() => {
        const values = [10, 12.5];
        return () => values.shift() ?? 12.5;
      })(),
      requestId: () => "req-fixed",
      challenge: () => "challenge-fixed"
    }
  );

  assert.deepEqual(response, {
    request_id: "req-fixed",
    audience: "cloud-access-gateway",
    challenge: "challenge-fixed",
    required_permission: {
      resource:
        "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",
      operation: "update_file"
    },
    expires_at: new Date(1_800_000_120_000).toISOString()
  });

  const record = store.get("req-fixed");
  assert.ok(record);
  assert.equal(record.task_id, "task-backend-1");
  assert.equal(record.agent_role, "backend");
  assert.equal(record.request.tool, "update_file");
  assert.equal(record.consumed, false);
  assert.match(record.request_fingerprint, /^[0-9a-f]{64}$/);

  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].event, "authorization_prepared");
  assert.equal(audit.events[0].prepare_ms, 2.5);
  assert.equal(audit.events[0].resource_uri, response.required_permission.resource);
});

test("prepare generates independent one-time bindings for repeated tool requests", () => {
  const store = new InMemoryRequestStore();
  const audit = new InMemoryAuditSink();
  let counter = 0;

  const deps = {
    store,
    audit,
    nowMs: () => 1_800_000_000_000,
    durationNowMs: () => 1,
    requestId: () => `req-${++counter}`,
    challenge: () => `challenge-${counter}`
  };

  const input = {
    task_id: "task-test-1",
    agent_role: "test",
    tool: "run_tests",
    arguments: { branch: "feature/account-suspension" }
  };

  const first = prepareAuthorization(input, config, deps);
  const second = prepareAuthorization(input, config, deps);

  assert.notEqual(first.request_id, second.request_id);
  assert.notEqual(first.challenge, second.challenge);
  assert.equal(store.size(), 2);
  assert.equal(
    store.get(first.request_id)?.request_fingerprint,
    store.get(second.request_id)?.request_fingerprint
  );
});
