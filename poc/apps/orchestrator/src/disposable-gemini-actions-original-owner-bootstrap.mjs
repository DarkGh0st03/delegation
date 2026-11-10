/**
 * Zero-inference Actions-only composition into the ORIGINAL Engineer Review
 * Host. This is NOT a workflow entrypoint and never launches a model/host,
 * approves any plan, reserves a Root, starts A2A/Docker or creates a signer.
 *
 * The five-model set must have been issued ONLY by the independently checked
 * GitHub workflow_dispatch/REST/one-use-admission path. The original native
 * checkpoint store must already be constructed by trusted owner code; never
 * accept a JSON workflow input, model output or A2A payload as authority.
 *
 * The backend signer is loaded from a distinct protected private file and
 * verified by BOTH an Ed25519 public pin and the original typed checkpoint
 * store. The original protected R5 manifest remains forbidden in Actions.
 *
 * A pre-Root provision is one-shot and is ONLY consumed by the original
 * reviewed handoff after a separately signed Engineer decision. This module
 * does not establish process isolation or a project monetary cap.
 */
import {execFileSync} from "node:child_process";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {AuthorityPlanningCheckpointStore}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts";
import {assertIssuedDisposableActionsOwnerGeminiModelSet}
 from "./disposable-gemini-live-model-set.mjs";
import {bindDisposableLiveGeminiCanonicalInputs}
 from "./disposable-gemini-live-canonical-binding.mjs";
import {bindOriginalBackendCheckpointSigner}
 from "./disposable-gemini-original-checkpoint-signer.mjs";
import {prepareDisposableOriginalGeminiNativeProvision}
 from "./disposable-gemini-original-native-provision.mjs";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/experiment/disposable-gemini-live-20261109";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const CONFIRM="I AUTHORIZE GEMINI API CHARGES";
const CAP="I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES";
const SHA=/^[0-9a-f]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
const deny=()=>{throw Error("Disposable Actions original owner bootstrap NO-GO");};
// A verified admission, model binding and native provision may enter exactly
// ONE original Review Host. Free tests cannot forge this in-memory capability.
const PREPARED_ORIGINAL_HOSTS=new WeakSet();

/** Defense-in-depth runtime gate. The model-set constructor independently
 * validates live GitHub REST run identity and the clean checkout before
 * issuing the unforgeable in-process Actions provenance brand. */
export function assertDisposableActionsOriginalOwnerContext(env,observedSha){
 if(!env||typeof env!=="object"||Array.isArray(env)||
    env.GITHUB_ACTIONS!=="true"||
    env.GITHUB_REPOSITORY!==REPO||
    env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    env.GITHUB_REF!==REF||
    env.GITHUB_WORKFLOW_REF!==REPO+"/"+WORKFLOW+"@"+REF||
    env.GITHUB_RUN_ATTEMPT!=="1"||
    !RUN.test(env.GITHUB_RUN_ID??"")||
    !SHA.test(env.GITHUB_SHA??"")||
    !SHA.test(observedSha??"")||
    env.GITHUB_SHA!==observedSha||
    env.DELEGATION_DISPOSABLE_LIVE_MODE!=="gemini-real"||
    env.DELEGATION_GEMINI_CHARGE_CONFIRMATION!==CONFIRM||
    env.DELEGATION_BILLING_CAP_ACK!==CAP||
    env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    env.ENGINEER_CORE_NATIVE_MODE!=="1"||
    env.DELEGATION_LIVE_CI_PREFLIGHT_MODE!==undefined||
    env.DELEGATION_DISPOSABLE_CI_MODE!==undefined||
    env.DELEGATION_SIGNED_GEMINI_PILOT!==undefined||
    env.GEMINI_API_KEY!==undefined||
    env.GOOGLE_API_KEY!==undefined||
    env.OPENAI_API_KEY!==undefined||
    env.GH_TOKEN!==undefined||
    env.GITHUB_TOKEN!==undefined)
   deny();
 return Object.freeze({
  profile:"disposable_actions_original_owner_context_only",
  source_sha:observedSha,
  real_gemini_calls_started_here:0,
  approval_signed_here:false,
  rust_root_issued_here:false,
  provider_spend_cap_verified_here:false
 });
}
function observedCleanSourceSha(){
 try{
  const sha=execFileSync("git",["rev-parse","--verify","HEAD"],{
   cwd:ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
  const dirty=execFileSync("git",["status","--porcelain",
   "--untracked-files=all"],{
   cwd:ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
  if(!SHA.test(sha)||dirty)deny();
  return sha;
 }catch{deny();}
}

/** Prepare ONLY original host options and one original native provision.
 * The caller is an isolated, separately trusted owner; it must not forward
 * these opaque objects to workflow JSON, Agent Cards, A2A, Gateway or Docker.
 * The paid host must not start without independent operator authorization. */
export async function prepareDisposableActionsOriginalOwnerBootstrap({
 models,authority,operational,backendPrivateKeyFile,
 backendPublicKeyPem,geminiKeyFile
}={}){
 assertDisposableActionsOriginalOwnerContext(
  process.env,observedCleanSourceSha());
 assertIssuedDisposableActionsOwnerGeminiModelSet(models);
 if(!(authority?.checkpoint?.store instanceof
      AuthorityPlanningCheckpointStore)||
    typeof backendPrivateKeyFile!=="string"||
    typeof backendPublicKeyPem!=="string"||
    !backendPublicKeyPem.trim()||
    typeof geminiKeyFile!=="string"||
    backendPrivateKeyFile===geminiKeyFile||
    backendPrivateKeyFile===process.env.ADAPTER_ENGINEER_NATIVE_SOCKET)
   deny();

 // No alternative Planner, worker, adaptive engine, grant or effect handler.
 const bound=bindDisposableLiveGeminiCanonicalInputs({
  models,authority,operational
 });
 const signedAuthority=await bindOriginalBackendCheckpointSigner({
  authority:bound.authority,loaded:{backendPublicKeyPem},
  backendPrivateKeyFile,forbiddenFiles:[geminiKeyFile]
 });
 // The original native installer and one-shot source reconciliation gate
 // are shared with the private R5-compatible Review Host wrapper.
 const {provision}=await prepareDisposableOriginalGeminiNativeProvision({
  bound,signedAuthority
 });
 const prepared=Object.freeze({
  status:"actions_original_host_inputs_prepared_no_inference",
  authority:signedAuthority,provision
 });
 PREPARED_ORIGINAL_HOSTS.add(prepared);
 return prepared;
}

/** Consume once before starting the ORIGINAL Review Host. An attempt that
 * fails after this call can never reuse the same Actions admission. */
export function claimDisposableActionsOriginalOwnerBootstrap(prepared){
 if(!prepared||typeof prepared!=="object"||
    !PREPARED_ORIGINAL_HOSTS.delete(prepared)||
    prepared.status!=="actions_original_host_inputs_prepared_no_inference"||
    typeof prepared.provision!=="function"||
    !prepared.authority||typeof prepared.authority!=="object")
  deny();
 return prepared;
}
