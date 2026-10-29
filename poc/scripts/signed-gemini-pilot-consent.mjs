#!/usr/bin/env node
/**
 * Zero-inference, zero-network manual-consent guard shared by the GitHub
 * workflow and the trusted native signed-DAG pilot child.
 *
 * This is NOT a billing cap, a provider usage receipt, real human approval,
 * permission grant, or a successful Gemini generation. Each Task can consume
 * its own bounded turns and the provider still meters INPUT tokens.
 */
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
export const SIGNED_GEMINI_PILOT = Object.freeze({
  model:"gemini-3.8-flash",thinkingLevel:"LOW",
  // R52: increase only Backend response allowance after MAX_TOKENS.
  // R53: bounded full-file outputs; these ceilings do NOT grant permissions
  // or enforce monetary cost controls. Test repair has a larger turn budget.
  maxOutputTokensPerCall:12288,maxModelCallMs:180000,
  maxOutputTokensPerRole:Object.freeze({
    backend:20480,frontend:12288,test:12288
  }),
  maxTurnsPerTask:Object.freeze({
    planner:24,backend:20,frontend:14,test:10
  }),
  maxPlanningMs:600000,maxA2aTaskMs:1800000,
  // Session credentials remain ephemeral, bound and revocable; their
  // lifetime covers bounded task deadlines rather than expiring midway.
  operationalRootValiditySeconds:6300,childCredentialValiditySeconds:2400,
  branch:"refs/heads/refactor/post-prof-plan-contracts-20261021",
  repository:"DarkGh0st03/delegation"
});
const SHA=/^[0-9a-f]{40}$/u;
const ID=/^[1-9][0-9]{0,19}$/u;
const CONSENT="I AUTHORIZE GEMINI API CHARGES";
export const BILLING_ACK=
  "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES";
function deny(){throw Error("Signed Gemini pilot preflight NO-GO");}
export function verifySignedGeminiPilotConsent(env,{requireApiKey=false}={}){
  if(!env||typeof env!=="object"||Array.isArray(env)||
     env.GITHUB_ACTIONS!=="true"||
     env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
     env.GITHUB_RUN_ATTEMPT!=="1"||
     env.GITHUB_REPOSITORY!==SIGNED_GEMINI_PILOT.repository||
     env.GITHUB_REF!==SIGNED_GEMINI_PILOT.branch||
     !SHA.test(env.GITHUB_SHA??"")||
     env.DELEGATION_PINNED_COMMIT_SHA!==env.GITHUB_SHA||
     env.DELEGATION_BILLING_CAP_ACK!==BILLING_ACK||
     !ID.test(env.GITHUB_RUN_ID??"")||
     env.DELEGATION_SIGNED_GEMINI_PILOT!=="1"||
     env.DELEGATION_GEMINI_CHARGE_CONFIRMATION!==CONSENT||
     env.DELEGATION_GEMINI_MODEL!==SIGNED_GEMINI_PILOT.model||
     env.APPROVED_RUNNER_SIGNED_DAG_RECOVERY==="1"||
     env.APPROVED_RUNNER_SIGNED_DAG_MULTI_TEST_TASKS==="1")
    deny();
  // This checks presence only. Never publish, return, hash or print the key.
  if(requireApiKey&&
     (typeof env.GEMINI_API_KEY!=="string"||
      env.GEMINI_API_KEY.trim().length<10))deny();
  return Object.freeze({
    status:"manual_pilot_configuration_verified_no_inference",
    model:SIGNED_GEMINI_PILOT.model,
    pinned_commit_sha:env.GITHUB_SHA,
    billing_cap_configuration:"user_attested_not_programmatically_verified",
    billing_cap_overage_risk_acknowledged:true,
    thinking_level:SIGNED_GEMINI_PILOT.thinkingLevel,
    max_output_tokens_per_call:Math.max(
      SIGNED_GEMINI_PILOT.maxOutputTokensPerCall,
      ...Object.values(SIGNED_GEMINI_PILOT.maxOutputTokensPerRole)),
    planner_max_output_tokens_per_call:SIGNED_GEMINI_PILOT.maxOutputTokensPerCall,
    max_output_tokens_per_role:SIGNED_GEMINI_PILOT.maxOutputTokensPerRole,
    max_model_turns_per_task:SIGNED_GEMINI_PILOT.maxTurnsPerTask,
    max_model_call_ms:SIGNED_GEMINI_PILOT.maxModelCallMs,
    generation_calls:0,
    spending_cap_enforced_by_this_check:false,
    actual_api_access_verified:false,
    engineer_review:"signed_test_fixture_not_human",
    paid_execution_authorized_by_this_receipt:false
  });
}
if(process.argv[1]&&
   import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!["--preflight-no-inference","--require-key-no-inference"]
       .includes(process.argv[2])||process.argv.length!==3)deny();
  const result=verifySignedGeminiPilotConsent(process.env,{
    requireApiKey:process.argv[2]==="--require-key-no-inference"
  });
  process.stdout.write(JSON.stringify(result)+"\n");
}
