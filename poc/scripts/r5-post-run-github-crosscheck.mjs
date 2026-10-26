#!/usr/bin/env node
/**
 * R5 POST-RUN cross-check of a LOCAL owner observation against GitHub's
 * independently fetched completed private-run metadata.
 *
 * Read-only, no dispatch, no OIDC, no A2A, no model, no authority grant.
 * This is NOT native EVM/Rust revocation attestation or external R5 GO.
 */
import {constants} from "node:fs";
import {open,lstat} from "node:fs/promises";
import {dirname,isAbsolute,resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {assertR5EvidenceDirectory}
  from "../apps/orchestrator/src/trusted-r5-scripted-completion-evidence.mjs";

const REPO="DarkGh0st03/delegation";
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const JOB="Authenticated OIDC then host-verified signed DAG closure, no models";
const STEPS=Object.freeze([
  "Validate default-branch registration and immutable runner source",
  "Probe pinned private Engineer mTLS before GitHub OIDC",
  "Submit signed OIDC then wait for offline root revocation",
  "Report zero-cost authenticated role only"
]);
const LABELS=Object.freeze(["self-hosted","linux","x64","delegation-private"]);
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LIMIT=65536;
function deny(reason){throw Error("R5 post-run GitHub cross-check NO-GO: "+reason);}
function eqSet(a,b){
  return Array.isArray(a)&&Array.isArray(b)&&a.length>=1&&a.length<=128&&
    a.length===b.length&&a.every(x=>typeof x==="string"&&ID.test(x))&&
    b.every(x=>typeof x==="string"&&ID.test(x))&&
    new Set(a).size===a.length&&new Set(b).size===b.length&&
    a.every(x=>b.includes(x));
}
/** Local owner JSON is a claim, NOT an independently signed receipt. */
export function validateR5OwnerCompletionClaim(evidence,{
  expectedSourceSha,expectedRunId
}={}){
  if(!SHA.test(expectedSourceSha??"")||!RUN.test(expectedRunId??"")||
     !evidence||typeof evidence!=="object"||Array.isArray(evidence)||
     evidence.schema!=="r5-scripted-owner-completion-v1"||
     evidence.status!=="verified_complete_local_owner_observation"||
     evidence.source_sha!==expectedSourceSha||
     evidence.github_run_id!==expectedRunId||
     typeof evidence.session_id!=="string"||!ID.test(evidence.session_id)||
     typeof evidence.authenticated_engineer_did!=="string"||
     !evidence.authenticated_engineer_did.startsWith("did:")||
     !DIGEST.test(evidence.approved_plan_digest??"")||
     !eqSet(evidence.approved_task_ids,evidence.completed_task_ids)||
     evidence.coordinator_terminal_phase!=="closed"||
     evidence.original_runtime_returned_success!==true||
     evidence.independently_attested!==false||
     evidence.external_r5_go!==false)
    deny("local owner claim absent, partial or not pinned to this run");
  return Object.freeze({
    run_id:expectedRunId,source_sha:expectedSourceSha,
    session_id:evidence.session_id,plan_digest:evidence.approved_plan_digest
  });
}
function matchGitHubRun(run,pins){
  return run&&String(run.id)===pins.run_id&&
    run.event==="workflow_dispatch"&&run.run_attempt===1&&
    run.status==="completed"&&run.conclusion==="success"&&
    run.head_sha===pins.source_sha&&
    run.head_branch===BRANCH&&run.path===WORKFLOW&&
    run.head_repository?.full_name===REPO&&
    run.repository?.full_name===REPO;
}
function matchPrivateJob(page,pins){
  if(!page||page.total_count!==1||
     !Array.isArray(page.jobs)||page.jobs.length!==1)return false;
  const j=page.jobs[0];
  if(j.name!==JOB||j.status!=="completed"||
     j.conclusion!=="success"||
     !Number.isSafeInteger(j.runner_id)||j.runner_id<=0||
     typeof j.runner_name!=="string"||!j.runner_name.trim()||
     !Array.isArray(j.labels)||
     !LABELS.every(label=>j.labels.includes(label))||
     !Array.isArray(j.steps))return false;
  // GitHub can add setup/cleanup steps; the reviewed 4 actual run steps
  // must be present in the exact order with successful conclusions.
  let lastIndex=-1;
  for(const name of STEPS){
    const matches=j.steps.map((step,i)=>({step,i}))
      .filter(x=>x.step?.name===name);
    if(matches.length!==1||matches[0].i<=lastIndex||
       matches[0].step.status!=="completed"||
       matches[0].step.conclusion!=="success")return false;
    lastIndex=matches[0].i;
  }
  return true;
}
/** Injectable fetch is for offline tests, NOT trusted network substitution. */
export async function corroborateR5PostRunGithub({
  evidence,expectedSourceSha,expectedRunId,githubToken,fetchFn=fetch
}={}){
  const pins=validateR5OwnerCompletionClaim(evidence,{
    expectedSourceSha,expectedRunId
  });
  if(typeof githubToken!=="string"||githubToken.length<16||
     githubToken.length>512||/\s/u.test(githubToken)||
     typeof fetchFn!=="function")
    deny("independently protected GitHub read token required");
  const base="https://api.github.com/repos/"+REPO+
    "/actions/runs/"+pins.run_id;
  async function read(url){
    let response;
    try{
      response=await fetchFn(url,{
        method:"GET",redirect:"error",
        headers:{
          authorization:"Bearer "+githubToken,
          accept:"application/vnd.github+json",
          "x-github-api-version":"2022-11-28"
        },signal:AbortSignal.timeout(10000)
      });
    }catch{deny("GitHub run or job API unavailable");}
    if(!response?.ok)deny("GitHub run or job API denied");
    try{
      const obj=await response.json();
      if(!obj||typeof obj!=="object"||Array.isArray(obj))
        deny("invalid GitHub JSON");
      return obj;
    }catch{deny("unparseable GitHub JSON");}
  }
  // One fixed run and its complete one-page job list; an unexpected
  // pagination count is terminal, never interpreted as absent work.
  const run=await read(base);
  if(!matchGitHubRun(run,pins))
    deny("GitHub manual run does not match exact reviewed completed source");
  const page=await read(base+"/jobs?per_page=100");
  if(!matchPrivateJob(page,pins))
    deny("GitHub private job, runner labels or four hold steps not corroborated");
  return Object.freeze({
    status:"github_completed_private_job_correlated_owner_claim_only",
    source_sha:pins.source_sha,github_run_id:pins.run_id,
    session_id:pins.session_id,approved_plan_digest:pins.plan_digest,
    observed_github_run_conclusion:"success",
    observed_private_job_steps:STEPS.length,
    owner_receipt_provenance_independently_verified:false,
    physical_runner_identity_independently_verified:false,
    native_rust_evm_revocation_independently_verified:false,
    model_api_calls_independently_verified:false,
    external_r5_go:false
  });
}
async function protectedText(path,maxBytes){
  if(typeof path!=="string"||!isAbsolute(path)||
     resolve(path)!==path)deny("protected file path required");
  try{
    const parent=await lstat(dirname(path));
    if(!parent.isDirectory()||parent.isSymbolicLink()||
       (parent.mode&0o077)!==0||
       (process.getuid?.()!==undefined&&parent.uid!==process.getuid()))
      deny("protected parent directory required");
    const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const m=await fd.stat();
      if(!m.isFile()||(m.mode&0o077)!==0||m.size===0||
         m.size>maxBytes||
         (process.getuid?.()!==undefined&&m.uid!==process.getuid()))
        deny("unprotected owner file");
      return await fd.readFile("utf8");
    }finally{await fd.close();}
  }catch{
    // No private path, owner token or OS-level file details in CLI errors.
    deny("protected owner file unavailable");
  }
}
/** Only owner-controlled CLI calls this with its independent pins. */
export async function corroborateProtectedR5PostRunGithub({
  evidenceDirectory,expectedRunId,expectedSourceSha,operatorTokenFile
}={}){
  if(process.env.GITHUB_ACTIONS==="true"||
     !RUN.test(expectedRunId??"")||!SHA.test(expectedSourceSha??""))
    deny("owner-only pinned post-run audit required");
  await assertR5EvidenceDirectory(evidenceDirectory);
  const evidenceFile=join(evidenceDirectory,
    "r5-scripted-run-"+expectedRunId+".json");
  let evidence;
  try{evidence=JSON.parse(await protectedText(evidenceFile,LIMIT));}
  catch{deny("protected local owner receipt unavailable");}
  const githubToken=(await protectedText(operatorTokenFile,512)).trim();
  return corroborateR5PostRunGithub({
    evidence,expectedRunId,expectedSourceSha,githubToken
  });
}
if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  try{
    const r=await corroborateProtectedR5PostRunGithub({
      evidenceDirectory:process.env.DELEGATION_R5_EVIDENCE_DIRECTORY,
      expectedRunId:process.env.DELEGATION_R5_EXPECTED_RUN_ID,
      expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
      operatorTokenFile:process.env.DELEGATION_R5_OPERATOR_GITHUB_TOKEN_FILE
    });
    process.stdout.write("R5 read-only GitHub/private-job completed cross-check "+
      r.github_run_id+" at "+r.source_sha+
      "; local owner claim only; external R5 GO NOT established\n");
  }catch{
    // Never disclose owner receipt contents or GitHub bearer.
    process.stderr.write("R5 post-run GitHub cross-check NO-GO\n");
    process.exitCode=1;
  }
}
