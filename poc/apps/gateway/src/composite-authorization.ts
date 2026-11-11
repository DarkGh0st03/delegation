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
import {DirectCoreRustVerifier} from "./direct-core-verifier.ts";
import {giteaPermissionCovers}
 from "../../../packages/plan-contracts/src/gitea-permission-containment.mjs";
import { GatewayError, VerificationRejectedError, VerificationUnavailableError } from "./errors.ts";
import { buildPolicyInput } from "./policy-input.ts";
import { validatePrepareAuthorizationRequest } from "./validation.ts";
import type {TrustedPlanningRevisions} from "./planning-revisions.ts";
import type {TrustedApprovedExecutionPlans} from "./approved-execution-plans.ts";
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
  /** Opt-in executable reads: never inferred from an authorization-only receipt. */
  read_execution?:Readonly<{
    pinned_revision:string;
    guard:"planning"|"approved";
    actions:readonly PreparedRequestRecord[];
  }>;
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
  planningRevisions?:TrustedPlanningRevisions;
  approvedPlans?:TrustedApprovedExecutionPlans;
  executor?:import("./types.ts").ExecutionPort;
  signal?:AbortSignal;
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

async function verifyCompositeInternal(
  raw: unknown, deps: CompositeDependencies, readExecution:boolean
) {
  const input=object(raw,"composite verification");
  exact(input,["request_id","signed_vp"]);
  const id=nonempty(input.request_id,"request_id");
  const signed_vp=nonempty(input.signed_vp,"signed_vp");
  if (signed_vp.length > 2_000_000) {
    throw new GatewayError(413,"vp_too_large","Signed VP too large");
  }
  const record=deps.store.get(id);
  if(!record)throw new GatewayError(404,"unknown_request","Composite request not found");
  if(Boolean(record.read_execution)!==readExecution)
    throw new GatewayError(403,"composite_mode_denied",
      "Composite approval cannot change its prepared execution mode");
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
    const nativePlanningHierarchy=readExecution&&
      record.read_execution?.guard==="planning"&&
      deps.planningRevisions!==undefined&&
      // A trusted approved-plan registry may be instantiated but cannot
      // grant these requests: the pinned Planning guard, not component
      // presence, decides which original Root authenticates the batch.
      record.read_execution?.guard==="planning"&&
      record.agent_role==="orchestrator"&&
      deps.verifier instanceof DirectCoreRustVerifier&&
      deps.verifier.allowsGiteaScopeCoverage;
    if (!requirements.every((p)=>verified.permissions.some((q)=>
      samePermission(p,q)||
      (nativePlanningHierarchy&&giteaPermissionCovers(q,p))))) {
      // An authenticated ancestor is legal only for this precise original
      // preliminary read transaction, NEVER generic operational bundles.
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
  for(const [index,action] of record.actions.entries()) {
    // Executable reads MUST carry the actual authenticated plan digest,
    // trusted work branch and exact pinned SHA into OPA, exactly as the
    // single-operation Gateway execution does. The authorization-only
    // historical path retains its old policy projection.
    const policyRecord:PreparedRequestRecord=record.read_execution
      ? record.read_execution.actions[index]!
      : {
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
    policies,
    record,verified
  };
}

export async function verifyCompositeAuthorization(raw:unknown,deps:CompositeDependencies){
  const {record,policies}=await verifyCompositeInternal(raw,deps,false);
  return {request_id:record.request_id,decision:"allow" as const,
    authorization_only:true as const,
    required_permissions:record.actions.map(x=>x.permission),policies};
}

/**
 * Prepare an executable READ-ONLY bundle. All operation/path grants are
 * independently checked against the active Planning session or signed Task.
 * The trusted provider pins one immutable SHA; no unapproved execution mode,
 * write, mixed branch or live-HEAD fallback is accepted.
 */
export async function prepareReadCompositeAuthorization(raw:unknown,
  deps:CompositeDependencies){
  const input=object(raw,"read composite prepare");
  exact(input,["task_id","agent_role","actions"]);
  if(!Array.isArray(input.actions)||input.actions.length<2||
     input.actions.length>MAX_COMPOSITE_ACTIONS)
    throw new GatewayError(400,"invalid_request","Read composite needs 2-12 actions");
  const taskId=nonempty(input.task_id,"task_id");
  const role=nonempty(input.agent_role,"agent_role") as AgentRole;
  const actions=input.actions.map((rawAction:unknown)=>{
    const action=object(rawAction,"read action");
    exact(action,["tool","arguments"]);
    const normalized=validatePrepareAuthorizationRequest({
      task_id:taskId,agent_role:role,tool:action.tool,arguments:action.arguments
    });
    if(!["read_file","list_directory"].includes(normalized.request.tool))
      throw new GatewayError(403,"composite_read_only",
        "Executable composite requests support read_file/list_directory only");
    return normalized.request;
  });
  const branches=actions.map(a=>"branch" in a.arguments?a.arguments.branch:null);
  if(branches.some(b=>!b||b!==branches[0]))
    throw new GatewayError(403,"composite_branch_mismatch",
      "Read composite must use one trusted branch");
  let planningRevision:string|undefined;
  let operational:ReturnType<TrustedApprovedExecutionPlans["authorizePrepare"]>|undefined;
  for(const request of actions){
    const permission=deriveRequiredPermission(deps.config.repository,request);
    const planning=deps.planningRevisions?.authorizePrepare(taskId,role,request);
    if(planning){
      if(operational||(planningRevision&&planningRevision!==planning))
        throw new GatewayError(403,"composite_binding_mismatch","Read scopes cannot be mixed");
      planningRevision=planning;
    }else{
      if(planningRevision||!deps.approvedPlans)
        throw new GatewayError(403,"composite_trusted_binding_required",
          "Read composite requires a trusted planning or signed Task binding");
      const next=deps.approvedPlans.authorizePrepare(taskId,role,permission,request);
      if(operational&&(
        next.plan_digest!==operational.plan_digest||
        next.plan_task_id!==operational.plan_task_id||
        next.work_branch!==operational.work_branch))
        throw new GatewayError(403,"composite_binding_mismatch","Read scopes cannot be mixed");
      operational=next;
    }
  }
  if(operational&&operational.work_branch!==branches[0])
    throw new GatewayError(403,"composite_branch_mismatch",
      "Read branch differs from signed plan");
  // Planning pins are already verified by the trusted Gateway session.
  // Operational bundles resolve HEAD via the actual Gitea provider once.
  const revision=planningRevision??
    await deps.executor?.resolveReadRevision?.(branches[0]!);
  if(typeof revision!=="string"||!/^[a-f0-9]{40}$/u.test(revision))
    throw new GatewayError(503,"composite_revision_unavailable",
      "Trusted immutable Gitea revision is unavailable");
  // Ensure no stale trusted binding was admitted during asynchronous HEAD read.
  const prepared=prepareCompositeAuthorization(raw,deps);
  const record=deps.store.get(prepared.request_id)!;
  const actionRecords=record.actions.map((a,i):PreparedRequestRecord=>({
    request_id:record.request_id+"."+i,
    task_id:record.task_id,agent_role:record.agent_role,
    request:a.request,required_permission:a.permission,
    audience:record.audience,challenge:record.challenge,
    request_fingerprint:"",pinned_revision:revision,
    ...(operational?{approved_plan_digest:operational.plan_digest,
      approved_plan_task_id:operational.plan_task_id,
      approved_work_branch:operational.work_branch}:{}),
    created_at_ms:record.created_at_ms,expires_at_ms:record.expires_at_ms,
    consumed:true
  }));
  record.read_execution=Object.freeze({
    pinned_revision:revision,
    guard:planningRevision?"planning" as const:"approved" as const,
    actions:Object.freeze(actionRecords)
  });
  return {...prepared,authorization_only:false as const,pinned_revision:revision};
}

/**
 * Verify one signed multipermission VP and ALL OPA decisions before reading
 * anything. Reads are pinned, bounded, and emitted only as one complete result.
 * Trusted Task effect accounting remains private; no batch grants are minted.
 */
export async function executeReadCompositeAuthorization(raw:unknown,
 deps:CompositeDependencies){
  const {record,verified,policies}=await verifyCompositeInternal(raw,deps,true);
  const read=record.read_execution!;
  const audit=(decision:"allow"|"deny",reason:string,
    provider_result:"success"|"error"|"not_called")=>
    deps.audit.emit({event:"composite_read_executed",
      timestamp:new Date((deps.nowMs??Date.now)()).toISOString(),
      request_id:record.request_id,task_id:record.task_id,
      agent_role:record.agent_role,permission_count:read.actions.length,
      decision,reason,provider_result,pinned_revision:read.pinned_revision});
  if(!deps.executor||!deps.planningRevisions&&read.guard==="planning"||
    !deps.approvedPlans&&read.guard==="approved"){
    audit("deny","trusted_boundary_unavailable","not_called");
    throw new GatewayError(503,"composite_boundary_unavailable",
      "Trusted read execution dependency unavailable");
  }
  // Check every Task's immutable permission immediately before provider IO.
  try{
    for(const action of read.actions){
      if(read.guard==="planning")
        deps.planningRevisions!.assertActiveForExecution(action);
      else deps.approvedPlans!.assertAuthorizedForExecution(
        action,verified.presenter_id,verified.credential_id);
    }
  }catch{
    audit("deny","trusted_binding_denied","not_called");
    throw new GatewayError(403,"composite_binding_denied",
      "Trusted read binding is no longer authorized");
  }
  const release=read.guard==="approved"
    ?deps.approvedPlans!.beginProviderEffect(read.actions[0]!):undefined;
  const results:import("./types.ts").ExecutionResult[]=[];
  let total=0;
  try{
    for(const action of read.actions){
      deps.signal?.throwIfAborted();
      // An in-flight fence blocks epoch retirement; recheck role and grants
      // for each action to prevent use after completion or revocation.
      if(read.guard==="planning")
        deps.planningRevisions!.assertActiveForExecution(action);
      else deps.approvedPlans!.assertAuthorizedForExecution(
        action,verified.presenter_id,verified.credential_id);
      const requested=action.request;
      if(requested.tool!=="read_file"&&requested.tool!=="list_directory")
        throw new GatewayError(403,"composite_read_only",
          "Trusted read bundle has an invalid operation");
      const result=await deps.executor.execute(action,deps.signal);
      if(result.provider!=="gitea"||result.performed!==true||
         result.tool!==requested.tool||
         !("revision" in result)||result.revision!==read.pinned_revision||
         !("branch" in result)||result.branch!==requested.arguments.branch||
         (result.tool==="read_file"&&requested.tool==="read_file"&&
          (result.path!==requested.arguments.path||
           result.encoding!=="utf-8"))||
         (result.tool==="list_directory"&&requested.tool==="list_directory"&&
          result.path!==requested.arguments.path))
        throw new GatewayError(503,"composite_provider_mismatch",
          "Read provider returned a mismatched immutable result");
      total+=Buffer.byteLength(JSON.stringify(result),"utf8");
      if(total>2*1024*1024)
        throw new GatewayError(413,"composite_result_too_large",
          "Combined read result exceeds 2 MiB");
      results.push(result);
    }
    if(read.guard==="approved"){
      for(let i=0;i<results.length;i++)
        deps.approvedPlans!.recordProviderSuccess(
          read.actions[i]!,results[i]!,verified.presenter_id,verified.credential_id);
    }
    audit("allow","all_reads_completed","success");
    return {request_id:record.request_id,decision:"allow" as const,
      pinned_revision:read.pinned_revision,policies,executions:results};
  }catch(error){
    audit("deny",error instanceof GatewayError?error.code:"provider_unavailable","error");
    if(error instanceof GatewayError)throw error;
    throw new GatewayError(503,"composite_provider_unavailable",
      "Composite Gitea read failed closed");
  }finally{release?.();}
}
