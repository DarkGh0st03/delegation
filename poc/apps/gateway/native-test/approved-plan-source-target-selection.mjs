/**
 * Offline Block B experiment only. Selects source-derived edits from the
 * Engineer-reviewed plan and exact approved permission resources, NOT from a
 * hardcoded scenario name, file manifest or target-file constant.
 *
 * This function does NOT verify the signature or enforce DC/VP/OPA; upstream
 * MUST authenticate approval and run assertApprovedPlanScope first.
 */
import {canonicalBranchUri,canonicalFileUri} from "../src/canonical.ts";

const permitted=new Set(["read_file","update_file"]);
const validPathSegment=p=>typeof p==="string"&&p.length>0&&
  p!=="."&&p!==".."&&!p.includes("%")&&!p.includes("/")&&
  !p.includes("\\")&&!/[\x00-\x1f\x7f]/u.test(p);
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function deny(reason){throw Error("Approved source-derived target NO-GO: "+reason);}
function filePath(repo,branch,resource){
  const prefix=canonicalBranchUri(repo,branch)+"/files/";
  if(typeof resource!=="string"||!resource.startsWith(prefix))
    deny("file grant outside approved repository or branch");
  let parts;
  try{parts=resource.slice(prefix.length).split("/").map(decodeURIComponent);}
  catch{deny("malformed percent-encoded file path");}
  if(!parts.length||parts.length>24||parts.some(x=>!validPathSegment(x)))
    deny("unsafe approved file path");
  const path=parts.join("/");
  if(path.length>240||canonicalFileUri(repo,branch,path)!==resource)
    deny("noncanonical file grant");
  return path;
}
export function selectSourceDerivedTargetsFromApprovedPlan({
  plan,approvedRows,repo,branch
}={}){
  if(!object(plan)||!Array.isArray(plan.tasks)||
     !Array.isArray(plan.requested_permissions)||
     !Array.isArray(approvedRows)||!object(repo)||
     typeof branch!=="string"||!branch||
     plan.tasks.length>64||approvedRows.length>256)
    deny("reviewed plan and permission scope required");
  const tasks=new Map(plan.tasks.map(task=>[task.id,task]));
  const originals=new Map(plan.requested_permissions.map(g=>[g.id,g]));
  if(tasks.size!==plan.tasks.length||
     originals.size!==plan.requested_permissions.length)
    deny("duplicate original plan identities");
  const approvedIds=new Set(),byTask=new Map();
  for(const g of approvedRows){
    const t=tasks.get(g?.task_id),original=originals.get(g?.id);
    if(!object(g)||!original||approvedIds.has(g.id)||!t||
       original.task_id!==g.task_id||
       original.agent_id!==g.agent_id||
       original.operation!==g.operation||
       original.resource!==g.resource||t.agent_id!==g.agent_id)
      deny("unapproved or rewritten grant");
    approvedIds.add(g.id);
    const current=byTask.get(g.task_id)??[];
    current.push(g);byTask.set(g.task_id,current);
  }
  const output=[],usedPaths=new Set();
  for(const task of plan.tasks){
    if(task.agent_id!=="backend"||
       !byTask.has(task.id))continue;
    if(typeof task.description!=="string")deny("missing Task objective");
    // These declarative test-only directives select the needed categories;
    // filenames and locations must still come from approved grants.
    const wantsRoutes=/^ROUTE /mu.test(task.description);
    const wantsController=/^CONTROLLER HANDLER /mu.test(task.description);
    const wantsStatus=/^STATUS TYPE /mu.test(task.description);
    if(!wantsRoutes&&!wantsController&&!wantsStatus)continue;
    const operations=new Map();
    for(const g of byTask.get(task.id)){
      if(!permitted.has(g.operation))
        deny("unexpected Backend permission in source-derived Task");
      const path=filePath(repo,branch,g.resource);
      const ops=operations.get(path)??new Set();
      if(ops.has(g.operation))deny("duplicate file operation");
      ops.add(g.operation);operations.set(path,ops);
    }
    for(const [needed,suffix] of [
      [wantsRoutes,".routes.ts"],
      [wantsController,".controller.ts"],
      [wantsStatus,"status.ts"]
    ]){
      if(!needed)continue;
      const matched=[...operations].filter(([path,ops])=>
        path.endsWith(suffix)&&ops.has("read_file")&&
        ops.has("update_file"));
      if(matched.length!==1)
        deny("no unique exact read/update grant for approved code category");
      const path=matched[0][0];
      if(usedPaths.has(path))deny("source-derived file selected in two tasks");
      usedPaths.add(path);output.push(path);
    }
  }
  if(!output.length||output.length>8)
    deny("no authorized source-derived file candidates");
  return Object.freeze(output);
}
