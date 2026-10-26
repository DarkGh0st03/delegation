#!/usr/bin/env node
/**
 * R5 READ-ONLY registration PR audit. No merge, no dispatch, no secrets,
 * no Engineer/Gateway traffic, no paid model invocation. The only allowed
 * PR is the one-file, independently reviewed manual-workflow proposal.
 */
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const REPO="DarkGh0st03/delegation";
const MAIN="main";
const DEV="refactor/post-prof-plan-contracts-20261021";
const REGISTRATION="r5/scripted-workflow-registration-review-20261026";
const REGISTRATION_HEAD="6ea1e36b1ed502336f7dce57aa63d8bb28bf0869";
const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const WORKFLOW_BLOB="ff11137db63ade2806387537f5fd87c37e1a2285";
const URL_ROOT="https://api.github.com/repos/"+REPO;
const SHA=/^[a-f0-9]{40}$/u;
function deny(reason){throw Error("R5 registration PR audit NO-GO: "+reason);}
function exactRepo(ref){return ref?.repo?.full_name===REPO;}
/** Can be tested entirely offline; it provides no authorization to merge. */
export function verifyR5OneFileRegistrationPrSnapshot({
  expectedDevSha,expectedMainSha,repo,main,dev,pr,files,
  devWorkflow,mainWorkflowAbsent
}={}){
  if(!SHA.test(expectedDevSha??"")||!SHA.test(expectedMainSha??""))
    deny("independent owner SHA pins missing");
  if(repo?.full_name!==REPO||repo?.default_branch!==MAIN||
     main?.name!==MAIN||main?.commit?.sha!==expectedMainSha||
     dev?.name!==DEV||dev?.commit?.sha!==expectedDevSha)
    deny("repository/default or source SHA changed");
  if(pr?.number!==37||pr?.state!=="open"||
     pr.draft!==true||pr.merged!==false||
     pr.base?.ref!==MAIN||pr.base?.sha!==expectedMainSha||
     pr.head?.ref!==REGISTRATION||pr.head?.sha!==REGISTRATION_HEAD||
     !exactRepo(pr.head)||!exactRepo(pr.base))
    deny("reviewed draft PR identity or base/head SHA changed");
  if(pr.changed_files!==1||pr.deletions!==0||pr.additions!==50||
     !Array.isArray(files)||files.length!==1)
    deny("PR is not exactly the reviewed one-file registration proposal");
  const only=files[0];
  if(only?.filename!==WORKFLOW||only.status!=="added"||
     only.additions!==50||only.deletions!==0||
     only.sha!==WORKFLOW_BLOB||
     devWorkflow?.type!=="file"||devWorkflow.path!==WORKFLOW||
     devWorkflow.sha!==WORKFLOW_BLOB||
     mainWorkflowAbsent!==true)
    deny("workflow blob drift or default branch already registered");
  return Object.freeze({
    status:"draft_registration_pr_exact_review_only_not_merged",
    pull_request:37,
    reviewed_registration_head:REGISTRATION_HEAD,
    reviewed_workflow_blob:WORKFLOW_BLOB,
    main_sha:expectedMainSha,
    development_sha:expectedDevSha,
    workflow_registration_complete:false,
    private_runner_deployed:false,
    engineer_signature_verified:false,
    model_api_calls:0,
    r5_go:false
  });
}
/** Only GET these seven fixed public GitHub resources. */
export async function verifyR5OneFileRegistrationPr({
  expectedDevSha,expectedMainSha,fetchFn=fetch
}={}){
  if(!SHA.test(expectedDevSha??"")||
     !SHA.test(expectedMainSha??"")||typeof fetchFn!=="function")
    deny("read-only PR audit SHA pins missing");
  async function read(path,{allowMissing=false,array=false}={}){
    let res;
    try{
      res=await fetchFn(URL_ROOT+path,{
        method:"GET",redirect:"error",signal:AbortSignal.timeout(12000),
        headers:{accept:"application/vnd.github+json",
          "x-github-api-version":"2022-11-28"}
      });
    }catch{deny("GitHub public PR information unavailable");}
    if(allowMissing&&res?.status===404)return null;
    if(!res?.ok)deny("GitHub PR information unavailable or denied");
    try{
      const result=await res.json();
      if(!result||typeof result!=="object"||
         Array.isArray(result)!==array)
        deny("malformed PR data");
      return result;
    }catch{deny("malformed GitHub PR response");}
  }
  const [repo,main,dev,pr,files,devWorkflow,mainWorkflow]=
    await Promise.all([
      read(""),
      read("/branches/"+MAIN),
      read("/branches/"+encodeURIComponent(DEV)),
      read("/pulls/37"),
      read("/pulls/37/files?per_page=100"),
      read("/contents/"+WORKFLOW+"?ref="+encodeURIComponent(DEV)),
      read("/contents/"+WORKFLOW+"?ref="+MAIN,{allowMissing:true})
    ]);
  return verifyR5OneFileRegistrationPrSnapshot({
    expectedDevSha,expectedMainSha,repo,main,dev,pr,files,devWorkflow,
    mainWorkflowAbsent:mainWorkflow===null
  });
}
if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.env.GITHUB_ACTIONS==="true")
      deny("owner-only review cannot be requested by a workflow");
    const x=await verifyR5OneFileRegistrationPr({
      expectedDevSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
      expectedMainSha:process.env.DELEGATION_R5_EXPECTED_MAIN_SHA
    });
    process.stdout.write(
      "R5 PR #"+x.pull_request+" exactly matches reviewed draft at "+
      x.development_sha+"; workflow NOT registered, R5 NO-GO\n");
  }catch{
    process.stderr.write("R5 registration PR review NO-GO\n");
    process.exitCode=1;
  }
}
