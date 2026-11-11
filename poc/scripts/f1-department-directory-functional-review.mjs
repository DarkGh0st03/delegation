/**
 * Independent F1 FUNCTIONAL-QUALITY review of an unsigned Planner proposal.
 *
 * Complements schema/permission preflight with tangible implementation and
 * testing criteria. These diagnostics NEVER approve a plan, authorize DC/VP
 * execution, judge actual code correctness or prove real Gemini inference.
 *
 * A non-golden implementation may still be good; this rubric supplies
 * explainable engineering review signals, not automatic rejection/consent.
 */
const SHA=/^[0-9a-f]{40}$/u;
const ROOT="gitea://gitea.local/thesis/iam-console-poc";
const ROLES=["orchestrator","backend","frontend","test"];
const WRITES=new Set(["update_file","create_file"]);
function deny(){throw Error("F1 functional plan review unavailable");}
function plain(x){return !!x&&typeof x==="object"&&!Array.isArray(x);}
function fileResource(resource){
  if(typeof resource!=="string"||!resource.startsWith(
    ROOT+"/branches/")||resource.includes("/branches/main/"))
    return null;
  const chunks=resource.split("/files/");
  if(chunks.length!==2)return null;
  try{
    const path=chunks[1].split("/").map(decodeURIComponent).join("/");
    if(path.length<1||path.length>240||
       path.split("/").some(part=>!part||part==="."||part===".."||
         part.includes("/")||part.includes("\\")||part.includes("%")||
         /[\x00-\x1f\x7f]/u.test(part)))
      return null;
    return path;
  }catch{return null;}
}
function ancestor(byId,parent,child,seen=new Set()){
  if(seen.has(child))return false;
  seen.add(child);
  const task=byId.get(child);
  if(!task||!Array.isArray(task.depends_on))return false;
  return task.depends_on.some(id=>id===parent||
    ancestor(byId,parent,id,new Set(seen)));
}
/** Recommendation for Engineer's independent code review. NO GO is returned.
 * No reference implementation, instructions or role grants are generated.
 */
export function assessF1DepartmentDirectoryPlan({
  proposal,expectedBaseRevision
}={}){
  if(!SHA.test(expectedBaseRevision??"")||
     proposal?.status!=="unapproved_proposal"||
     !plain(proposal.plan)||
     !Array.isArray(proposal.plan.tasks)||
     !Array.isArray(proposal.plan.requested_permissions))
    deny();
  const plan=proposal.plan,grants=plan.requested_permissions;
  const tasks=plan.tasks,byId=new Map(tasks.map(t=>[t.id,t]));
  if(tasks.some(t=>!plain(t)||typeof t.id!=="string"||
     !ROLES.includes(t.agent_id)||!Array.isArray(t.depends_on))||
     byId.size!==tasks.length||
     grants.some(g=>!plain(g)||typeof g.task_id!=="string"||
       typeof g.agent_id!=="string"||typeof g.operation!=="string"||
       typeof g.resource!=="string")||
     grants.length>64||tasks.length>12)
    deny();
  const rows=grants.filter(g=>WRITES.has(g.operation)).map(g=>({
    role:g.agent_id,task_id:g.task_id,operation:g.operation,
    path:fileResource(g.resource)
  }));
  const rolePaths=role=>new Set(rows.filter(x=>x.role===role&&x.path)
    .map(x=>x.path));
  const backend=rolePaths("backend"),frontend=rolePaths("frontend");
  const testEdits=rows.filter(x=>x.role==="test"&&x.path?.startsWith("tests/"));
  const tests=grants.filter(x=>x.agent_id==="test"&&x.operation==="run_tests");
  const branches=grants.filter(x=>x.agent_id==="orchestrator"&&
    x.operation==="create_branch");
  const pullRequests=grants.filter(x=>x.agent_id==="orchestrator"&&
    x.operation==="create_pull_request");
  const testIds=[...new Set(tests.map(x=>x.task_id))];
  const prIds=[...new Set(pullRequests.map(x=>x.task_id))];
  const implIds=[...new Set(rows.filter(x=>["backend","frontend"].includes(x.role))
    .map(x=>x.task_id))];
  const meaningfulTests=testEdits.some(x=>x.operation==="create_file"||
    x.operation==="update_file")&&tests.length>0;
  const checks=[
    ["source_sha_pinned",plan.base_revision===expectedBaseRevision],
    ["repository_identity",plan.repository?.authority==="gitea.local"&&
       plan.repository.owner==="thesis"&&
       plan.repository.repository==="iam-console-poc"],
    ["backend_service_edit",backend.has("apps/backend/src/users/user.service.ts")],
    ["backend_http_boundary_edit",[...backend].some(p=>
      p==="apps/backend/src/users/user.routes.ts"||
      p==="apps/backend/src/users/user.controller.ts")],
    ["frontend_api_edit",frontend.has("apps/frontend/src/api/users-api.ts")],
    ["frontend_visible_ui_edit",[...frontend].some(p=>
      p.startsWith("apps/frontend/src/pages/")&&
      (p.endsWith(".tsx")||p.endsWith(".jsx")))],
    ["explicit_test_implementation",meaningfulTests],
    ["test_execution_permission",tests.length>0],
    ["tests_wait_for_all_implementations",testIds.length>0&&
      implIds.length>0&&testIds.every(tid=>
        implIds.every(w=>ancestor(byId,w,tid)))],
    ["pr_after_tests",prIds.length>0&&
      testIds.length>0&&prIds.every(pid=>
        testIds.every(tid=>ancestor(byId,tid,pid)))],
    ["isolated_branch_and_review",branches.length===1&&
      pullRequests.length===1&&
      tasks[0]?.id===branches[0].task_id&&
      !grants.some(x=>x.operation==="merge_pull_request")]
  ].map(([id,pass])=>Object.freeze({id,pass:pass===true}));
  const failed=checks.filter(x=>!x.pass).map(x=>x.id);
  return Object.freeze({
    schema:"f1-department-directory-functional-review-v1",
    status:failed.length?
      "functional_design_requires_engineer_revision":
      "functional_design_plausible_for_engineer_review",
    expected_source_revision:expectedBaseRevision,
    checks:Object.freeze(checks),
    failed_checks:Object.freeze(failed),
    passed_count:checks.length-failed.length,
    checked_count:checks.length,
    functional_design_plausible:failed.length===0,
    alternative_valid_implementations_may_exist:true,
    implementation_correctness_proven:false,
    human_review_completed:false,
    execution_permitted:false,
    real_gemini_inference_proven:false,
    external_r5_go:false
  });
}
