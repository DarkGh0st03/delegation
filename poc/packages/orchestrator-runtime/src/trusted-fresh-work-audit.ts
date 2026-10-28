/**
 * Owner-only, source-free audit of partial work on a RETIRED signed DAG branch.
 *
 * This does not grant new permissions, read source, replay the failed DAG,
 * cherry-pick old code, change Gitea branches or call a model. The provider
 * must authenticate its pinned branch-diff response; a model/A2A payload
 * must never implement this interface.
 */
import {approvedWorkBranch}
  from "../../plan-contracts/src/approved-work-branch.mjs";
import {assertApprovedPlanScope,planDigest}
  from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {SignedEngineerApprovalFileStore}
  from "./signed-approval-store.ts";
import {prepareTrustedFreshPlanningIntake,
  type TrustedFreshMainDiscovery} from "./trusted-fresh-planning-intake.ts";
import {startOwnerControlledPlanningReview}
  from "./trusted-owner-planning-bootstrap.ts";
import {isDeepStrictEqual} from "node:util";
import type {OwnerControlledPlanningConfig}
  from "./trusted-owner-planning-bootstrap.ts";
import {TrustedFreshWorkDecisionStore,type FreshWorkDisposition}
  from "./trusted-fresh-work-decision-store.ts";

const SHA=/^[a-f0-9]{40}$/u;
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/u;
const CHANGES=new Set(["added","modified","deleted"]);
function fail(message:string):never{
  throw Error("Trusted fresh work audit: "+message);
}
export type PriorChangedFile=Readonly<{
  path:string;change:"added"|"modified"|"deleted";
}>;
export interface TrustedPriorBranchDiffReader {
  /** Trusted Gitea provider, pinned to the last independently observed SHA. */
  readPinnedFeatureDiff(input:Readonly<{
    repository:{authority:string;owner:string;repository:string};
    branch:string;base_revision:string;head_revision:string;
  }>):Promise<{
    branch:string;base_revision:string;head_revision:string;
    changes:PriorChangedFile[];
  }>;
}
export type TrustedPriorWorkAudit=Readonly<{
  status:"prior_work_audited";
  previous_session_id:string;
  proposed_next_session_id:string;
  previous_plan_digest:string;
  previous_base_revision:string;
  previous_branch:string;
  previous_feature_head_sha:string;
  changed_files:readonly PriorChangedFile[];
  planning_authorized:false;
  prior_changes_imported:false;
}>;
const bindings=new WeakMap<TrustedPriorWorkAudit,{
  previousCoordinator:TrustedExecutionCoordinator;
  nextSessionId:string;used:boolean;
}>();

/** No old branch read is allowed until the old Gateway AND native root
 * revocation have completed. Both old plan and permissions must be backed
 * by an authentic Engineer signature before its branch name is trusted. */
export async function auditTrustedRetiredFeatureWork(input:{
  previousCoordinator:TrustedExecutionCoordinator;
  nextSessionId:string;
  previousSignedApprovals:SignedEngineerApprovalFileStore;
  trustedFinalFeatureSha:string;
  trustedGitea:TrustedPriorBranchDiffReader;
}):Promise<TrustedPriorWorkAudit>{
  if(!(input?.previousCoordinator instanceof TrustedExecutionCoordinator)||
     !(input.previousSignedApprovals instanceof SignedEngineerApprovalFileStore)||
     !SHA.test(input.trustedFinalFeatureSha)||
     typeof input.trustedGitea?.readPinnedFeatureDiff!=="function")
    fail("retired Coordinator, signed previous receipt and pinned Gitea required");
  const referral=await input.previousCoordinator
    .freshPlanningIntakeAfterClosure(input.nextSessionId);
  const signed=await input.previousSignedApprovals
    .loadAuthenticatedApproval(referral.previous_session_id);
  const plan=signed.plan as any;
  if(!plan||plan.session_id!==referral.previous_session_id||
     plan.base_revision!==referral.previous_base_revision)
    fail("previous signed plan is not bound to retired authority");
  assertApprovedPlanScope(plan,signed.approval,{
    allowedOperations:new Set<string>(RUST_OPERATIONS),
    expectedEngineerDid:signed.authenticated_engineer_did
  });
  input.previousCoordinator.assertOriginalRepository(plan.repository);
  const branch=approvedWorkBranch(plan);
  const query=Object.freeze({
    repository:structuredClone(plan.repository),
    branch,base_revision:referral.previous_base_revision,
    head_revision:input.trustedFinalFeatureSha
  });
  const diff=await input.trustedGitea.readPinnedFeatureDiff(query);
  if(!diff||typeof diff!=="object"||Array.isArray(diff)||
     Object.keys(diff).sort().join(",")!=="base_revision,branch,changes,head_revision"||
     diff.branch!==branch||
     diff.base_revision!==referral.previous_base_revision||
     diff.head_revision!==input.trustedFinalFeatureSha||
     !Array.isArray(diff.changes)||diff.changes.length>64)
    fail("untrusted branch diff or changed Git SHA");
  const seen=new Set<string>();
  const files:PriorChangedFile[]=[];
  for(const item of diff.changes){
    if(!item||typeof item!=="object"||Array.isArray(item)||
       Object.keys(item).sort().join(",")!=="change,path"||
       typeof item.path!=="string"||item.path.length>240||
       !PATH.test(item.path)||
       item.path.split("/").some(s=>s==="."||s===".."||s.endsWith(".lock"))||
       !CHANGES.has(item.change)||seen.has(item.path))
      fail("invalid, duplicated or unsanitized prior changed-file metadata");
    seen.add(item.path);
    files.push(Object.freeze({path:item.path,change:item.change}));
  }
  if(files.length>0&&diff.head_revision===diff.base_revision)
    fail("changed files cannot be attributed to unchanged base revision");
  const audit=Object.freeze({
    status:"prior_work_audited" as const,
    previous_session_id:referral.previous_session_id,
    proposed_next_session_id:referral.proposed_next_session_id,
    previous_plan_digest:planDigest(plan),
    previous_base_revision:referral.previous_base_revision,
    previous_branch:branch,
    previous_feature_head_sha:diff.head_revision,
    changed_files:Object.freeze(files),
    planning_authorized:false as const,
    prior_changes_imported:false as const
  });
  bindings.set(audit,{
    previousCoordinator:input.previousCoordinator,
    nextSessionId:referral.proposed_next_session_id,used:false
  });
  return audit;
}

/** The PRIVATE owner must persist a decision BEFORE triggering any new
 * Planning root. Quarantine returns without Planning; start_from_main
 * deliberately does not import old branch source into the fresh model.
 * A rejected/uncertain audit write is terminal; re-audit manually.
 */
export async function startAuditedFreshRepairPlanning(input:{
  audit:TrustedPriorWorkAudit;
  disposition:FreshWorkDisposition;
  decisionStore:TrustedFreshWorkDecisionStore;
  previousCoordinator:TrustedExecutionCoordinator;
  nextCoordinator:TrustedExecutionCoordinator;
  nextSessionId:string;
  trustedGitea:TrustedFreshMainDiscovery;
  planning:Omit<OwnerControlledPlanningConfig,"coordinator"|"snapshot">;
}){
  const state=bindings.get(input?.audit);
  if(!state||state.used||state.previousCoordinator!==input.previousCoordinator||
     state.nextSessionId!==input.nextSessionId||
     !["quarantine_prior_branch","start_from_pinned_main"]
       .includes(input.disposition)||
     !(input.decisionStore instanceof TrustedFreshWorkDecisionStore))
    fail("fresh audited owner decision must be bound and single-use");
  state.used=true; // reserve synchronously before any external audit write
  await input.decisionStore.recordDecision({
    audit:input.audit,disposition:input.disposition
  });
  // Never trust an in-memory callback as evidence of persistence.
  await input.decisionStore.assertRecorded({
    audit:input.audit,disposition:input.disposition
  });
  if(input.disposition==="quarantine_prior_branch"){
    return Object.freeze({
      status:"manual_reconciliation_required" as const,
      previous_branch:input.audit.previous_branch,
      previous_feature_head_sha:input.audit.previous_feature_head_sha,
      planning_authorized:false as const
    });
  }
  // This is now the ONLY executable fresh repair Planning entry. The legacy
  // startTrustedFreshRepairPlanningReview() rejects unconditionally.
  // Recheck old-root retirement, fetch independently pinned main, and refuse
  // any attempted use of the failed feature-branch source as planning state.
  if(!input.planning||typeof input.planning!=="object")
    fail("owner-controlled fresh repair Planning configuration required");
  const intake=await prepareTrustedFreshPlanningIntake(input);
  const cfg=input.planning;
  if(!isDeepStrictEqual(cfg.planner?.snapshot,intake.snapshot))
    fail("new Planner must use independently pinned Gitea snapshot");
  if(typeof cfg.planner?.requirement!=="string"||
     !cfg.planner.requirement.trim()||
     cfg.planner.requirement.length>4000)
    fail("fresh repair requirement must be explicitly supplied by the owner");
  // Existing signed checkpoint, Gateway reads and read-only provisional root;
  // the audit itself cannot issue new execution credentials.
  return startOwnerControlledPlanningReview({
    ...cfg,coordinator:input.nextCoordinator,
    snapshot:structuredClone(intake.snapshot)
  });
}
