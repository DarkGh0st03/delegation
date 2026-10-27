/**
 * F1 preflight: REAL disposable Gitea, UNSOLVED requirement, no Gemini calls.
 * Independent source novelty and immutable revision. Never place golden
 * edits, source contents or credentials into model prompts or evidence.
 * Native Rust VP / Gateway / OPA is a distinct proof, not this direct GET.
 */
import {GiteaClient} from "../apps/gateway/src/gitea-client.ts";

const SHA=/^[a-f0-9]{40}$/u;
const LOCAL=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u;
const PATHS=Object.freeze([
  "apps/backend/src/users/user.service.ts",
  "apps/backend/src/users/user.routes.ts",
  "apps/frontend/src/api/users-api.ts",
  "apps/frontend/src/pages/UserDetailPage.tsx"
]);
function deny(reason){throw Error("F1 real Gitea readiness NO-GO: "+reason);}
function sourceCheck(path,source){
  if(typeof source!=="string"||!source||Buffer.byteLength(source)>96_000)
    deny("unbounded baseline file");
  switch(path){
    case "apps/backend/src/users/user.service.ts":
      if(!source.includes("listUsers()")||!source.includes("getUser(")||
         /listUsersByDepartment\s*\(/u.test(source))
        deny("backend user directory baseline unsuitable or already solved");
      break;
    case "apps/backend/src/users/user.routes.ts":
      if(!source.includes('router.get("/:id"')||
         /by-department|byDepartment/iu.test(source))
        deny("backend router baseline unsuitable or already solved");
      break;
    case "apps/frontend/src/api/users-api.ts":
      if(!source.includes("listUsers()")||
         /listUsersByDepartment|by-department/iu.test(source))
        deny("frontend API baseline unsuitable or already solved");
      break;
    case "apps/frontend/src/pages/UserDetailPage.tsx":
      if(!source.includes("UserDetailPage")||
         /Department directory|listUsersByDepartment/iu.test(source))
        deny("frontend baseline unsuitable or already solved");
      break;
    default:deny("path outside independent source scope");
  }
}
/**
 * No write or privileged action: GiteaClient is used ONLY for GETs.
 * The exact main SHA is supplied from a separately pinned bootstrap,
 * never from an untrusted model proposal or current branch PR.
 */
export async function inspectF1RealGiteaPlannerReadiness({
  baseUrl,readToken,expectedMainSha,fetchFn=fetch
}={}){
  const m=typeof baseUrl==="string"?LOCAL.exec(baseUrl):null;
  if(!m||Number(m[1])>65535||
     !SHA.test(expectedMainSha??"")||
     typeof readToken!=="string"||readToken.trim().length<16||
     typeof fetchFn!=="function")
    deny("independently pinned disposable localhost Gitea and reader required");
  const client=new GiteaClient({
    baseUrl,token:readToken,owner:"thesis",
    repository:"iam-console-poc",timeoutMs:10000,fetchFn
  });
  const before=await client.readRepository();
  if(before.full_name!=="thesis/iam-console-poc"||
     before.default_branch!=="main"||
     before.revision!==expectedMainSha)
    deny("repository identity or original main revision not pinned");
  for(const path of PATHS){
    const file=await client.readTextFile("main",path,expectedMainSha);
    if(file.path!==path||file.branch!=="main"||
       file.revision!==expectedMainSha)
      deny("unbound source read in real Gitea");
    sourceCheck(path,file.content);
  }
  const after=await client.getBranchMetadata("main");
  if(after.commit_sha!==expectedMainSha||after.name!=="main")
    deny("main changed during Planning source preflight");
  return Object.freeze({
    schema:"f1-real-disposable-gitea-readonly-baseline-v1",
    status:"unsolved_pinned_real_gitea_baseline_verified",
    scenario_id:"department-directory",
    repository:"thesis/iam-console-poc",
    base_revision:expectedMainSha,
    verified_source_files:PATHS.length,
    main_unchanged:true,
    novel_unsolved_requirement:true,
    read_only_api_operations:true,
    actual_gitea_source_contents_excluded:true,
    golden_solution_excluded:true,
    provider_model_inference_calls:0,
    native_vp_opa_authorization_attested_by_this_check:false,
    engineer_approval_verified_by_this_check:false,
    executable_gemini_plan_produced:false,
    external_r5_go:false
  });
}
