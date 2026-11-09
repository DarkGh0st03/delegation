/**
 * Research-only Gemini provider assembly for the disposable authority-only CI
 * experiment. This is NOT the R5 protected human-approval session.
 *
 * The original trusted Review Host and its Gateway/Rust/OPA/Child/VP/A2A
 * implementation remain authoritative. This module only creates ADK BaseLlm
 * instances and the bounded settings for their existing callers.
 *
 * There is deliberately NO executable/CLI entrypoint and no provider call.
 * The future live workflow must isolate its secrets from the Docker code/test
 * containers, independently verify source/approval and obtain explicit user
 * billing consent. Environment predicates alone do not prove isolation.
 */
import {Gemini} from "@google/adk";
import {DisposablePrivateBudgetedAdkModel,PRIVATE_GEMINI_SESSION_LIMITS}
 from "./disposable-gemini-live-budgeted-model.mjs";
import {execFileSync} from "node:child_process";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {consumePinnedGithubAdmission}
 from "../../../packages/orchestrator-runtime/src/trusted-github-admission-consumer.ts";
import {verifyGithubManualRunViaApi}
 from "../../../packages/orchestrator-runtime/src/trusted-github-run-identity.ts";
import {createGeminiAdkModel}
 from "../../../packages/agent-runtime/src/gemini-adk-model.ts";
import {loadProtectedDisposableGeminiKeyFile,
 consumeProtectedDisposableGeminiKey}
 from "./disposable-gemini-private-key.mjs";

const SHA=/^[0-9a-f]{40}$/u;
const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const MODEL="gemini-3.8-flash";
const CHARGE_CONSENT="I AUTHORIZE GEMINI API CHARGES";
const CAP_ACK="I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES";
const ROLES=Object.freeze(["backend","frontend","test"]);
// In-process origin check: a plain object cannot impersonate a consented set.
const ISSUED_SETS=new WeakSet();
const OFFLINE_SYNTHETIC_KEYS=new Set([
 "synthetic-not-a-real-provider-key",
 "synthetic-no-network-key"
]);
const deny=()=>{throw Error("Disposable live Gemini model admission NO-GO");};

// These are runtime instruction/call limits, NEVER a monetary guarantee.
// Existing Planner and ADK worker code must enforce them at invocation.
const PLANNING=Object.freeze({
 maxModelTurns:20,maxModelCallMs:60000,maxOutputTokens:12000,
 maxPlanningMs:180000,maxProposalRevisions:2,thinkingLevel:"LOW"
});
const ADAPTIVE=Object.freeze({maxSteps:25,maxVerifiedFailures:2});
const WORKERS=Object.freeze({
 backend:Object.freeze({maxModelTurns:12,maxModelCallMs:60000,
  generateContentConfig:Object.freeze({maxOutputTokens:16384})}),
 frontend:Object.freeze({maxModelTurns:12,maxModelCallMs:60000,
  generateContentConfig:Object.freeze({maxOutputTokens:16384})}),
 test:Object.freeze({maxModelTurns:10,maxModelCallMs:60000,
  generateContentConfig:Object.freeze({maxOutputTokens:12288})})
});

/**
 * A future manually dispatched, separately registered LIVE workflow is the
 * sole authorized caller. Compare the selected Git SHA with the independently
 * observed checkout HEAD (the caller cannot take that value from the model).
 *
 * No secret, model or network use occurs during this check. The exact key is
 * deliberately not accepted as a user-provided workflow input.
 */
export function assertDisposableLiveGeminiAdmission(
 env,observedCheckoutSha
){
 if(!env||typeof env!=="object"||Array.isArray(env)||
    env.GITHUB_ACTIONS!=="true"||
    env.GITHUB_REPOSITORY!==REPO||
    env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    env.GITHUB_REF!==REF||
    env.GITHUB_WORKFLOW_REF!==REPO+"/"+WORKFLOW+"@"+REF||
    env.GITHUB_RUN_ATTEMPT!=="1"||
    !/^[1-9]\d{0,19}$/u.test(env.GITHUB_RUN_ID??"")||
    !SHA.test(env.GITHUB_SHA??"")||
    observedCheckoutSha!==env.GITHUB_SHA||
    env.DELEGATION_DISPOSABLE_LIVE_MODE!=="gemini-real"||
    env.DELEGATION_GEMINI_CHARGE_CONFIRMATION!==CHARGE_CONSENT||
    env.DELEGATION_BILLING_CAP_ACK!==CAP_ACK||
    // The live profile must never be selected in the scripted-no-billing job.
    env.DELEGATION_DISPOSABLE_CI_MODE!==undefined||
    env.DELEGATION_SIGNED_GEMINI_PILOT!==undefined||
    env.OPENAI_API_KEY!==undefined||
    // A key in a runner-wide environment would be inherited by child
    // processes and potentially by Docker. It must be loaded separately
    // from a protected owner-only secret file, never by workflow inputs.
    env.GEMINI_API_KEY!==undefined||
    env.GOOGLE_API_KEY!==undefined)
  deny();
 return Object.freeze({
  source_sha:observedCheckoutSha,
  profile:"gemini-real-owner-admission",
  human_review_simulated:true,
  gemini_inference_started:false,
  billing_cap_automatically_enforced:false
 });
}

/**
 * Construct five independent ADK Gemini instances: one original Planner,
 * one original adaptive Orchestrator model and the THREE existing workers.
 *
 * No SDK method that performs inference is called. Models/key must remain in
 * the trusted owner/worker memory, not in GitHub logs, ADK prompts, A2A Task
 * payloads, Gateway responses, Docker build arguments or PR artifacts.
 *
 * The returned set refuses JSON serialization and hides its member references
 * from ordinary object enumeration. This is defense-in-depth, not sandboxing.
 */
export function createDisposableLiveGeminiModelSet({
 env,checkoutSha,privateKeyHandle
}={}){
 assertDisposableLiveGeminiAdmission(env,checkoutSha);
 // CI research construction is PERMANENTLY synthetic-only. Untrusted
 // GitHub workflow inputs cannot use this method with a real provider key.
 return assembleVerifiedModels(privateKeyHandle,{fixtureOnly:true});
}

/**
 * Constructor-only shared implementation; NEVER a public provider gateway.
 * A model set can be issued only by a verified research Actions fixture or
 * by the independently admitted private Engineer-host path below.
 */
function assembleVerifiedModels(privateKeyHandle,{fixtureOnly=false}={}){
 // Only a key actually loaded by the owner-private filesystem reader is
 // accepted. A raw string or a forged handle is never sufficient.
 // The handle is consumed once BEFORE any SDK object is constructed.
 const privateApiKey=consumeProtectedDisposableGeminiKey(privateKeyHandle);
 if(fixtureOnly&&!OFFLINE_SYNTHETIC_KEYS.has(privateApiKey))deny();
 const create=phase=>{
  const model=createGeminiAdkModel({
   apiKey:privateApiKey,model:MODEL
  });
  if(!(model instanceof Gemini)||model.model!==MODEL)deny();
  // Research CI constructors remain inert, with their synthetic-only key.
  // The independently OIDC-admitted PRIVATE host wraps all FIVE models in
  // genuine per-session call/usage ceilings. No wrapper authorizes billing,
  // and constructor-only work never contacts the Gemini provider.
  if(fixtureOnly)return model;
  return new DisposablePrivateBudgetedAdkModel({
   delegate:model,phase,...PRIVATE_GEMINI_SESSION_LIMITS[phase]
  });
 };
 const planner=Object.freeze({...PLANNING,model:create("planning")});
 const adaptive=Object.freeze({...ADAPTIVE,model:create("adaptive-execution")});
 const workers=Object.freeze(Object.fromEntries(
  ROLES.map(role=>[role,Object.freeze({...WORKERS[role],model:create(role)})])
 ));
 const set=Object.create(null);
 for(const [key,value] of [
  ["planner",planner],["adaptive",adaptive],["workers",workers]
 ])Object.defineProperty(set,key,{
  value,enumerable:false,writable:false,configurable:false
 });
 Object.defineProperty(set,"toJSON",{enumerable:false,
  value:()=>{throw Error("Private Gemini model set must not be serialized");}
 });
 const issued=Object.freeze(set);
 ISSUED_SETS.add(issued);
 return issued;
}

/**
 * Verify consent/source BEFORE opening the protected key file. The file
 * reader checks ownership/mode/symlink boundaries; this still DOES NOT
 * prove separate process isolation or an enforced provider spend cap.
 * No inference occurs here.
 */
export async function createDisposableLiveGeminiModelSetFromPrivateFile({
 env,checkoutSha,keyFile
}={}){
 assertDisposableLiveGeminiAdmission(env,checkoutSha);
 const privateKeyHandle=await loadProtectedDisposableGeminiKeyFile(keyFile);
 return createDisposableLiveGeminiModelSet({
  env,checkoutSha,privateKeyHandle
 });
}

/**
 * Private-host half of the disposable pilot. Unlike the runner-side
 * assertDisposableLiveGeminiAdmission(), this is executed OUTSIDE Actions.
 *
 * The original OIDC intake must already have verified signed GitHub
 * identity, the run and a one-use replay before recording the owner-only
 * HMAC receipt. This function consumes that SAME receipt once, independently
 * checks GitHub's current active run, and THEN opens the protected key file.
 *
 * This is not Engineer approval, grant selection, Root issuance, execution
 * isolation, paid consent from a ChatGPT reply, or permission to bill.
 * The referenced live workflow is not yet registered: the path remains
 * operationally NO-GO until deployed with real native owner controls.
 */
export async function createDisposableLiveGeminiModelSetFromPrivateHostAdmission({
 admissionStore,pins,checkoutSha,keyFile,githubApiToken
}={}){
 if(process.env.GITHUB_ACTIONS==="true"||
    process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    process.env.ENGINEER_CORE_NATIVE_MODE!=="1"||
    process.env.GEMINI_API_KEY!==undefined||
    process.env.GOOGLE_API_KEY!==undefined||
    process.env.OPENAI_API_KEY!==undefined||
    !pins||typeof pins!=="object"||
    Object.keys(pins).sort().join(",")!==
      "ref,repository,runId,sessionId,sourceSha"||
    pins.repository!==REPO||pins.ref!==REF||
    !SHA.test(checkoutSha??"")||
    pins.sourceSha!==checkoutSha||
    typeof githubApiToken!=="string"||githubApiToken.length<16)
   deny();
 // Prevent presenting an attacker-controlled expected SHA as verification.
 // No dirty source checkout or foreign branch may construct a paid client.
 try{
  const current=execFileSync("git",["rev-parse","--verify","HEAD"],{
   cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
  const dirty=execFileSync("git",["status","--porcelain",
    "--untracked-files=all"],{
   cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
  if(current!==checkoutSha||dirty)deny();
 }catch{deny();}
 // The store's HMAC, session/source pins and durable single-use marker
 // are independently enforced. Even a failure below burns this admission.
 const admitted=await consumePinnedGithubAdmission({admissionStore,pins});
 if(admitted.model_name!==MODEL||
    admitted.max_model_turns!==PLANNING.maxModelTurns||
    admitted.max_output_tokens!==PLANNING.maxOutputTokens||
    admitted.max_model_call_ms!==PLANNING.maxModelCallMs||
    admitted.authorization_input!==CHARGE_CONSENT)deny();
 // A valid but canceled/expired job must not reach secret loading.
 await verifyGithubManualRunViaApi({
  dispatch:{run_id:admitted.run_id,source_sha:admitted.source_sha},
  pinned:{repository:REPO,ref:REF,workflowPath:WORKFLOW,
   sourceSha:checkoutSha},
  githubApiToken
 });
 const privateKeyHandle=await loadProtectedDisposableGeminiKeyFile(keyFile);
 return assembleVerifiedModels(privateKeyHandle);
}

/** Strict origin check for owner-only zero-inference canonical binding. */
export function assertIssuedDisposableLiveGeminiModelSet(candidate){
 if(!candidate||typeof candidate!=="object"||!ISSUED_SETS.has(candidate))
  deny();
 return candidate;
}

/**
 * In-process, one-shot claim for the original trusted Review Host.
 * The OIDC receipt has already been consumed, but a retained model-set
 * object must NOT bind another original owner session in this process.
 * This is a defense-in-depth lifecycle fence, not process isolation.
 */
export function claimIssuedDisposableLiveGeminiModelSet(candidate){
 assertIssuedDisposableLiveGeminiModelSet(candidate);
 if(!ISSUED_SETS.delete(candidate))deny();
 return candidate;
}

/** Safe summary for CI prior to any actual provider call. */
export function describeDisposableLiveGeminiContract(){
 return Object.freeze({
  profile:"unexecuted-live-model-assembly",
  model:MODEL,
  specialist_roles:[...ROLES],
  orchestrator_models:["planning","adaptive-execution"],
  requires_simulated_engineer_review:true,
  requires_real_rust_authority:true,
  requires_disposable_gitea_docker:true,
  requires_isolated_api_secret:true,
  requires_explicit_manual_billing_consent:true,
  provider_calls:0,
  model_generated_code_proven:false,
  spend_cap_proven:false
 });
}
