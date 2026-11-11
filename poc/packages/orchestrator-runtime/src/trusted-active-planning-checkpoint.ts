/**
 * PRIVATE in-process Planning -> persisted, signed checkpoint bridge.
 *
 * A real active TrustedExecutionCoordinator and its bound
 * TrustedPlanningGatewayReadPort must produce the only candidate via
 * TrustedAdkReadOnlyPlanner.propose(). Never take an uploaded proposal, a
 * GitHub event, an A2A message or a model-supplied signer/approval.
 *
 * Persistence and review staging never authorize Execution, create a DC,
 * sign for the Engineer or trigger Gemini automatically.
 */
import {DEFAULT_ENGINEER_REVIEW_MS,MAX_ENGINEER_REVIEW_MS} from "../../plan-contracts/src/planning-limits.mjs";
import {createPrivateKey} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {TrustedAdkReadOnlyPlanner} from "./trusted-adk-planner.ts";
import {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import type {TrustedPlanningSnapshot}
  from "./trusted-engineer-authority.ts";
import {TrustedPlanningGatewayReadPort}
  from "./trusted-planning-gateway-port.ts";
import {TrustedPlanningReviewGate,type PlanningReviewPacket}
  from "./trusted-planning-review-gate.ts";
import {SignedPlanningCheckpointFileStore}
  from "./trusted-planning-checkpoint-store.ts";
import {signTrustedPlanningCheckpoint}
  from "./trusted-planning-checkpoint.ts";

type Input={
  coordinator:TrustedExecutionCoordinator;
  planner:TrustedAdkReadOnlyPlanner;
  reviewGate:TrustedPlanningReviewGate;
  checkpointStore:SignedPlanningCheckpointFileStore;
  /** An owner-configured snapshot; never copy a model-supplied identity. */
  snapshot:TrustedPlanningSnapshot;
  expectedWorkBranch:string;
  /** Loaded privately by the trusted backend; never forwarded to ADK. */
  backendKeyId:string;
  backendPrivateKeyPem:string;
  checkpointLifetimeMs?:number;
};

function deny():never{
  throw Error("Trusted active Planning checkpoint: missing or changed active authority");
}

export class TrustedActivePlanningCheckpoint {
  readonly #config:Input;
  readonly #snapshot:TrustedPlanningSnapshot;
  readonly #port:TrustedPlanningGatewayReadPort;
  #attempted=false;

  constructor(config:Input){
    if(!(config.coordinator instanceof TrustedExecutionCoordinator)||
       !(config.planner instanceof TrustedAdkReadOnlyPlanner)||
       !(config.reviewGate instanceof TrustedPlanningReviewGate)||
       !(config.checkpointStore instanceof SignedPlanningCheckpointFileStore)||
       !(config.planner.config.readPort instanceof TrustedPlanningGatewayReadPort)||
       typeof config.expectedWorkBranch!=="string"||
       config.expectedWorkBranch!==config.planner.config.workBranch||
       !Number.isSafeInteger(config.checkpointLifetimeMs??DEFAULT_ENGINEER_REVIEW_MS)||
       (config.checkpointLifetimeMs??DEFAULT_ENGINEER_REVIEW_MS)<1000||
       (config.checkpointLifetimeMs??DEFAULT_ENGINEER_REVIEW_MS)>MAX_ENGINEER_REVIEW_MS||
       !isDeepStrictEqual(config.snapshot,config.planner.config.snapshot))
      deny();
    // Reject invalid trusted backend keys before any potentially paid model
    // invocation. Their actual public key must also match the independent
    // file-store trust pin when the signed checkpoint is persisted.
    try{
      if(createPrivateKey(config.backendPrivateKeyPem).asymmetricKeyType!=="ed25519")
        deny();
    }catch{deny();}
    this.#config=config;
    this.#snapshot=structuredClone(config.snapshot);
    this.#port=config.planner.config.readPort;
    this.#active();
  }

  #active():void{
    const {coordinator,planner,expectedWorkBranch}=this.#config;
    if(coordinator.phase!=="planning"||
       expectedWorkBranch!==planner.config.workBranch||
       !isDeepStrictEqual(this.#snapshot,planner.config.snapshot)||
       planner.config.readPort!==this.#port)deny();
    // The port proves its private coordinator object identity; phase or SHA
    // comparisons alone cannot authenticate a separate coordinator.
    this.#port.assertTrustedPlanningBinding(coordinator,this.#snapshot);
  }

  /** One attempt. An ambiguous persisted file blocks retries and must be
   * reconciled by the owner; it must never be silently overwritten. */
  async proposePersistAndStage():Promise<PlanningReviewPacket>{
    if(this.#attempted)
      throw Error("Trusted active Planning checkpoint: one attempt only");
    this.#attempted=true;
    this.#active();
    // All source reads still traverse Gateway -> Adapter VP -> Rust/OPA ->
    // pinned Gitea, using the active, scoped provisional root.
    const proposal=await this.#config.planner.propose();
    this.#active();
    const now=Date.now();
    const signed=signTrustedPlanningCheckpoint({
      snapshot:this.#snapshot,
      expectedWorkBranch:this.#config.expectedWorkBranch,
      proposal,
      keyId:this.#config.backendKeyId,
      privateKeyPem:this.#config.backendPrivateKeyPem,
      issuedAt:new Date(now).toISOString(),
      expiresAt:new Date(now+(this.#config.checkpointLifetimeMs??DEFAULT_ENGINEER_REVIEW_MS))
        .toISOString()
    });
    this.#active();
    await this.#config.checkpointStore.persistVerified(signed);
    this.#active();
    // Reload with the pinned backend public key and on-disk file checks
    // before exposing a packet that the Engineer may inspect separately.
    const stored=await this.#config.checkpointStore.load();
    this.#active();
    const packet=this.#config.checkpointStore.stageVerified(
      this.#config.reviewGate,stored);
    if(packet.plan_digest!==proposal.digest)deny();
    return packet;
  }
}
