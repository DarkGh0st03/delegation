import assert from "node:assert/strict";
import test from "node:test";
import {
  VerificationRejectedError,
  VerificationUnavailableError
} from "../src/errors.ts";
import { executeAuthorization } from "../src/execute.ts";
import { MockExecutor } from "../src/mock-executor.ts";
import {
  InMemoryAuditSink,
  InMemoryRequestStore,
  prepareAuthorization
} from "../src/prepare.ts";
import type {
  VerificationRequest,
  VerifiedDelegation,
  VerifierPort
} from "../src/types.ts";

const config = {
  audience: "cloud-access-gateway",
  request_ttl_ms: 120_000,
  repository: {
    authority: "gitea.local",
    owner: "thesis",
    repository: "iam-console-poc"
  }
};

function prepared(now = 1_800_000_000_000) {
  const store = new InMemoryRequestStore();
  const audit = new InMemoryAuditSink();
  const response = prepareAuthorization(
    {
      task_id: "task-backend-1",
      agent_role: "backend",
      tool: "read_file",
      arguments: {
        branch: "feature/account-suspension",
        path: "apps/backend/src/users/user.service.ts"
      }
    },
    config,
    {
      store,
      audit,
      nowMs: () => now,
      durationNowMs: () => 1,
      requestId: () => "req-1",
      challenge: () => "challenge-1"
    }
  );
  return { store, audit, response, now };
}

class SuccessVerifier implements VerifierPort {
  calls: VerificationRequest[] = [];

  async verify(request: VerificationRequest): Promise<VerifiedDelegation> {
    this.calls.push(request);
    return {
      presenter_id: "did:thesis:backend-agent",
      credential_id: "urn:credential:backend",
      issuer_id: "did:thesis:orchestrator",
      permissions: [request.required_permission],
      hierarchy_depth: 1,
      expiration: "1800000120000000000000"
    };
  }
}

test("execute binds the stored role, challenge and permission before mock execution", async () => {
  const { store, audit, response, now } = prepared();
  const verifier = new SuccessVerifier();
  const executor = new MockExecutor();

  const result = await executeAuthorization(
    { request_id: response.request_id, signed_vp: "signed.jwt.value" },
    { store, audit, verifier, executor, nowMs: () => now + 1000, durationNowMs: () => 10 }
  );

  assert.equal(result.decision, "allow");
  assert.equal(executor.callCount, 1);
  assert.equal(result.execution.performed, false);
  assert.equal(verifier.calls.length, 1);
  assert.equal(verifier.calls[0].presenter, "backend");
  assert.equal(verifier.calls[0].audience, response.audience);
  assert.equal(verifier.calls[0].challenge, response.challenge);
  assert.deepEqual(verifier.calls[0].required_permission, response.required_permission);

  const event = audit.events.at(-1);
  assert.equal(event?.event, "authorization_executed");
  if (event?.event === "authorization_executed") {
    assert.equal(event.decision, "allow");
    assert.equal(event.chain_depth, 1);
    assert.equal(event.disclosed_permission_count, 1);
  }
});

test("prepared request is one-shot and replay is rejected before verification", async () => {
  const { store, audit, response, now } = prepared();
  const verifier = new SuccessVerifier();
  const executor = new MockExecutor();
  const deps = { store, audit, verifier, executor, nowMs: () => now + 1, durationNowMs: () => 1 };

  await executeAuthorization(
    { request_id: response.request_id, signed_vp: "signed.jwt.value" },
    deps
  );

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "signed.jwt.value" },
      deps
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "replay_detected"
  );

  assert.equal(verifier.calls.length, 1);
  assert.equal(executor.callCount, 1);
});

test("expired prepare request fails closed without invoking verifier or executor", async () => {
  const { store, audit, response, now } = prepared();
  const verifier = new SuccessVerifier();
  const executor = new MockExecutor();

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "signed.jwt.value" },
      {
        store,
        audit,
        verifier,
        executor,
        nowMs: () => now + 120_000,
        durationNowMs: () => 1
      }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "expired_request"
  );

  assert.equal(verifier.calls.length, 0);
  assert.equal(executor.callCount, 0);
});

test("verification rejection prevents provider execution", async () => {
  const { store, audit, response, now } = prepared();
  const verifier: VerifierPort = {
    async verify() {
      throw new VerificationRejectedError("bad proof");
    }
  };
  const executor = new MockExecutor();

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "bad.jwt" },
      { store, audit, verifier, executor, nowMs: () => now + 1, durationNowMs: () => 1 }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "verification_rejected"
  );

  assert.equal(executor.callCount, 0);
});

test("verifier outage fails closed and prevents provider execution", async () => {
  const { store, audit, response, now } = prepared();
  const verifier: VerifierPort = {
    async verify() {
      throw new VerificationUnavailableError("offline");
    }
  };
  const executor = new MockExecutor();

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "signed.jwt.value" },
      { store, audit, verifier, executor, nowMs: () => now + 1, durationNowMs: () => 1 }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "verifier_unavailable"
  );

  assert.equal(executor.callCount, 0);
});
