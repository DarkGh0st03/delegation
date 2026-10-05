import { createHash, randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { deriveRequiredPermission } from "./canonical.ts";
import {
  assertNoCallerSuppliedAuthority,
  validatePrepareAuthorizationRequest
} from "./validation.ts";
import type {
  AuditEvent,
  AuditSink,
  GatewayPrepareConfig,
  PreparedAuthorizationResponse,
  PreparedRequestRecord
} from "./types.ts";

export class InMemoryRequestStore {
  readonly #records = new Map<string, PreparedRequestRecord>();

  put(record: PreparedRequestRecord): void {
    if (this.#records.has(record.request_id)) {
      throw new Error(`Duplicate request_id ${record.request_id}`);
    }
    this.#records.set(record.request_id, record);
  }

  get(requestId: string): PreparedRequestRecord | undefined {
    return this.#records.get(requestId);
  }

  size(): number {
    return this.#records.size;
  }
}

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  emit(event: AuditEvent): void {
    this.events.push(event);
  }
}

export interface PrepareDependencies {
  store: InMemoryRequestStore;
  audit: AuditSink;
  nowMs?: () => number;
  durationNowMs?: () => number;
  requestId?: () => string;
  challenge?: () => string;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function defaultChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export function prepareAuthorization(
  raw: unknown,
  config: GatewayPrepareConfig,
  dependencies: PrepareDependencies
): PreparedAuthorizationResponse {
  const durationNow = dependencies.durationNowMs ?? (() => performance.now());
  const started = durationNow();

  assertNoCallerSuppliedAuthority(raw);
  const normalized = validatePrepareAuthorizationRequest(raw);
  const permission = deriveRequiredPermission(config.repository, normalized.request);

  if (config.audience.trim().length === 0) {
    throw new Error("Gateway audience cannot be empty");
  }
  if (!Number.isSafeInteger(config.request_ttl_ms) || config.request_ttl_ms <= 0) {
    throw new Error("request_ttl_ms must be a positive safe integer");
  }

  const nowMs = (dependencies.nowMs ?? Date.now)();
  const requestId = (dependencies.requestId ?? (() => `req_${randomUUID()}`))();
  const challenge = (dependencies.challenge ?? defaultChallenge)();

  if (requestId.trim().length === 0 || challenge.trim().length === 0) {
    throw new Error("Generated request binding values cannot be empty");
  }

  const requestFingerprint = fingerprint({
    task_id: normalized.task_id,
    agent_role: normalized.agent_role,
    request: normalized.request
  });

  const record: PreparedRequestRecord = {
    request_id: requestId,
    task_id: normalized.task_id,
    agent_role: normalized.agent_role,
    request: normalized.request,
    required_permission: permission,
    audience: config.audience,
    challenge,
    request_fingerprint: requestFingerprint,
    created_at_ms: nowMs,
    expires_at_ms: nowMs + config.request_ttl_ms,
    consumed: false
  };

  dependencies.store.put(record);

  const prepareMs = Math.max(0, durationNow() - started);
  dependencies.audit.emit({
    event: "authorization_prepared",
    timestamp: new Date(nowMs).toISOString(),
    request_id: requestId,
    task_id: normalized.task_id,
    agent_role: normalized.agent_role,
    tool: normalized.request.tool,
    resource_uri: permission.resource,
    operation: permission.operation,
    prepare_ms: prepareMs
  });

  return {
    request_id: requestId,
    audience: config.audience,
    challenge,
    required_permission: permission,
    expires_at: new Date(record.expires_at_ms).toISOString()
  };
}
