/**
 * Test-only ADK script compilation from the Engineer-approved DAG.
 *
 * Approval MUST be authenticated by TrustedPlanningReviewGate upstream.
 * Input approvedRows MUST come from assertApprovedPlanScope upstream.
 * The code payload map is a deterministic offline fixture, not autonomous
 * agent implementation and NEVER an independent permission grant.
 * Real Gemini F2 will supply its own model-generated tool-call choices.
 */
import {canonicalBranchUri,canonicalFileUri}
  from "../src/canonical.ts";
const ROLES=Object.freeze(["backend","frontend","test"]);
const OPS={
  backend:new Set(["read_file","update_file"]),
  frontend:new Set(["read_file","update_file"]),
  test:new Set(["read_file","update_file","create_file","run_tests"])
};
function deny(reason){throw Error("Approved offline ADK script NO-GO: "+reason);}
function plain(x){return x!==null&&typeof x==="object"&&!Array.isArray(x);}
function topo(plan){
  if(!Array.isArray(plan?.tasks)||plan.tasks.length>64)deny("invalid tasks");
  const all=new Map(plan.tasks.map(t=>[t.id,t]));
  if(all.size!==plan.tasks.length)deny("duplicate tasks");
  const out=[],done=new Set();
  while(out.length<all.size){
    const next=plan.tasks.find(t=>!done.has(t.id)&&
      Array.isArray(t.depends_on)&&t.depends_on.every(id=>done.has(id)));
    if(!next)deny("unknown or cyclic dependency");
    done.add(next.id);out.push(next);
  }
  return out;
}
function decodeFile(repo,branch,resource){
  const prefix=canonicalBranchUri(repo,branch)+"/files/";
  if(typeof resource!=="string"||!resource.startsWith(prefix))
    deny("outside approved branch");
  let components;
  try{components=resource.slice(prefix.length).split("/").map(decodeURIComponent);}
  catch{deny("invalid encoding");}
  if(components.some(p=>!p||p==="."||p===".."||p.includes("/")||
     p.includes("\\")||p.includes("%")||/[\x00-\x1f\x7f]/u.test(p)))
    deny("noncanonical path");
  const path=components.join("/");
  if(canonicalFileUri(repo,branch,path)!==resource)deny("ambiguous file URI");
  return path;
}
/** The same constructor handles any approved plan within the supported roles.
 * It does not authenticate Engineer signatures or execute a credential.
 */
export function buildOfflineAdkScriptsFromApprovedPlan({
  plan,approvedRows,repo,branch,implementationContents,
  sourceDerivedPaths=[]
}={}){
  if(!plain(plan)||!plain(repo)||typeof branch!=="string"||
     !Array.isArray(approvedRows)||approvedRows.length>256||
     !plain(implementationContents)||
     !Array.isArray(sourceDerivedPaths)||sourceDerivedPaths.length>8||
     sourceDerivedPaths.some(p=>typeof p!=="string"||!p||
       p.startsWith("/")||p.includes("..")||p.includes("\\"))||
     new Set(sourceDerivedPaths).size!==sourceDerivedPaths.length)
    deny("missing or malformed reviewed input");
  const derived=new Set(sourceDerivedPaths),consumed=new Set();
  const tasks=topo(plan),ids=new Set(tasks.map(t=>t.id));
  const scripts=Object.fromEntries(ROLES.map(role=>[role,[]]));
  const accounted=new Set();
  for(const task of tasks){
    const permissions=approvedRows.filter(p=>p.task_id===task.id);
    if(task.agent_id==="orchestrator"){
      if(permissions.some(p=>p.agent_id!=="orchestrator"||
         !["create_branch","create_pull_request"].includes(p.operation)))
        deny("invalid infrastructure grant");
      for(const p of permissions)accounted.add(p.id);
      continue;
    }
    const role=task.agent_id;
    if(!ROLES.includes(role)||permissions.length===0)
      deny("unsupported or unauthorized agent task");
    const fileOperations=new Map();
    const runners=[];
    for(const p of permissions){
      if(!plain(p)||p.agent_id!==role||!OPS[role].has(p.operation))
        deny("wrong role or operation");
      if(accounted.has(p.id))deny("duplicate permission row");
      accounted.add(p.id);
      if(p.operation==="run_tests"){
        if(p.resource!==canonicalBranchUri(repo,branch))
          deny("test scope is not exact approved branch");
        runners.push(p);
      }else{
        const path=decodeFile(repo,branch,p.resource);
        if(!fileOperations.has(path))fileOperations.set(path,new Set());
        const ops=fileOperations.get(path);
        if(ops.has(p.operation))deny("duplicate file operation");
        ops.add(p.operation);
      }
    }
    for(const [path,ops] of fileOperations){
      if(ops.has("create_file")&&ops.size!==1)
        deny("create cannot overlap file reads or updates");
      if(ops.has("update_file")&&!ops.has("read_file"))
        deny("offline update requires approved source read");
      if(ops.has("read_file"))
        scripts[role].push({name:"read_file",args:{branch,path}});
      for(const operation of ["update_file","create_file"]){
        if(!ops.has(operation))continue;
        if(derived.has(path)){
          if(operation!=="update_file"||!ops.has("read_file")||
             Object.hasOwn(implementationContents,path))
            deny("source-derived edit cannot receive golden content");
          consumed.add(path);
          scripts[role].push({name:operation,args:{branch,path}});
        }else{
          const content=implementationContents[path];
          if(typeof content!=="string"||content.length>250000)
            deny("missing test-only implementation payload");
          scripts[role].push({name:operation,args:{branch,path,content}});
        }
      }
    }
    if(runners.length>1)deny("duplicate test execution grant");
    if(runners.length)
      scripts[role].push({name:"run_tests",
        args:{branch,profile:"poc-default"}});
  }
  if(approvedRows.some(p=>!ids.has(p.task_id)||!accounted.has(p.id)))
    deny("orphaned approved grant");
  if(consumed.size!==derived.size)
    deny("source-derived path not present in approved read/update grants");
  const output={};
  for(const role of ROLES){
    if(scripts[role].length>30)deny("offline ADK turn cap exceeded");
    output[role]=Object.freeze(scripts[role].map(c=>Object.freeze({
      name:c.name,args:Object.freeze(c.args)
    })));
  }
  return Object.freeze(output);
}
