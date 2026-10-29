/**
 * R95 trusted owner-only no-silent-loss gate for *fresh* TypeScript repair.
 *
 * A previous feature branch is RETIRED. Its source must never be silently
 * merged, cherry-picked, or injected into a model. Before new root issuance,
 * every prior changed file must be represented by a NEW independently
 * Engineer-signed Task on the clean pinned-main branch. This is only
 * authorization/intention coverage; no code is imported, and successful
 * preservation remains subject to an actual new Runner acceptance test.
 *
 * For now, deletion needs manual disposition; fail closed rather than
 * representing it as a harmless omission. Caller must supply the genuinely
 * trusted prior audit from auditTrustedRetiredFeatureWork(), not A2A text.
 */
import {TrustedFreshWorkDecisionStore}
  from "./trusted-fresh-work-decision-store.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import {approvedWorkBranch}
  from "../../plan-contracts/src/approved-work-branch.mjs";
import {assertApprovedPlanScope,planDigest}
  from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {canonicalFileUri}
  from "../../../apps/gateway/src/canonical.ts";

const SHA=/^[0-9a-f]{40}$/u;
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/u;
const ROLES=new Set(["backend","frontend","test"]);
function fail(){throw Error("Fresh repair preservation: signed prior work not fully covered");}
function pathOK(path){
  return typeof path==="string"&&path.length<=240&&PATH.test(path)&&
    !path.split("/").some(p=>p==="."||p===".."||p.endsWith(".lock"));
}
export async function verifySignedFreshRepairPreservation({
  priorAudit,decisionStore,reviewGate,expectedNextSessionId,
  expectedNewMainSha,expectedOldFeatureSha
}={}){
  if(!(decisionStore instanceof TrustedFreshWorkDecisionStore)||
     !(reviewGate instanceof TrustedPlanningReviewGate)||
     !priorAudit||typeof priorAudit!=="object"||
     priorAudit.status!=="prior_work_audited"||
     priorAudit.planning_authorized!==false||
     priorAudit.prior_changes_imported!==false||
     priorAudit.proposed_next_session_id!==expectedNextSessionId||
     !SHA.test(expectedNewMainSha)||
     !SHA.test(expectedOldFeatureSha)||
     priorAudit.previous_feature_head_sha!==expectedOldFeatureSha||
     !Array.isArray(priorAudit.changed_files)||
     priorAudit.changed_files.length>64||
     priorAudit.changed_files.some(c=>!c||!pathOK(c.path)||
       !["modified","added","deleted"].includes(c.change))||
     new Set(priorAudit.changed_files.map(c=>c.path)).size!==
       priorAudit.changed_files.length)
    fail();
  // Durable owner decision is NOT an Engineer signature; check separately.
  // No root is created by either of these read-only checks.
  await decisionStore.assertRecorded({
    audit:priorAudit,disposition:"start_from_pinned_main"
  });
  const packet=reviewGate.reviewPacket();
  const signed=await reviewGate.loadAuthenticatedApproval(expectedNextSessionId);
  const plan=signed.plan;
  if(plan.session_id!==expectedNextSessionId||
     plan.base_revision!==expectedNewMainSha||
     packet.session_id!==expectedNextSessionId||
     packet.base_revision!==expectedNewMainSha||
     packet.plan_digest!==planDigest(plan))
    fail();
  const nextBranch=approvedWorkBranch(plan);
  if(nextBranch===priorAudit.previous_branch||
     nextBranch!==packet.work_branch)fail();
  const grants=assertApprovedPlanScope(plan,signed.approval,{
    allowedOperations:new Set(RUST_OPERATIONS),
    expectedEngineerDid:signed.authenticated_engineer_did
  });
  let existing=0,created=0;
  for(const {path,change} of priorAudit.changed_files){
    // No trusted way to preserve a deleted file with the current operations.
    // Require an independent manual review rather than silently lose work.
    if(change==="deleted")fail();
    const resource=canonicalFileUri(plan.repository,nextBranch,path);
    const operation=change==="added"?"create_file":"update_file";
    const edits=grants.filter(g=>g.operation===operation&&g.resource===resource);
    if(edits.length!==1||!ROLES.has(edits[0].agent_id)||
       grants.some(g=>g.resource===resource&&
         (g.operation==="update_file"||g.operation==="create_file")&&
         g!==edits[0]))
      fail();
    const taskId=edits[0].task_id,role=edits[0].agent_id;
    if(change==="modified"){
      const reads=grants.filter(g=>g.resource===resource&&
        g.operation==="read_file"&&g.agent_id===role&&g.task_id===taskId);
      if(reads.length!==1)fail();
      existing++;
    }else{
      // Newly created files have no old main source to read, so only the
      // exact approved create_file operation can represent reconstruction.
      created++;
    }
  }
  // A zero-change run is legitimate: the new signed plan still owns
  // any fresh repair work, and no prior modifications can disappear.
  return Object.freeze({
    status:"all_prior_changes_explicitly_scoped_in_new_signed_plan",
    changed_files:priorAudit.changed_files.length,
    modified_file_reimplementations:existing,
    added_file_recreations:created,
    previous_branch_quarantined:true,
    old_source_imported:false,
    functional_equivalence_not_attested:true,
    operational_credentials_issued:false,
    tasks_dispatched:false
  });
}
