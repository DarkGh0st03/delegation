import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryCompositeStore,
  prepareReadCompositeAuthorization,
  executeReadCompositeAuthorization
} from "../src/composite-authorization.ts";
import { InMemoryAuditSink } from "../src/prepare.ts";
import { GatewayRuntime } from "../src/runtime.ts";
import { VerificationRejectedError } from "../src/errors.ts";
import type { TrustedPlanningRevisions } from "../src/planning-revisions.ts";
import type {
  ExecutionPort, MultipleVerificationRequest, NormalizedToolRequest, PolicyInput,
  PolicyPort, PreparedRequestRecord, VerifiedDelegation, VerifierPort
} from "../src/types.ts";

// Planning read bundles: the Planner reads several files of the pinned
// commit with ONE signed VP. Rust verification and OPA decide every read
// before the first provider call.
const config = {
  audience: "cloud-access-gateway",
  request_ttl_ms: 120_000,
  repository: { authority: "gitea.local", owner: "thesis", repository: "iam-console-poc" }
};
const now = 1_800_000_000_000;
const PINNED = "a".repeat(40);
const reads = {
  task_id: "planning-task", agent_role: "orchestrator",
  actions: [
    { tool: "read_file", arguments: { branch: "main", path: "src/one.ts" } },
    { tool: "read_file", arguments: { branch: "main", path: "src/two.ts" } }
  ]
};
const authorization = (request_id: string) => ({ request_id, signed_vp: "signed.jwt.payload" });

class Verifier implements VerifierPort {
  readonly calls: MultipleVerificationRequest[] = [];
  reject = false;
  async verify(): Promise<VerifiedDelegation> { throw Error("single verification must not be used"); }
  async verifyMultiple(input: MultipleVerificationRequest): Promise<VerifiedDelegation> {
    this.calls.push(input);
    if (this.reject) throw new VerificationRejectedError("bad VP");
    return {
      presenter_id: "did:thesis:orchestrator", credential_id: "urn:credential:planning",
      issuer_id: "did:thesis:engineer", permissions: input.required_permissions,
      hierarchy_depth: 0, expiration: "9999999999999999999999"
    };
  }
}
class Policy implements PolicyPort {
  readonly calls: PolicyInput[] = [];
  decision: (index: number) => boolean = () => true;
  async evaluate(input: PolicyInput) {
    this.calls.push(input);
    return { allow: this.decision(this.calls.length), policy_version: "offline-policy-v1" };
  }
}
/** Active Planning session pinned to one immutable revision. */
function planning(active = { value: true }) {
  return {
    authorizePrepare(_task: string, role: string, request: NormalizedToolRequest) {
      return active.value && role === "orchestrator" && "branch" in request.arguments &&
        request.arguments.branch === "main" ? PINNED : undefined;
    },
    assertActiveForExecution(record: PreparedRequestRecord) {
      if (!active.value || record.pinned_revision !== PINNED) throw Error("Planning retired");
    }
  } as unknown as TrustedPlanningRevisions;
}
function reader(calls: PreparedRequestRecord[]): ExecutionPort {
  return {
    provider: "gitea",
    async execute(record) {
      calls.push(record);
      assert.equal(record.pinned_revision, PINNED);
      const req = record.request;
      assert.equal(req.tool, "read_file");
      return { provider: "gitea", performed: true, tool: "read_file", branch: "main",
        path: req.arguments.path, revision: PINNED, blob_sha: "c".repeat(40),
        last_commit_sha: PINNED, size: 5, encoding: "utf-8", content: "hello" };
    }
  } as ExecutionPort;
}
function deps(over: Record<string, unknown> = {}) {
  let counter = 0;
  return {
    config, store: new InMemoryCompositeStore(), audit: new InMemoryAuditSink(),
    verifier: new Verifier(), policy: new Policy(), planningRevisions: planning(),
    executor: reader([]), nowMs: () => now,
    requestId: () => "c-" + (++counter), challenge: () => "challenge-" + counter,
    ...over
  } as Parameters<typeof prepareReadCompositeAuthorization>[1];
}
async function rejected(p: Promise<unknown>, status: number, code: string) {
  await assert.rejects(p, (error: unknown) =>
    error instanceof Error && "statusCode" in error && "code" in error &&
    error.statusCode === status && error.code === code);
}

test("Planning read bundle runs two pinned reads after one multi-VP and two OPA decisions", async () => {
  const verifier = new Verifier(), policy = new Policy(), calls: PreparedRequestRecord[] = [];
  const audit = new InMemoryAuditSink();
  const runtime = new GatewayRuntime({
    bind_host: "127.0.0.1", bind_port: 0, prepare: config, verifier_mode: "core-rust",
    opa_url: "http://unused", opa_timeout_ms: 1000, provider_mode: "gitea", gitea_timeout_ms: 1000
  }, { verifier, policy, executor: reader(calls), audit, planningRevisions: planning() });
  const prepared = await runtime.prepareReadComposite(reads);
  assert.equal(prepared.authorization_only, false);
  assert.equal(prepared.pinned_revision, PINNED);
  assert.equal(calls.length, 0);
  const result = await runtime.executeReadComposite(authorization(prepared.request_id));
  assert.deepEqual(result.executions.map(x => x.tool), ["read_file", "read_file"]);
  assert.equal(verifier.calls.length, 1);
  assert.deepEqual(verifier.calls[0].required_permissions, prepared.required_permissions);
  assert.equal(policy.calls.length, 2);
  assert.ok(policy.calls.every(p => p.pinned_revision === PINNED));
  assert.equal(calls.length, 2);
  assert.equal(audit.events.at(-1)?.event, "composite_read_executed");
  assert.equal(audit.events.at(-1)?.provider_result, "success");
  await rejected(runtime.executeReadComposite(authorization(prepared.request_id)), 409, "replay_detected");
});

test("read bundles need an active Planning session, reads only and one branch", async () => {
  await rejected(prepareReadCompositeAuthorization(reads,
    deps({ planningRevisions: planning({ value: false }) })), 403, "composite_trusted_binding_required");
  await rejected(prepareReadCompositeAuthorization(reads,
    deps({ planningRevisions: undefined })), 403, "composite_trusted_binding_required");
  await rejected(prepareReadCompositeAuthorization({ ...reads, actions: [reads.actions[0],
    { tool: "update_file", arguments: { branch: "main", path: "src/two.ts", content: "x" } }] },
    deps()), 403, "composite_read_only");
  await rejected(prepareReadCompositeAuthorization({ ...reads, actions: [reads.actions[0],
    { tool: "read_file", arguments: { branch: "feature/other", path: "src/two.ts" } }] },
    deps()), 403, "composite_branch_mismatch");
  await rejected(prepareReadCompositeAuthorization({ ...reads, actions: [reads.actions[0]] },
    deps()), 400, "invalid_request");
  await rejected(prepareReadCompositeAuthorization({ ...reads, actions: [reads.actions[0], reads.actions[0]] },
    deps()), 400, "duplicate_permission");
});

test("an OPA denial of any read produces zero provider reads", async () => {
  const policy = new Policy(); policy.decision = i => i === 1;
  const calls: PreparedRequestRecord[] = [];
  const d = deps({ policy, executor: reader(calls) });
  const prepared = await prepareReadCompositeAuthorization(reads, d);
  await rejected(executeReadCompositeAuthorization(authorization(prepared.request_id), d), 403, "policy_denied");
  assert.equal(calls.length, 0);
});

test("a rejected VP denies the whole bundle without consulting OPA or the provider", async () => {
  const verifier = new Verifier(); verifier.reject = true;
  const policy = new Policy(), calls: PreparedRequestRecord[] = [];
  const d = deps({ verifier, policy, executor: reader(calls) });
  const prepared = await prepareReadCompositeAuthorization(reads, d);
  await rejected(executeReadCompositeAuthorization(authorization(prepared.request_id), d),
    403, "verification_rejected");
  assert.equal(policy.calls.length, 0);
  assert.equal(calls.length, 0);
});

test("a Planning session retired after verification blocks every read", async () => {
  const active = { value: true }, calls: PreparedRequestRecord[] = [];
  const d = deps({ planningRevisions: planning(active), executor: reader(calls) });
  const prepared = await prepareReadCompositeAuthorization(reads, d);
  active.value = false;
  await rejected(executeReadCompositeAuthorization(authorization(prepared.request_id), d),
    403, "composite_binding_denied");
  assert.equal(calls.length, 0);
});

test("an expired bundle is consumed and cannot be replayed", async () => {
  let clock = now;
  const d = deps({ nowMs: () => clock });
  const prepared = await prepareReadCompositeAuthorization(reads, d);
  clock = now + config.request_ttl_ms + 1;
  await rejected(executeReadCompositeAuthorization(authorization(prepared.request_id), d), 410, "expired_request");
  await rejected(executeReadCompositeAuthorization(authorization(prepared.request_id), d), 409, "replay_detected");
});
