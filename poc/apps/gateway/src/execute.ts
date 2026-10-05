import { performance } from "node:perf_hooks";
import {
  GatewayError,
  PolicyUnavailableError,
  ProviderNotFoundError,
  ProviderOperationUnavailableError,
  ProviderUnavailableError,
  VerificationRejectedError,
  VerificationUnavailableError
} from "./errors.ts";
import { buildPolicyInput } from "./policy-input.ts";
import { InMemoryRequestStore } from "./prepare.ts";
import type {
  AuditSink,
  ExecuteAuthorizationRequest,
  ExecuteAuthorizationResponse,
  ExecutionPort,
  GatewayRepositoryConfig,
  Permission,
  PolicyDecision,
  PolicyPort,
  PreparedRequestRecord,
  VerifierPort,
  VerifiedDelegation
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function validateExecuteRequest(raw: unknown): ExecuteAuthorizationRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new GatewayError(400, "invalid_request", "execute request must be an object");
  }
  const value = raw as JsonObject;
  const keys = Object.keys(value);
  if (
    keys.some((key) => !["request_id", "signed_vp"].includes(key)) ||
    !("request_id" in value) ||
    !("signed_vp" in value)
  ) {
    throw new GatewayError(
      400,
      "invalid_request",
      "execute request accepts only request_id and signed_vp"
    );
  }
  if (typeof value.request_id !== "string" || value.request_id.trim().length === 0) {
    throw new GatewayError(400, "invalid_request", "request_id cannot be empty");
  }
  if (typeof value.signed_vp !== "string" || value.signed_vp.trim().length === 0) {
    throw new GatewayError(400, "invalid_request", "signed_vp cannot be empty");
  }
  if (value.signed_vp.length > 2_000_000) {
    throw new GatewayError(413, "vp_too_large", "signed_vp exceeds 2 MiB");
  }
  return {
    request_id: value.request_id,
    signed_vp: value.signed_vp
  };
}

function includesPermission(permissions: Permission[], required: Permission): boolean {
  return permissions.some(
    (permission) =>
      permission.resource === required.resource &&
      permission.operation === required.operation
  );
}

function validateVerifiedDelegation(
  verified: VerifiedDelegation,
  record: PreparedRequestRecord
): void {
  if (!includesPermission(verified.permissions, record.required_permission)) {
    throw new VerificationUnavailableError(
      "Verifier response did not contain the required permission"
    );
  }
}

function elapsed(start: number, durationNow: () => number): number {
  return Math.max(0, durationNow() - start);
}

export interface ExecuteDependencies {
  store: InMemoryRequestStore;
  audit: AuditSink;
  verifier: VerifierPort;
  policy: PolicyPort;
  repository: GatewayRepositoryConfig;
  executor: ExecutionPort;
  nowMs?: () => number;
  durationNowMs?: () => number;
}

export async function executeAuthorization(
  raw: unknown,
  dependencies: ExecuteDependencies
): Promise<ExecuteAuthorizationResponse> {
  const request = validateExecuteRequest(raw);
  const nowMs = (dependencies.nowMs ?? Date.now)();
  const durationNow = dependencies.durationNowMs ?? (() => performance.now());
  const totalStarted = durationNow();
  const provider = dependencies.executor.provider;

  const record = dependencies.store.get(request.request_id);
  if (!record) {
    throw new GatewayError(404, "unknown_request", "Prepared authorization request was not found");
  }
  if (record.consumed) {
    throw new GatewayError(409, "replay_detected", "Prepared authorization request was already consumed");
  }

  record.consumed = true;

  if (nowMs >= record.expires_at_ms) {
    dependencies.audit.emit({
      event: "authorization_executed",
      timestamp: new Date(nowMs).toISOString(),
      request_id: record.request_id,
      task_id: record.task_id,
      agent_role: record.agent_role,
      tool: record.request.tool,
      resource_uri: record.required_permission.resource,
      operation: record.required_permission.operation,
      decision: "deny",
      reason: "expired_request",
      verification_ms: 0,
      opa_ms: 0,
      policy_decision: "not_evaluated",
      provider_ms: 0,
      provider_result: "not_called",
      total_ms: elapsed(totalStarted, durationNow),
      vp_size_bytes: Buffer.byteLength(request.signed_vp, "utf8"),
      provider
    });
    throw new GatewayError(410, "expired_request", "Prepared authorization request has expired");
  }

  const verificationStarted = durationNow();
  let verified: VerifiedDelegation;
  try {
    verified = await dependencies.verifier.verify({
      presenter: record.agent_role,
      audience: record.audience,
      challenge: record.challenge,
      required_permission: record.required_permission,
      signed_vp: request.signed_vp
    });
    validateVerifiedDelegation(verified, record);
  } catch (error) {
    const verificationMs = elapsed(verificationStarted, durationNow);
    const unavailable = error instanceof VerificationUnavailableError;
    const reason = unavailable ? "verifier_unavailable" : "verification_rejected";
    dependencies.audit.emit({
      event: "authorization_executed",
      timestamp: new Date(nowMs).toISOString(),
      request_id: record.request_id,
      task_id: record.task_id,
      agent_role: record.agent_role,
      tool: record.request.tool,
      resource_uri: record.required_permission.resource,
      operation: record.required_permission.operation,
      decision: "deny",
      reason,
      verification_ms: verificationMs,
      opa_ms: 0,
      policy_decision: "not_evaluated",
      provider_ms: 0,
      provider_result: "not_called",
      total_ms: elapsed(totalStarted, durationNow),
      vp_size_bytes: Buffer.byteLength(request.signed_vp, "utf8"),
      provider
    });

    if (unavailable) {
      throw new GatewayError(503, reason, "Delegation verification is unavailable");
    }
    if (error instanceof VerificationRejectedError) {
      throw new GatewayError(403, reason, "Delegation proof was rejected");
    }
    throw new GatewayError(503, reason, "Delegation verification failed closed");
  }

  const verificationMs = elapsed(verificationStarted, durationNow);
  const policyInput = buildPolicyInput(record, dependencies.repository, verified);
  const opaStarted = durationNow();
  let policyDecision: PolicyDecision;
  try {
    policyDecision = await dependencies.policy.evaluate(policyInput);
  } catch (error) {
    const opaMs = elapsed(opaStarted, durationNow);
    dependencies.audit.emit({
      event: "authorization_executed",
      timestamp: new Date(nowMs).toISOString(),
      request_id: record.request_id,
      task_id: record.task_id,
      agent_role: record.agent_role,
      tool: record.request.tool,
      resource_uri: record.required_permission.resource,
      operation: record.required_permission.operation,
      decision: "deny",
      reason: "policy_unavailable",
      verification_ms: verificationMs,
      opa_ms: opaMs,
      policy_decision: "error",
      provider_ms: 0,
      provider_result: "not_called",
      total_ms: elapsed(totalStarted, durationNow),
      vp_size_bytes: Buffer.byteLength(request.signed_vp, "utf8"),
      chain_depth: verified.hierarchy_depth,
      disclosed_permission_count: verified.permissions.length,
      provider
    });
    if (error instanceof PolicyUnavailableError) {
      throw new GatewayError(503, "policy_unavailable", "OPA policy evaluation is unavailable");
    }
    throw new GatewayError(503, "policy_unavailable", "OPA policy evaluation failed closed");
  }

  const opaMs = elapsed(opaStarted, durationNow);
  if (!policyDecision.allow) {
    dependencies.audit.emit({
      event: "authorization_executed",
      timestamp: new Date(nowMs).toISOString(),
      request_id: record.request_id,
      task_id: record.task_id,
      agent_role: record.agent_role,
      tool: record.request.tool,
      resource_uri: record.required_permission.resource,
      operation: record.required_permission.operation,
      decision: "deny",
      reason: "policy_denied",
      verification_ms: verificationMs,
      opa_ms: opaMs,
      policy_decision: "deny",
      policy_version: policyDecision.policy_version,
      provider_ms: 0,
      provider_result: "not_called",
      total_ms: elapsed(totalStarted, durationNow),
      vp_size_bytes: Buffer.byteLength(request.signed_vp, "utf8"),
      chain_depth: verified.hierarchy_depth,
      disclosed_permission_count: verified.permissions.length,
      provider
    });
    throw new GatewayError(403, "policy_denied", "Workflow policy denied the operation");
  }

  const providerStarted = durationNow();
  let execution;
  try {
    execution = await dependencies.executor.execute(record);
  } catch (error) {
    const providerMs = elapsed(providerStarted, durationNow);
    const common = {
      event: "authorization_executed" as const,
      timestamp: new Date(nowMs).toISOString(),
      request_id: record.request_id,
      task_id: record.task_id,
      agent_role: record.agent_role,
      tool: record.request.tool,
      resource_uri: record.required_permission.resource,
      operation: record.required_permission.operation,
      decision: "allow" as const,
      verification_ms: verificationMs,
      opa_ms: opaMs,
      policy_decision: "allow" as const,
      policy_version: policyDecision.policy_version,
      provider_ms: providerMs,
      provider_result: "error" as const,
      total_ms: elapsed(totalStarted, durationNow),
      vp_size_bytes: Buffer.byteLength(request.signed_vp, "utf8"),
      chain_depth: verified.hierarchy_depth,
      disclosed_permission_count: verified.permissions.length,
      provider
    };

    if (error instanceof ProviderNotFoundError) {
      dependencies.audit.emit({ ...common, reason: "provider_not_found" });
      throw new GatewayError(404, "provider_not_found", error.message);
    }
    if (error instanceof ProviderOperationUnavailableError) {
      dependencies.audit.emit({ ...common, reason: "provider_operation_unavailable" });
      throw new GatewayError(501, "provider_operation_unavailable", error.message);
    }
    if (error instanceof ProviderUnavailableError) {
      dependencies.audit.emit({ ...common, reason: "provider_unavailable" });
      throw new GatewayError(503, "provider_unavailable", error.message);
    }

    dependencies.audit.emit({ ...common, reason: "provider_unavailable" });
    throw new GatewayError(503, "provider_unavailable", "Protected provider failed");
  }

  const providerMs = elapsed(providerStarted, durationNow);
  const totalMs = elapsed(totalStarted, durationNow);

  dependencies.audit.emit({
    event: "authorization_executed",
    timestamp: new Date(nowMs).toISOString(),
    request_id: record.request_id,
    task_id: record.task_id,
    agent_role: record.agent_role,
    tool: record.request.tool,
    resource_uri: record.required_permission.resource,
    operation: record.required_permission.operation,
    decision: "allow",
    reason: `verified_policy_allowed_${execution.provider}_execution`,
    verification_ms: verificationMs,
    opa_ms: opaMs,
    policy_decision: "allow",
    policy_version: policyDecision.policy_version,
    provider_ms: providerMs,
    provider_result: "success",
    total_ms: totalMs,
    vp_size_bytes: Buffer.byteLength(request.signed_vp, "utf8"),
    chain_depth: verified.hierarchy_depth,
    disclosed_permission_count: verified.permissions.length,
    provider: execution.provider
  });

  return {
    request_id: record.request_id,
    decision: "allow",
    verified_delegation: verified,
    policy: policyDecision,
    execution
  };
}
