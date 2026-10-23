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
import {createReviewedApprovedDagExecution}
  from "./trusted-reviewed-approved-dag.ts";
import {verifyGithubManualRunViaApi}
  from "./trusted-manual-github-dispatch.ts";

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
      /** Host-owned read token; never runner-controlled. */
      githubApiToken:string|undefined;
      /** Independently pinned first-attempt manual workflow path. */
      expectedWorkflowPath:string;
      /** Offline fixtures ONLY; default is GitHub REST over HTTPS. */
      githubApiFetchFn?:typeof fetch;
    }
){
  if(!(input.coordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     !(input.checkpointStore instanceof SignedPlanningCheckpointFileStore))
    deny("active trusted Coordinator, backend checkpoint and Engineer review required");
  // Enforced before the run's one-use receipt is consumed and BEFORE root
  // issuance. Without a separately enforced Gateway TTL the Engineer
  // process crashing would leave an active long-lived execution session.
  input.coordinator.assertOperationalLeaseConfigured();
  input.coordinator.assertOperationalRecoveryConfigured();
  const root=input.coordinator.trustedPlanningAuthority();
  if(root.session_id!==input.pins?.sessionId)
    deny("independent GitHub admission session differs from active Planning root");
  const admitted=await consumePinnedGithubAdmission(input);
  // TOCTOU guard: a workflow can complete or be canceled AFTER it was
  // admitted. A still-valid 5-minute HMAC receipt does not prove the job
  // remains active. Re-query GitHub just before signed Planning activation.
  // Failed corroboration permanently consumes this run's admission.
  if(typeof input.expectedWorkflowPath!=="string"||
     !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u
       .test(input.expectedWorkflowPath))
    deny("independently pinned GitHub workflow required before activation");
  await verifyGithubManualRunViaApi({
    dispatch:{
      status:"manual_workflow_input_only_not_authorized",
      source_repository:input.pins.repository,
      source_ref:input.pins.ref,
      source_sha:admitted.source_sha,
      run_id:admitted.run_id,
      model_name:admitted.model_name,
      max_model_turns:admitted.max_model_turns,
      max_output_tokens:admitted.max_output_tokens,
      max_model_call_ms:admitted.max_model_call_ms,
      authorization_input:admitted.authorization_input
    },
    pinned:{repository:input.pins.repository,ref:input.pins.ref,
      workflowPath:input.expectedWorkflowPath,
      sourceSha:input.pins.sourceSha},
    githubApiToken:input.githubApiToken,
    fetchFn:input.githubApiFetchFn
  });
  const {admissionStore,pins,geminiApiKey,githubApiToken,
    expectedWorkflowPath,githubApiFetchFn,...trusted}=input;
  const running=await startPersistedReviewedGeminiHandoff({
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
  // Once the operational root exists, recheck the authoritative GitHub run
  // periodically; a canceled/completed/replaced run must never leave Gateway
  // approval and the root valid until an operator notices. The check is
  // non-billable and uses only the host's Actions:read credential.
  type WatchStatus="active"|"closing"|"closed"|"revocation_unconfirmed";
  let status:WatchStatus="active";
  let pending:Promise<void>|undefined;
  let closing:Promise<void>|undefined;
  const stop=()=>{
    if(closing)return closing;
    status="closing";
    clearInterval(timer);
    closing=running.close().then(()=>{
      status="closed";
    },()=>{
      status="revocation_unconfirmed";
      throw Error("GitHub run watch: operational root revocation or server shutdown unconfirmed");
    });
    return closing;
  };
  const checkNow=():Promise<void>=>{
    // A prior host close / canceled job must NEVER count as a fresh
    // authentication proof. In particular, the DAG dispatcher must
    // not enter Execution while a concurrent shutdown is still
    // revoking the delegated root.
    if(status!=="active")
      return Promise.reject(Error(
        "GitHub run watch: run not active; Execution is forbidden"));
    if(pending)return pending.then(()=>{
      if(status!=="active")
        throw Error("GitHub run watch: run closed during status verification");
    });
    const call=(async()=>{
      try{
        await verifyGithubManualRunViaApi({
          dispatch:{
            status:"manual_workflow_input_only_not_authorized",
            source_repository:pins.repository,
            source_ref:pins.ref,
            source_sha:admitted.source_sha,
            run_id:admitted.run_id,
            model_name:admitted.model_name,
            max_model_turns:admitted.max_model_turns,
            max_output_tokens:admitted.max_output_tokens,
            max_model_call_ms:admitted.max_model_call_ms,
            authorization_input:admitted.authorization_input
          },
          pinned:{repository:pins.repository,ref:pins.ref,
            workflowPath:expectedWorkflowPath,sourceSha:pins.sourceSha},
          githubApiToken,fetchFn:githubApiFetchFn
        });
        // An external SIGTERM may have started root revocation WHILE
        // GitHub REST was in flight. Verify the local guard again
        // before and after lease renewal.
        if(status!=="active")
          throw Error("GitHub run watch: shutdown began during verification");
        await input.coordinator.renewExecutionLease();
        if(status!=="active")
          throw Error("GitHub run watch: shutdown began during renewal");
      }catch{
        // Any verification failure, including an unavailable REST endpoint,
        // is fail-closed. Never retry a lost run or issue another root.
        await stop();
        throw Error("GitHub run watch: active run identity lost; operational session closed");
      }
    })();
    pending=call;
    void call.finally(()=>{
      if(pending===call)pending=undefined;
    }).catch(()=>{});
    return call;
  };
  // A successful start alone does not prove the job remained active while
  // A2A listeners were starting. Check immediately, THEN return to caller.
  const timer=setInterval(()=>{
    void checkNow().catch(()=>{
      // Terminal close/revocation is performed by checkNow itself.
      // The trusted host may read githubRunWatch.status for reconciliation.
    });
  },15_000);
  try{
    await checkNow();
  }catch(error){
    // checkNow already closed/revoked; uncertainty must propagate.
    if(status==="revocation_unconfirmed")
      deny("GitHub job lost; operational root revocation unconfirmed");
    throw error;
  }
  // The admitted host now exposes ONE private execution route that binds
  // the reviewed Gemini role servers to the SAME signed-plan dispatcher used
  // by offline E2E. Merely creating this controller performs no inference.
  const approvedDag=createReviewedApprovedDagExecution({
    coordinator:input.coordinator,reviewGate:input.reviewGate,running,
    verifyLiveRun:checkNow,close:stop
  });
  return Object.freeze({
    ...running,
    approvedDag,
    githubRunWatch:Object.freeze({
      checkNow,
      get status():WatchStatus{return status;}
    }),
    close:async()=>{
      // A manual close cannot race an in-flight GitHub status check:
      // await the check, then reuse the same one-time shutdown promise.
      if(pending)await pending.catch(()=>{});
      await stop();
    }
  });
}
