/**
 * Phase R — operational batch reads with ONE signed VP.
 *
 * `prepareReadBatch` creates N ORDINARY read records, one per signed file,
 * through the unchanged `prepareAuthorization` (role-bound Prepare, Gateway-
 * derived permission, authority-only Task preflight, pinned HEAD, per-file
 * fingerprint). The only difference is that they share one fresh challenge.
 *
 * `verifyReadBatchItem` is used by Execute instead of a single-permission
 * verification when a record belongs to a batch: the FIRST Execute verifies
 * the VP once with the native multi-permission verifier over ALL permissions
 * derived by the Gateway for the batch; later items reuse that result only
 * for the byte-identical VP. Every item is still consumed once and passes
 * OPA, Task/Child/flight binding, provider read, receipt and attestation on
 * its own (see docs/PHASE_R_BATCH_READ_DESIGN.md).
 */
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {MAX_TASK_READS}
 from "../../../packages/plan-contracts/src/gitea-permission-containment.mjs";
import {prepareAuthorization, type PrepareDependencies} from "./prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "./trusted-authority-only-admissions.ts";
import {VerificationRejectedError, VerificationUnavailableError} from "./errors.ts";
import type {
  AgentRole, GatewayPrepareConfig, Permission, PreparedRequestRecord,
  VerifierPort, VerifiedDelegation
} from "./types.ts";

export const READ_BATCH_TOOL = "read_files";
/**
 * Validity window of a read batch, independent of the Prepare TTL needed by
 * the Runner (20 min for the Test Agent). The revocation status of the Child
 * is observed once per batch (first Execute), so this bounds how long a
 * verified result may be reused. Every record of the batch is clamped to it.
 */
export const READ_BATCH_TTL_MS = 60_000;

type BatchState = "prepared" | "verifying" | "verified" | "failed";

interface ReadBatch {
  readonly batch_id: string;
  readonly task_id: string;
  readonly agent_role: AgentRole;
  readonly request_ids: readonly string[];
  readonly required_permissions: readonly Permission[];
  readonly challenge: string;
  readonly audience: string;
  readonly pinned_revision: string;
  readonly expires_at_ms: number;
  state: BatchState;
  vp_sha256?: string;
  verified?: Readonly<VerifiedDelegation>;
}

export interface PreparedReadBatchResponse {
  batch_id: string;
  audience: string;
  challenge: string;
  expires_at: string;
  items: { request_id: string; path: string; required_permission: Permission }[];
}

export interface ReadBatchVerification {
  verified: VerifiedDelegation;
  batch_id: string;
  batch_verification: "performed" | "reused";
}

function deny(reason: string): never {
  throw new VerificationRejectedError("Read batch rejected: " + reason);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class TrustedReadBatchStore {
  readonly #batches = new Map<string, ReadBatch>();
  readonly #byRequest = new Map<string, string>();

  register(batch: ReadBatch): void {
    if (this.#batches.has(batch.batch_id) ||
        batch.request_ids.some(id => this.#byRequest.has(id)))
      throw Error("Duplicate read batch or batched request");
    this.#batches.set(batch.batch_id, batch);
    for (const id of batch.request_ids) this.#byRequest.set(id, batch.batch_id);
  }

  /** The batch owning a prepared request, if any. Never created from input. */
  forRequest(requestId: string): ReadBatch | undefined {
    const id = this.#byRequest.get(requestId);
    return id === undefined ? undefined : this.#batches.get(id);
  }

  /**
   * Fail-closed: any failed Execute of a batch item (verification, OPA,
   * binding, provider, receipt) makes the whole batch terminally failed.
   */
  failForRequest(requestId: unknown): void {
    if (typeof requestId !== "string") return;
    const batch = this.forRequest(requestId);
    if (batch) batch.state = "failed";
  }

  get size(): number { return this.#batches.size; }
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function prepareReadBatch(
  raw: unknown,
  config: GatewayPrepareConfig & { read_batch_ttl_ms?: number },
  dependencies: PrepareDependencies & { batches: TrustedReadBatchStore }
): PreparedReadBatchResponse {
  const batchTtl = config.read_batch_ttl_ms ?? READ_BATCH_TTL_MS;
  if (!Number.isSafeInteger(batchTtl) || batchTtl <= 0 || batchTtl > READ_BATCH_TTL_MS)
    throw Error(`Read batch window must be 1-${READ_BATCH_TTL_MS} ms`);
  if (!(dependencies.batches instanceof TrustedReadBatchStore) ||
      !(dependencies.authorityOnlyAdmissions instanceof TrustedAuthorityOnlyGatewayAdmissions) ||
      dependencies.planningRevisions)
    throw Error("Read batches require the live authority-only owner Gateway");
  if (!exactKeys(raw, ["task_id", "agent_role", "tool", "arguments"]) ||
      raw.tool !== READ_BATCH_TOOL ||
      !exactKeys(raw.arguments, ["branch", "paths"]))
    throw Error("Invalid read batch request shape");
  const args = raw.arguments as { branch: unknown; paths: unknown };
  const paths = args.paths;
  if (!Array.isArray(paths) || paths.length < 2 || paths.length > MAX_TASK_READS ||
      paths.some(p => typeof p !== "string") || new Set(paths).size !== paths.length)
    throw Error(`A read batch needs 2-${MAX_TASK_READS} distinct file paths`);

  const challenge = randomBytes(32).toString("base64url");
  const createdMs = (dependencies.nowMs ?? Date.now)();
  const records: PreparedRequestRecord[] = [];
  const responses: PreparedReadBatchResponse["items"] = [];
  try {
    for (const path of paths as string[]) {
      // Exactly the single-read Prepare, with every existing check.
      const prepared = prepareAuthorization({
        task_id: raw.task_id, agent_role: raw.agent_role, tool: "read_file",
        arguments: { branch: args.branch, path }
      }, config, { ...dependencies, challenge: () => challenge });
      const record = dependencies.store.get(prepared.request_id);
      if (!record) throw Error("Prepared batch item is missing from the store");
      records.push(record);
      responses.push({ request_id: prepared.request_id, path,
        required_permission: prepared.required_permission });
    }
    const first = records[0]!;
    if (records.some(r =>
          r.task_id !== first.task_id || r.agent_role !== first.agent_role ||
          r.challenge !== challenge || r.audience !== first.audience ||
          !r.authority_only_digest || r.authority_only_digest !== first.authority_only_digest ||
          r.authority_only_plan_task_id !== first.authority_only_plan_task_id ||
          typeof r.pinned_revision !== "string" || r.pinned_revision !== first.pinned_revision))
      throw Error("Read batch items differ in Task, role, authority or pinned revision");
    // The batch window never exceeds the records' own TTL and replaces it:
    // a batched record cannot outlive the batch (stage/Execute check it).
    const expiresAtMs = Math.min(createdMs + batchTtl, ...records.map(r => r.expires_at_ms));
    for (const r of records) r.expires_at_ms = expiresAtMs;
    const batch: ReadBatch = {
      batch_id: `batch_${randomUUID()}`,
      task_id: first.task_id, agent_role: first.agent_role,
      request_ids: Object.freeze(records.map(r => r.request_id)),
      required_permissions: Object.freeze(records.map(r => Object.freeze({ ...r.required_permission }))),
      challenge, audience: first.audience, pinned_revision: first.pinned_revision!,
      expires_at_ms: expiresAtMs,
      state: "prepared"
    };
    dependencies.batches.register(batch);
    return {
      batch_id: batch.batch_id, audience: batch.audience, challenge,
      expires_at: new Date(batch.expires_at_ms).toISOString(), items: responses
    };
  } catch (error) {
    // Items already prepared are never handed out: burn them.
    for (const r of records) r.consumed = true;
    throw error;
  }
}

/**
 * Called by Execute AFTER the record was consumed, instead of the single
 * verification. Fail-closed: any mismatch or verifier failure poisons the batch.
 */
export async function verifyReadBatchItem(
  batch: ReadBatch,
  record: PreparedRequestRecord,
  signedVp: string,
  verifier: VerifierPort,
  nowMs: number
): Promise<ReadBatchVerification> {
  if (batch.state === "failed") deny("batch already failed closed");
  if (!batch.request_ids.includes(record.request_id) ||
      record.request.tool !== "read_file" ||
      record.task_id !== batch.task_id || record.agent_role !== batch.agent_role ||
      record.challenge !== batch.challenge || record.audience !== batch.audience ||
      record.pinned_revision !== batch.pinned_revision ||
      nowMs >= batch.expires_at_ms) {
    batch.state = "failed";
    deny("record does not belong to this live batch");
  }
  if (typeof signedVp !== "string" || !signedVp) {
    batch.state = "failed";
    deny("missing VP");
  }
  const digest = sha256(signedVp);
  if (batch.state === "verified") {
    if (digest !== batch.vp_sha256 || !batch.verified) {
      batch.state = "failed";
      deny("a batch item must present the VP verified for the batch");
    }
    return { verified: batch.verified, batch_id: batch.batch_id, batch_verification: "reused" };
  }
  if (batch.state !== "prepared") {
    batch.state = "failed";
    deny("concurrent batch verification");
  }
  if (typeof verifier.verifyMultiple !== "function") {
    batch.state = "failed";
    throw new VerificationUnavailableError("Multi-permission verifier is not available");
  }
  batch.state = "verifying";
  try {
    const verified = await verifier.verifyMultiple({
      presenter: batch.agent_role, audience: batch.audience, challenge: batch.challenge,
      required_permissions: batch.required_permissions.map(p => ({ ...p })),
      signed_vp: signedVp
    });
    // "failed" is terminal: a concurrent or later failure recorded while
    // this verification was pending must never be overwritten by success.
    if ((batch.state as BatchState) !== "verifying")
      deny("batch failed closed during verification");
    batch.verified = Object.freeze(structuredClone(verified));
    batch.vp_sha256 = digest;
    batch.state = "verified";
    return { verified: batch.verified, batch_id: batch.batch_id, batch_verification: "performed" };
  } catch (error) {
    batch.state = "failed";
    throw error;
  }
}
