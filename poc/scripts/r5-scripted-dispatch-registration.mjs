#!/usr/bin/env node
/**
 * R5 non-billable, READ-ONLY pre-deployment gate for the actual private
 * scripted_offline GitHub workflow. A passing registration check is NOT
 * a deployed Engineer Host, a live runner, a signed DAG, or R5 GO.
 *
 * Run on the independently provisioned private runner with
 * DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG set to its protected 0600 config.
 * This command never requests an OIDC token or calls any model.
 */
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const REPO="DarkGh0st03/delegation";
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const REF="refs/heads/"+BRANCH;
const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const API="https://api.github.com/repos/"+REPO;
const SHA=/^[a-f0-9]{40}$/u;

function deny(reason){
  throw Error("R5 scripted registration NO-GO: "+reason);
}
async function readGithub(path,fetchFn){
  let response;
  try{
    response=await fetchFn(API+path,{
      headers:{accept:"application/vnd.github+json",
        "x-github-api-version":"2022-11-28"},
      signal:AbortSignal.timeout(10000)
    });
  }catch{deny("GitHub API unavailable");}
  if(!response?.ok)deny(response?.status===404
    ?"workflow or repository not registered":"GitHub API rejected request");
  let value;
  try{value=await response.json();}
  catch{deny("malformed GitHub response");}
  if(!value||typeof value!=="object"||Array.isArray(value))
    deny("invalid GitHub response");
  return value;
}

/** Advisory source/registration proof only. Does NOT grant any authority. */
export async function verifyR5ScriptedDispatchRegistration({
  pins,fetchFn=fetch
}){
  if(!pins||pins.expectedRepository!==REPO||
     pins.expectedRef!==REF||pins.expectedWorkflowPath!==WORKFLOW||
     !SHA.test(pins.expectedSourceSha??""))
    deny("runner owner pins do not match the reviewed scripted profile");

  const repo=await readGithub("",fetchFn);
  if(repo.full_name!==REPO||repo.default_branch!=="main")
    deny("unexpected repository or default branch");
  const feature=await readGithub(
    "/branches/"+encodeURIComponent(BRANCH),fetchFn);
  if(feature.name!==BRANCH||feature.commit?.sha!==pins.expectedSourceSha)
    deny("installed source SHA is not the current reviewed branch HEAD");

  // GitHub only registers workflow_dispatch from the default branch.
  // The byte-identical workflow must also exist on the pinned branch;
  // identical filenames alone are not sufficient for a trusted dispatch.
  const [registered,pinnedFile]=await Promise.all([
    readGithub("/contents/"+WORKFLOW+"?ref=main",fetchFn),
    readGithub("/contents/"+WORKFLOW+"?ref="+
      encodeURIComponent(BRANCH),fetchFn)
  ]);
  if(registered.type!=="file"||pinnedFile.type!=="file"||
     registered.path!==WORKFLOW||pinnedFile.path!==WORKFLOW||
     !SHA.test(registered.sha??"")||
     registered.sha!==pinnedFile.sha)
    deny("default and pinned workflow contents differ");
  const workflow=await readGithub(
    "/actions/workflows/"+WORKFLOW.split("/").at(-1),fetchFn);
  if(workflow.path!==WORKFLOW||workflow.state!=="active")
    deny("scripted workflow is not enabled on the default branch");
  return Object.freeze({
    status:"registration_verified_only_not_r5_go",
    source_sha:pins.expectedSourceSha,
    workflow_blob_sha:registered.sha
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const {loadProtectedScriptedRunnerOidcConfig}=await import(
      "../apps/orchestrator/src/trusted-private-scripted-runner-oidc.mjs");
    const pins=await loadProtectedScriptedRunnerOidcConfig(
      process.env.DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG);
    // Remote GitHub SHA cannot establish which bytes the runner executes.
    // Verify protected, root-owned local source before any GitHub REST call,
    // OIDC token request or authenticated admission.
    const {verifyProtectedScriptedInstallation}=await import(
      "./r5-scripted-install-integrity.mjs");
    await verifyProtectedScriptedInstallation({
      expectedSourceSha:pins.expectedSourceSha
    });
    const result=await verifyR5ScriptedDispatchRegistration({pins});
    process.stdout.write("R5 scripted workflow registration verified for "+
      result.source_sha+"; deployment and R5 GO NOT established\n");
  }catch{
    // Never log local runner secrets, host URLs, client TLS or OIDC values.
    process.stderr.write("R5 scripted dispatch registration NO-GO\n");
    process.exitCode=1;
  }
}
