/**
 * Legacy deterministic A2A card descriptions for historical fixture tests.
 * Explicit opt-in only. A canonical Engineer-approved Task receives only
 * generic role capabilities in the public Agent Card.
 */
import type {SpecializedAgentRole} from "../contracts.ts";

export const LEGACY_ACCOUNT_SUSPENSION_AGENT_CARD_TAGS:
 readonly string[]=Object.freeze(["thesis","iam","account-suspension"]);

export const LEGACY_ACCOUNT_SUSPENSION_AGENT_CARD_CONTENT:Readonly<
 Record<SpecializedAgentRole,{
  skillId:string;skillName:string;description:string;example:string;
 }>
>=Object.freeze({
 backend:Object.freeze({
  skillId:"backend-account-lifecycle",
  skillName:"Backend Account Lifecycle",
  description:"Deterministic Phase 7 backend agent for the IAM Account Suspension workflow.",
  example:"Implement the backend account suspension lifecycle."
 }),
 frontend:Object.freeze({
  skillId:"frontend-account-lifecycle",
  skillName:"Frontend Account Lifecycle",
  description:"Deterministic Phase 7 frontend agent for the IAM Account Suspension workflow.",
  example:"Implement administrator Suspend/Reactivate controls."
 }),
 test:Object.freeze({
  skillId:"test-account-lifecycle",
  skillName:"Account Suspension Validation",
  description:"Deterministic Phase 7 testing agent for the IAM Account Suspension workflow.",
  example:"Validate the Account Suspension workflow."
 })
});
