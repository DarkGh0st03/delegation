/**
 * Phase R review (R-F1, R-F2, R-F3): batch state machine, batch validity
 * window and fail-closed behaviour after verification, exercised through the
 * real `executeAuthorization`. Verifier, OPA, owner binding and provider are
 * fixtures; the native Rust core and real Gitea are covered elsewhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {InMemoryAuditSink, InMemoryRequestStore} from "../src/prepare.ts";
import {executeAuthorization} from "../src/execute.ts";
import {DirectCoreRustVerifier} from "../src/direct-core-verifier.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "../src/trusted-authority-only-admissions.ts";
import {
  READ_BATCH_TTL_MS, TrustedReadBatchStore, prepareReadBatch, verifyReadBatchItem
} from "../src/trusted-read-batch.ts";
import {ProviderUnavailableError, VerificationRejectedError} from "../src/errors.ts";

const SHA = "a".repeat(40);
const branch = "feature/s-batch";
const repository = {authority: "gitea.local", owner: "team", repository: "app"};
const testerConfig = {audience: "cloud-access-gateway", request_ttl_ms: 1_200_000, repository};
const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];

type Fault = "policy" | "binding" | "provider" | "receipt";

function harness(opts: {fault?: {item: number; kind: Fault}; t0?: number} = {}) {
  let now = opts.t0 ?? 1_000_000;
  const clock = {now: () => now, advance: (ms: number) => { now += ms; }};
  const store = new InMemoryRequestStore();
  const batches = new TrustedReadBatchStore();
  const audit = new InMemoryAuditSink();
  let counter = 0;
  const executed: string[] = [];
  const faultOn = (kind: Fault, path: string) =>
    opts.fault?.kind === kind && paths[opts.fault.item] === path;
  const admissions = Object.assign(Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype), {
    preflightCanonicalRequest() {
      return {status: "gateway_permission_preflight_only", authority_digest: "d".repeat(64),
        runtime_task_id: "dispatch_batch", agent_did: "did:ethr:0x7a69:0xabc",
        plan_task_id: "B-1", pinned_revision: SHA, work_branch: branch,
        gateway_execution_authorized: false};
    },
    assertVerifiedVpAndPolicyForExecution(record: {request: {arguments: {path: string}}}) {
      if (faultOn("binding", record.request.arguments.path)) throw Error("no staged owner flight");
    }
  }) as TrustedAuthorityOnlyGatewayAdmissions;
  const verifier = Object.create(DirectCoreRustVerifier.prototype) as DirectCoreRustVerifier & {
    calls: number; revoked: boolean;
  };
  Object.defineProperty(verifier, "allowsGiteaScopeCoverage", {value: true});
  Object.assign(verifier, {
    calls: 0, revoked: false,
    async verify() { throw Error("single verification must not be used for a batch"); },
    async verifyMultiple(r: {required_permissions: unknown[]}) {
      verifier.calls++;
      if (verifier.revoked) throw new VerificationRejectedError("Child revoked on-chain");
      return {presenter_id: "did:ethr:0x7a69:0xabc", credential_id: "urn:child",
        issuer_id: "did:ethr:0x7a69:0xorc", permissions: r.required_permissions,
        hierarchy_depth: 1, expiration: "0", root_credential_id: "urn:root"};
    }
  });
  const deps = {
    store, audit, readBatches: batches, authorityOnlyAdmissions: admissions,
    authorityOnlyReadEnabled: true, verifier, repository, nowMs: clock.now,
    policy: {async evaluate(input: {required_permission: {resource: string}}) {
      const denied = opts.fault?.kind === "policy" &&
        input.required_permission.resource.endsWith("/files/" + paths[opts.fault.item]);
      return {allow: !denied, policy_version: "fixture"};
    }},
    executor: {provider: "gitea" as const, async execute(record: {request: {arguments: {path: string}}}) {
      const p = record.request.arguments.path;
      if (faultOn("provider", p)) throw new ProviderUnavailableError("Gitea down");
      executed.push(p);
      return {provider: "gitea", performed: true, tool: "read_file", branch, path: p,
        revision: SHA, blob_sha: "c".repeat(40), content: "x"} as never;
    }},
    authorityOnlyReceiptWriter: {
      isForAdmissions: (a: unknown) => a === admissions,
      async publishSuccessfulRead({execution}: {execution: {path: string}}) {
        if (faultOn("receipt", execution.path)) throw Error("receipt journal unavailable");
      }
    } as never
  };
  const prepare = (config: Record<string, unknown> = testerConfig) => prepareReadBatch({
    task_id: "dispatch_batch", agent_role: "test", tool: "read_files",
    arguments: {branch, paths}}, config as never,
    {store, audit, batches, authorityOnlyAdmissions: admissions, nowMs: clock.now,
      requestId: () => `req_${counter++}`});
  const execute = (request_id: string, signed_vp = "SIGNED_VP") =>
    executeAuthorization({request_id, signed_vp}, deps as never);
  return {store, batches, audit, verifier, clock, executed, prepare, execute};
}

const code = (c: string) => (e: unknown) => (e as {code?: string}).code === c;

// ---------------------------------------------------------------- R-F1
test("R-F1: a concurrent verification failure is terminal for the first, second and third item", async () => {
  const store = new InMemoryRequestStore();
  const batches = new TrustedReadBatchStore();
  const admissions = Object.assign(Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype), {
    preflightCanonicalRequest: () => ({status: "gateway_permission_preflight_only",
      authority_digest: "d".repeat(64), runtime_task_id: "dispatch_batch",
      agent_did: "did:x", plan_task_id: "B-1", pinned_revision: SHA, work_branch: branch,
      gateway_execution_authorized: false})
  }) as TrustedAuthorityOnlyGatewayAdmissions;
  let n = 0;
  const out = prepareReadBatch({task_id: "dispatch_batch", agent_role: "backend", tool: "read_files",
    arguments: {branch, paths}}, {audience: "gw", request_ttl_ms: 120_000, repository},
    {store, audit: new InMemoryAuditSink(), batches, authorityOnlyAdmissions: admissions,
      requestId: () => `c_${n++}`});
  const [a, b, c] = out.items.map(i => store.get(i.request_id)!);
  const batch = batches.forRequest(a!.request_id)!;
  let release!: () => void;
  let calls = 0;
  const slow = {async verifyMultiple(r: {required_permissions: unknown[]}) {
    calls++;
    await new Promise<void>(ok => { release = ok; });
    return {presenter_id: "p", credential_id: "c", issuer_id: "i",
      permissions: r.required_permissions, hierarchy_depth: 1, expiration: "0"};
  }, async verify() { throw Error("no"); }};
  const first = verifyReadBatchItem(batch, a!, "SIGNED_VP", slow as never, Date.now());
  await assert.rejects(verifyReadBatchItem(batch, b!, "SIGNED_VP", slow as never, Date.now()),
    /concurrent/u);
  release();
  // The pending success must NOT resurrect the batch.
  await assert.rejects(first, /failed closed during verification/u);
  await assert.rejects(verifyReadBatchItem(batch, c!, "SIGNED_VP", slow as never, Date.now()),
    /already failed closed/u);
  await assert.rejects(verifyReadBatchItem(batch, a!, "SIGNED_VP", slow as never, Date.now()),
    /already failed closed/u);
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------- R-F2
test("R-F2: the batch window (60 s) replaces the 20-minute Test Agent Prepare TTL", async () => {
  const h = harness();
  const t0 = h.clock.now();
  const out = h.prepare();
  assert.equal(Date.parse(out.expires_at), t0 + READ_BATCH_TTL_MS);
  for (const item of out.items)
    assert.equal(h.store.get(item.request_id)!.expires_at_ms, t0 + READ_BATCH_TTL_MS);
  assert.throws(() => h.prepare({...testerConfig, read_batch_ttl_ms: READ_BATCH_TTL_MS + 1}),
    /window/u);
  assert.throws(() => h.prepare({...testerConfig, read_batch_ttl_ms: 0}), /window/u);
  // A shorter window can be configured.
  const short = h.prepare({...testerConfig, read_batch_ttl_ms: 5_000});
  assert.equal(Date.parse(short.expires_at), t0 + 5_000);
});

test("R-F2: expiry during the batch stops the remaining items and terminates the batch", async () => {
  const h = harness();
  const out = h.prepare();
  const [a, b, c] = out.items.map(i => i.request_id);
  await h.execute(a!);
  h.clock.advance(READ_BATCH_TTL_MS);
  await assert.rejects(h.execute(b!), code("expired_request"));
  h.clock.advance(-READ_BATCH_TTL_MS + 1);   // even back inside the window
  await assert.rejects(h.execute(c!), code("verification_rejected"));
  assert.deepEqual(h.executed, ["src/a.ts"]);
});

test("R-F2: an on-chain revocation after the batch verification is observed at most at the window end", async () => {
  const h = harness();
  const out = h.prepare();
  const [a, b, c] = out.items.map(i => i.request_id);
  await h.execute(a!);
  h.verifier.revoked = true;              // revocation after the single batch verification
  h.clock.advance(1_000);
  await h.execute(b!);                    // declared window: reused within the batch
  assert.equal(h.verifier.calls, 1);
  h.clock.advance(READ_BATCH_TTL_MS);
  await assert.rejects(h.execute(c!), code("expired_request"));
  // A new batch must verify again and now observes the revocation.
  const again = h.prepare();
  await assert.rejects(h.execute(again.items[0]!.request_id), code("verification_rejected"));
  await assert.rejects(h.execute(again.items[1]!.request_id), code("verification_rejected"));
  assert.equal(h.verifier.calls, 2);
  assert.deepEqual(h.executed, ["src/a.ts", "src/b.ts"]);
});

// ---------------------------------------------------------------- R-F3
for (const kind of ["policy", "binding", "provider", "receipt"] as const) {
  test(`R-F3: a ${kind} failure on an item stops every later item, also for out-of-order calls`, async () => {
    const h = harness({fault: {item: 1, kind}});
    const out = h.prepare();
    const [a, b, c] = out.items.map(i => i.request_id);
    await h.execute(a!);
    await assert.rejects(h.execute(b!));
    // A non-conforming client keeps going with the verified batch VP.
    await assert.rejects(h.execute(c!), code("verification_rejected"));
    await assert.rejects(h.execute(b!), code("replay_detected"));
    assert.equal(h.verifier.calls, 1);
    const expectedReads = kind === "receipt" ? ["src/a.ts", "src/b.ts"] : ["src/a.ts"];
    assert.deepEqual(h.executed, expectedReads);
    const denied = h.audit.events.filter(e => e.event === "authorization_executed" &&
      e.request_id === c && e.decision === "deny");
    assert.equal(denied.length, 1);
  });
}

test("R-F3: a failure on the FIRST item (before any reuse) also terminates the batch", async () => {
  const h = harness({fault: {item: 0, kind: "policy"}});
  const out = h.prepare();
  const [a, b, c] = out.items.map(i => i.request_id);
  await assert.rejects(h.execute(a!), code("policy_denied"));
  await assert.rejects(h.execute(b!), code("verification_rejected"));
  await assert.rejects(h.execute(c!), code("verification_rejected"));
  assert.deepEqual(h.executed, []);
});

test("R-F3: a replayed or foreign-VP item terminates the batch", async () => {
  const h = harness();
  const out = h.prepare();
  const [a, b, c] = out.items.map(i => i.request_id);
  await h.execute(a!);
  await assert.rejects(h.execute(a!), code("replay_detected"));
  await assert.rejects(h.execute(b!), code("verification_rejected"));
  const h2 = harness();
  const out2 = h2.prepare();
  const [x, y, z] = out2.items.map(i => i.request_id);
  await h2.execute(x!);
  await assert.rejects(h2.execute(y!, "OTHER_VP"), code("verification_rejected"));
  await assert.rejects(h2.execute(z!), code("verification_rejected"));
  void c;
});

test("observability: allow events carry read_batch_id and batch_verification", async () => {
  const h = harness();
  const out = h.prepare();
  for (const item of out.items) await h.execute(item.request_id);
  const events = h.audit.events.filter(e => e.event === "authorization_executed");
  assert.deepEqual(events.map(e => (e as {batch_verification?: string}).batch_verification),
    ["performed", "reused", "reused"]);
  assert.ok(events.every(e => (e as {read_batch_id?: string}).read_batch_id === out.batch_id));
});
