#!/usr/bin/env node
/**
 * R5 zero-charge GitHub administration preflight. OWNER MACHINE ONLY.
 * Uses read-only GitHub REST endpoints with an independently protected
 * operator token. Never dispatches workflow, modifies GitHub, reaches an
 * Engineer Host, signs a plan, or treats a visible runner as trusted.
 */
import {constants} from "node:fs";
import {open,lstat} from "node:fs/promises";
import {dirname,isAbsolute,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {verifyR5ScriptedDispatchRegistration}
  from "./r5-scripted-dispatch-registration.mjs";

const REPO="DarkGh0st03/delegation";
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const REF="refs/heads/"+BRANCH;
const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const ENVIRONMENT="r5-private-scripted-admission";
const API="https://api.github.com/repos/"+REPO;
const SHA=/^[a-f0-9]{40}$/u;
const LABELS=Object.freeze(["self-hosted","linux","x64","delegation-private"]);
function deny(reason){throw Error("R5 private GitHub deployment NO-GO: "+reason);}
function validToken(token){
  return typeof token==="string"&&token.length>=16&&token.length<=512&&
    !/\s/u.test(token);
}
function validReviewRule(rule){
  return rule?.type==="required_reviewers"&&
    rule.prevent_self_review===true&&
    Array.isArray(rule.reviewers)&&rule.reviewers.length>=1&&
    rule.reviewers.every(r=>["User","Team"].includes(r?.type)&&
      r.reviewer&&typeof r.reviewer==="object"&&
      (typeof r.reviewer.login==="string"||
       typeof r.reviewer.slug==="string"));
}
/** Pure decision on already fetched GitHub JSON, suitable for offline CI. */
export function verifyR5PrivateGithubControlsSnapshot({
  sourceSha,branch,environment,runners
}={}){
  if(!SHA.test(sourceSha??"")||
     branch?.name!==BRANCH||branch?.commit?.sha!==sourceSha)
    deny("reviewed development branch SHA differs from GitHub");
  // GET /environments places prevent_self_review on the reviewers
  // protection RULE, not a top-level field. The REST response cannot
  // reliably prove that admins cannot bypass environment protection.
  if(environment?.name!==ENVIRONMENT||
     environment?.can_admins_bypass===true||
     !Array.isArray(environment.protection_rules)||
     !environment.protection_rules.some(validReviewRule))
    deny("private environment lacks independent, non-bypassable manual reviewers");
  // Branch policy semantics can be intricate. Do not assume an allowlist
  // accepts the development branch without a separate exact policy audit.
  if(environment.deployment_branch_policy!==null)
    deny("environment branch restrictions need separate authorized review");
  if(!runners||!Number.isSafeInteger(runners.total_count)||
     !Array.isArray(runners.runners)||
     runners.total_count!==runners.runners.length||
     runners.total_count>100)
    deny("runner listing is missing, paged, or ambiguous");
  const eligible=runners.runners.filter(r=>
    r?.status==="online"&&r.busy===false&&
    Array.isArray(r.labels)&&
    LABELS.every(label=>r.labels.some(x=>
      typeof x?.name==="string"&&x.name.toLowerCase()===label)));
  if(eligible.length!==1)
    deny("exactly one idle, online, correctly labelled private runner required");
  return Object.freeze({
    status:"private_controls_visible_only_not_r5_go",
    source_sha:sourceSha,environment_name:ENVIRONMENT,
    eligible_private_runners:1,independent_review_configured:true,
    admin_bypass_independently_verified:false,
    runner_execution_observed:false,engineer_approval_observed:false,
    git_registration_verified:false,model_api_calls:0
  });
}
/** Only fixed, read-only Github REST API routes. Do not return secrets. */
export async function verifyR5PrivateGithubDeploymentReadiness({
  expectedSourceSha,githubToken,fetchFn=fetch
}={}){
  if(!SHA.test(expectedSourceSha??"")||!validToken(githubToken)||
     typeof fetchFn!=="function")
    deny("operator source SHA and protected read-only GitHub token required");
  const read=async(path,request={})=>{
    if(!/^\/(?:branches\/|environments\/|actions\/runners|contents\/|actions\/workflows\/|$)/u.test(path))
      deny("unknown GitHub GET endpoint");
    const headers={accept:"application/vnd.github+json",
      "x-github-api-version":"2022-11-28",
      ...(request.headers??{}),authorization:"Bearer "+githubToken};
    let response;
    try{
      response=await fetchFn(API+path,{
        method:"GET",headers,redirect:"error",
        signal:AbortSignal.timeout(12000)
      });
    }catch{deny("GitHub protected read-only API unavailable");}
    if(!response?.ok)deny("GitHub returned denied/missing protected control");
    try{
      const value=await response.json();
      if(!value||typeof value!=="object"||Array.isArray(value))
        deny("invalid GitHub administrative response");
      return value;
    }catch{deny("malformed GitHub administrative response");}
  };
  const [branch,environment,runners]=await Promise.all([
    read("/branches/"+encodeURIComponent(BRANCH)),
    read("/environments/"+encodeURIComponent(ENVIRONMENT)),
    read("/actions/runners?per_page=100")
  ]);
  const controls=verifyR5PrivateGithubControlsSnapshot({
    sourceSha:expectedSourceSha,branch,environment,runners
  });
  // Independently require byte-identical, active workflow registration on
  // both refs. No OIDC or job dispatch is performed here.
  await verifyR5ScriptedDispatchRegistration({
    pins:{expectedRepository:REPO,expectedRef:REF,
      expectedWorkflowPath:WORKFLOW,expectedSourceSha},
    fetchFn:async(url,request)=>{
      if(!url.startsWith(API)||request?.method&&request.method!=="GET")
        deny("unexpected registration endpoint");
      // Registration verifier uses only known GET URLs; preserve its
      // response contract while adding the protected operator token.
      return fetchFn(url,{...request,method:"GET",redirect:"error",
        headers:{...request.headers,authorization:"Bearer "+githubToken}});
    }
  });
  return Object.freeze({...controls,
    status:"private_admin_and_registration_preflight_only_not_r5_go",
    git_registration_verified:true
  });
}

async function protectedOperatorToken(path){
  if(typeof path!=="string"||!isAbsolute(path)||resolve(path)!==path)
    deny("operator token file path unavailable");
  try{
    const parent=await lstat(dirname(path));
    if(!parent.isDirectory()||parent.isSymbolicLink()||
       (parent.mode&0o077)!==0||
       (typeof process.getuid==="function"&&parent.uid!==process.getuid()))
      deny("token parent is not owner-only");
    const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const stat=await f.stat();
      if(!stat.isFile()||(stat.mode&0o077)!==0||
         stat.size<16||stat.size>512||
         (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
        deny("operator token inode not protected");
      const value=(await f.readFile("utf8")).trim();
      if(!validToken(value))deny("invalid protected operator token");
      return value;
    }finally{await f.close();}
  }catch{deny("operator token file unavailable or unprotected");}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.env.GITHUB_ACTIONS==="true")deny("owner-only preflight cannot run in GitHub Actions");
    const token=await protectedOperatorToken(
      process.env.DELEGATION_R5_OPERATOR_GITHUB_TOKEN_FILE);
    const r=await verifyR5PrivateGithubDeploymentReadiness({
      expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
      githubToken:token
    });
    process.stdout.write("R5 private environment and registration checked at "+
      r.source_sha+"; no dispatch, approval, deployment or R5 GO\n");
  }catch{
    process.stderr.write("R5 protected GitHub administration NO-GO\n");
    process.exitCode=1;
  }
}
