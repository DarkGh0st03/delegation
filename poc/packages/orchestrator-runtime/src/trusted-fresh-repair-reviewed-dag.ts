/**
 * Private trusted owner handoff from a freshly signed repair approval into
 * the EXISTING reviewed ADK/A2A DAG controller. This does not run a model,
 * dispatch a task, or grant any permissions beyond the signed receipt.
 *
 * The former root must have been durably retired. No user-supplied digest,
 * Engineer DID or permission list is accepted as authority. A failed
 * post-activation check retires the newly issued root BEFORE host teardown.
 */
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import type {RootParameters}
  from "./trusted-engineer-authority.ts";
import {beginTrustedFreshRepairApprovedExecution}
  from "./trusted-fresh-planning-intake.ts";
import {createReviewedApprovedDagExecution}
  from "./trusted-reviewed-approved-dag.ts";

type AgentEndpoints=Readonly<Record<"backend"|"frontend"|"test",string>>;
function fail(reason:string):never{
  throw Error("Trusted fresh repair DAG: "+reason);
}

/**
 * Explicit owner action. The returned controller is ARMED, not executing:
 * only its separately invoked executeApprovedDag can reach A2A/paid models.
 * The caller must independently authorize any paid inference beforehand.
 */
export async function armTrustedFreshRepairReviewedDag(input:{
  previousCoordinator:TrustedExecutionCoordinator;
  nextCoordinator:TrustedExecutionCoordinator;
  nextSessionId:string;
  reviewGate:TrustedPlanningReviewGate;
  operationalRoot:RootParameters;
  /** Operator-pinned live Agent Card endpoints, never LLM output. */
  endpoints:AgentEndpoints;
  /** Authenticated current GitHub run liveness, rechecked around issuance. */
  verifyLiveRun:()=>Promise<void>;
  /** Stop the trusted host AFTER revoking operational authority. */
  close:()=>Promise<void>;
}):Promise<ReturnType<typeof createReviewedApprovedDagExecution>>{
  if(!input||!(input.nextCoordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     typeof input.verifyLiveRun!=="function"||
     typeof input.close!=="function")
    fail("private fresh owner and live-run verification are required");
  // Never issue an operational root for a canceled/non-current job.
  await input.verifyLiveRun();
  let activated=false;
  let shutdownStarted=false;
  const shutdown=async()=>{
    if(shutdownStarted)return;
    shutdownStarted=true;
    try{
      if(input.nextCoordinator.phase==="execution")
        await input.nextCoordinator.closeExecution();
      // A mere "closed" phase is insufficient; await Gateway, Rust and
      // durable recovery reconciliation before completing host shutdown.
      await input.nextCoordinator.assertOperationalClosureConfirmed();
    }finally{
      await input.close();
    }
  };
  try{
    const active=await beginTrustedFreshRepairApprovedExecution(input);
    activated=true;
    const receipt=await input.reviewGate
      .loadAuthenticatedApproval(active.session_id);
    if((receipt.approval as {decision_id?:string}).decision_id!==
        active.approval_decision_id)
      fail("independent signed permission decision changed during arming");
    const controller=createReviewedApprovedDagExecution({
      coordinator:input.nextCoordinator,reviewGate:input.reviewGate,
      running:{
        readiness:{
          session_id:active.session_id,base_revision:active.base_revision,
          plan_digest:active.plan_digest,
          authenticated_engineer_did:receipt.authenticated_engineer_did
        },
        operational_root_id:active.operational_root_id,
        endpoints:input.endpoints
      },
      verifyLiveRun:input.verifyLiveRun,close:shutdown
    });
    await input.verifyLiveRun();
    return controller;
  }catch(error){
    if(activated){
      try{await shutdown();}
      catch(retirementError){
        throw Error("Fresh repair DAG admission failed; root retirement unconfirmed",
          {cause:retirementError});
      }
    }
    throw error;
  }
}
