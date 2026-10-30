/**
 * Authenticated MANUAL host: the missing bridge from three started Gemini
 * ADK/A2A servers to the SAME immutable Engineer-signed DAG dispatcher.
 *
 * No model call is performed by constructing the controller. The only entry
 * that can run paid inference is executeApprovedDag, and it is NOT exported
 * through the GitHub OIDC intake, Engineer UI, Gateway HTTP, A2A or MCP.
 *
 * All plan/permission authority is reloaded from the trusted review gate by
 * TrustedApprovedA2ADispatcher; no caller can provide a replacement digest,
 * session, role endpoint, Engineer DID or source SHA.
 */
import {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate} from "./trusted-planning-review-gate.ts";
import {TrustedApprovedA2ADispatcher} from "./trusted-approved-a2a-dispatcher.ts";
import {TrustedApprovedExecutionPlans}
  from "../../../apps/gateway/src/approved-execution-plans.ts";
import {TrustedPlanIpcClient}
  from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {TrustedOperationalEpochIntake}
  from "./trusted-operational-epoch-intake.ts";
import type {TrustedRepairFeedbackSignal}
  from "./trusted-validation-repair-feedback.ts";
// Both independently approved paid and nonbillable scripted executions
// present the same immutable, authority-relevant facts. Neither model
// budgets nor charge-consent fields can be used by the DAG dispatcher.

type Running={
  readonly readiness:Readonly<{
    session_id:string;
    base_revision:string;
    plan_digest:string;
    authenticated_engineer_did:string;
  }>;
  readonly operational_root_id:string;
  readonly endpoints:Readonly<Record<"backend"|"frontend"|"test",string>>;
};
type DispatcherInput=Parameters<
  typeof TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority
>[0];
type ExecutorInput=Pick<DispatcherInput,
  "a2a"|"adapter"|"authorityForTask"
>&{
  invokeOrchestratorTask:(planTaskId:string,gatewayTaskId:string)=>Promise<unknown>;
};
const SHA=/^[a-f0-9]{40}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ROLES=["backend","frontend","test"] as const;
const LOOPBACK=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/?$/u;
function fail(reason:string):never{
  throw Error("Reviewed Gemini DAG bridge: "+reason);
}

/** Shared owner-side A2A endpoint preflight. Run this BEFORE any new
 * operational root issuance and freeze a defensive copy across awaits. */
export function pinTrustedReviewedAgentEndpoints(
  endpoints:Readonly<Record<"backend"|"frontend"|"test",string>>
):Readonly<Record<"backend"|"frontend"|"test",string>>{
  const pinnedUrls=ROLES.map(role=>endpoints?.[role]);
  if(pinnedUrls.some(url=>typeof url!=="string"||!LOOPBACK.test(url))||
     new Set(pinnedUrls).size!==ROLES.length)
    fail("Gemini A2A endpoints must be three distinct localhost servers");
  return Object.freeze({
    backend:pinnedUrls[0]!,frontend:pinnedUrls[1]!,test:pinnedUrls[2]!
  });
}

export function createReviewedApprovedDagExecution(input:{
  coordinator:TrustedExecutionCoordinator;
  reviewGate:TrustedPlanningReviewGate;
  running:Running;
  /** Host-owned live GitHub OIDC/REST watch, not a callback from the model. */
  verifyLiveRun:()=>Promise<void>;
  /** Must retire Gateway/root before tearing down the three A2A servers. */
  close:()=>Promise<void>;
  /** Owner-only R113 continuation; not exposed in A2A/MCP/model inputs.
   * The callback must complete within the lifetime of the same Rust root. */
  verifiedTestFailureRecovery?:Readonly<{
    gateway:TrustedApprovedExecutionPlans|TrustedPlanIpcClient;
    intake:TrustedOperationalEpochIntake;
    continueWithinActiveRoot:(signal:Readonly<TrustedRepairFeedbackSignal>)=>Promise<void>;
  }>;
}){
  if(!(input.coordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     typeof input.verifyLiveRun!=="function"||
     typeof input.close!=="function")fail("trusted Coordinator and signed review required");
  const readiness=input.running?.readiness;
  const endpoints=input.running?.endpoints;
  if(!readiness||!SESSION.test(readiness.session_id)||
     !SHA.test(readiness.base_revision)||
     !DIGEST.test(readiness.plan_digest)||
     !readiness.authenticated_engineer_did?.startsWith("did:")||
     !input.running.operational_root_id)
    fail("missing authenticated signed plan, base SHA or operational root");
  // Freeze a value copy, never a caller-owned mutable endpoint object.
  const agentBaseUrls=pinTrustedReviewedAgentEndpoints(endpoints);
  const pinned=Object.freeze({
    sessionId:readiness.session_id,
    planDigest:readiness.plan_digest,
    baseRevision:readiness.base_revision,
    engineerDid:readiness.authenticated_engineer_did,
    rootId:input.running.operational_root_id
  });
  const recovery=input.verifiedTestFailureRecovery;
  if(recovery){
    if(typeof recovery.continueWithinActiveRoot!=="function")
      fail("R113 owner-controlled recovery callback required");
    // The original same-process pathway retains its pre-existing R112
    // enforcement in dispatcher.load(). Require additional identity and
    // lease checks HERE only for the new remote IPC capability. Local
    // bridge test doubles are never passed to a real privileged dispatcher.
    if(recovery.gateway instanceof TrustedPlanIpcClient){
      if(!(recovery.intake instanceof TrustedOperationalEpochIntake))
        fail("R117 remote recovery requires original signed Rust-root intake");
      recovery.intake.assertSameCoordinator(input.coordinator);
      if(!recovery.gateway.operationalLeaseConfigured()||
         !recovery.gateway.operationalSessionDurableConfigured())
        fail("R117 remote recovery requires durable Gateway operational fences");
    }
  }
  let attempted=false;
  return Object.freeze({
    async executeApprovedDag(config:ExecutorInput){
      if(attempted)fail("approved DAG dispatch is one-shot; retry forbidden");
      attempted=true; // reserve BEFORE any network verification/effect
      try{
        await input.verifyLiveRun();
        if(input.coordinator.phase!=="execution")
          fail("operational Execution is not active");
        const authority=input.coordinator.trustedOperationalAuthority();
        if(authority.credential_id!==pinned.rootId||
           authority.plan_digest!==pinned.planDigest)
          fail("operational root no longer matches signed Engineer approval");
        const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
          approvals:input.reviewGate,coordinator:input.coordinator,
          sessionId:pinned.sessionId,
          expectedPlanDigest:pinned.planDigest,
          baseRevision:pinned.baseRevision,
          expectedEngineerDid:pinned.engineerDid,
          agentBaseUrls,
          a2a:config.a2a,adapter:config.adapter,
          authorityForTask:config.authorityForTask,
          ...(recovery?{verifiedTestFailureRecovery:{
            gateway:recovery.gateway,intake:recovery.intake
          }}:{})
        });
        const completed=await dispatcher.executeApprovedDag({
          invokeOrchestratorTask:config.invokeOrchestratorTask,
          // The trusted host owns this callback; neither the model nor
          // the operator-supplied task executor can replace it.
          beforeTask:async()=>{await input.verifyLiveRun();},
          // The dispatcher itself awaits Gateway closure, native Rust root
          // revocation and durable reconciliation BEFORE returning.
          // Therefore the last post-Task liveness check MUST occur via
          // this hook while the trusted operational session is still live.
          beforeCompletion:async()=>{await input.verifyLiveRun();}
        });
        // R112 only suspends a verified failed Test, never completes it.
        // Preserve the root while an owner-only callback executes; afterward
        // the existing finally retires authority. Every uncertainty closes.
        if(completed.status==="verified_test_failure_suspended"){
          const feedback=completed.verified_test_failure;
          if(!recovery||!feedback||
             feedback.status!=="repair_planning_eligible"||
             feedback.provenance!=="gateway_verified_docker_runner"||
             feedback.authority_kind!=="existing_rust_operational_root"||
             feedback.execution_authorized!==false||
             feedback.permission_granted!==false||
             feedback.session_id!==pinned.sessionId||
             feedback.root_plan_digest!==pinned.planDigest)
            fail("R113 verified Test FAIL lacks owner-bound repair admission");
          const assertStillActive=()=>{
            if(input.coordinator.phase!=="execution")
              fail("R113 original operational root retired during repair handoff");
            const current=input.coordinator.trustedOperationalAuthority();
            if(current.credential_id!==pinned.rootId||
               current.plan_digest!==pinned.planDigest)
              fail("R113 repair handoff changed the signed Rust root");
          };
          await input.verifyLiveRun();
          assertStillActive();
          await recovery.continueWithinActiveRoot(feedback);
          await input.verifyLiveRun();
          assertStillActive();
          // Deliberately NOT completed or PASS: requires separate acceptance.
          return {...completed,
            status:"verified_test_failure_recovery_handoff" as const};
        }
        if(completed.status&&completed.status!=="completed")
          fail("unrecognized signed DAG terminal status");
        // CLOSED is the only valid successful terminal phase here.
        // Requiring execution would reject EVERY actual successful DAG:
        // executeApprovedDag() already awaited closeExecution().
        if(input.coordinator.phase!=="closed")
          fail("operational root not closed after signed DAG completion");
        // Verify the SAME GitHub job again after durable closure. If a
        // cancellation raced revocation, never return verified success.
        await input.verifyLiveRun();
        if(input.coordinator.phase!=="closed")
          fail("operational root terminal phase changed after closure");
        return completed;
      } finally {
        // Closing the host's session is mandatory even when a plan mismatch,
        // run cancellation, broken Adapter or A2A error prevents dispatch.
        await input.close();
      }
    }
  });
}
