/** Trusted experiment profiles. No consent, model construction or authority. */
import {SIGNED_GEMINI_PILOT} from './signed-gemini-pilot-consent.mjs';
export const ACCOUNT_SUSPENSION_PLANNER_MAX_TURNS=20;
export function accountSuspensionPlanningConfig(mode){
  if(mode==='fixture')return Object.freeze({
    maxModelTurns:ACCOUNT_SUSPENSION_PLANNER_MAX_TURNS,
    maxProposalRevisions:2,maxModelCallMs:120000,maxPlanningMs:180000,
    maxOutputTokens:12000,thinkingLevel:'LOW'
  });
  if(mode==='pilot'||mode==='real-planning-only')return Object.freeze({
    maxModelTurns:SIGNED_GEMINI_PILOT.maxTurnsPerTask.planner,
    maxProposalRevisions:2,maxModelCallMs:SIGNED_GEMINI_PILOT.maxModelCallMs,
    maxPlanningMs:SIGNED_GEMINI_PILOT.maxPlanningMs,
    maxOutputTokens:SIGNED_GEMINI_PILOT.maxOutputTokensPerCall,
    thinkingLevel:SIGNED_GEMINI_PILOT.thinkingLevel
  });
  throw Error('Unknown trusted planning experiment profile');
}
