/**
 * R5 preflight: enforce exact child inventory coverage for every specialized
 * Task in an independently verified Engineer-signed plan. This module does
 * NOT verify the signature or prove an issuance ledger is complete; its
 * caller MUST authenticate the record using SignedEngineerApprovalFileStore.
 * No Adapter HTTP, secret, A2A or model access is performed.
 */
import {assertApprovedPlanScope,planDigest}
  from "../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../apps/gateway/src/operation-catalog.ts";
import {validateR5RevocationInventory}
  from "./r5-native-revocation-observer.mjs";

const ROLES=new Set(["backend","frontend","test"]);
function deny(reason){throw Error("R5 signed inventory scope NO-GO: "+reason);}
function sameSet(a,b){
  return Array.isArray(a)&&Array.isArray(b)&&
    a.length===b.length&&new Set(a).size===a.length&&
    new Set(b).size===b.length&&a.every(id=>b.includes(id));
}
export function validateR5SignedRevocationInventory({
  ownerEvidence,inventory,authenticatedReview
}={}){
  const pinned=validateR5RevocationInventory({ownerEvidence,inventory});
  const signed=authenticatedReview,plan=signed?.plan;
  if(!plan||typeof plan!=="object"||
     signed.authenticated_engineer_did!==ownerEvidence.authenticated_engineer_did||
     plan.session_id!==pinned.session_id||
     plan.base_revision!==pinned.source_sha||
     planDigest(plan)!==inventory.approved_plan_digest)
    deny("signed plan does not match pinned original Coordinator claim");
  let rows;
  try{
    rows=assertApprovedPlanScope(plan,signed.approval,{
      allowedOperations:new Set(RUST_OPERATIONS),
      expectedEngineerDid:signed.authenticated_engineer_did
    });
  }catch{deny("Engineer approved permission subset invalid");}
  const tasks=plan.tasks;
  if(!sameSet(tasks.map(t=>t.id),ownerEvidence.approved_task_ids)||
     !sameSet(tasks.map(t=>t.id),ownerEvidence.completed_task_ids))
    deny("original completed Task IDs differ from signed plan");
  const specialized=tasks.filter(t=>t.agent_id!=="orchestrator");
  if(specialized.some(t=>!ROLES.has(t.agent_id))||
     ![...ROLES].every(role=>specialized.some(t=>t.agent_id===role))||
     !specialized.every(t=>rows.some(row=>
       row.task_id===t.id&&row.agent_id===t.agent_id)))
    deny("specialized Task roles or Engineer permissions are incomplete");
  if(!sameSet(specialized.map(t=>t.id),
      inventory.task_children.map(row=>row.task_id)))
    deny("every specialized signed Task must have one inventoried child");
  return Object.freeze({
    status:"signed_plan_task_coverage_only_not_issuance_attestation",
    source_sha:pinned.source_sha,github_run_id:pinned.github_run_id,
    specialized_task_count:specialized.length,
    issuance_ledger_completeness_independently_verified:false,
    external_r5_go:false
  });
}
