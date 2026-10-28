/**
 * Trusted host-only bridge from a TERMINALLY RETIRED operational DAG to a
 * distinct, UNAPPROVED Planning session. The old authority cannot be reused.
 *
 * This never calls a model, starts a Planning root, signs a receipt, creates
 * permissions or builds operational credentials. The independent Engineer
 * backend must explicitly start a fresh read-only root and obtain a new
 * signed review of a fresh proposal afterward.
 */
import {preliminaryReadPermissions,type RootParameters,type TrustedPlanningSnapshot}
  from "./trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import type {OwnerControlledPlanningConfig}
  from "./trusted-owner-planning-bootstrap.ts";
import {TrustedPlanningReviewGate,
  type PlanningReviewPacket} from "./trusted-planning-review-gate.ts";

type PinnedMainSnapshot=Omit<TrustedPlanningSnapshot,"session_id">;
export interface TrustedFreshMainDiscovery {
  /** Trusted Gitea provider read on main, not model/A2A/GUI JSON.
   * The host must authenticate this provider and verify the returned SHA. */
  readPinnedMainSnapshot():Promise<PinnedMainSnapshot>;
}
export interface FreshUnapprovedPlanningIntake {
  state:"awaiting_fresh_planning_root";
  previous_session_id:string;
  previous_base_revision:string;
  snapshot:Readonly<TrustedPlanningSnapshot>;
  planning_authorized:false;
  engineer_approved:false;
  operational_credentials_issued:false;
}
function fail(message:string):never{throw Error("Trusted fresh Planning intake: "+message);}

export async function prepareTrustedFreshPlanningIntake(input:{
  previousCoordinator:TrustedExecutionCoordinator;
  nextCoordinator:TrustedExecutionCoordinator;
  nextSessionId:string;
  trustedGitea:TrustedFreshMainDiscovery;
}):Promise<Readonly<FreshUnapprovedPlanningIntake>>{
  if(!(input?.previousCoordinator instanceof TrustedExecutionCoordinator)||
     !(input.nextCoordinator instanceof TrustedExecutionCoordinator)||
     input.previousCoordinator===input.nextCoordinator||
     !input.trustedGitea||
     typeof input.trustedGitea.readPinnedMainSnapshot!=="function")
    fail("distinct trusted Coordinators and Gitea discovery required");
  // No source access or snapshot handling until BOTH independent Gateway and
  // Rust operational-root retirement have been confirmed.
  const referral=await input.previousCoordinator
    .freshPlanningIntakeAfterClosure(input.nextSessionId);
  if(referral.planning_authorized!==false||
     referral.engineer_approved!==false||
     referral.operational_credentials_issued!==false)
    fail("previous referral cannot carry authority");
  const raw=await input.trustedGitea.readPinnedMainSnapshot();
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     Object.keys(raw).sort().join(",")!==
       "base_revision,directories,files,repository")
    fail("trusted main snapshot has invalid shape");
  const snapshot=structuredClone({
    session_id:input.nextSessionId,...raw
  }) as TrustedPlanningSnapshot;
  // Validate every directory/file path against canonical Gateway rules and
  // check same immutable repository pin from the previous Engineer session.
  const grants=preliminaryReadPermissions(snapshot);
  if(grants.some(p=>!["read_repository","list_directory","read_file"]
      .includes(p.operation)))fail("new Planning snapshot is not read-only");
  input.previousCoordinator.assertOriginalRepository(snapshot.repository);
  input.nextCoordinator.assertUnstartedFreshPlanningSnapshot(snapshot);
  if(snapshot.session_id!==referral.proposed_next_session_id)
    fail("fresh session mismatch");
  const pinned=Object.freeze({
    session_id:snapshot.session_id,
    repository:Object.freeze({...snapshot.repository}),
    base_revision:snapshot.base_revision,
    directories:Object.freeze([...snapshot.directories]),
    files:Object.freeze([...snapshot.files])
  });
  return Object.freeze({
    state:"awaiting_fresh_planning_root" as const,
    previous_session_id:referral.previous_session_id,
    previous_base_revision:referral.previous_base_revision,
    snapshot:pinned,
    planning_authorized:false as const,
    engineer_approved:false as const,
    operational_credentials_issued:false as const
  });
}

/**
 * Deliberately disabled R43 legacy entry. New repairs MUST use the audited,
 * durably recorded owner disposition in trusted-fresh-work-audit.ts.
 * Existing callers fail closed rather than bypass the owner review ledger.
 *
 * The repair is a NEW plan on a fresh pinned main snapshot, not a replay
 * of the failed feature branch. The host must provide its own reviewed
 * requirement and separately chosen (possibly offline) ADK model.
 * This function makes no billing or execution authorization decisions:
 * provider selection/consent belongs to the authenticated owner host,
 * and no issued operational root exists at the return boundary.
 */
export async function startTrustedFreshRepairPlanningReview(input:{
  previousCoordinator:TrustedExecutionCoordinator;
  nextCoordinator:TrustedExecutionCoordinator;
  nextSessionId:string;
  trustedGitea:TrustedFreshMainDiscovery;
  planning:Omit<OwnerControlledPlanningConfig,"coordinator"|"snapshot">;
}):Promise<PlanningReviewPacket>{
  // R43: disable the formerly executable unguarded handoff. New repair
  // Planning is possible only through startAuditedFreshRepairPlanning(),
  // after a signed old-branch audit and durable owner disposition.
  // Keeping this intentionally failing export makes old callers fail closed
  // instead of silently bypassing the decision ledger.
  fail("audited durable owner disposition required for fresh repair Planning");
}

/**
 * Explicit owner-only verification gate AFTER a fresh, signed Planning
 * checkpoint is staged and an independent Engineer has signed a NEW receipt.
 * This NEVER issues a root or launches any DAG: beginExecution() must still
 * independently reload the signed receipt and activate the Gateway.
 *
 * A receipt from the prior session is not approval for a fresh repair.
 */
export async function verifyTrustedFreshRepairEngineerApproval(input:{
  previousCoordinator:TrustedExecutionCoordinator;
  nextCoordinator:TrustedExecutionCoordinator;
  nextSessionId:string;
  reviewGate:import("./trusted-planning-review-gate.ts").TrustedPlanningReviewGate;
}):Promise<Readonly<{
  status:"fresh_engineer_review_verified";
  session_id:string;
  base_revision:string;
  plan_digest:string;
  approval_decision_id:string;
  planning_authority_only:true;
  operational_credentials_issued:false;
}>>{
  if(!(input?.previousCoordinator instanceof TrustedExecutionCoordinator)||
     !(input.nextCoordinator instanceof TrustedExecutionCoordinator)||
     input.previousCoordinator===input.nextCoordinator||
     !(input.reviewGate instanceof TrustedPlanningReviewGate))
    fail("separate trusted Coordinators and authenticated review gate required");
  const referral=await input.previousCoordinator
    .freshPlanningIntakeAfterClosure(input.nextSessionId);
  const packet=input.reviewGate.reviewPacket();
  input.nextCoordinator.assertActiveFreshEngineerReviewPins({
    session_id:packet.session_id,base_revision:packet.base_revision,
    repository:packet.plan.repository
  });
  if(packet.session_id!==referral.proposed_next_session_id)
    fail("new Engineer review is not bound to the proposed distinct session");
  // The file store must authenticate the NEW Engineer signature using its
  // independent pinned key. Digest/permission equality is checked again.
  const signed=await input.reviewGate.loadAuthenticatedApproval(packet.session_id);
  return Object.freeze({
    status:"fresh_engineer_review_verified" as const,
    session_id:packet.session_id,
    base_revision:packet.base_revision,
    plan_digest:packet.plan_digest,
    approval_decision_id:(signed.approval as {decision_id:string}).decision_id,
    planning_authority_only:true as const,
    operational_credentials_issued:false as const
  });
}


/** Private owner-only repair transition, reusing beginExecution's signed
 * Engineer approval reload, preliminary revocation and Gateway activation.
 * This does not call Gemini, dispatch agents, or sign a new approval. */
export async function beginTrustedFreshRepairApprovedExecution(input:{
  previousCoordinator:TrustedExecutionCoordinator;
  nextCoordinator:TrustedExecutionCoordinator;
  nextSessionId:string;
  reviewGate:TrustedPlanningReviewGate;
  operationalRoot:RootParameters;
}):Promise<Readonly<{
  status:"fresh_execution_activated";
  session_id:string;
  base_revision:string;
  plan_digest:string;
  approval_decision_id:string;
  operational_root_id:string;
}>>{
  if(!input?.operationalRoot)fail("independent operational root required");
  const reviewed=await verifyTrustedFreshRepairEngineerApproval(input);
  await input.previousCoordinator.assertIndependentFreshOperationalRoot(input.operationalRoot);
  const active=await input.nextCoordinator.beginExecution(
    structuredClone(input.operationalRoot));
  if(active.plan_digest!==reviewed.plan_digest){
    try{await input.nextCoordinator.closeExecution();}
    catch(error){
      throw Error("Fresh repair operational digest mismatch; retirement unconfirmed",
        {cause:error});
    }
    fail("fresh operational plan digest changed during signed handoff");
  }
  return Object.freeze({
    status:"fresh_execution_activated" as const,
    session_id:reviewed.session_id,
    base_revision:reviewed.base_revision,
    plan_digest:active.plan_digest,
    approval_decision_id:reviewed.approval_decision_id,
    operational_root_id:active.credential_id
  });
}
