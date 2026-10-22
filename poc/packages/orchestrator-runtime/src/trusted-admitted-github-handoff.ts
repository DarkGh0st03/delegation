/**
 * Trusted Engineer-host continuation of an independently admitted GitHub job.
 *
 * GitHub OIDC + Actions REST + one-use replay were already checked by the
 * loopback intake. This module accepts ONLY a session-bound, HMAC-verified,
 * one-use admission from the owner's persistent store. It NEVER accepts
 * caller-supplied GitHub event/runner claims in place of that admission.
 *
 * Admission is NOT Engineer approval. Operational authority still requires
 * the live Planning Coordinator, signed backend checkpoint, independent
 * Ed25519 Engineer review, Rust root revocation/issuance and Gateway policy.
 */
import {TrustedGithubAdmissionReceiptStore}
  from "./trusted-github-admission-store.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import {SignedPlanningCheckpointFileStore}
  from "./trusted-planning-checkpoint-store.ts";
import {startPersistedReviewedGeminiHandoff}
  from "./trusted-manual-gemini-handoff.ts";

const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const REF=/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9]\d{0,19}$/u;
const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function deny(reason:string):never{
  throw Error("Trusted Github admitted handoff: "+reason);
}

/** All fields must come from the trusted Engineer host, NOT workflow JSON. */
export interface PinnedGithubAdmissionForSession{
  readonly sessionId:string;
  readonly runId:string;
  readonly sourceSha:string;
  readonly repository:string;
  readonly ref:string;
}

export interface PinnedGithubAdmittedManual{
  readonly status:"github_oidc_admitted_only_not_engineer_approved";
  readonly session_id:string;
  readonly run_id:string;
  readonly source_sha:string;
  readonly model_name:string;
  readonly max_model_turns:number;
  readonly max_output_tokens:number;
  readonly max_model_call_ms:number;
  readonly authorization_input:"I AUTHORIZE GEMINI API CHARGES";
}

/**
 * Verify the host's independent pins, then atomically CONSUME the HMAC
 * admission. Return bounded inputs only; no operational DC, Engineer
 * approval, API key, signed JWT or Gemini client can be returned here.
 *
 * Any failure after consumption is terminal for this GitHub run. The
 * Engineer must approve a fresh run rather than recycling a receipt.
 */
export async function consumePinnedGithubAdmission(input:{
  admissionStore:TrustedGithubAdmissionReceiptStore;
  pins:PinnedGithubAdmissionForSession;
}):Promise<Readonly<PinnedGithubAdmittedManual>>{
  const {pins}=input;
  if(!(input.admissionStore instanceof TrustedGithubAdmissionReceiptStore)||
     !SESSION.test(pins?.sessionId??"")||
     !RUN.test(pins?.runId??"")||
     !SHA.test(pins?.sourceSha??"")||
     !REPO.test(pins?.repository??"")||
     !REF.test(pins?.ref??""))
    deny("persistent admission store and independent session/run/source pins required");
  const admitted=await input.admissionStore.consume({
    expectedRunId:pins.runId,
    expectedSourceSha:pins.sourceSha,
    expectedSessionId:pins.sessionId
  });
  // The store already checked the HMAC, freshness and one-use marker.
  // Repository and ref are additionally pinned here by the trusted host.
  if(admitted.source_repository!==pins.repository||
     admitted.source_ref!==pins.ref)
    deny("authenticated run differs from independently pinned repository/ref");
  return Object.freeze({
    status:"github_oidc_admitted_only_not_engineer_approved",
    session_id:admitted.session_id,
    run_id:admitted.run_id,
    source_sha:admitted.source_sha,
    model_name:admitted.model_name,
    max_model_turns:admitted.max_model_turns,
    max_output_tokens:admitted.max_output_tokens,
    max_model_call_ms:admitted.max_model_call_ms,
    authorization_input:admitted.authorization_input
  });
}

/**
 * A future persistent Engineer process may call this IN PROCESS after the
 * private OIDC intake. There is no exposed endpoint or remote activation.
 * Starting this handoff constructs role models only after separate signed
 * Engineer verification; it does NOT invoke Gemini inference.
 *
 * No unsigned event data or caller-defined Gemini limits are accepted:
 * every paid-model parameter except the host-owned secret is sourced from
 * the consumed authenticated admission.
 */
export async function startAdmittedGithubReviewedGeminiHandoff(
  input:Omit<Parameters<typeof startPersistedReviewedGeminiHandoff>[0],
    "manual"|"maxModelCallMs">&{
      admissionStore:TrustedGithubAdmissionReceiptStore;
      pins:PinnedGithubAdmissionForSession;
      geminiApiKey:string|undefined;
    }
){
  if(!(input.coordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     !(input.checkpointStore instanceof SignedPlanningCheckpointFileStore))
    deny("active trusted Coordinator, backend checkpoint and Engineer review required");
  const root=input.coordinator.trustedPlanningAuthority();
  if(root.session_id!==input.pins?.sessionId)
    deny("independent GitHub admission session differs from active Planning root");
  const admitted=await consumePinnedGithubAdmission(input);
  const {admissionStore,pins,geminiApiKey,...trusted}=input;
  return startPersistedReviewedGeminiHandoff({
    ...trusted,
    maxModelCallMs:admitted.max_model_call_ms,
    manual:{
      githubEventName:"workflow_dispatch",
      githubRunAttempt:"1",
      authorizationInput:admitted.authorization_input,
      geminiApiKey,
      modelName:admitted.model_name,
      maxModelTurns:admitted.max_model_turns,
      maxOutputTokens:admitted.max_output_tokens
    }
  });
}
