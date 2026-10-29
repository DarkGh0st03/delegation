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
import type {SignedEngineerApprovalFileStore}
  from "./signed-approval-store.ts";
import {beginTrustedFreshRepairApprovedExecution}
  from "./trusted-fresh-planning-intake.ts";
import {createReviewedApprovedDagExecution,pinTrustedReviewedAgentEndpoints}
  from "./trusted-reviewed-approved-dag.ts";
import {createFreshTypecheckRepairIssueFence}
  from "./trusted-typecheck-repair-activation-fence.mjs";

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
  /**
   * R94 owner-controlled TypeScript repair admission. Omit only for other
   * fresh work; a compiler failure must enter via the strict wrapper below.
   * The source-free candidate cannot create new permission by itself.
   */
  typecheckRepairScope?:{
    approvalStore:SignedEngineerApprovalFileStore;
    previousSessionId:string;
    nextSessionId:string;
    expectedFreshMainSha:string;
    expectedRepository:{authority:string;owner:string;repository:string};
    trustedDiagnosticPath:string;
    ownerSelectedRole:"backend"|"frontend";
    previousApprovedBranch:string;
    nextApprovedBranch:string;
    nomination:unknown;
  };
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
  // Validate and immutably pin ALL endpoints before root issuance, including
  // before the first asynchronous liveness check. No invalid endpoint may
  // trigger irreversible credential issuance or consume a status entry.
  const pinnedEndpoints=pinTrustedReviewedAgentEndpoints(input.endpoints);
  const fence=input.typecheckRepairScope?
    createFreshTypecheckRepairIssueFence({
      reviewGate:input.reviewGate,repairScope:input.typecheckRepairScope
    }):null;
  await input.verifyLiveRun();
  let activated=false;
  let shutdownPromise:Promise<void>|undefined;
  const shutdown=():Promise<void>=>{
    // Concurrent cancellation/close callers must await the SAME terminal
    // retirement, not treat an in-progress shutdown as already complete.
    if(shutdownPromise)return shutdownPromise;
    shutdownPromise=(async()=>{
      try{
        if(input.nextCoordinator.phase==="execution")
          await input.nextCoordinator.closeExecution();
        // "closed" alone is not a receipt: await Gateway, native root
        // revocation and durable journal reconciliation.
        await input.nextCoordinator.assertOperationalClosureConfirmed();
      }finally{
        await input.close();
      }
    })();
    return shutdownPromise;
  };
  try{
    if(fence){
      // Prior to root issuance, pin the exact signed Engineer permission
      // decision and the R93 repair-role/Task restrictions.
      await fence.pinBeforeOperationalActivation();
      await input.verifyLiveRun();
    }
    // The existing beginExecution path reloads the SAME immutable signed
    // receipt before issuing the Rust operational root. The ReviewGate
    // rejects any different signed permission decision in between.
    const active=await beginTrustedFreshRepairApprovedExecution(input);
    activated=true;
    if(fence)await fence.recheckAfterOperationalActivation();
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
        endpoints:pinnedEndpoints
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
    }else if(fence&&input.nextCoordinator.phase==="planning"){
      // Pre-issuance rejection must also retire the still-live *read-only*
      // Planning root. It must not be mistaken for operational closure.
      try{
        await input.nextCoordinator.closePlanning();
        await input.close();
      }catch(retirementError){
        throw Error("Fresh repair Planning rejection; preliminary root retirement unconfirmed",
          {cause:retirementError});
      }
    }
    throw error;
  }
}


/**
 * Strict owner-only entry for a TypeScript recovery. A repair nomination is
 * NOT sufficient by itself; the signed fresh plan must pass R93 and the
 * review decision is pinned across issuance. No model calls occur here.
 */
export function armTrustedTypecheckRepairReviewedDag(input:
  Parameters<typeof armTrustedFreshRepairReviewedDag>[0] &
  {typecheckRepairScope:NonNullable<
    Parameters<typeof armTrustedFreshRepairReviewedDag>[0]["typecheckRepairScope"]
  >}
):ReturnType<typeof armTrustedFreshRepairReviewedDag>{
  if(!input||!input.typecheckRepairScope)
    throw Error("TypeScript repair requires trusted owner scope and fresh approval");
  return armTrustedFreshRepairReviewedDag(input);
}
