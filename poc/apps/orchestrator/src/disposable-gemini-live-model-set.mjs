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
import {createGeminiAdkModel}
 from "../../../packages/agent-runtime/src/gemini-adk-model.ts";
import {loadProtectedDisposableGeminiKeyFile,
 consumeProtectedDisposableGeminiKey}
 from "./disposable-gemini-private-key.mjs";

const SHA=/^[0-9a-f]{40}$/u;
const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const MODEL="gemini-3.8-flash";
const CHARGE_CONSENT="I AUTHORIZE GEMINI API CHARGES";
const CAP_ACK="I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES";
const ROLES=Object.freeze(["backend","frontend","test"]);
// In-process origin check: a plain object cannot impersonate a consented set.
const ISSUED_SETS=new WeakSet();
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
 // Only a key actually loaded by the owner-private filesystem reader is
 // accepted. A raw string or a forged handle is never sufficient.
 // The handle is consumed once BEFORE any SDK object is constructed.
 const privateApiKey=consumeProtectedDisposableGeminiKey(privateKeyHandle);
 const create=()=>{
  const model=createGeminiAdkModel({
   apiKey:privateApiKey,model:MODEL
  });
  if(!(model instanceof Gemini)||model.model!==MODEL)deny();
  return model;
 };
 const planner=Object.freeze({...PLANNING,model:create()});
 const adaptive=Object.freeze({...ADAPTIVE,model:create()});
 const workers=Object.freeze(Object.fromEntries(
  ROLES.map(role=>[role,Object.freeze({...WORKERS[role],model:create()})])
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

/** Strict origin check for owner-only zero-inference canonical binding. */
export function assertIssuedDisposableLiveGeminiModelSet(candidate){
 if(!candidate||typeof candidate!=="object"||!ISSUED_SETS.has(candidate))
  deny();
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
