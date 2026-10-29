/**
 * R93 owner-only preflight for a NEW, separately signed repair plan.
 *
 * The candidate summary does not authorize anything. Both the candidate and
 * trusted owner-selected path/role are only CHECKS against an independently
 * authenticated Engineer receipt, pinned fresh-main SHA, and NEW feature
 * branch. No DC, VP, A2A task, MCP call, Git edit, model or retry is produced.
 *
 * The caller must separately complete the old root's durable retirement,
 * prior-branch audit and owner disposition via trusted-fresh-work-audit.ts;
 * then use the existing fresh Planning/Engineer workflow and reviewed DAG.
 */
import {SignedEngineerApprovalFileStore}
  from "./signed-approval-store.ts";
import {assertApprovedPlanScope,planDigest}
  from "../../plan-contracts/src/plan.mjs";
import {approvedWorkBranch}
  from "../../plan-contracts/src/approved-work-branch.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {canonicalFileUri,canonicalBranchUri,canonicalRepositoryUri}
  from "../../../apps/gateway/src/canonical.ts";
import {safeTypecheckRepairNomination}
  from "../../../apps/test-runner-controller/scripts/typecheck-repair-nomination.mjs";

const SHA=/^[a-f0-9]{40}$/u;
const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.tsx?$/u;
const ROLES=new Set(["backend","frontend"]);
function fail(){throw Error("Fresh repair preflight: independent signed scope mismatch");}
function pathOK(p){
  return typeof p==="string"&&p.length<=180&&PATH.test(p)&&
    p.split("/").every(x=>x!=="."&&x!=="..");
}
function sameRepository(a,b){
  return a&&b&&["authority","owner","repository"].every(k=>
    typeof a[k]==="string"&&a[k]===b[k]);
}
function hasAncestors(tasks,ancestor,descendant){
  const byId=new Map(tasks.map(t=>[t.id,t]));
  const visited=new Set();
  function walk(id){
    if(id===ancestor)return true;
    if(visited.has(id))return false;
    visited.add(id);
    return byId.get(id)?.depends_on.some(walk)===true;
  }
  return walk(descendant);
}

/** Signed receipt must be loaded through the PINNED Engineer key store. */
export async function verifyFreshTypecheckRepairReviewedScope(input){
  if(!input||typeof input!=="object"||Array.isArray(input)||
     !(input.approvalStore instanceof SignedEngineerApprovalFileStore)||
     !SESSION.test(input.previousSessionId)||
     !SESSION.test(input.nextSessionId)||
     input.previousSessionId===input.nextSessionId||
     !SHA.test(input.expectedFreshMainSha)||
     !sameRepository(input.expectedRepository,input.expectedRepository)||
     !pathOK(input.trustedDiagnosticPath)||
     !ROLES.has(input.ownerSelectedRole)||
     typeof input.previousApprovedBranch!=="string"||
     typeof input.nextApprovedBranch!=="string"||
     !input.previousApprovedBranch.startsWith("feature/")||
     !input.nextApprovedBranch.startsWith("feature/")||
     input.previousApprovedBranch===input.nextApprovedBranch)
    fail();
  // A summary from a model/agent is never a permission. It is only a
  // bounded, source-free hint corroborated by a new signed approval.
  const nomination=safeTypecheckRepairNomination(input.nomination);
  if(!nomination||nomination.diagnostic_files!==1||
     nomination.unresolved_files!==0||
     nomination.outside_operational_scope!==0||
     nomination.backend_candidates+nomination.frontend_candidates!==1||
     nomination.test_candidates!==0||
     nomination[input.ownerSelectedRole+"_candidates"]!==1)fail();
  const verified=await input.approvalStore.loadAuthenticatedApproval(
    input.nextSessionId);
  const plan=verified.plan,approval=verified.approval;
  if(plan.session_id!==input.nextSessionId||
     plan.base_revision!==input.expectedFreshMainSha||
     !sameRepository(plan.repository,input.expectedRepository)||
     approvedWorkBranch(plan)!==input.nextApprovedBranch)fail();
  // loadAuthenticatedApproval has already verified the Ed25519 Engineer
  // signature. Cross-check all approved rows against the signed plan digest.
  const grants=assertApprovedPlanScope(plan,approval,{
    allowedOperations:new Set(RUST_OPERATIONS),
    expectedEngineerDid:verified.authenticated_engineer_did
  });
  if(approval.plan_digest!==planDigest(plan))fail();
  const file=canonicalFileUri(plan.repository,input.nextApprovedBranch,
    input.trustedDiagnosticPath);
  const branch=canonicalBranchUri(plan.repository,input.nextApprovedBranch);
  const root=canonicalRepositoryUri(plan.repository);
  const updates=grants.filter(p=>p.resource===file&&p.operation==="update_file");
  if(updates.length!==1||updates[0].agent_id!==input.ownerSelectedRole)fail();
  const repairTask=updates[0].task_id;
  if(grants.filter(p=>p.resource===file&&p.operation==="read_file"&&
       p.task_id===repairTask&&p.agent_id===input.ownerSelectedRole).length!==1)
    fail();
  // No other signed Task is permitted to update this diagnostic target;
  // the Engineer may of course approve unrelated changes separately.
  if(grants.some(p=>p.resource===file&&p.operation==="create_file"))
    fail();
  const branchTasks=grants.filter(p=>
    p.agent_id==="orchestrator"&&p.operation==="create_branch"&&p.resource===root);
  const testTasks=grants.filter(p=>
    p.agent_id==="test"&&p.operation==="run_tests"&&p.resource===branch);
  const reviewTasks=grants.filter(p=>
    p.agent_id==="orchestrator"&&
    p.operation==="create_pull_request"&&p.resource===root);
  if(branchTasks.length!==1||testTasks.length!==1||
     reviewTasks.length!==1||new Set([
       branchTasks[0].task_id,repairTask,testTasks[0].task_id,
       reviewTasks[0].task_id]).size!==4||
     !hasAncestors(plan.tasks,branchTasks[0].task_id,repairTask)||
     !hasAncestors(plan.tasks,repairTask,testTasks[0].task_id)||
     !hasAncestors(plan.tasks,testTasks[0].task_id,reviewTasks[0].task_id))
    fail();
  // No path, source, task ID, credential or Agent text crosses this output.
  return Object.freeze({
    status:"fresh_engineer_signed_repair_scope_verified",
    new_session_verified:true,new_branch_verified:true,
    owner_selected_role_scope_verified:true,
    same_task_read_write_verified:true,
    signed_test_dependency_verified:true,
    signed_review_dependency_verified:true,
    operational_credentials_issued:false,
    execution_activated:false,model_calls_started:0,
    prior_feature_changes_imported:false
  });
}
