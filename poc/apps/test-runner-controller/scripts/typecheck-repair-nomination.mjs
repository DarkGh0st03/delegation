/**
 * R92 private, non-authorizing repair nomination. A Docker compiler location
 * is evidence, NEVER a permission request and NEVER a credential capability.
 * Only trusted Runner metadata, authenticated Engineer grants, the actually
 * issued operational root and Gateway-correlated writes enter this function.
 *
 * Outputs contain only integer counters and immutable booleans. Even a
 * unique candidate requires a NEW independent Engineer-signed repair Task:
 * this function cannot reissue, grant, dispatch, retry or read source.
 */
import {auditTrustedTypecheckPermissionScope}
  from "./typecheck-permission-scope-audit.mjs";
import {safeTypecheckRevisionComparison}
  from "./typecheck-revision-comparison.mjs";
const ROLES=["backend","frontend","test"];
const KEYS=["schema","status","diagnostic_files","backend_candidates",
  "frontend_candidates","test_candidates","unresolved_files",
  "outside_operational_scope","signed_task_review_required",
  "permissions_issued","task_dispatched","retry_started"];
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/u;
function validPath(x){
  return typeof x==="string"&&x.length<=240&&PATH.test(x)&&
    !x.split("/").some(s=>s==="."||s==="..");
}
function fileUri(repo,branch,path){
  return "gitea://"+repo.authority.trim().toLowerCase()+"/"+
    encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repository)+
    "/branches/"+encodeURIComponent(branch)+"/files/"+
    path.split("/").map(encodeURIComponent).join("/");
}
export function safeTypecheckRepairNomination(value){
  if(!value||typeof value!=="object"||Array.isArray(value)||
     Object.keys(value).sort().join(",")!==[...KEYS].sort().join(",")||
     value.schema!=="typecheck-repair-nomination-v1"||
     value.status!=="new_independent_engineer_review_required"||
     value.signed_task_review_required!==true||
     value.permissions_issued!==false||
     value.task_dispatched!==false||
     value.retry_started!==false)return null;
  const out={
    schema:"typecheck-repair-nomination-v1",
    status:"new_independent_engineer_review_required"
  };
  for(const key of KEYS.slice(2,8)){
    if(!Number.isSafeInteger(value[key])||value[key]<0||value[key]>8)
      return null;
    out[key]=value[key];
  }
  if(out.diagnostic_files<1||
     out.backend_candidates+out.frontend_candidates+out.test_candidates+
       out.unresolved_files!==out.diagnostic_files||
     out.outside_operational_scope>out.unresolved_files)return null;
  return Object.freeze({
    ...out,
    signed_task_review_required:true,
    permissions_issued:false,task_dispatched:false,retry_started:false
  });
}
export function nominateTrustedTypecheckRepair(input){
  if(!input||typeof input!=="object"||Array.isArray(input)||
     Object.keys(input).sort().join(",")!==[
       "approvedRows","branch","diagnostics","observedWrites",
       "operationalPermissions","planningFiles","repo","revisionComparison"
     ].sort().join(","))return null;
  const {diagnostics,planningFiles,approvedRows,operationalPermissions,
    repo,branch,observedWrites,revisionComparison}=input;
  const scope=auditTrustedTypecheckPermissionScope({
    diagnostics,planningFiles,approvedRows,operationalPermissions,repo,branch
  });
  const revisions=safeTypecheckRevisionComparison(revisionComparison);
  if(!scope||!revisions||revisions.diagnostic_files!==scope.distinct_file_count||
     !Array.isArray(planningFiles)||planningFiles.some(p=>!validPath(p))||
     !observedWrites||typeof observedWrites!=="object"||
     Object.keys(observedWrites).sort().join(",")!==[...ROLES].sort().join(",")||
     !ROLES.every(role=>observedWrites[role] instanceof Set&&
       observedWrites[role].size<=128&&
       [...observedWrites[role]].every(validPath)))return null;
  const distinct=new Set(diagnostics.map(x=>x.path));
  const counts={diagnostic_files:distinct.size,backend_candidates:0,
    frontend_candidates:0,test_candidates:0,unresolved_files:0,
    outside_operational_scope:0};
  let observed={backend:0,frontend:0,test:0,none:0};
  const root=new Set(operationalPermissions.map(x=>
    JSON.stringify([x.operation,x.resource])));
  const snapshot=new Set(planningFiles);
  for(const path of distinct){
    const res=fileUri(repo,branch,path);
    const rootAllows=root.has(JSON.stringify(["update_file",res]));
    const writers=ROLES.filter(role=>observedWrites[role].has(path));
    for(const role of writers)observed[role]++;
    if(writers.length===0)observed.none++;
    if(!rootAllows)counts.outside_operational_scope++;
    if(!snapshot.has(path)||!rootAllows||writers.length!==1){
      counts.unresolved_files++;continue;
    }
    const role=writers[0];
    const grants=approvedRows.filter(g=>g.agent_id===role&&
      g.operation==="update_file"&&g.resource===res);
    // A single signed Task must have BOTH its own read and update grant.
    // Multiple candidate Task IDs or split read/write Tasks are ambiguous.
    if(grants.length!==1||!approvedRows.some(g=>
       g.agent_id===role&&g.task_id===grants[0].task_id&&
       g.operation==="read_file"&&g.resource===res)){
      counts.unresolved_files++;continue;
    }
    counts[role+"_candidates"]++;
  }
  if(observed.backend!==revisions.backend_writes_observed||
     observed.frontend!==revisions.frontend_writes_observed||
     observed.test!==revisions.test_writes_observed||
     observed.none!==revisions.without_observed_writes||
     counts.outside_operational_scope!==scope.outside_operational_root_write)
    return null; // conflicting trusted receipts, do not even nominate
  return safeTypecheckRepairNomination({
    schema:"typecheck-repair-nomination-v1",
    status:"new_independent_engineer_review_required",...counts,
    signed_task_review_required:true,
    permissions_issued:false,task_dispatched:false,retry_started:false
  });
}
