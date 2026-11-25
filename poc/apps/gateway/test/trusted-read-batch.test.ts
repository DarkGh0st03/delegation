/**
 * Phase R unit tests: operational read batches (one VP for N signed reads).
 * The authority-only preflight and the native verifier are fixtures; the
 * per-record Execute path (OPA, binding, provider, evidence) is unchanged and
 * covered by the existing suites and the scripted E2E.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {InMemoryAuditSink, InMemoryRequestStore} from "../src/prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "../src/trusted-authority-only-admissions.ts";
import {
  TrustedReadBatchStore, prepareReadBatch, verifyReadBatchItem
} from "../src/trusted-read-batch.ts";
import {VerificationRejectedError, VerificationUnavailableError} from "../src/errors.ts";

const SHA = "a".repeat(40);
const branch = "feature/s-batch";
const config = {audience: "cloud-access-gateway", request_ttl_ms: 120_000,
  repository: {authority: "gitea.local", owner: "team", repository: "app"}};
const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];

function admissions(opts: {failPath?: string} = {}) {
  return Object.assign(Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype), {
    preflightCanonicalRequest(raw: {arguments: {path: string}}) {
      if (raw.arguments.path === opts.failPath) throw Error("not a signed read of this Task");
      return {status: "gateway_permission_preflight_only", authority_digest: "d".repeat(64),
        runtime_task_id: "dispatch_batch", agent_did: "did:ethr:0x7a69:0xabc",
        plan_task_id: "B-1", pinned_revision: SHA, work_branch: branch,
        gateway_execution_authorized: false};
    }
  }) as TrustedAuthorityOnlyGatewayAdmissions;
}

let counter = 0;
function setup(opts: {failPath?: string} = {}) {
  const store = new InMemoryRequestStore();
  const batches = new TrustedReadBatchStore();
  const deps = {store, audit: new InMemoryAuditSink(), batches,
    authorityOnlyAdmissions: admissions(opts), requestId: () => `req_${counter++}`};
  return {store, batches, deps};
}

const request = (p: unknown = paths, extra: Record<string, unknown> = {}) => ({
  task_id: "dispatch_batch", agent_role: "backend", tool: "read_files",
  arguments: {branch, paths: p}, ...extra
});

class FakeVerifier {
  calls: unknown[] = [];
  behaviour: "ok" | "reject";
  constructor(behaviour: "ok" | "reject" = "ok") { this.behaviour = behaviour; }
  async verify(): Promise<never> { throw Error("single verification must not be used"); }
  async verifyMultiple(r: {required_permissions: unknown[]; challenge: string}) {
    this.calls.push(r);
    if (this.behaviour === "reject") throw new VerificationRejectedError("Rust rejected");
    return {presenter_id: "did:ethr:0x7a69:0xabc", credential_id: "urn:child",
      issuer_id: "did:ethr:0x7a69:0xorc", permissions: r.required_permissions,
      hierarchy_depth: 1, expiration: "0", root_credential_id: "urn:root"};
  }
}

test("batch Prepare creates N ordinary role-bound read records sharing one challenge", () => {
  const {store, batches, deps} = setup();
  const out = prepareReadBatch(request(), config, deps);
  assert.equal(out.items.length, 3);
  assert.equal(batches.size, 1);
  const records = out.items.map(i => store.get(i.request_id)!);
  assert.equal(new Set(out.items.map(i => i.request_id)).size, 3);
  for (const [i, r] of records.entries()) {
    assert.equal(r.request.tool, "read_file");
    assert.equal(r.request.arguments.path, paths[i]);
    assert.equal(r.challenge, out.challenge);
    assert.equal(r.pinned_revision, SHA);
    assert.equal(r.consumed, false);
    // Permission derived by the Gateway, never by the caller.
    assert.equal(r.required_permission.operation, "read_file");
    assert.ok(r.required_permission.resource.endsWith("/files/" + paths[i]));
    assert.deepEqual(out.items[i]!.required_permission, r.required_permission);
    assert.equal(batches.forRequest(r.request_id)?.batch_id, out.batch_id);
  }
});

test("batch Prepare rejects malformed, duplicate, oversized and caller-authorized requests", () => {
  const {deps} = setup();
  assert.throws(() => prepareReadBatch(request(["src/a.ts"]), config, deps), /2-15 distinct/u);
  assert.throws(() => prepareReadBatch(request(["src/a.ts", "src/a.ts"]), config, deps), /2-15 distinct/u);
  assert.throws(() => prepareReadBatch(request(Array.from({length: 16}, (_, i) => `src/f${i}.ts`)),
    config, deps), /2-15 distinct/u);
  assert.throws(() => prepareReadBatch({...request(), tool: "read_file"}, config, deps), /shape/u);
  assert.throws(() => prepareReadBatch(request(paths, {required_permission: {}}), config, deps), /shape/u);
  assert.throws(() => prepareReadBatch({...request(), arguments: {branch, paths, extra: 1}}, config, deps), /shape/u);
});

test("batch Prepare requires the live authority-only owner Gateway", () => {
  const {store, batches} = setup();
  assert.throws(() => prepareReadBatch(request(), config,
    {store, audit: new InMemoryAuditSink(), batches} as never), /authority-only/u);
});

test("a failing item burns the already prepared items and registers no batch", () => {
  const {store, batches, deps} = setup({failPath: "src/c.ts"});
  const first = counter;
  assert.throws(() => prepareReadBatch(request(), config, deps), /not a signed read/u);
  assert.equal(batches.size, 0);
  assert.equal(store.size(), 2);
  // Every orphaned record is unusable (already consumed).
  assert.equal(store.get(`req_${first}`)?.consumed, true);
  assert.equal(store.get(`req_${first + 1}`)?.consumed, true);
});

test("the VP is verified ONCE over all Gateway-derived permissions and reused only byte-identically", async () => {
  const {store, batches, deps} = setup();
  const out = prepareReadBatch(request(), config, deps);
  const verifier = new FakeVerifier();
  const now = Date.now();
  const results = [];
  for (const item of out.items) {
    const record = store.get(item.request_id)!;
    results.push(await verifyReadBatchItem(batches.forRequest(record.request_id)!, record,
      "SIGNED_VP", verifier as never, now));
  }
  assert.equal(verifier.calls.length, 1);
  const call = verifier.calls[0] as {required_permissions: unknown[]; challenge: string};
  assert.deepEqual(call.required_permissions, out.items.map(i => i.required_permission));
  assert.equal(call.challenge, out.challenge);
  assert.deepEqual(results.map(r => r.batch_verification), ["performed", "reused", "reused"]);
});

test("a different VP on a later item poisons the whole batch", async () => {
  const {store, batches, deps} = setup();
  const out = prepareReadBatch(request(), config, deps);
  const verifier = new FakeVerifier();
  const [a, b, c] = out.items.map(i => store.get(i.request_id)!);
  const batch = batches.forRequest(a!.request_id)!;
  await verifyReadBatchItem(batch, a!, "SIGNED_VP", verifier as never, Date.now());
  await assert.rejects(verifyReadBatchItem(batch, b!, "OTHER_VP", verifier as never, Date.now()),
    VerificationRejectedError);
  await assert.rejects(verifyReadBatchItem(batch, c!, "SIGNED_VP", verifier as never, Date.now()),
    /failed closed/u);
});

test("a rejected batch VP fails every later item closed", async () => {
  const {store, batches, deps} = setup();
  const out = prepareReadBatch(request(), config, deps);
  const verifier = new FakeVerifier("reject");
  const [a, b] = out.items.map(i => store.get(i.request_id)!);
  const batch = batches.forRequest(a!.request_id)!;
  await assert.rejects(verifyReadBatchItem(batch, a!, "SIGNED_VP", verifier as never, Date.now()),
    /Rust rejected/u);
  await assert.rejects(verifyReadBatchItem(batch, b!, "SIGNED_VP", new FakeVerifier() as never, Date.now()),
    /failed closed/u);
});

test("expired batch and foreign record are rejected", async () => {
  const {store, batches, deps} = setup();
  const out = prepareReadBatch(request(), config, deps);
  const record = store.get(out.items[0]!.request_id)!;
  const batch = batches.forRequest(record.request_id)!;
  await assert.rejects(verifyReadBatchItem(batch, record, "SIGNED_VP", new FakeVerifier() as never,
    Date.now() + 10 * 60_000), /live batch/u);
  const other = setup();
  const out2 = prepareReadBatch(request(), config, other.deps);
  const foreign = other.store.get(out2.items[0]!.request_id)!;
  const fresh = prepareReadBatch(request(), config, deps);
  await assert.rejects(verifyReadBatchItem(batches.forRequest(fresh.items[0]!.request_id)!, foreign,
    "SIGNED_VP", new FakeVerifier() as never, Date.now()), /live batch/u);
});

test("without a multi-permission verifier the batch fails closed", async () => {
  const {store, batches, deps} = setup();
  const out = prepareReadBatch(request(), config, deps);
  const record = store.get(out.items[0]!.request_id)!;
  await assert.rejects(verifyReadBatchItem(batches.forRequest(record.request_id)!, record, "SIGNED_VP",
    {verify: async () => { throw Error("no"); }} as never, Date.now()), VerificationUnavailableError);
});

test("concurrent first verifications cannot both proceed", async () => {
  const {store, batches, deps} = setup();
  const out = prepareReadBatch(request(), config, deps);
  const [a, b] = out.items.map(i => store.get(i.request_id)!);
  const batch = batches.forRequest(a!.request_id)!;
  let release!: () => void;
  const slow = {async verifyMultiple(r: {required_permissions: unknown[]}) {
    await new Promise<void>(ok => { release = ok; });
    return {presenter_id: "p", credential_id: "c", issuer_id: "i",
      permissions: r.required_permissions, hierarchy_depth: 1, expiration: "0"};
  }, async verify() { throw Error("no"); }};
  const first = verifyReadBatchItem(batch, a!, "SIGNED_VP", slow as never, Date.now());
  await assert.rejects(verifyReadBatchItem(batch, b!, "SIGNED_VP", slow as never, Date.now()),
    /concurrent/u);
  release();
  // "failed" is terminal (R-F1): the pending first verification cannot succeed.
  await assert.rejects(first, /failed closed during verification/u);
});
