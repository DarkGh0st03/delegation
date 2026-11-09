#!/usr/bin/env node
/**
 * R464: owner-only, read-only GitHub administrative readiness for the PAID
 * R5 Gemini profile. Not the scripted profile, not a workflow dispatch,
 * trusted physical runner attestation, Engineer approval, or R5 GO.
 * No GitHub Actions execution, no model calls, no state mutation.
 */
import {constants} from "node:fs";
import {open,lstat} from "node:fs/promises";
import {dirname,isAbsolute,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {verifyR5GeminiPrivateDispatchRegistration}
 from "./r5-gemini-private-dispatch-registration.mjs";

const REPO="DarkGh0st03/delegation";
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const REF="refs/heads/"+BRANCH;
const WORKFLOW=".github/workflows/trusted-gemini-private-session-hold.yml";
const ENVIRONMENT="r5-private-gemini-admission";
const API="https://api.github.com/repos/"+REPO;
const SHA=/^[0-9a-f]{40}$/u;
const LABELS=Object.freeze(["self-hosted","linux","x64","delegation-private"]);
const deny=()=>{throw Error("R464 paid Gemini GitHub private controls NO-GO");};
function validReviewRule(rule){
 return rule?.type==="required_reviewers"&&
  rule.prevent_self_review===true&&
  Array.isArray(rule.reviewers)&&rule.reviewers.length>=1&&
  rule.reviewers.every(x=>["User","Team"].includes(x?.type)&&
   x.reviewer&&typeof x.reviewer==="object"&&
   (typeof x.reviewer.login==="string"&&x.reviewer.login.length>0||
    typeof x.reviewer.slug==="string"&&x.reviewer.slug.length>0));
}
function privateRunner(x){
 return Array.isArray(x?.labels)&&LABELS.every(label=>
  x.labels.some(y=>y?.name?.toLowerCase?.()===label));
}
/** Pure snapshot review; CI may test this with synthetic metadata only. */
export function verifyR464PaidPrivateGithubControlsSnapshot({
 expectedSourceSha,expectedMainSha,development,main,environment,runners
}={}){
 if(!SHA.test(expectedSourceSha??"")||!SHA.test(expectedMainSha??"")||
    development?.name!==BRANCH||
    development?.commit?.sha!==expectedSourceSha||
    main?.name!=="main"||main?.commit?.sha!==expectedMainSha)
  deny();
 // Fail-closed on missing/ambiguous independent protection. GitHub's
 // visible environment metadata is NOT physical runner/host attestation.
 if(environment?.name!==ENVIRONMENT||
    environment?.can_admins_bypass!==false||
    environment?.deployment_branch_policy!==null||
    !Array.isArray(environment?.protection_rules)||
    !environment.protection_rules.some(validReviewRule))deny();
 // A paginated/partial inventory must not misreport a sole trusted runner.
 if(!Number.isSafeInteger(runners?.total_count)||
    !Array.isArray(runners?.runners)||
    runners.total_count!==runners.runners.length||
    runners.total_count>100)deny();
 const matches=runners.runners.filter(privateRunner);
 if(matches.length!==1)deny();
 const runner=matches[0];
 if(runner.status!=="online"||runner.busy!==false||
    !Number.isSafeInteger(runner.id)||runner.id<1||
    runners.runners.some(r=>r!==runner&&r?.id===runner.id))deny();
 return Object.freeze({
  status:"paid_admin_controls_visible_only_not_r5_go",
  source_sha:expectedSourceSha,main_sha:expectedMainSha,
  environment_name:ENVIRONMENT,private_runner_id:runner.id,
  private_runner_candidates:1,independent_review_configured:true,
  workflow_registration_verified:false,
  physical_runner_attested:false,private_engineer_host_attested:false,
  signed_engineer_approval:false,model_api_calls:0,r5_go:false
 });
}
function validToken(x){
 return typeof x==="string"&&x.length>=16&&x.length<=512&&!/\s/u.test(x);
}
/**
 * Read only: independently pinned main+feature, protected Environment,
 * complete private Runner inventory, and existing R5 Gemini registration
 * check. Never return bearer, runner URL, TLS, or approval capability.
 */
export async function verifyR464PaidPrivateGithubReadiness({
 expectedSourceSha,expectedMainSha,githubToken,fetchFn=fetch
}={}){
 if(!SHA.test(expectedSourceSha??"")||!SHA.test(expectedMainSha??"")||
    !validToken(githubToken)||typeof fetchFn!=="function")deny();
 async function get(path){
  const url=API+path;
  const target=new URL(url);
  if(target.origin!=="https://api.github.com"||
     !target.pathname.startsWith("/repos/"+REPO+"/")||
     !/^\/(?:branches\/|environments\/|actions\/runners)/u.test(path))deny();
  let response;
  try{
   response=await fetchFn(url,{
    method:"GET",redirect:"error",
    headers:{accept:"application/vnd.github+json",
     "x-github-api-version":"2022-11-28",
     authorization:"Bearer "+githubToken},
    signal:AbortSignal.timeout(12000)
   });
  }catch{deny();}
  if(!response?.ok)deny();
  try{
   const value=await response.json();
   if(!value||typeof value!=="object"||Array.isArray(value))deny();
   return value;
  }catch{deny();}
 }
 const [development,main,environment,runners]=await Promise.all([
  get("/branches/"+encodeURIComponent(BRANCH)),
  get("/branches/main"),
  get("/environments/"+encodeURIComponent(ENVIRONMENT)),
  get("/actions/runners?per_page=100")
 ]);
 const controls=verifyR464PaidPrivateGithubControlsSnapshot({
  expectedSourceSha,expectedMainSha,development,main,environment,runners
 });
 // Reuse the R5 paid profile's original branch/blob/registration check;
 // never substitute the scripted R5 workflow or its environment.
 try{
  await verifyR5GeminiPrivateDispatchRegistration({
   pins:{expectedRepository:REPO,expectedRef:REF,
    expectedWorkflowPath:WORKFLOW,expectedSourceSha},
   fetchFn:async(url,request)=>{
    const target=new URL(url);
    if(target.origin!=="https://api.github.com"||
       !target.pathname.startsWith("/repos/"+REPO+"/")||
       !(/^\/repos\/DarkGh0st03\/delegation\/(?:branches\/|contents\/|actions\/workflows\/)/u.test(target.pathname)||
        target.pathname==="/repos/"+REPO))deny();
    return fetchFn(url,{...request,method:"GET",redirect:"error",
     headers:{...request.headers,authorization:"Bearer "+githubToken}});
   }
  });
 }catch{deny();}
 return Object.freeze({...controls,
  status:"paid_admin_and_registration_readonly_preflight_not_r5_go",
  workflow_registration_verified:true
 });
}
async function protectedOperatorToken(file){
 if(typeof file!=="string"||!isAbsolute(file)||resolve(file)!==file)deny();
 let handle;
 try{
  const dir=await lstat(dirname(file));
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o077)!==0||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
    deny();
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const st=await handle.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o077)!==0||
     st.size<16||st.size>512||
     (typeof process.getuid==="function"&&st.uid!==process.getuid()))
   deny();
  const token=(await handle.readFile("utf8")).trim();
  if(!validToken(token))deny();
  return token;
 }catch{deny();}
 finally{await handle?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.env.GITHUB_ACTIONS==="true")deny();
  const token=await protectedOperatorToken(
   process.env.DELEGATION_R5_OPERATOR_GITHUB_TOKEN_FILE);
  const verified=await verifyR464PaidPrivateGithubReadiness({
   expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
   expectedMainSha:process.env.DELEGATION_R5_EXPECTED_MAIN_SHA,
   githubToken:token
  });
  process.stdout.write("R464 paid Github registration and visible controls checked at "+
   verified.source_sha+"; private Host unverified; NO R5 GO\n");
 }catch{
  // Never echo upstream error bodies, token, runner network or local paths.
  process.stderr.write("R464 paid private GitHub admin preflight NO-GO\n");
  process.exitCode=1;
 }
}
