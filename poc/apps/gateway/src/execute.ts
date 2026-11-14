import {TrustedAuthorityOnlyBranchExecutor} from './trusted-authority-only-branch-executor.ts';
import { GiteaExecutor } from "./gitea-executor.ts";
import { OpaPolicyClient } from "./policy-client.ts";
import {TrustedAuthorityOnlyGiteaMutationExecutor}
 from "./trusted-authority-only-mutation-executor.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor}
 from "./trusted-authority-only-create-executor.ts";
import {TrustedAuthorityOnlyRunnerExecutor}
 from "./trusted-authority-only-runner-executor.ts";
import {TrustedAuthorityOnlyPullRequestExecutor}
 from "./trusted-authority-only-pull-request-executor.ts";
import {DirectCoreRustVerifier} from "./direct-core-verifier.ts";
import {giteaPermissionCovers,isProjectTestCreateGrant}
 from "../../../packages/plan-contracts/src/gitea-permission-containment.mjs";
import { performance } from "node:perf_hooks";
import {
  GatewayError,
  PolicyUnavailableError,
  ProviderConflictError,
  ProviderNotFoundError,
  ProviderOperationUnavailableError,
  ProviderUnavailableError,
  VerificationRejectedError,
  VerificationUnavailableError
} from "./errors.ts";
import { buildPolicyInput } from "./policy-input.ts";
import type { TrustedPlanningRevisions } from "./planning-revisions.ts";
import type { TrustedApprovedExecutionPlans } from "./approved-execution-plans.ts";
import type { TrustedAuthorityOnlyGatewayAdmissions } from "./trusted-authority-only-admissions.ts";
import type { TrustedGatewayGiteaReadEvidencePublisher }
 from "./trusted-authority-only-gitea-publisher.ts";
import { InMemoryRequestStore } from "./prepare.ts";
import type {
  AuditSink,
  ExecuteAuthorizationRequest,
  ExecuteAuthorizationResponse,
  ExecutionPort,
  ExecutionResult,
  GatewayRepositoryConfig,
  Permission,
  PolicyDecision,
  PolicyPort,
  PreparedRequestRecord,
  VerifierPort,
  VerifiedDelegation
} from "./types.ts";
import {APPLICATION_ROLES} from "../../../packages/plan-contracts/src/agent-roles.mjs";

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
  record: PreparedRequestRecord,
  allowVerifiedScope:boolean
): void {
  if (!includesPermission(verified.permissions, record.required_permission)&&
      !(allowVerifiedScope&&verified.permissions.some(
        p=>giteaPermissionCovers(p,record.required_permission)))) {
    throw new VerificationUnavailableError(
      "Verifier response did not contain the required permission"
    );
  }
}

function elapsed(start: number, durationNow: () => number): number {
  return Math.max(0, durationNow() - start);
}


/** Bounded single-line message for the OWNER audit sink only. */
function providerErrorDetail(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/[\r\n\t]+/gu, " ").slice(0, 300);
}
export interface ExecuteDependencies {
  store: InMemoryRequestStore;
  audit: AuditSink;
  verifier: VerifierPort;
  policy: PolicyPort;
  repository: GatewayRepositoryConfig;
  executor: ExecutionPort;
  planningRevisions?: TrustedPlanningRevisions;
  approvedPlans?: TrustedApprovedExecutionPlans;
  authorityOnlyAdmissions?: TrustedAuthorityOnlyGatewayAdmissions;
  /** Owner-only result publisher, required for opt-in authority-only reads. */
  authorityOnlyReceiptWriter?: TrustedGatewayGiteaReadEvidencePublisher;
  /** Owner-only opt-in for one durably reserved Gitea read per Task. */
  authorityOnlyReadEnabled?: boolean;
  /** Owner-only, opt-in atomic HEAD-CAS mutation; never the legacy PUT. */
  authorityOnlyMutationExecutor?:TrustedAuthorityOnlyGiteaMutationExecutor;
  authorityOnlyMutationEnabled?:boolean;
  /** R383.7 explicit original owner create HEAD-CAS; never legacy POST. */
  authorityOnlyCreateExecutor?:TrustedAuthorityOnlyGiteaCreateExecutor;
  authorityOnlyCreateEnabled?:boolean;
  /** Opt-in owner-controlled native Test Runner; never the legacy Runner. */
  authorityOnlyRunnerExecutor?:TrustedAuthorityOnlyRunnerExecutor;
  authorityOnlyRunnerEnabled?:boolean;
  authorityOnlyBranchExecutor?:TrustedAuthorityOnlyBranchExecutor;
  authorityOnlyBranchEnabled?:boolean;
  authorityOnlyPullRequestExecutor?:TrustedAuthorityOnlyPullRequestExecutor;
  authorityOnlyPullRequestEnabled?:boolean;
  nowMs?: () => number;
  durationNowMs?: () => number;
  signal?: AbortSignal;
}

export async function executeAuthorization(
  raw: unknown,
  dependencies: ExecuteDependencies
): Promise<ExecuteAuthorizationResponse> {
  if(dependencies.authorityOnlyAdmissions&&
     (dependencies.planningRevisions||dependencies.approvedPlans))
    throw new GatewayError(403,"authority_only_binding_denied",
      "Authority-only and legacy Gateway modes cannot share provider effects");
  if(dependencies.authorityOnlyRunnerExecutor&&
     (!dependencies.authorityOnlyAdmissions||
      !dependencies.authorityOnlyRunnerExecutor.isForAdmissions(
       dependencies.authorityOnlyAdmissions)))
    throw new GatewayError(403,"authority_only_binding_denied",
      "Runner Test Agent owner differs from trusted Gateway authority");
  if(dependencies.authorityOnlyMutationExecutor&&
     (!dependencies.authorityOnlyAdmissions||
      !dependencies.authorityOnlyMutationExecutor.isForAdmissions(
       dependencies.authorityOnlyAdmissions)))
    throw new GatewayError(403,"authority_only_binding_denied",
      "Atomic mutation owner differs from trusted Gateway authority");
  if(dependencies.authorityOnlyCreateExecutor&&
     (!dependencies.authorityOnlyAdmissions||
      !(dependencies.authorityOnlyCreateExecutor instanceof
       TrustedAuthorityOnlyGiteaCreateExecutor)||
      !TrustedAuthorityOnlyGiteaCreateExecutor.prototype.isForAdmissions.call(
       dependencies.authorityOnlyCreateExecutor,
       dependencies.authorityOnlyAdmissions)))
    throw new GatewayError(403,"authority_only_binding_denied",
      "Create CAS executor differs from original native Gateway authority");
  if(dependencies.authorityOnlyBranchExecutor&&
     (!dependencies.authorityOnlyAdmissions||
      !TrustedAuthorityOnlyBranchExecutor.isNativeForAdmissions(
       dependencies.authorityOnlyBranchExecutor,dependencies.authorityOnlyAdmissions)))
    throw new GatewayError(403,"authority_only_binding_denied","branch owner differs from original Gateway");
  if(dependencies.authorityOnlyPullRequestExecutor&&
     (!dependencies.authorityOnlyAdmissions||
      !TrustedAuthorityOnlyPullRequestExecutor.isNativeForAdmissions(
       dependencies.authorityOnlyPullRequestExecutor,dependencies.authorityOnlyAdmissions)))
    throw new GatewayError(403,"authority_only_binding_denied",
      "PR executor differs from original Gateway authority");
  if(dependencies.authorityOnlyReceiptWriter&&
     (!dependencies.authorityOnlyAdmissions||
      !dependencies.authorityOnlyReceiptWriter.isForAdmissions(
       dependencies.authorityOnlyAdmissions)))
    throw new GatewayError(403,"authority_only_binding_denied",
      "Gateway receipt writer must belong to the exact trusted admission instance");
  const request = validateExecuteRequest(raw);
  const nowMs = (dependencies.nowMs ?? Date.now)();
  const durationNow = dependencies.durationNowMs ?? (() => performance.now());
  const totalStarted = durationNow();

  const record = dependencies.store.get(request.request_id);
  if (!record) {
    throw new GatewayError(404, "unknown_request", "Prepared authorization request was not found");
  }
  const provider =
    dependencies.executor.providerFor?.(record) ?? dependencies.executor.provider;
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
    // R299: scope expansion is confined to the authority-only read flow.
    // The concrete native Rust verifier must have explicitly verified the
    // required leaf against a signed directory grant and its chain.
    validateVerifiedDelegation(verified, record,
      dependencies.verifier instanceof DirectCoreRustVerifier&&
      dependencies.verifier.allowsGiteaScopeCoverage&&
      (
        // Existing R299 authority-only signed Task read, unchanged.
        (!!record.authority_only_digest&&
         dependencies.authorityOnlyReadEnabled===true&&
         dependencies.authorityOnlyAdmissions!==undefined&&
         record.request.tool==="read_file")||
        // R380.3 separately bounded ORIGINAL preliminary Planning Root.
        // No operational-approved Task can inherit this ancestor scope.
        (!!record.pinned_revision&&
         dependencies.planningRevisions!==undefined&&
         record.approved_plan_digest===undefined&&
         record.approved_plan_task_id===undefined&&
         dependencies.authorityOnlyAdmissions===undefined&&
         record.agent_role==="orchestrator"&&
         (record.request.tool==="read_file"||
          record.request.tool==="list_directory"))
      ));
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

  // Native VP and OPA have both executed. Only an explicitly enabled,
  // durably reserved read may pass the authority-only binding gate.
  if(record.authority_only_digest||dependencies.authorityOnlyAdmissions){
    try{
      if(!dependencies.authorityOnlyAdmissions)
        throw Error("authority-only binding guard missing");
      if(dependencies.authorityOnlyReadEnabled===true&&
         dependencies.authorityOnlyReceiptWriter&&
         dependencies.executor instanceof GiteaExecutor&&
         record.request.tool==="read_file"){
        dependencies.authorityOnlyAdmissions.assertTrustedCompletedReadEvidenceBinding(
          record,verified);
      }else if(record.request.tool==="update_file"&&
         dependencies.authorityOnlyMutationEnabled===true&&
         dependencies.authorityOnlyMutationExecutor instanceof
           TrustedAuthorityOnlyGiteaMutationExecutor&&
         dependencies.authorityOnlyMutationExecutor.isForAdmissions(
           dependencies.authorityOnlyAdmissions)&&
         dependencies.verifier instanceof DirectCoreRustVerifier&&
         dependencies.policy instanceof OpaPolicyClient&&
         dependencies.executor instanceof GiteaExecutor&&
         !dependencies.approvedPlans&&!dependencies.planningRevisions){
        // No old blob-only PUT adapter, synthetic verifier, injected OPA,
        // legacy signed DAG, or unsupported provider may write here.
        dependencies.authorityOnlyAdmissions.assertTrustedCompletedMutationEvidenceBinding(
          record,verified);
      }else if(record.request.tool==="create_file"&&
         (APPLICATION_ROLES.includes(record.agent_role)||
          (record.agent_role==="test"&&
           isProjectTestCreateGrant([record.required_permission],
             dependencies.authorityOnlyAdmissions?.projectTestSourceProfile)))&&
         dependencies.authorityOnlyCreateEnabled===true&&
         dependencies.authorityOnlyCreateExecutor instanceof
           TrustedAuthorityOnlyGiteaCreateExecutor&&
         TrustedAuthorityOnlyGiteaCreateExecutor.prototype.isForAdmissions.call(
           dependencies.authorityOnlyCreateExecutor,
           dependencies.authorityOnlyAdmissions)&&
         dependencies.verifier instanceof DirectCoreRustVerifier&&
         dependencies.policy instanceof OpaPolicyClient&&
         dependencies.executor instanceof GiteaExecutor&&
         !dependencies.approvedPlans&&!dependencies.planningRevisions){
        // Test CREATE is additionally constrained to one exact tests/*
        // project source by the original signed Child and Gateway admission.
        // The ORIGINAL consumed Prepare, signed single-file Child and
        // durable Task flight are checked only after actual Rust VP + OPA.
        // Neither a mock verifier nor a legacy Gitea create can reach CAS.
        dependencies.authorityOnlyAdmissions.assertTrustedCreateNativeAdmissionBinding(
          record,verified);
      }else if(record.request.tool==="run_tests"&&
         record.agent_role==="test"&&
         dependencies.authorityOnlyRunnerEnabled===true&&
         dependencies.authorityOnlyRunnerExecutor instanceof
           TrustedAuthorityOnlyRunnerExecutor&&
         dependencies.authorityOnlyRunnerExecutor.isForAdmissions(
           dependencies.authorityOnlyAdmissions)&&
         dependencies.verifier instanceof DirectCoreRustVerifier&&
         dependencies.policy instanceof OpaPolicyClient&&
         dependencies.executor instanceof GiteaExecutor&&
         !dependencies.approvedPlans&&!dependencies.planningRevisions){
        // Exactly the pre-enrolled Test Child + immutable Runner commit,
        // never a legacy RunnerClient fallback or agent-chosen tested SHA.
        dependencies.authorityOnlyAdmissions.assertTrustedCompletedRunnerEvidenceBinding(
          record,verified);
      }else if(record.request.tool==="create_branch"&&record.agent_role==="orchestrator"&&
         dependencies.authorityOnlyBranchEnabled===true&&
         TrustedAuthorityOnlyBranchExecutor.isNativeForAdmissions(
          dependencies.authorityOnlyBranchExecutor,dependencies.authorityOnlyAdmissions)&&
         dependencies.verifier instanceof DirectCoreRustVerifier&&
         dependencies.policy instanceof OpaPolicyClient&&
         dependencies.executor instanceof GiteaExecutor&&
         !dependencies.approvedPlans&&!dependencies.planningRevisions){
        dependencies.authorityOnlyAdmissions.assertTrustedCompletedBranchEvidenceBinding(record,verified);
      }else if(record.request.tool==="create_pull_request"&&record.agent_role==="orchestrator"&&
         dependencies.authorityOnlyPullRequestEnabled===true&&
         TrustedAuthorityOnlyPullRequestExecutor.isNativeForAdmissions(
          dependencies.authorityOnlyPullRequestExecutor,dependencies.authorityOnlyAdmissions)&&
         dependencies.verifier instanceof DirectCoreRustVerifier&&
         dependencies.policy instanceof OpaPolicyClient&&
         dependencies.executor instanceof GiteaExecutor&&
         !dependencies.approvedPlans&&!dependencies.planningRevisions){
        dependencies.authorityOnlyAdmissions.assertTrustedCompletedPullRequestEvidenceBinding(
         record,verified);
      }else{
        dependencies.authorityOnlyAdmissions.assertVerifiedVpAndPolicyForExecution(
          record,verified);
      }
    }catch{
      dependencies.audit.emit({
        event:"authorization_executed",
        timestamp:new Date(nowMs).toISOString(),request_id:record.request_id,
        task_id:record.task_id,agent_role:record.agent_role,
        tool:record.request.tool,resource_uri:record.required_permission.resource,
        operation:record.required_permission.operation,
        decision:"deny",reason:"authority_only_execution_not_enabled",
        verification_ms:verificationMs,opa_ms:opaMs,
        policy_decision:"allow",policy_version:policyDecision.policy_version,
        provider_ms:0,provider_result:"not_called",
        total_ms:elapsed(totalStarted,durationNow),
        vp_size_bytes:Buffer.byteLength(request.signed_vp,"utf8"),
        chain_depth:verified.hierarchy_depth,
        disclosed_permission_count:verified.permissions.length,
        provider
      });
      throw new GatewayError(403,"authority_only_execution_not_enabled",
        "Authority-only Child DC/VP/Task execution binding is not enabled");
    }

  }

  // A pending challenge must not survive trusted Planning expiry/revocation.
  // Recheck after asynchronous cryptography/OPA, before any provider read.
  dependencies.planningRevisions?.assertActiveForExecution(record);
  if (!record.pinned_revision) {
    try {
      dependencies.approvedPlans?.assertAuthorizedForExecution(record,verified.presenter_id,verified.credential_id);
    } catch {
      dependencies.audit.emit({
        event:"authorization_executed",
        timestamp:new Date(nowMs).toISOString(),
        request_id:record.request_id,task_id:record.task_id,
        agent_role:record.agent_role,tool:record.request.tool,
        resource_uri:record.required_permission.resource,
        operation:record.required_permission.operation,
        decision:"deny",reason:"approved_plan_denied",
        verification_ms:verificationMs,opa_ms:opaMs,
        policy_decision:"allow",policy_version:policyDecision.policy_version,
        provider_ms:0,provider_result:"not_called",
        total_ms:elapsed(totalStarted,durationNow),
        vp_size_bytes:Buffer.byteLength(request.signed_vp,"utf8"),
        chain_depth:verified.hierarchy_depth,
        disclosed_permission_count:verified.permissions.length,
        ...(record.approved_plan_digest ? {approved_plan_digest:record.approved_plan_digest} : {}),
        provider
      });
      throw new GatewayError(403,"approved_plan_denied",
        "Trusted approved plan rejected the operation before provider execution");
    }
  }
  // Synchronous owner-private flight fence: an epoch must not advance
  // while an already-authorized provider request is still executing.
  const releaseEffect=!record.pinned_revision
    ?dependencies.approvedPlans?.beginProviderEffect(record):undefined;
  const providerStarted = durationNow();
  let execution: ExecutionResult;
  try {
    dependencies.signal?.throwIfAborted();
    if(record.authority_only_digest&&record.request.tool==="update_file"){
      // Reached ONLY after independent native Rust VP, real OPA and durable
      // owner-bound Task flight. Failure must not retry a pending CAS.
      if(dependencies.authorityOnlyMutationEnabled!==true||
         !dependencies.authorityOnlyMutationExecutor)
        throw new ProviderOperationUnavailableError(
          "Signed authority-only mutation executor is not configured");
      execution=await dependencies.authorityOnlyMutationExecutor
        .executeAfterVerifiedRustOpa(record,verified,policyDecision);
    }else if(record.authority_only_digest&&record.request.tool==="create_file"){
      if(dependencies.authorityOnlyCreateEnabled!==true||
         !(dependencies.authorityOnlyCreateExecutor instanceof
           TrustedAuthorityOnlyGiteaCreateExecutor))
        throw new ProviderOperationUnavailableError(
          "Signed native create CAS executor is not configured");
      // Invoke the original class implementation, not an overridden
      // public/provider/mocked method on an untrusted injection.
      execution=await TrustedAuthorityOnlyGiteaCreateExecutor.prototype
        .executeAfterVerifiedRustOpa.call(dependencies.authorityOnlyCreateExecutor,
          record,verified,policyDecision);
    }else if(record.authority_only_digest&&record.request.tool==="run_tests"){
      if(dependencies.authorityOnlyRunnerEnabled!==true||
         !dependencies.authorityOnlyRunnerExecutor)
        throw new ProviderOperationUnavailableError(
          "Signed Test Agent Runner executor is not configured");
      // A FAIL or ambiguous provider response is terminal, never retried.
      execution=await dependencies.authorityOnlyRunnerExecutor
        .executeAfterVerifiedRustOpa(record,verified,policyDecision);
    }else if(record.authority_only_digest&&record.request.tool==="create_branch"){
      if(dependencies.authorityOnlyBranchEnabled!==true||!dependencies.authorityOnlyBranchExecutor)
       throw new ProviderOperationUnavailableError("Original branch executor is not configured");
      execution=await TrustedAuthorityOnlyBranchExecutor.prototype.executeAfterVerifiedRustOpa.call(
       dependencies.authorityOnlyBranchExecutor,record,verified,policyDecision);
    }else if(record.authority_only_digest&&record.request.tool==="create_pull_request"){
      if(dependencies.authorityOnlyPullRequestEnabled!==true||
         !dependencies.authorityOnlyPullRequestExecutor)
       throw new ProviderOperationUnavailableError("Original PR executor is not configured");
      execution=await TrustedAuthorityOnlyPullRequestExecutor.prototype
       .executeAfterVerifiedRustOpa.call(dependencies.authorityOnlyPullRequestExecutor,
        record,verified,policyDecision);
    }else{
      execution = await dependencies.executor.execute(
        record,dependencies.signal);
    }
  } catch (error) {
    releaseEffect?.();
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
      ...(record.pinned_revision ? {pinned_revision:record.pinned_revision} : {}),
      ...(record.approved_plan_digest
        ? {approved_plan_digest:record.approved_plan_digest} : {}),
      provider,
      provider_error_detail: providerErrorDetail(error)
    };

    if (error instanceof ProviderNotFoundError) {
      dependencies.audit.emit({ ...common, reason: "provider_not_found" });
      throw new GatewayError(404, "provider_not_found", error.message);
    }
    if (error instanceof ProviderConflictError) {
      dependencies.audit.emit({ ...common, reason: "provider_conflict" });
      throw new GatewayError(409, "provider_conflict", error.message);
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

  // Count only real Gateway-confirmed provider effects as trusted evidence
  // for a later, separately attested A2A Task completion.
  try {
    if (!record.pinned_revision) {
      dependencies.approvedPlans?.recordProviderSuccess(
        record,execution,verified.presenter_id,verified.credential_id
      );
    }
  } finally {
    releaseEffect?.();
  }
  // R295: owner-only provenance publication must happen AFTER a *real*
  // GiteaExecutor success (it carries a private WeakMap result witness).
  // Only the explicitly enabled read gate above can reach this hook.
  if(record.authority_only_digest){
    if(execution.performed!==true)
      throw new GatewayError(403,"authority_only_binding_denied",
       "Authority-only provider result cannot be authenticated");
    if(execution.provider==="gitea"&&execution.tool==="read_file"){
      if(!dependencies.authorityOnlyReceiptWriter)
        throw new GatewayError(403,"authority_only_binding_denied",
         "Authority-only read lacks trusted result publisher");
      await dependencies.authorityOnlyReceiptWriter.publishSuccessfulRead({
       record,verified,policy:policyDecision,execution
      });
    }else if(execution.provider==="gitea"&&
             execution.tool==="update_file"&&
             !!dependencies.authorityOnlyMutationExecutor&&
             dependencies.authorityOnlyMutationEnabled===true){
      // Already independently attested and fsync'd in mutation executor.
    }else if(execution.provider==="gitea"&&
             execution.tool==="create_file"&&
             dependencies.authorityOnlyCreateEnabled===true&&
             dependencies.authorityOnlyCreateExecutor instanceof
               TrustedAuthorityOnlyGiteaCreateExecutor&&
             dependencies.authorityOnlyAdmissions&&
             TrustedAuthorityOnlyGiteaCreateExecutor.prototype.isForAdmissions.call(
               dependencies.authorityOnlyCreateExecutor,
               dependencies.authorityOnlyAdmissions)){
      // A one-shot CAS and TWO independent authenticated observations were
      // already sealed durably inside the private CREATE executor.
    }else if(execution.provider==="runner"&&
             execution.tool==="run_tests"&&execution.status==="pass"&&
             !!dependencies.authorityOnlyRunnerExecutor&&
             dependencies.authorityOnlyRunnerEnabled===true){
      // Runner PASS receipt already independently attested and sealed.
    }else if(execution.provider==="gitea"&&execution.tool==="create_branch"&&
             dependencies.authorityOnlyBranchEnabled===true&&dependencies.authorityOnlyAdmissions&&
             TrustedAuthorityOnlyBranchExecutor.isNativeForAdmissions(
              dependencies.authorityOnlyBranchExecutor,dependencies.authorityOnlyAdmissions)){
      TrustedAuthorityOnlyBranchExecutor.prototype.assertExecutionResult.call(
       dependencies.authorityOnlyBranchExecutor,record,execution);
    }else if(execution.provider==="gitea"&&execution.tool==="create_pull_request"&&
             dependencies.authorityOnlyPullRequestEnabled===true&&
             dependencies.authorityOnlyAdmissions&&
             TrustedAuthorityOnlyPullRequestExecutor.isNativeForAdmissions(
              dependencies.authorityOnlyPullRequestExecutor,dependencies.authorityOnlyAdmissions)){
      // POST, independent GET and tested HEAD were confirmed by this exact
      // executor. This witness is not a separately completed PR Task.
      TrustedAuthorityOnlyPullRequestExecutor.prototype.assertExecutionResult.call(
       dependencies.authorityOnlyPullRequestExecutor,record,execution);
    }else{
      throw new GatewayError(403,"authority_only_binding_denied",
       "Unauthorized authority-only provider result");
    }
  }
  const providerMs = elapsed(providerStarted, durationNow);
  const totalMs = elapsed(totalStarted, durationNow);
  const providerIdentifiers =
    execution.provider === "gitea"
      ? {
          ...("revision" in execution ? { provider_revision: execution.revision } : {}),
          ...("commit_sha" in execution
            ? { provider_commit_sha: execution.commit_sha }
            : {}),
          ...("blob_sha" in execution ? { provider_blob_sha: execution.blob_sha } : {}),
          ...("pull_request_id" in execution
            ? { provider_pull_request_id: execution.pull_request_id }
            : {}),
          ...("pull_request_number" in execution
            ? { provider_pull_request_number: execution.pull_request_number }
            : {}),
          ...("url" in execution && execution.url !== undefined
            ? { provider_pull_request_url: execution.url }
            : {})
        }
      : execution.provider === "runner"
        ? {
            provider_revision: execution.revision,
            runner_tested_commit_sha: execution.tested_commit_sha,
            runner_profile: execution.runner_profile,
            runner_status: execution.status,
            ...(execution.project_tests === undefined
              ? {}
              : { runner_project_tests_status: execution.project_tests.status }),
            ...(execution.researcher_acceptance === undefined
              ? {}
              : {
                  runner_researcher_acceptance_status:
                    execution.researcher_acceptance.status
                }),
            ...(execution.log_reference === undefined
              ? {}
              : { runner_log_reference: execution.log_reference })
          }
        : {};

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
    ...providerIdentifiers,
    ...(record.pinned_revision ? {pinned_revision:record.pinned_revision} : {}),
    ...(record.approved_plan_digest ? {approved_plan_digest:record.approved_plan_digest} : {}),
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
