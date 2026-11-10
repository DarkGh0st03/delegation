/**
 * Experimental Actions-only ORIGINAL Engineer Review Host lifecycle.
 *
 * The production-facing start requires a ONE-USE branded native bootstrap
 * assembled from the independently admitted five Gemini models. The only
 * operational owner remains startTrustedAuthorityOnlyReviewHost, with its
 * original Planning checkpoint, Engineer Ed25519 receipt, Root, Child,
 * signed VP, Gateway, OPA, three specialist A2A workers and Draft PR.
 *
 * This module does NOT sign or simulate an Engineer approval, issue a Root,
 * implement a second host, or create a worker. It has NO CLI/workflow entry.
 * Calling the public start would trigger billable Planning; no existing free
 * workflow invokes it. Operator consent, isolation and spend controls must
 * be independently implemented before any such invocation is permitted.
 *
 * In particular the FREE R385.13 simulated Engineer reviewer MUST NOT be
 * imported into the paid path: its explicit no-billing guard is correct.
 */
import {startTrustedAuthorityOnlyReviewHost}
 from "./trusted-authority-only-review-host.mjs";
import {retireDisposableOriginalHostAfterStartup}
 from "./disposable-gemini-live-original-review-session.mjs";
import {assertDisposableActionsOriginalOwnerContext,
 claimDisposableActionsOriginalOwnerBootstrap}
 from "./disposable-gemini-actions-original-owner-bootstrap.mjs";
import {createDisposableActionsOriginalGithubRunWatch}
 from "./disposable-gemini-actions-original-github-run-watch.mjs";
import {attestDisposableActionsOriginalPlanningCompletion}
 from "./disposable-gemini-actions-original-planning-evidence.mjs";

const CONFIRM="I AUTHORIZE GEMINI API CHARGES";
const CAP="I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES";
const deny=()=>{throw Error("Disposable Actions original reviewed session NO-GO");};

/**
 * TESTABLE lifecycle of exactly ONE supplied original Host. No substitute
 * approval, automatic grant or Root can be manufactured here. The production
 * wrapper below binds this to the real original Host and real GitHub watcher;
 * the isolated offline tests use inert synthetic objects with no SDK calls.
 *
 * Watch must be ACTIVE at every sensitive transition; cancellation during
 * startup closes the eventually resolved original listener, not a second one.
 */
export async function runOneOriginalReviewHostWithWatch({
 watchFactory,startOriginalHost,authority,provision,fenceProviderCalls
}={}){
 if(typeof watchFactory!=="function"||
    typeof startOriginalHost!=="function"||
    !authority||typeof authority!=="object"||
    typeof provision!=="function"||
    (fenceProviderCalls!==undefined&&
     typeof fenceProviderCalls!=="function"))deny();
 let starting,host,handoff,watch;
 const retire=()=>retireDisposableOriginalHostAfterStartup({
  starting,host,handoff
 });
 watch=watchFactory(retire,()=>fenceProviderCalls?.());
 if(!watch||typeof watch!=="object"||
    typeof watch.start!=="function"||
    typeof watch.checkNow!=="function"||
    typeof watch.close!=="function")deny();
 try{
  await watch.start(); // independently corroborated active GitHub job
  await watch.checkNow();
  starting=Promise.resolve().then(()=>{
   if(watch.status!=="active")deny();
   return startOriginalHost(authority);
  });
  host=await starting;
  starting=undefined;
  if(!host||typeof host.close!=="function"||
     typeof host.createReviewedCanonicalHandoff!=="function")deny();
  await watch.checkNow();
  // Use the EXACT same original Host's existing checkpoint and signed
  // Engineer review capability. This function never auto-approves it.
  handoff=host.createReviewedCanonicalHandoff({provision});
  await watch.checkNow();
  let executionAttempted=false;
  return Object.freeze({
   status:"actions_original_planning_awaiting_original_signed_engineer_review",
   get phase(){return host.phase;},
   get githubRunStatus(){return watch.status;},
   get engineerUrl(){return host.engineerUrl;},
   checkGithubRunActive:()=>watch.checkNow(),
   reviewReadiness:async()=>{
    await watch.checkNow();
    const result=await handoff.reviewReadiness();
    await watch.checkNow();
    return result;
   },
   runApprovedCanonical:async()=>{
    if(executionAttempted)deny();
    executionAttempted=true; // a failed/uncertain Root cannot be retried
    try{
     await watch.checkNow();
     const result=await handoff.runApprovedCanonical();
     await watch.checkNow();
     return result;
    }catch(error){
     // A Root could have been issued. Require original Host retirement
     // rather than reporting a failed execution as safe to retry.
     await watch.close();
     throw error;
    }
   },
   close:()=>watch.close()
  });
 }catch(error){
  await watch.close();
  throw error;
 }
}

/** Owner-only, POTENTIALLY BILLABLE if explicitly invoked. Not wired into
 * any current workflow. The prepared native authority is one-use and the
 * checkout/run/consent pins must still match before opening a listener.
 * A genuine independently submitted signed Engineer receipt is required;
 * this function MUST NOT simulate or automatically sign an Engineer decision.
 */
export async function startDisposableActionsOriginalReviewSession({
 prepared,sourceSha,runId,githubApiToken,
 operatorChargeAuthorization,operatorSpendCapAcknowledgement
}={}){
 if(operatorChargeAuthorization!==CONFIRM||
    operatorSpendCapAcknowledgement!==CAP)deny();
 // The CURRENT native local worker helper passes actual Gemini model
 // objects to startSpecializedAgentServer in the owner PID. A real paid
 // startup here would violate the promised owner/worker secret boundary.
 // Do NOT initiate billable Planning, sign Engineer consent or issue Root
 // until a separately audited, process-isolated worker transport exists.
 // The original one-use bootstrap brand is checked separately on claim.
 if(prepared?.worker_process_isolation_verified!==true)deny();
 try{assertDisposableActionsOriginalOwnerContext(process.env,sourceSha);}
 catch{deny();}
 const claimed=claimDisposableActionsOriginalOwnerBootstrap(prepared);
 // Original signed Planning completes within startTrustedAuthorityOnlyReviewHost.
 // The following review MUST be selected from its authentic persisted
 // checkpoint, never from an unsigned model-selected permissions object.
 const session=await runOneOriginalReviewHostWithWatch({
  authority:claimed.authority,provision:claimed.provision,
  fenceProviderCalls:claimed.fenceProviderCalls,
  startOriginalHost:startTrustedAuthorityOnlyReviewHost,
  watchFactory:(onClose,onFence)=>createDisposableActionsOriginalGithubRunWatch({
   runId,sourceSha,githubApiToken,onClose,onFence
  })
 });
 try{
  await session.checkGithubRunActive();
  const authority=claimed.authority;
  // Original Planning must have complete and valid metering before
  // exposing its private review. Never turn a model response into consent.
  const planningEvidence=attestDisposableActionsOriginalPlanningCompletion(
   authority
  );
  await session.checkGithubRunActive();
  // Real Engineer review is mandatory. Holding an Ed25519 key in a CI
  // runner NEVER makes the CI run a human reviewer. The original Host's
  // immutable signed checkpoint and authenticated review flow own this
  // decision; no automatic simulated signature may be minted here.
  return Object.freeze({
   status:"actions_original_planning_awaiting_original_signed_engineer_review",
   original_engineer_decision:"AWAITING_HUMAN_REVIEW",
   original_review_verified:false,
   original_planning_metered_calls:planningEvidence.calls_started,
   original_planning_reported_total_tokens:planningEvidence.reported_total_tokens,
   model_authored_code_proven:false,
   provider_billing_verified:false,
   monetary_cap_enforced:false,
   get phase(){return session.phase;},
   get engineerUrl(){return session.engineerUrl;},
   get githubRunStatus(){return session.githubRunStatus;},
   checkGithubRunActive:()=>session.checkGithubRunActive(),
   reviewReadiness:()=>session.reviewReadiness(),
   runApprovedCanonical:()=>session.runApprovedCanonical(),
   close:()=>session.close()
  });
 }catch(error){
  await session.close();
  throw error;
 }
}
