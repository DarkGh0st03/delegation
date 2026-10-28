/** Bounded native pilot ONLY. Not a credential/signature verifier.
 * Enforces structure and task ordering before any A2A/Gitea/Docker effect.
 * Planner/Engineer contracts stay generic; Gateway/Rust remain authoritative.
 */
import {canonicalRepositoryUri,canonicalBranchUri,canonicalFileUri}
  from "../src/canonical.ts";
import {analyzeApprovedTestEdits} from "./approved-test-edits.mjs";
const ROLES=["backend","frontend","test"];
const OPS={
  orchestrator:new Set(["create_branch","create_pull_request"]),
  backend:new Set(["read_file","update_file"]),
  frontend:new Set(["read_file","update_file"]),
  test:new Set(["read_file","update_file","create_file","run_tests"])
};
const FILES=new Set(["read_file","update_file","create_file"]);
const WRITES=new Set(["update_file","create_file"]);
function deny(message){throw Error("Pilot DAG preflight: "+message);}
function filePath(repo,branch,resource){
  const prefix=canonicalBranchUri(repo,branch)+"/files/";
  if(!resource.startsWith(prefix))deny("file resource outside branch");
  let path;
  try{
    const pieces=resource.slice(prefix.length).split("/").map(decodeURIComponent);
    if(pieces.some(p=>!p||p==="."||p===".."||
      p.includes("/")||p.includes("\\")||p.includes("%")||
      /[\x00-\x1f\x7f]/u.test(p)))deny("invalid canonical file path");
    path=pieces.join("/");
  }catch{deny("invalid canonical file path");}
  if(canonicalFileUri(repo,branch,path)!==resource)
    deny("noncanonical file resource");
  return path;
}
export function preflightApprovedPilotDag({plan,grants,repo,branch}){
  if(!plan||!Array.isArray(plan.tasks)||plan.tasks.length<2||
    plan.tasks.length>12||!Array.isArray(grants)||grants.length>64)
    deny("unsupported pilot bounds");
  const tasks=new Map(plan.tasks.map(task=>[task.id,task]));
  if(tasks.size!==plan.tasks.length)deny("duplicate Task IDs");
  const root=canonicalRepositoryUri(repo),scoped=canonicalBranchUri(repo,branch);
  const byTask=new Map(plan.tasks.map(task=>[task.id,[]]));
  const taskIdsByRole=Object.fromEntries(ROLES.map(role=>
    [role,plan.tasks.filter(t=>t.agent_id===role).map(t=>t.id)]));
  for(const role of ROLES)
    if(!taskIdsByRole[role].length)
      deny("bounded pilot requires signed "+role+" Task");
  const rows=[],identity=new Set();
  for(const grant of grants){
    const task=tasks.get(grant?.task_id);
    if(!task||task.agent_id!==grant.agent_id||
      !OPS[grant.agent_id]?.has(grant.operation)||
      !task.resources.includes(grant.resource))
      deny("permission outside approved Task");
    const key=grant.task_id+"\0"+grant.operation+"\0"+grant.resource;
    if(identity.has(key))deny("duplicate Task permission");
    identity.add(key);
    byTask.get(task.id).push(grant);
    if(FILES.has(grant.operation))
      rows.push({...grant,path:filePath(repo,branch,grant.resource)});
    else if(grant.operation==="run_tests"){
      if(grant.resource!==scoped)deny("invalid Runner branch");
    }else if(grant.resource!==root)
      deny("invalid orchestrator resource");
  }
  for(const task of plan.tasks){
    const own=byTask.get(task.id);
    if(!own.length)deny("Task without approved grants");
    // A read-only specialist can complete only with a Gateway-corroborated
    // read snapshot (the execution attestor enforces that). Requiring a
    // mutation here would impose an artificial workflow on the Planner.
  }
  const single=(role,operation)=>{
    const selected=grants.filter(g=>
      g.agent_id===role&&g.operation===operation);
    if(selected.length!==1)deny("expected one "+role+" "+operation);
    return selected[0].task_id;
  };
  const branchTaskId=single("orchestrator","create_branch");
  const reviewTaskId=single("orchestrator","create_pull_request");
  const runnerTaskId=single("test","run_tests");
  if(plan.tasks[0].id!==branchTaskId||
    tasks.get(branchTaskId).depends_on.length)
    deny("first Task must create branch");
  const ancestor=(a,b,seen=new Set())=>{
    if(a===b)return false;
    if(seen.has(b))deny("cyclic DAG");
    seen.add(b);
    const task=tasks.get(b);
    if(!task)deny("unknown DAG Task");
    return task.depends_on.some(parent=>
      parent===a||ancestor(a,parent,new Set(seen)));
  };
  for(const task of plan.tasks)
    if(task.id!==branchTaskId&&!ancestor(branchTaskId,task.id))
      deny("Task not downstream of branch");
  if(!ancestor(runnerTaskId,reviewTaskId))
    deny("PR must depend on final Runner");
  const writes=rows.filter(g=>WRITES.has(g.operation));
  for(const write of writes){
    if(write.operation==="update_file"&&!rows.some(g=>
      g.task_id===write.task_id&&g.operation==="read_file"&&
      g.resource===write.resource))
      deny("signed update missing same-Task read");
    for(const other of writes){
      if(other===write||other.resource!==write.resource)continue;
      if(other.task_id===write.task_id||
        (!ancestor(other.task_id,write.task_id)&&
         !ancestor(write.task_id,other.task_id)))
        deny("unordered or overlapping file writes");
    }
    if(write.task_id!==runnerTaskId&&!ancestor(write.task_id,runnerTaskId))
      deny("Runner must follow every file edit");
    if(!ancestor(write.task_id,reviewTaskId))
      deny("PR must follow every file edit");
  }
  const created=new Map();
  for(const g of rows.filter(x=>x.operation==="create_file")){
    if(created.has(g.resource))deny("file created twice");
    created.set(g.resource,g.task_id);
  }
  for(const g of rows.filter(x=>x.operation==="read_file")){
    const creator=created.get(g.resource);
    if(creator!==undefined&&!ancestor(creator,g.task_id))
      deny("read of new file before creation");
  }
  const testGrants=grants.filter(g=>g.agent_id==="test");
  const testRows=rows.filter(g=>g.agent_id==="test");
  const testShape=analyzeApprovedTestEdits({
    creates:testRows.filter(g=>g.operation==="create_file").map(g=>g.path),
    updates:testRows.filter(g=>g.operation==="update_file").map(g=>g.path),
    reads:testRows.filter(g=>g.operation==="read_file").map(g=>g.path),
    testGrants
  });
  return Object.freeze({taskIdsByRole,branchTaskId,reviewTaskId,
    runnerTaskId,approvedTaskCount:plan.tasks.length,
    createdTestFiles:testShape.createdTestFiles,
    updatedTestFiles:testShape.updatedTestFiles,
    expectedTestWriteKeys:testShape.expectedWriteKeys});
}
