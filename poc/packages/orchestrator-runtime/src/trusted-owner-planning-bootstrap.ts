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
import {
  DEFAULT_PLANNER_SESSION_MS,DEFAULT_ENGINEER_REVIEW_MS,
  MAX_PRELIMINARY_ROOT_SECONDS,MAX_ENGINEER_REVIEW_MS,
  TRUSTED_PLANNING_HANDOFF_MARGIN_MS
} from "../../plan-contracts/src/planning-limits.mjs";
import {isDeepStrictEqual} from "node:util";
import {TrustedPlanningRecoveryStore}
  from "./trusted-planning-recovery-store.ts";
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
import {TrustedReviewedPlanFile}
  from "./trusted-reviewed-plan-file.ts";
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
  /** Optional owner-only Engineer UI file derived from the signed checkpoint. */
  reviewPlanFile?:TrustedReviewedPlanFile;
  planningRecovery:TrustedPlanningRecoveryStore;
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
     !(config.planningRecovery instanceof TrustedPlanningRecoveryStore)||
     (config.reviewPlanFile!==undefined&&
       !(config.reviewPlanFile instanceof TrustedReviewedPlanFile))||
     config.coordinator.phase!=="idle"||
     !isDeepStrictEqual(config.planner?.snapshot,config.snapshot)||
     !config.gateway?.gatewayBaseUrl||!config.gateway?.adapterBaseUrl||
     !config.gateway?.adapterToken||
     !config.backendPrivateKeyPem||!config.backendKeyId)
    refuse("independent Planning components and idle Coordinator required");
  // A 15-minute inference ceiling cannot consume the entire provisional
  // credential's lifetime: Engineer review and signed handoff need their
  // OWN bounded time after a proposal. Reject undersized or stale roots
  // BEFORE beginning Gitea Planning or issuing any preliminary DC.
  const modelBudget=config.planner.maxPlanningMs??DEFAULT_PLANNER_SESSION_MS;
  const reviewBudget=config.checkpointLifetimeMs??DEFAULT_ENGINEER_REVIEW_MS;
  const root=config.preliminaryRoot;
  const notBefore=Date.parse(root?.valid_from??"");
  const elapsed=Date.now()-notBefore;
  if(!Number.isSafeInteger(modelBudget)||modelBudget<1000||
     modelBudget>DEFAULT_PLANNER_SESSION_MS||
     !Number.isSafeInteger(reviewBudget)||reviewBudget<1000||
     reviewBudget>MAX_ENGINEER_REVIEW_MS||
     !Number.isSafeInteger(root?.validity_seconds)||
     root.validity_seconds<1||
     root.validity_seconds>MAX_PRELIMINARY_ROOT_SECONDS||
     !Number.isFinite(notBefore)||elapsed< -60_000||
     root.validity_seconds*1000-Math.max(0,elapsed)<
       modelBudget+reviewBudget+TRUSTED_PLANNING_HANDOFF_MARGIN_MS)
    refuse("preliminary credential lacks independent Planning, Engineer review and handoff time");
  preliminaryReadPermissions(config.snapshot);
  config.reviewPlanFile?.assertCheckpointStore(config.checkpointStore);
  config.coordinator.assertPlanningRecoveryStore(config.planningRecovery);
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
    const packet=await bridge.proposePersistAndStage();
    if(config.reviewPlanFile){
      await config.reviewPlanFile.persist(packet);
      // File operations are asynchronous: never return an unsigned review
      // if the preliminary authority ended while writing to disk.
      if(config.coordinator.phase!=="planning")
        refuse("provisional authority ended while preparing Engineer plan");
    }
    return packet;
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
