/**
 * Authorization-only composite preflight.
 *
 * IMPORTANT: these routes NEVER execute Gitea/Docker operations, never mint a
 * permission/capability and never permit execution of a preflight result.
 * A provider operation batch requires a separate transaction/rollback design.
 * Every action's canonical permission is Gateway-derived (not caller supplied).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { deriveRequiredPermission } from "./canonical.ts";
import { GatewayError, VerificationRejectedError, VerificationUnavailableError } from "./errors.ts";
import { buildPolicyInput } from "./policy-input.ts";
import { validatePrepareAuthorizationRequest } from "./validation.ts";
import type {
  AgentRole, AuditSink, GatewayPrepareConfig, NormalizedToolRequest,
  Permission, PolicyDecision, PolicyPort, PreparedRequestRecord,
  VerifierPort, VerifiedDelegation
} from "./types.ts";

const MAX_COMPOSITE_ACTIONS = 12;

interface Action {
  request: NormalizedToolRequest;
  permission: Permission;
}

interface CompositeRecord {
  request_id: string;
  task_id: string;
  agent_role: AgentRole;
  actions: Action[];
  audience: string;
  challenge: string;
  created_at_ms: number;
  expires_at_ms: number;
  consumed: boolean;
}

export interface PreparedCompositeResponse {
  request_id: string;
  audience: string;
  challenge: string;
  required_permissions: Permission[];
  expires_at: string;
  authorization_only: true;
}

export class InMemoryCompositeStore {
  readonly #records = new Map<string, CompositeRecord>();
  put(record: CompositeRecord): void {
    if (this.#records.has(record.request_id)) {
      throw new GatewayError(409, "duplicate_request_id", "Composite request ID already exists");
    }
    this.#records.set(record.request_id, record);
  }
  get(requestId: string): CompositeRecord | undefined {
    return this.#records.get(requestId);
  }
  size(): number {
    return this.#records.size;
  }
}

export interface CompositeDependencies {
  store: InMemoryCompositeStore;
  audit: AuditSink;
  verifier: VerifierPort;
  policy: PolicyPort;
  config: GatewayPrepareConfig;
  nowMs?: () => number;
  requestId?: () => string;
  challenge?: () => string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GatewayError(400, "invalid_request", label + " must be an object");
  }
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key))) {
    throw new GatewayError(400, "invalid_request", "Unexpected or missing composite request fields");
  }
}
function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GatewayError(400, "invalid_request", label + " must be a nonempty string");
  }
  return value;
}
function samePermission(a: Permission, b: Permission): boolean {
  return a.resource === b.resource && a.operation === b.operation;
}
function event(
  deps: CompositeDependencies, record: CompositeRecord,
  stage: "composite_authorization_prepared" | "composite_authorization_verified",
  decision: "pending" | "allow" | "deny", reason: string, timestamp: number
): void {
  deps.audit.emit({
    event: stage,
    timestamp: new Date(timestamp).toISOString(),
    request_id: record.request_id,
    task_id: record.task_id,
    agent_role: record.agent_role,
    permission_count: record.actions.length,
    decision,
    reason,
    provider_result: "not_called"
  });
}

export function prepareCompositeAuthorization(
  raw: unknown, deps: CompositeDependencies
): PreparedCompositeResponse {
  const input = object(raw, "composite prepare");
  exact(input, ["task_id", "agent_role", "actions"]);
  if (!Array.isArray(input.actions) ||
      input.actions.length < 2 || input.actions.length > MAX_COMPOSITE_ACTIONS) {
    throw new GatewayError(400, "invalid_request", "Composite request needs 2–12 actions");
  }
  const task_id = nonempty(input.task_id, "task_id");
  const role = nonempty(input.agent_role, "agent_role");
  if (!Number.isSafeInteger(deps.config.request_ttl_ms) ||
      deps.config.request_ttl_ms <= 0 || !deps.config.audience.trim()) {
    throw new GatewayError(500, "invalid_config", "Composite Gateway configuration is invalid");
  }

  const actions: Action[] = input.actions.map((rawAction: unknown) => {
    const item = object(rawAction, "action");
    exact(item, ["tool", "arguments"]);
    // The normalizer rejects unsupported tools and authority injection.
    const normalized = validatePrepareAuthorizationRequest({
      task_id, agent_role: role, tool:item.tool, arguments:item.arguments
    });
    return {
      request: normalized.request,
      permission: deriveRequiredPermission(deps.config.repository, normalized.request)
    };
  });
  // Identical required permissions are not a meaningful composite; reject
  // instead of counting duplicates as multiple independent grants.
  for (let i=0; i<actions.length; i++) {
    for (let j=0; j<i; j++) {
      if (samePermission(actions[i].permission, actions[j].permission)) {
        throw new GatewayError(400, "duplicate_permission", "Duplicate required permission");
      }
    }
  }

  const now = (deps.nowMs ?? Date.now)();
  const id = (deps.requestId ?? (() => "composite_" + randomUUID()))();
  const challenge = (deps.challenge ?? (() => randomBytes(32).toString("base64url")))();
  nonempty(id, "request_id");
  nonempty(challenge, "challenge");
  const record: CompositeRecord = {
    request_id:id,
    task_id,
    agent_role:role as AgentRole,
    actions,
    audience:deps.config.audience,
    challenge,
    created_at_ms:now,
    expires_at_ms:now + deps.config.request_ttl_ms,
    consumed:false
  };
  deps.store.put(record);
  event(deps,record,"composite_authorization_prepared","pending","prepared",now);
  return {
    request_id:id,
    audience:record.audience,
    challenge,
    required_permissions:actions.map((x)=>x.permission),
    expires_at:new Date(record.expires_at_ms).toISOString(),
    authorization_only:true
  };
}

export async function verifyCompositeAuthorization(
  raw: unknown, deps: CompositeDependencies
): Promise<{
  request_id:string;
  decision:"allow";
  authorization_only:true;
  required_permissions:Permission[];
  policies:PolicyDecision[];
}> {
  const input=object(raw,"composite verification");
  exact(input,["request_id","signed_vp"]);
  const id=nonempty(input.request_id,"request_id");
  const signed_vp=nonempty(input.signed_vp,"signed_vp");
  if (signed_vp.length > 2_000_000) {
    throw new GatewayError(413,"vp_too_large","Signed VP too large");
  }
  const record=deps.store.get(id);
  if(!record)throw new GatewayError(404,"unknown_request","Composite request not found");
  if(record.consumed)throw new GatewayError(409,"replay_detected","Composite request already consumed");
  record.consumed=true; // before the first await: one-time request even with concurrency
  const now=(deps.nowMs ?? Date.now)();
  const deny=(reason:string, code:string,status:number,message:string):never=>{
    event(deps,record,"composite_authorization_verified","deny",reason,now);
    throw new GatewayError(status,code,message);
  };
  if(now>=record.expires_at_ms) {
    deny("expired_request","expired_request",410,"Composite request expired");
  }
  if(!deps.verifier.verifyMultiple) {
    deny("verifier_unavailable","verifier_unavailable",503,
      "Composite cryptographic verification is not available");
  }
  let verified:VerifiedDelegation;
  const requirements=record.actions.map((a)=>a.permission);
  try {
    verified=await deps.verifier.verifyMultiple({
      presenter:record.agent_role,
      audience:record.audience,
      challenge:record.challenge,
      required_permissions:requirements,
      signed_vp
    });
    if (!requirements.every((p)=>verified.permissions.some((q)=>samePermission(p,q)))) {
      // Adapter/Core result inconsistency must not be interpreted as allow.
      throw new VerificationUnavailableError("Verifier returned an incomplete permission set");
    }
  } catch(error) {
    if(error instanceof VerificationUnavailableError || !(error instanceof VerificationRejectedError)) {
      deny("verifier_unavailable","verifier_unavailable",503,
        "Composite verification failed closed");
    }
    deny("verification_rejected","verification_rejected",403,
      "At least one required permission was not verified");
  }

  const policies: PolicyDecision[]=[];
  for(const action of record.actions) {
    // buildPolicyInput expects a prepared single-action record; this temporary
    // object has the exact derived permission for the current composite action.
    const policyRecord:PreparedRequestRecord={
      request_id:record.request_id,
      task_id:record.task_id,
      agent_role:record.agent_role,
      request:action.request,
      required_permission:action.permission,
      audience:record.audience,
      challenge:record.challenge,
      request_fingerprint:"",
      created_at_ms:record.created_at_ms,
      expires_at_ms:record.expires_at_ms,
      consumed:true
    };
    let decision:PolicyDecision;
    try {
      decision=await deps.policy.evaluate(buildPolicyInput(
        policyRecord,deps.config.repository,verified
      ));
      if(typeof decision.allow!=="boolean" || !decision.policy_version) {
        throw new Error("Malformed policy decision");
      }
    } catch {
      deny("policy_unavailable","policy_unavailable",503,"Composite OPA evaluation failed closed");
    }
    if(!decision.allow) {
      deny("policy_denied","policy_denied",403,
        "OPA denied at least one operation of the composite request");
    }
    policies.push(decision);
  }
  event(deps,record,"composite_authorization_verified","allow","verified_only_no_provider",now);
  return {
    request_id:record.request_id,
    decision:"allow",
    authorization_only:true,
    required_permissions:requirements,
    policies
  };
}
