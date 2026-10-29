/**
 * R81 private typecheck authorization audit. Runner locations and approval
 * resources are inspected in the trusted host only. Published output has
 * bounded integer counters, never paths, permission URIs or compiler text.
 * This function cannot approve, issue credentials, retry or widen rights.
 */
const SCHEMA="typecheck-permission-scope-v1";
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.tsx?$/u;
const CODE=/^TS[0-9]{4,5}$/u;
const KEYS=["schema","status","location_count","distinct_file_count",
  "outside_planning_snapshot","outside_signed_plan_write",
  "outside_operational_root_write","within_operational_root_write",
  "within_test_task_write","root_write_but_test_write_missing",
  "covered_by_backend_write","covered_by_frontend_write"];
const OPS=new Set(["read_file","update_file","create_file","run_tests",
  "create_branch","create_pull_request"]);
const ROLES=new Set(["orchestrator","backend","frontend","test"]);
function deny(){throw Error("Trusted TypeScript scope audit: invalid authoritative inputs");}
function isCount(n){return Number.isSafeInteger(n)&&n>=0&&n<=8;}
function isPath(p){return typeof p==="string"&&p.length<=180&&PATH.test(p)&&
  p.split("/").every(s=>s!=="."&&s!=="..");}
function key(p){return JSON.stringify([p.operation,p.resource]);}
function fileResource(repo,branch,path){
  return "gitea://"+repo.authority.trim().toLowerCase()+"/"+
    encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repository)+
    "/branches/"+encodeURIComponent(branch)+"/files/"+
    path.split("/").map(encodeURIComponent).join("/");
}
function validGrant(p,task){
  return p&&typeof p==="object"&&
    typeof p.resource==="string"&&p.resource.startsWith("gitea://")&&
    OPS.has(p.operation)&&(!task||(ROLES.has(p.agent_id)&&
    typeof p.task_id==="string"&&p.task_id.length>0));
}
/** A second, fail-closed, source-free whitelist for log/artifact boundaries. */
export function safeTypecheckPermissionScopeAudit(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     Object.keys(raw).sort().join(",")!==[...KEYS].sort().join(",")||
     raw.schema!==SCHEMA||raw.status!=="observed")return null;
  const result={schema:SCHEMA,status:"observed"};
  for(const k of KEYS.slice(2)){
    if(!isCount(raw[k]))return null;
    result[k]=raw[k];
  }
  const n=result.distinct_file_count;
  if(result.location_count<1||n<1||n>result.location_count||
     result.outside_planning_snapshot>n||
     result.outside_signed_plan_write>n||
     result.within_operational_root_write+
       result.outside_operational_root_write!==n||
     result.within_test_task_write>result.within_operational_root_write||
     result.root_write_but_test_write_missing!==
       result.within_operational_root_write-result.within_test_task_write||
     result.covered_by_backend_write>result.within_operational_root_write||
     result.covered_by_frontend_write>result.within_operational_root_write)
    return null;
  return Object.freeze(result);
}
/**
 * Trusted inputs ONLY: locations from exact-SHA isolated Runner, files from
 * pinned preliminary snapshot, rows from verified Engineer-signed approval,
 * operationalPermissions from actually issued coordinator parent credential.
 * Child-role coverage is the signed Task grant, NOT independent child-DC proof.
 */
export function auditTrustedTypecheckPermissionScope({
  diagnostics,planningFiles,approvedRows,operationalPermissions,repo,branch
}={}){
  if(!Array.isArray(diagnostics)||!diagnostics.length||diagnostics.length>8||
     !Array.isArray(planningFiles)||planningFiles.length>128||
     !Array.isArray(approvedRows)||approvedRows.length>128||
     !Array.isArray(operationalPermissions)||operationalPermissions.length>128||
     !repo||!["authority","owner","repository"].every(k=>
       typeof repo[k]==="string"&&repo[k].trim())||
     typeof branch!=="string"||!branch.trim()||branch.length>128)return null;
  if(diagnostics.some(x=>!x||typeof x!=="object"||
       Object.keys(x).sort().join(",")!=="code,column,line,path"||
       !isPath(x.path)||!CODE.test(x.code)||
       !Number.isSafeInteger(x.line)||x.line<1||x.line>100000||
       !Number.isSafeInteger(x.column)||x.column<1||x.column>10000))
    return null;
  if(planningFiles.some(p=>typeof p!=="string"||!p.trim())||
     approvedRows.some(p=>!validGrant(p,true))||
     operationalPermissions.some(p=>!validGrant(p,false)))deny();
  const planned=new Set(approvedRows.map(key));
  const root=new Set(operationalPermissions.map(key));
  if(root.size!==operationalPermissions.length||
     planned.size!==root.size||[...planned].some(k=>!root.has(k)))deny();
  const paths=new Set(diagnostics.map(d=>d.path));
  const snapshot=new Set(planningFiles);
  const covered=(set,operation,resource)=>
    set.has(JSON.stringify([operation,resource]));
  const role=(who,resource)=>approvedRows.some(p=>
    p.agent_id===who&&p.operation==="update_file"&&p.resource===resource);
  const counters={
    outside_planning_snapshot:0,outside_signed_plan_write:0,
    outside_operational_root_write:0,within_operational_root_write:0,
    within_test_task_write:0,root_write_but_test_write_missing:0,
    covered_by_backend_write:0,covered_by_frontend_write:0
  };
  for(const path of paths){
    const resource=fileResource(repo,branch,path);
    if(!snapshot.has(path))counters.outside_planning_snapshot++;
    if(!covered(planned,"update_file",resource))counters.outside_signed_plan_write++;
    if(!covered(root,"update_file",resource))
      counters.outside_operational_root_write++;
    else{
      counters.within_operational_root_write++;
      if(role("test",resource))counters.within_test_task_write++;
      else counters.root_write_but_test_write_missing++;
      if(role("backend",resource))counters.covered_by_backend_write++;
      if(role("frontend",resource))counters.covered_by_frontend_write++;
    }
  }
  return safeTypecheckPermissionScopeAudit({
    schema:SCHEMA,status:"observed",
    location_count:diagnostics.length,distinct_file_count:paths.size,
    ...counters
  });
}
