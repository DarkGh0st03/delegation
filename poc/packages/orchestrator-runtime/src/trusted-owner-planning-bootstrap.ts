/**
 * Owner-controlled, private Planning bootstrap executed BEFORE the
 * authenticated Engineer review listener is exposed.
 *
 * The host supplies the Gitea-pinned snapshot, a new provisional root,
 * approved model object, Gateway/Adapter transport, separate backend
 * signing key, review gate and independently pinned checkpoint store.
 * No HTTP, A2A, MCP, LLM tool, or GitHub event can invoke this module.
 *
 * On any failure after a confirmed Planning root issue, synchronously
 * fence its read-only phase and attempt native revocation. A rejected
 * retirement is MANUAL RECONCILIATION, never an automatic retry.
 */
import {isDeepStrictEqual} from "node:util";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {TrustedAdkReadOnlyPlanner,type TrustedAdkPlannerConfig}
  from "./trusted-adk-planner.ts";
import {TrustedPlanningGatewayReadPort,
  type TrustedPlanningGatewayPortConfig}
  from "./trusted-planning-gateway-port.ts";
import {TrustedPlanningReviewGate,type PlanningReviewPacket}
  from "./trusted-planning-review-gate.ts";
import {SignedPlanningCheckpointFileStore}
  from "./trusted-planning-checkpoint-store.ts";
import {TrustedActivePlanningCheckpoint}
  from "./trusted-active-planning-checkpoint.ts";
import {preliminaryReadPermissions,type RootParameters,
  type TrustedPlanningSnapshot} from "./trusted-engineer-authority.ts";

export interface OwnerControlledPlanningConfig {
  coordinator:TrustedExecutionCoordinator;
  snapshot:TrustedPlanningSnapshot;
  preliminaryRoot:RootParameters;
  planner:Omit<TrustedAdkPlannerConfig,"readPort">;
  gateway:Omit<TrustedPlanningGatewayPortConfig,"coordinator"|"snapshot">;
  reviewGate:TrustedPlanningReviewGate;
  checkpointStore:SignedPlanningCheckpointFileStore;
  backendKeyId:string;
  backendPrivateKeyPem:string;
  checkpointLifetimeMs?:number;
}

function refuse(message:string):never{
  throw Error("Trusted owner Planning bootstrap: "+message);
}

/** Returns only an unapproved human-review packet. Deliberately retains
 * the short-lived Planning root for the subsequent independently signed
 * human authorization; this module NEVER starts Execution or paid agents. */
export async function startOwnerControlledPlanningReview(
  config:OwnerControlledPlanningConfig
):Promise<PlanningReviewPacket>{
  // Validate operator-supplied bindings BEFORE any root issuance or inference.
  if(!(config.coordinator instanceof TrustedExecutionCoordinator)||
     !(config.reviewGate instanceof TrustedPlanningReviewGate)||
     !(config.checkpointStore instanceof SignedPlanningCheckpointFileStore)||
     config.coordinator.phase!=="idle"||
     !isDeepStrictEqual(config.planner?.snapshot,config.snapshot)||
     !config.gateway?.gatewayBaseUrl||!config.gateway?.adapterBaseUrl||
     !config.gateway?.adapterToken||
     !config.backendPrivateKeyPem||!config.backendKeyId)
    refuse("independent Planning components and idle Coordinator required");
  preliminaryReadPermissions(config.snapshot);
  await config.coordinator.beginPlanning(config.preliminaryRoot);
  try{
    const readPort=new TrustedPlanningGatewayReadPort({
      ...config.gateway,coordinator:config.coordinator,
      snapshot:config.snapshot
    });
    const planner=new TrustedAdkReadOnlyPlanner({
      ...config.planner,readPort
    });
    const bridge=new TrustedActivePlanningCheckpoint({
      coordinator:config.coordinator,planner,
      reviewGate:config.reviewGate,
      checkpointStore:config.checkpointStore,
      snapshot:config.snapshot,
      expectedWorkBranch:config.planner.workBranch,
      backendKeyId:config.backendKeyId,
      backendPrivateKeyPem:config.backendPrivateKeyPem,
      ...(config.checkpointLifetimeMs===undefined?{}:{
        checkpointLifetimeMs:config.checkpointLifetimeMs
      })
    });
    return await bridge.proposePersistAndStage();
  }catch(error){
    // A failed model, source read, signature or disk write must NEVER
    // leave an unreviewable provisional root running as if accepted.
    try{
      await config.coordinator.closePlanning();
    }catch(revocationFailure){
      throw Error("Trusted owner Planning bootstrap: provisional root cancellation unconfirmed; manual reconciliation required",
        {cause:revocationFailure});
    }
    throw error;
  }
}
