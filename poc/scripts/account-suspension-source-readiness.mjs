/** D0 Account Suspension source-capability inspection (ADVISORY ONLY).
 * This observes known missing lifecycle interfaces on the immutable unsolved
 * public main; it is NOT a grant authority, runtime check, semantic proof or
 * permission expansion. Alternative designs require independent review.
 */
import {ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES}
 from "../apps/test-runner-controller/fixtures/account-suspension-unsolved-baseline.mjs";

const CONTRACT_SURFACES=Object.freeze([
 {role:"backend",path:"packages/shared/src/account-status.ts",
  absent:/\bSUSPENDED\b/u},
 {role:"backend",path:"apps/backend/src/users/user.service.ts",
  absent:/\bsuspendUser\s*\(/u},
 {role:"backend",path:"apps/backend/src/users/user.controller.ts",
  absent:/\bsuspendUser\s*\(/u},
 {role:"backend",path:"apps/backend/src/users/user.routes.ts",
  absent:/\/:id\/suspend/u},
 {role:"frontend",path:"apps/frontend/src/api/users-api.ts",
  absent:/\bsuspendUser\s*\(/u},
 {role:"frontend",path:"apps/frontend/src/pages/UserDetailPage.tsx",
  absent:/\bchangeStatus\s*\(/u}
]);
const isRecord=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const pathUri=(repo,branch,path)=>
  "gitea://"+repo.authority+"/"+repo.owner+"/"+repo.repository+
  "/branches/"+encodeURIComponent(branch)+"/files/"+
  path.split("/").map(encodeURIComponent).join("/");
export function assessAccountSuspensionSourceGrantCoverage({
 plan,workBranch,baselineFiles=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES
}){
 if(!isRecord(plan)||!isRecord(plan.repository)||
    !Array.isArray(plan.tasks)||!Array.isArray(plan.requested_permissions)||
    typeof workBranch!=="string"||!workBranch.startsWith("feature/")||
    !isRecord(baselineFiles))
  throw Error("invalid source grant coverage input");
 // This inventory is only for the known pinned public main. Do not treat a
 // synthetic fingerprint as independently authenticated Gitea identity.
 const absent=CONTRACT_SURFACES.filter(({path,absent})=>{
  const content=baselineFiles[path];
  if(typeof content!=="string")throw Error("missing baseline contract surface");
  return !absent.test(content);
 });
 const missing=[],present=[];
 for(const {role,path} of absent){
  const resource=pathUri(plan.repository,workBranch,path);
  const roleTasks=new Set(plan.tasks.filter(t=>t.agent_id===role).map(t=>t.id));
  const perms=plan.requested_permissions.filter(p=>
    p.agent_id===role&&roleTasks.has(p.task_id)&&p.resource===resource);
  const writeTasks=new Set(perms.filter(p=>p.operation==="update_file")
    .map(p=>p.task_id));
  const full=perms.some(p=>p.operation==="read_file"&&
    writeTasks.has(p.task_id));
  (full?present:missing).push(path);
 }
 return Object.freeze({
  status:missing.length?"manual_source_grant_review_required":
    "observed_capabilities_cover_known_missing_interfaces",
  baseline_kind:"immutable_public_unsolved_main_fixture",
  contract_surfaces_missing_on_baseline:absent.length,
  corresponding_read_and_update_capabilities:present.length,
  missing_same_task_read_and_update:missing,
  advisory_only:true,
  permission_grants_issued:false,
  functional_correctness_not_proven:true,
  authorization_or_billing_gate:false
 });
}
