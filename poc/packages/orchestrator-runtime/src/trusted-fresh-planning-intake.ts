/**
 * Trusted host-only bridge from a TERMINALLY RETIRED operational DAG to a
 * distinct, UNAPPROVED Planning session. The old authority cannot be reused.
 *
 * This never calls a model, starts a Planning root, signs a receipt, creates
 * permissions or builds operational credentials. The independent Engineer
 * backend must explicitly start a fresh read-only root and obtain a new
 * signed review of a fresh proposal afterward.
 */
import {isDeepStrictEqual} from "node:util";
import {preliminaryReadPermissions,type TrustedPlanningSnapshot}
  from "./trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {startOwnerControlledPlanningReview,
  type OwnerControlledPlanningConfig}
  from "./trusted-owner-planning-bootstrap.ts";
import type {PlanningReviewPacket} from "./trusted-planning-review-gate.ts";

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
  if(!isDeepStrictEqual(snapshot.session_id,referral.proposed_next_session_id))
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
 * An explicit PRIVATE owner action, never invoked by a failed A2A Task or
 * automatically by the old DAG. Reuses the existing read-only Planning ->
 * backend-signed checkpoint -> independent Engineer review pipeline.
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
  if(!input||!input.planning||typeof input.planning!=="object")
    fail("owner-controlled fresh repair Planning configuration required");
  // Gitea snapshot is pinned and old root is confirmed revoked BEFORE
  // model inference, Gateway reads, or preliminary credential issuance.
  const intake=await prepareTrustedFreshPlanningIntake(input);
  const cfg=input.planning;
  if(!isDeepStrictEqual(cfg.planner?.snapshot,intake.snapshot))
    fail("new Planner must use independently pinned Gitea snapshot");
  if(typeof cfg.planner?.requirement!=="string"||
     !cfg.planner.requirement.trim()||
     cfg.planner.requirement.length>4000)
    fail("fresh repair requirement must be explicitly supplied by the owner");
  // The trusted owner bootstrap handles read-only root issuance, bounded
  // ADK Planning, checkpoint signing/persistence and Engineer-review staging.
  // It does NOT grant Engineer permissions or activate an Execution DAG.
  return startOwnerControlledPlanningReview({
    ...cfg,coordinator:input.nextCoordinator,
    snapshot:structuredClone(intake.snapshot)
  });
}
