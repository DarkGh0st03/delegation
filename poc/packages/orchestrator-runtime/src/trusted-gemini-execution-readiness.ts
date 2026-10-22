/**
 * Fail-closed authorization PRECHECK before constructing a billable Gemini
 * model for a trusted Planning -> Execution handoff.
 *
 * This is not a payment authorization service and never performs inference.
 * The eventual manual workflow MUST invoke it in the trusted host process,
 * using the authenticated GitHub event/attempt and the actual API secret.
 *
 * Crucially, the paid opt-in never replaces the Engineer's independently
 * verified Ed25519 receipt. Neither a model-generated plan, a digest nor a
 * CI-only signing fixture can impersonate the human approval.
 */
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import {TrustedPlanningReviewGate} from "./trusted-planning-review-gate.ts";

const CONFIRMATION="I AUTHORIZE GEMINI API CHARGES";
const MODEL=/^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const DIGEST=/^[0-9a-f]{64}$/u;

function reject(reason:string):never{
  throw new Error("Trusted paid Gemini readiness: "+reason);
}
export interface ManualGeminiExecutionReadinessInput{
  /** Read only from authenticated GitHub Actions runtime, not model text. */
  githubEventName:string;
  githubRunAttempt:string;
  authorizationInput:string;
  /** Actual secret stays in the trusted host; never returned or logged. */
  geminiApiKey:string|undefined;
  modelName:string;
  maxModelTurns:number;
  maxOutputTokens:number;
  /** Trusted Coordinator, not a model/UI-reported phase. */
  trustedPhase:()=>string;
  /** Only accepts a real Ed25519-verifying trusted receipt store. */
  reviewGate:TrustedPlanningReviewGate;
}
export interface ManualGeminiExecutionReadiness{
  status:"signed_engineer_approved_manual_gemini_ready";
  session_id:string;
  plan_digest:string;
  base_revision:string;
  model_name:string;
  max_model_turns:number;
  max_output_tokens:number;
  approved_permission_ids:readonly string[];
  authenticated_engineer_did:string;
}

/**
 * Verifies, in order: manual first attempt, explicit cost consent, usable
 * bounded model config, active trusted Planning and the EXACT signed Engineer
 * decision already persisted in the trusted store.
 *
 * The returned immutable metadata is NOT a root credential or permission to
 * write; real operational issuance is still delegated to the Coordinator
 * (which reloads the same signed decision) and Gateway + native Rust + OPA.
 */
export async function verifyManualGeminiExecutionReadiness(
  input:ManualGeminiExecutionReadinessInput
):Promise<Readonly<ManualGeminiExecutionReadiness>>{
  if(input.githubEventName!=="workflow_dispatch"||
     input.githubRunAttempt!=="1")
    reject("requires an explicitly dispatched first GitHub Actions attempt");
  if(input.authorizationInput!==CONFIRMATION)
    reject("explicit API-charge authorization is missing");
  if(typeof input.geminiApiKey!=="string"||
     !input.geminiApiKey.trim())
    reject("Gemini API secret is not configured");
  if(typeof input.modelName!=="string"||!MODEL.test(input.modelName)||
     input.modelName.length>80)
    reject("invalid explicitly selected Gemini Developer API model");
  if(!Number.isSafeInteger(input.maxModelTurns)||
     input.maxModelTurns<1||input.maxModelTurns>32)
    reject("model-call budget must be bounded to 1..32 turns per role");
  if(!Number.isSafeInteger(input.maxOutputTokens)||
     input.maxOutputTokens<1||input.maxOutputTokens>32000)
    reject("model output budget must be bounded to 1..32000 tokens");
  if(!(input.reviewGate instanceof TrustedPlanningReviewGate)||
     typeof input.trustedPhase!=="function"||
     input.trustedPhase()!=="planning")
    reject("trusted Planning review and active Coordinator are required");

  const packet=input.reviewGate.reviewPacket();
  if(packet.status!=="awaiting_engineer_signature"||
     !DIGEST.test(packet.plan_digest))
    reject("no immutable staged Planning proposal");
  const receipt=await input.reviewGate.loadAuthenticatedApproval(
    packet.session_id
  );
  if(input.trustedPhase()!=="planning")
    reject("Planning phase changed during approval verification");
  if(planDigest(receipt.plan)!==packet.plan_digest)
    reject("signed plan no longer matches the staged digest");
  const ids=receipt.approval.approved_permission_ids;
  if(!Array.isArray(ids)||ids.length===0)
    reject("Engineer must explicitly approve at least one permission");
  const result:ManualGeminiExecutionReadiness={
    status:"signed_engineer_approved_manual_gemini_ready",
    session_id:packet.session_id,
    plan_digest:packet.plan_digest,
    base_revision:packet.base_revision,
    model_name:input.modelName,
    max_model_turns:input.maxModelTurns,
    max_output_tokens:input.maxOutputTokens,
    approved_permission_ids:Object.freeze([...ids]),
    authenticated_engineer_did:receipt.authenticated_engineer_did
  };
  return Object.freeze(result);
}
