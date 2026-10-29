/**
 * R96 trusted owner-only post-execution verification of fresh repair.
 * New signed Task coverage (R95) is necessary but NOT proof of actual edits.
 * This requires authentic Gitea exact-SHA diff metadata and owner-retrieved
 * Gateway Runner evidence on the SAME newly signed branch/revision.
 * It does not reuse old source or establish semantic equivalence.
 */
import {TrustedFreshWorkDecisionStore}
  from "./trusted-fresh-work-decision-store.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import {TrustedGiteaPriorDiffReader}
  from "./trusted-gitea-prior-diff-reader.ts";
import {verifySignedFreshRepairPreservation}
  from "./trusted-fresh-repair-preservation.mjs";
import {approvedWorkBranch}
  from "../../plan-contracts/src/approved-work-branch.mjs";
import {assertApprovedPlanScope}
  from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {canonicalBranchUri}
  from "../../../apps/gateway/src/canonical.ts";

const SHA=/^[a-f0-9]{40}$/u;
const PHASES=["dependency_install","typecheck","backend_tests",
  "frontend_tests","build","playwright_e2e","researcher_acceptance"];
function deny(){throw Error("Fresh repair post-run: reconstruction or trusted acceptance unconfirmed");}
function requireRunnerPass(e,branch,sha){
  if(!e||typeof e!=="object"||Array.isArray(e)||
     e.provider!=="runner"||e.performed!==true||e.tool!=="run_tests"||
     e.branch!==branch||e.tested_commit_sha!==sha||e.status!=="pass"||
     e.project_tests?.status!=="pass"||
     e.researcher_acceptance?.status!=="pass"||
     !Array.isArray(e.phases)||e.phases.length!==PHASES.length)
    deny();
  for(let i=0;i<PHASES.length;i++){
    if(e.phases[i]?.phase!==PHASES[i]||e.phases[i]?.status!=="pass")
      deny();
  }
}
/**
 * Gateway evidence MUST come from a trusted host's independently verified
 * Gateway provider result. The reader and callback are owner-private; model
 * output never implements these interfaces. Call after durable DAG closure.
 */
export async function verifyTrustedFreshRepairPostRun({
  priorAudit,decisionStore,reviewGate,trustedGitea,gatewayEvidence,
  expectedNextSessionId,expectedFreshMainSha,expectedOldFeatureSha,
  expectedTestedCommitSha
}={}){
  if(!(decisionStore instanceof TrustedFreshWorkDecisionStore)||
     !(reviewGate instanceof TrustedPlanningReviewGate)||
     !(trustedGitea instanceof TrustedGiteaPriorDiffReader)||
     typeof gatewayEvidence?.readVerifiedRunnerEffect!=="function"||
     !SHA.test(expectedTestedCommitSha)||
     expectedTestedCommitSha===expectedFreshMainSha)deny();
  const planned=await verifySignedFreshRepairPreservation({
    priorAudit,decisionStore,reviewGate,expectedNextSessionId,
    expectedNewMainSha:expectedFreshMainSha,expectedOldFeatureSha
  });
  if(planned.status!=="all_prior_changes_explicitly_scoped_in_new_signed_plan"||
     planned.old_source_imported!==false)deny();
  const receipt=await reviewGate.loadAuthenticatedApproval(expectedNextSessionId);
  const plan=receipt.plan,branch=approvedWorkBranch(plan);
  const grants=assertApprovedPlanScope(plan,receipt.approval,{
    allowedOperations:new Set(RUST_OPERATIONS),
    expectedEngineerDid:receipt.authenticated_engineer_did
  });
  const testTasks=grants.filter(g=>g.operation==="run_tests"&&
    g.agent_id==="test"&&
    g.resource===canonicalBranchUri(plan.repository,branch));
  if(testTasks.length!==1)deny();
  const [diff,effect]=await Promise.all([
    trustedGitea.readPinnedFeatureDiff({
      repository:structuredClone(plan.repository),branch,
      base_revision:expectedFreshMainSha,
      head_revision:expectedTestedCommitSha
    }),
    gatewayEvidence.readVerifiedRunnerEffect(Object.freeze({
      session_id:expectedNextSessionId,task_id:testTasks[0].task_id,
      branch,tested_commit_sha:expectedTestedCommitSha
    }))
  ]);
  if(diff.branch!==branch||diff.base_revision!==expectedFreshMainSha||
     diff.head_revision!==expectedTestedCommitSha||
     !Array.isArray(diff.changes)||diff.changes.length>64)deny();
  requireRunnerPass(effect,branch,expectedTestedCommitSha);
  const changed=new Map();
  for(const file of diff.changes){
    if(!file||typeof file.path!=="string"||
       !["modified","added","deleted"].includes(file.change)||
       changed.has(file.path))deny();
    changed.set(file.path,file.change);
  }
  let modified=0,added=0;
  for(const prior of priorAudit.changed_files){
    if(prior.change==="deleted"||changed.get(prior.path)!==prior.change)
      deny();
    if(prior.change==="modified")modified++;else added++;
  }
  return Object.freeze({
    status:"fresh_repair_exact_sha_runner_pass",
    prior_files_accounted_for:priorAudit.changed_files.length,
    modified_files_reimplemented:modified,
    added_files_recreated:added,
    exact_signed_branch_revision_verified:true,
    all_fixed_runner_phases_passed:true,
    functional_equivalence_not_attested:true,
    prior_source_imported:false,
    additional_permissions_issued:false
  });
}
