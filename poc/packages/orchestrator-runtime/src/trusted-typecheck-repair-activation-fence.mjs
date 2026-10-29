/**
 * R94 owner-private, single-use, signed repair-scope fence.
 *
 * The old Runner nomination is NOT permission. This pins a fresh,
 * independently authenticated Engineer's exact plan AND approval decision
 * across the R93 review and R94 root activation. It never signs, issues,
 * delegates, dispatches, contacts a model, reads source or retries a Task.
 */
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import {SignedEngineerApprovalFileStore}
  from "./signed-approval-store.ts";
import {verifyFreshTypecheckRepairReviewedScope}
  from "./trusted-typecheck-repair-preflight.mjs";
import {verifySignedFreshRepairPreservation}
  from "./trusted-fresh-repair-preservation.mjs";
import {TrustedFreshWorkDecisionStore}
  from "./trusted-fresh-work-decision-store.ts";

function fail(){throw Error("Fresh repair issue fence: signed review changed or unavailable");}
function fingerprint(verified){
  return planDigest({plan:verified.plan,approval:verified.approval,
    engineer_did:verified.authenticated_engineer_did});
}
/** No methods of this object may be exposed on an A2A/MCP/LLM boundary. */
export function createFreshTypecheckRepairIssueFence({repairScope,reviewGate,
  preservation}={}){
  if(!repairScope||typeof repairScope!=="object"||
     !(repairScope.approvalStore instanceof SignedEngineerApprovalFileStore)||
     !(reviewGate instanceof TrustedPlanningReviewGate))
    fail();
  // Pin caller-controlled selectors BEFORE any awaited I/O. Protected store
  // and review gate are class instances, never model-supplied providers.
  const scope={
    approvalStore:repairScope.approvalStore,
    previousSessionId:repairScope.previousSessionId,
    nextSessionId:repairScope.nextSessionId,
    expectedFreshMainSha:repairScope.expectedFreshMainSha,
    expectedRepository:structuredClone(repairScope.expectedRepository),
    trustedDiagnosticPath:repairScope.trustedDiagnosticPath,
    ownerSelectedRole:repairScope.ownerSelectedRole,
    previousApprovedBranch:repairScope.previousApprovedBranch,
    nextApprovedBranch:repairScope.nextApprovedBranch,
    nomination:structuredClone(repairScope.nomination)
  };
  if(preservation!==undefined&&(
     !preservation||typeof preservation!=="object"||
     !(preservation.decisionStore instanceof TrustedFreshWorkDecisionStore)||
     !preservation.priorAudit||typeof preservation.priorAudit!=="object"||
     preservation.priorAudit.previous_session_id!==scope.previousSessionId||
     preservation.priorAudit.proposed_next_session_id!==scope.nextSessionId||
     preservation.priorAudit.previous_branch!==scope.previousApprovedBranch
  ))fail();
  // Only the exact retired branch audit is usable; clone owner data BEFORE
  // any asynchronous signed receipt/ledger operations.
  const previous=preservation?{
    priorAudit:structuredClone(preservation.priorAudit),
    decisionStore:preservation.decisionStore,
    expectedOldFeatureSha:preservation.expectedOldFeatureSha
  }:null;
  let stage=0,pinned=null;
  async function verify(){
    if(previous)await verifySignedFreshRepairPreservation({
      ...previous,reviewGate,
      expectedNextSessionId:scope.nextSessionId,
      expectedNewMainSha:scope.expectedFreshMainSha
    });
    const approved=await verifyFreshTypecheckRepairReviewedScope(scope);
    if(approved.status!=="fresh_engineer_signed_repair_scope_verified"||
       approved.operational_credentials_issued!==false)fail();
    const packet=reviewGate.reviewPacket();
    if(packet.session_id!==scope.nextSessionId||
       packet.base_revision!==scope.expectedFreshMainSha||
       packet.work_branch!==scope.nextApprovedBranch)fail();
    const verifiedByGate=await reviewGate.loadAuthenticatedApproval(
      scope.nextSessionId);
    const verifiedByStore=await scope.approvalStore.loadAuthenticatedApproval(
      scope.nextSessionId);
    const f1=fingerprint(verifiedByGate),f2=fingerprint(verifiedByStore);
    if(f1!==f2||packet.plan_digest!==planDigest(verifiedByStore.plan)||
       (pinned!==null&&pinned!==f1))fail();
    if(pinned===null)pinned=f1;
  }
  return Object.freeze({
    async pinBeforeOperationalActivation(){
      if(stage!==0)fail();
      stage=1; // reserve before any asynchronous file/gate operations
      await verify();
      stage=2;
    },
    async recheckAfterOperationalActivation(){
      if(stage!==2)fail();
      stage=3;
      await verify();
      stage=4;
    }
  });
}
