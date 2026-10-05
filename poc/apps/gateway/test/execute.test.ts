import assert from "node:assert/strict";
import test from "node:test";
import {
  PolicyUnavailableError,
  ProviderUnavailableError,
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
  ExecutionPort,
  PolicyDecision,
  PolicyInput,
  PolicyPort,
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

class FixedPolicy implements PolicyPort {
  calls: PolicyInput[] = [];
  readonly decision: PolicyDecision;

  constructor(
    decision: PolicyDecision = {
      allow: true,
      policy_version: "phase4a-v1"
    }
  ) {
    this.decision = decision;
  }

  async evaluate(input: PolicyInput): Promise<PolicyDecision> {
    this.calls.push(input);
    return this.decision;
  }
}

function deps(
  store: InMemoryRequestStore,
  audit: InMemoryAuditSink,
  verifier: VerifierPort,
  policy: PolicyPort,
  executor: ExecutionPort,
  now: number
) {
  return {
    store,
    audit,
    verifier,
    policy,
    repository: config.repository,
    executor,
    nowMs: () => now + 1,
    durationNowMs: () => 1
  };
}

test("execute verifies, evaluates OPA and only then mock-executes", async () => {
  const { store, audit, response, now } = prepared();
  const verifier = new SuccessVerifier();
  const policy = new FixedPolicy();
  const executor = new MockExecutor();

  const result = await executeAuthorization(
    { request_id: response.request_id, signed_vp: "signed.jwt.value" },
    deps(store, audit, verifier, policy, executor, now)
  );

  assert.equal(result.decision, "allow");
  assert.equal(result.policy.allow, true);
  assert.equal(result.policy.policy_version, "phase4a-v1");
  assert.equal(executor.callCount, 1);
  assert.equal(policy.calls.length, 1);
  assert.equal(policy.calls[0].request_id, response.request_id);
  assert.deepEqual(policy.calls[0].required_permission, response.required_permission);

  const event = audit.events.at(-1);
  assert.equal(event?.event, "authorization_executed");
  if (event?.event === "authorization_executed") {
    assert.equal(event.decision, "allow");
    assert.equal(event.policy_decision, "allow");
    assert.equal(event.policy_version, "phase4a-v1");
    assert.equal(event.chain_depth, 1);
  }
});

test("prepared request is one-shot and replay stops before verifier and OPA", async () => {
  const { store, audit, response, now } = prepared();
  const verifier = new SuccessVerifier();
  const policy = new FixedPolicy();
  const executor = new MockExecutor();
  const dependencies = deps(store, audit, verifier, policy, executor, now);

  await executeAuthorization(
    { request_id: response.request_id, signed_vp: "signed.jwt.value" },
    dependencies
  );

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "signed.jwt.value" },
      dependencies
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "replay_detected"
  );

  assert.equal(verifier.calls.length, 1);
  assert.equal(policy.calls.length, 1);
  assert.equal(executor.callCount, 1);
});

test("verification rejection prevents OPA and provider execution", async () => {
  const { store, audit, response, now } = prepared();
  const verifier: VerifierPort = {
    async verify() {
      throw new VerificationRejectedError("bad proof");
    }
  };
  const policy = new FixedPolicy();
  const executor = new MockExecutor();

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "bad.jwt" },
      deps(store, audit, verifier, policy, executor, now)
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "verification_rejected"
  );

  assert.equal(policy.calls.length, 0);
  assert.equal(executor.callCount, 0);
});

test("verifier outage fails closed before OPA", async () => {
  const { store, audit, response, now } = prepared();
  const verifier: VerifierPort = {
    async verify() {
      throw new VerificationUnavailableError("offline");
    }
  };
  const policy = new FixedPolicy();
  const executor = new MockExecutor();

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "signed.jwt.value" },
      deps(store, audit, verifier, policy, executor, now)
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "verifier_unavailable"
  );

  assert.equal(policy.calls.length, 0);
  assert.equal(executor.callCount, 0);
});

test("OPA deny prevents provider execution", async () => {
  const { store, audit, response, now } = prepared();
  const verifier = new SuccessVerifier();
  const policy = new FixedPolicy({
    allow: false,
    policy_version: "phase4a-v1"
  });
  const executor = new MockExecutor();

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "signed.jwt.value" },
      deps(store, audit, verifier, policy, executor, now)
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "policy_denied"
  );

  assert.equal(policy.calls.length, 1);
  assert.equal(executor.callCount, 0);
  const event = audit.events.at(-1);
  if (event?.event === "authorization_executed") {
    assert.equal(event.policy_decision, "deny");
    assert.equal(event.provider_ms, 0);
  }
});

test("OPA outage fails closed and prevents provider execution", async () => {
  const { store, audit, response, now } = prepared();
  const verifier = new SuccessVerifier();
  const policy: PolicyPort = {
    async evaluate() {
      throw new PolicyUnavailableError("OPA offline");
    }
  };
  const executor = new MockExecutor();

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "signed.jwt.value" },
      deps(store, audit, verifier, policy, executor, now)
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "policy_unavailable"
  );

  assert.equal(executor.callCount, 0);
  const event = audit.events.at(-1);
  if (event?.event === "authorization_executed") {
    assert.equal(event.policy_decision, "error");
    assert.equal(event.decision, "deny");
  }
});


test("provider outage is reported after authorization and preserves policy allow", async () => {
  const { store, audit, response, now } = prepared();
  const verifier = new SuccessVerifier();
  const policy = new FixedPolicy();
  const executor: ExecutionPort = {
    provider: "gitea",
    async execute() {
      throw new ProviderUnavailableError("Gitea offline");
    }
  };

  await assert.rejects(
    executeAuthorization(
      { request_id: response.request_id, signed_vp: "signed.jwt.value" },
      deps(store, audit, verifier, policy, executor, now)
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "provider_unavailable"
  );

  assert.equal(policy.calls.length, 1);
  const event = audit.events.at(-1);
  if (event?.event === "authorization_executed") {
    assert.equal(event.decision, "allow");
    assert.equal(event.policy_decision, "allow");
    assert.equal(event.provider, "gitea");
    assert.equal(event.provider_result, "error");
    assert.equal(event.reason, "provider_unavailable");
  }
});
