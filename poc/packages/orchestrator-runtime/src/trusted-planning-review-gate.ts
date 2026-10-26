/**
 * Private trusted Planning -> Engineer review boundary.
 *
 * Instantiated by the authenticated Engineer backend, with an out-of-band
 * pinned Ed25519 public-key store. The ADK result is UNAPPROVED. No signing
 * key, model-facing tool, public route, or automatic approval exists here.
 *
 * Both the Rust authority and Gateway plan registry must use THIS SAME gate.
 * It binds the approved plan to the exact staged Planning digest and freezes
 * the first authentic permission decision across both root issuance and
 * Gateway activation. Digest equality alone is never human authentication.
 */
import {timingSafeEqual} from "node:crypto";
import {planDigest,validatePlan,assertApprovedPlanScope}
  from "../../plan-contracts/src/plan.mjs";
import {approvedWorkBranch}
  from "../../plan-contracts/src/approved-work-branch.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import type {UnapprovedPlanProposal}
  from "./trusted-adk-planner.ts";
import {preliminaryReadPermissions,type TrustedPlanningSnapshot,
  type TrustedApprovalRecord,type TrustedApprovalStore}
  from "./trusted-engineer-authority.ts";
import {SignedEngineerApprovalFileStore}
  from "./signed-approval-store.ts";

const OPERATIONS=new Set<string>(RUST_OPERATIONS);
const DIGEST=/^[0-9a-f]{64}$/u;
function refuse(message:string):never{
  throw Error("Trusted Planning review: "+message);
}
function equalDigest(left:string,right:string):boolean{
  return DIGEST.test(left)&&DIGEST.test(right)&&
    timingSafeEqual(Buffer.from(left,"hex"),Buffer.from(right,"hex"));
}
export interface PlanningReviewPacket {
  status:"awaiting_engineer_signature";
  session_id:string;
  plan_id:string;
  version:number;
  base_revision:string;
  work_branch:string;
  plan_digest:string;
  verified_source_reads:number;
  /** An exact copy for independent Engineer inspection, NOT authorization. */
  plan:ReturnType<typeof validatePlan>;
}

export class TrustedPlanningReviewGate implements TrustedApprovalStore {
  readonly #snapshot:TrustedPlanningSnapshot;
  readonly #signed:SignedEngineerApprovalFileStore;
  readonly #engineerDid:string;
  readonly #branch:string;
  readonly #planningIsActive:()=>boolean;
  #packet?:PlanningReviewPacket;
  #receiptDigest?:string;

  constructor(config:{
    snapshot:TrustedPlanningSnapshot;
    expectedWorkBranch:string;
    authenticatedEngineerDid:string;
    signedApprovals:SignedEngineerApprovalFileStore;
    /** Trusted coordinator phase, NOT a model/UI request flag. */
    planningIsActive:()=>boolean;
  }){
    preliminaryReadPermissions(config.snapshot);
    if(!config.authenticatedEngineerDid?.startsWith("did:")||
       !(config.signedApprovals instanceof SignedEngineerApprovalFileStore)||
       typeof config.planningIsActive!=="function")
      refuse("pinned Engineer signature store and trusted coordinator required");
    this.#snapshot=structuredClone(config.snapshot);
    this.#signed=config.signedApprovals;
    this.#engineerDid=config.authenticatedEngineerDid;
    this.#branch=config.expectedWorkBranch;
    this.#planningIsActive=config.planningIsActive;
  }

  /**
   * Called ONLY with the direct return of TrustedAdkReadOnlyPlanner.propose()
   * by the private Planning coordinator. This does not authenticate model
   * output by itself; an external caller must never be permitted to stage it.
   */
  stageTrustedProposal(result:UnapprovedPlanProposal):PlanningReviewPacket{
    if(!this.#planningIsActive())refuse("verified Planning phase is not active");
    if(this.#packet)refuse("one immutable proposal per Planning session");
    if(result?.status!=="unapproved_proposal"||
       !Number.isSafeInteger(result.verified_source_reads)||
       result.verified_source_reads<1||result.verified_source_reads>64||
       typeof result.digest!=="string")
      refuse("no grounded, unapproved Planner result");
    const plan=structuredClone(result.plan);
    validatePlan(plan,{allowedOperations:OPERATIONS});
    if(plan.version!==1||plan.session_id!==this.#snapshot.session_id||
       plan.base_revision!==this.#snapshot.base_revision||
       JSON.stringify(plan.repository)!==JSON.stringify(this.#snapshot.repository)||
       !equalDigest(result.digest,planDigest(plan))||
       approvedWorkBranch(plan)!==this.#branch||
       plan.tasks.length>12||plan.requested_permissions.length>64){
      refuse("proposal does not match the trusted session, SHA, work branch or digest");
    }
    this.#packet={
      status:"awaiting_engineer_signature",
      session_id:plan.session_id,
      plan_id:plan.plan_id,
      version:plan.version,
      base_revision:plan.base_revision,
      work_branch:this.#branch,
      plan_digest:result.digest,
      verified_source_reads:result.verified_source_reads,
      plan
    };
    // Never return internal mutable references to the caller.
    return structuredClone(this.#packet);
  }

  reviewPacket():PlanningReviewPacket{
    if(!this.#packet)refuse("no staged proposal available for Engineer review");
    return structuredClone(this.#packet);
  }

  /** The signed receipt must already be persisted by the real Engineer
   * process in the owner-only directory. No helper here issues a signature.
   */
  async loadAuthenticatedApproval(sessionId:string):Promise<TrustedApprovalRecord>{
    const packet=this.#packet;
    if(!packet || sessionId!==packet.session_id)
      refuse("no exact staged Planning proposal for this session");
    const record=await this.#signed.loadAuthenticatedApproval(sessionId);
    if(record.authenticated_engineer_did!==this.#engineerDid||
       !equalDigest(planDigest(record.plan),packet.plan_digest))
      refuse("signed Engineer plan differs from the staged proposal");
    assertApprovedPlanScope(record.plan,record.approval,{
      allowedOperations:OPERATIONS,expectedEngineerDid:this.#engineerDid
    });
    // A second separately valid Engineer receipt for the SAME plan may
    // approve different permissions. Reject this substitution before
    // Gateway activation; otherwise root and Gateway scopes could diverge.
    const fingerprint=planDigest({plan:record.plan,approval:record.approval,
      authenticated_engineer_did:record.authenticated_engineer_did});
    if(this.#receiptDigest && !equalDigest(this.#receiptDigest,fingerprint))
      refuse("signed permission decision changed after initial trusted load");
    this.#receiptDigest=fingerprint;
    return structuredClone(record);
  }
}
