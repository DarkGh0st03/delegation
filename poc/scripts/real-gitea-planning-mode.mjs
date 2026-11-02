/** F1: keep a real-Gitea planning-only paid experiment entirely separate
 * from the full D0 pilot, despite sharing the same bounded Planner runtime.
 * This function never constructs a model or reads secrets into its result. */
import {verifySignedGeminiPilotConsent} from "./signed-gemini-pilot-consent.mjs";
export const REAL_GITEA_PLANNER_WORKFLOW=
  "Gemini Real Gitea Planning-only (Manual, Billed)";
const fail=()=>{throw Error("F1 Gitea Planning-only consent NO-GO");};
export function verifyRealGiteaPlanningMode(env,{parent=false}={}){
  if(!env||typeof env!=="object"||Array.isArray(env))fail();
  const active=(parent?
    env.APPROVED_RUNNER_REAL_GITEA_PLANNING_ONLY:
    env.PLANNING_REAL_GITEA_ONLY)==="1";
  const paid=env.DELEGATION_F1_PAID_PLANNING_ONLY==="1";
  if(paid&&!active)fail();
  if(!active)return "other";
  if(env.DELEGATION_SIGNED_GEMINI_REPAIR_D1==="1"||
     env.APPROVED_RUNNER_NATIVE_OWNER_REPAIR_D1==="1")fail();
  if(paid){
    if(env.GITHUB_WORKFLOW!==REAL_GITEA_PLANNER_WORKFLOW||
       env.DELEGATION_SIGNED_GEMINI_PILOT!=="1"||
       env.APPROVED_RUNNER_SCENARIO!=="account-suspension")
      fail();
    verifySignedGeminiPilotConsent(env,{requireApiKey:true});
    return "gemini";
  }
  if(env.DELEGATION_SIGNED_GEMINI_PILOT==="1"||
     Boolean(env.GEMINI_API_KEY))fail();
  return "scripted";
}
