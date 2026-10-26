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

export function createReviewedApprovedDagExecution(input:{
  coordinator:TrustedExecutionCoordinator;
  reviewGate:TrustedPlanningReviewGate;
  running:Running;
  /** Host-owned live GitHub OIDC/REST watch, not a callback from the model. */
  verifyLiveRun:()=>Promise<void>;
  /** Must retire Gateway/root before tearing down the three A2A servers. */
  close:()=>Promise<void>;
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
  const pinnedUrls=ROLES.map(role=>endpoints?.[role]);
  if(pinnedUrls.some(url=>typeof url!=="string"||!LOOPBACK.test(url))||
     new Set(pinnedUrls).size!==ROLES.length)
    fail("Gemini A2A endpoints must be three distinct localhost servers");
  // Freeze a value copy, never a caller-owned mutable endpoint object.
  const agentBaseUrls=Object.freeze({
    backend:pinnedUrls[0]!,frontend:pinnedUrls[1]!,test:pinnedUrls[2]!
  });
  const pinned=Object.freeze({
    sessionId:readiness.session_id,
    planDigest:readiness.plan_digest,
    baseRevision:readiness.base_revision,
    engineerDid:readiness.authenticated_engineer_did,
    rootId:input.running.operational_root_id
  });
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
          authorityForTask:config.authorityForTask
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
