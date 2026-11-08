/**
 * R384.8: pure original-owner OIDC admission consumption, independent of
 * historical approved-DAG execution. Does NOT construct a model, issue a
 * Rust Root/Child, dispatch A2A or obtain access to provider execution.
 *
 * The HMAC-protected, one-use persistent store remains the authority. Its
 * consume marker cannot be rolled back after downstream denial.
 */
import {TrustedGithubAdmissionReceiptStore}
  from "./trusted-github-admission-store.ts";

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

