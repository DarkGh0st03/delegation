#!/usr/bin/env node
/**
 * Disposable GitHub Actions LIVE pilot: ZERO-INFERENCE preflight only.
 *
 * This is NOT a live-Gemini launcher. In particular it never imports ADK,
 * opens a provider key, creates model objects, issues an Engineer receipt,
 * grants authority or runs a container. It exists to prepare a *separately*
 * reviewed manual workflow before any billed model calls can be wired in.
 *
 * The experimental branch is not the default registered GitHub Actions
 * workflow branch. Registration and a future real owner entrypoint are
 * separate, explicit operations; neither is authorized by this script.
 */
import {execFileSync} from "node:child_process";
import {dirname,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/experiment/disposable-gemini-live-20261109";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const deny=()=>{throw Error("Disposable Gemini CI preflight NO-GO");};

/**
 * An honest NO-BILLING admission, not a paid consent check.
 * Inject the independently observed git HEAD for offline tests only;
 * the CLI always reads HEAD from the checkout itself.
 */
export function assertDisposableGeminiCiPreflight(env,checkoutSha){
 if(!env||typeof env!=="object"||Array.isArray(env)||
    env.GITHUB_ACTIONS!=="true"||
    env.GITHUB_REPOSITORY!==REPO||
    env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    env.GITHUB_REF!==REF||
    env.GITHUB_WORKFLOW_REF!==REPO+"/"+WORKFLOW+"@"+REF||
    env.GITHUB_RUN_ATTEMPT!=="1"||
    !RUN.test(env.GITHUB_RUN_ID??"")||
    !SHA.test(env.GITHUB_SHA??"")||
    checkoutSha!==env.GITHUB_SHA||
    env.DELEGATION_LIVE_CI_PREFLIGHT_MODE!=="preflight-only"||
    // A consent string must NEVER be inherited from a scripted job; a
    // paid workflow needs its own explicitly reviewed admission pathway.
    env.DELEGATION_GEMINI_CHARGE_CONFIRMATION!==undefined||
    env.DELEGATION_BILLING_CAP_ACK!==undefined||
    env.DELEGATION_DISPOSABLE_LIVE_MODE!==undefined||
    env.DELEGATION_SIGNED_GEMINI_PILOT!==undefined||
    env.GEMINI_API_KEY!==undefined||
    env.GOOGLE_API_KEY!==undefined||
    env.OPENAI_API_KEY!==undefined)
   deny();
 return Object.freeze({
  status:"disposable_manual_ci_preflight_only",
  source_sha:checkoutSha,
  workflow_path:WORKFLOW,
  signed_engineer_approval_created:false,
  native_root_created:false,
  gemini_provider_imported:false,
  gemini_api_calls:0,
  model_generated_code_proven:false,
  billed_execution_authorized:false,
  isolated_owner_execution_proven:false,
  monetary_cap_enforced:false
 });
}

export function runDisposableGeminiCiPreflight(env=process.env){
 let observed,dirty;
 try{
  observed=execFileSync("git",["rev-parse","--verify","HEAD"],{
   cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
  dirty=execFileSync("git",["status","--porcelain",
   "--untracked-files=all"],{
   cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
 }catch{deny();}
 if(dirty)deny();
 return assertDisposableGeminiCiPreflight(env,observed);
}

if(process.argv[1]&&
   import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.length!==2)deny();
  process.stdout.write(JSON.stringify(runDisposableGeminiCiPreflight())+"\\n");
 }catch{
  process.stderr.write("Disposable Gemini CI preflight NO-GO\\n");
  process.exitCode=1;
 }
}
