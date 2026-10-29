#!/usr/bin/env node
/**
 * Manual paid pilot gate: refuse to invoke ANY model unless all independent
 * offline CI workflows SUCCEEDED on the EXACT checked-out commit SHA.
 * GitHub API calls only; does not import or contact a Gemini SDK/provider.
 */
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {verifySignedGeminiPilotConsent} from "./signed-gemini-pilot-consent.mjs";
const REQUIRED=Object.freeze([
  ".github/workflows/functional-signed-dag-e2e.yml",
  ".github/workflows/shared-mcp-real-positive-e2e.yml",
  ".github/workflows/cumulative-refactoring-offline.yml"
]);
const REPO="DarkGh0st03/delegation";
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const SHA=/^[a-f0-9]{40}$/u;
const deny=()=>{throw Error("Signed Gemini exact-SHA CI gate NO-GO");};
export function verifyExactShaOfflineCiRuns(runs,sha){
  if(!Array.isArray(runs)||runs.length>100||
     typeof sha!=="string"||!SHA.test(sha))deny();
  const names=[];
  for(const path of REQUIRED){
    const accepted=runs.some(run=>run&&typeof run==="object"&&
      run.path===path&&run.head_sha===sha&&
      run.head_branch===BRANCH&&
      run.status==="completed"&&run.conclusion==="success"&&
      ["push","workflow_dispatch"].includes(run.event)&&
      run.repository?.full_name===REPO);
    if(!accepted)deny();
    names.push(path);
  }
  return Object.freeze({
    status:"independent_offline_ci_verified_exact_sha_no_inference",
    validated_commit_sha:sha,
    validated_offline_workflow_paths:Object.freeze(names),
    independent_workflows_verified:names.length,
    gemini_generation_calls:0,
    monetary_billing_cap_enforced:false
  });
}
export async function checkSignedGeminiCiGate(env,{request=fetch}={}){
  verifySignedGeminiPilotConsent(env,{requireApiKey:false});
  const token=env.GITHUB_TOKEN;
  if(typeof token!=="string"||token.length<10)deny();
  const url=new URL("https://api.github.com/repos/"+REPO+"/actions/runs");
  url.searchParams.set("branch",BRANCH);
  // GitHub Actions runs are numerous on this development branch. Query
  // the pinned SHA at the API, rather than losing an old-but-valid green
  // checkpoint when newer pushes fill the first page (100 runs).
  // verifyExactShaOfflineCiRuns independently enforces all identities.
  url.searchParams.set("head_sha",env.GITHUB_SHA);
  url.searchParams.set("per_page","100");
  let response;
  try{
    response=await request(url.href,{
      method:"GET",redirect:"error",signal:AbortSignal.timeout(20000),
      headers:{
        authorization:"Bearer "+token,
        accept:"application/vnd.github+json",
        "x-github-api-version":"2022-11-28"
      }
    });
  }catch{deny();}
  if(response?.status!==200)deny();
  let payload;
  try{
    const raw=await response.text();
    if(raw.length>10_000_000)deny();
    payload=JSON.parse(raw);
  }catch{deny();}
  return verifyExactShaOfflineCiRuns(payload?.workflow_runs,env.GITHUB_SHA);
}
if(process.argv[1]&&
   import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==3||process.argv[2]!=="--check-ci-no-inference")
    deny();
  const report=await checkSignedGeminiCiGate(process.env);
  process.stdout.write(JSON.stringify(report)+"\n");
}
