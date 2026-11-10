/**
 * Read-only reconciliation, run ONLY inside the original trusted owner,
 * between one fully metered model FunctionTool proposal and the real
 * original Gateway MAC-signed + independently reread Gitea UPDATE receipt.
 *
 * This does not issue a Root, approve any write or claim Gemini authorship.
 * The model delegate could be an offline fixture; a provider origin must
 * be separately established before a user-facing generativity claim.
 */
import {DisposablePrivateBudgetedAdkModel}
 from "./disposable-gemini-live-budgeted-model.mjs";
import {AuthenticatedGiteaMutationCompletionObserver}
 from "../../gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {AuthenticatedGiteaCreateCompletionObserver}
 from "../../gateway/src/trusted-authority-only-gitea-create-evidence.ts";
import {DisposableOriginalA2AModelCallWindowStore,
 isIssuedOriginalA2ACallWindow,claimIssuedOriginalA2ACallWindow}
 from "./disposable-gemini-original-task-call-window.mjs";

const deny=()=>{throw Error("Disposable original model/Gitea digest reconciliation NO-GO");};
const roles=new Set(["backend","frontend","test"]);

/**
 * The registeredAgentDid and ownerObservedTaskCallWindow must come from
 * the original native owner's signed Task lifecycle, NEVER from LLM/A2A
 * payloads, workflow inputs or a model-declared call index. The window
 * is minted by the owner-memory signed A2A handler, but is not an
 * independent cryptographic signature or provider-authorship proof.
 * A digest match is evidence of byte identity, not its causal origin.
 */
export async function reconcileOriginalModelWriteWithVerifiedGitea({
 model,mutationObserver,completionExpectation,role,registeredAgentDid,
 ownerObservedTaskCallWindow
}={}){
 if(!(model instanceof DisposablePrivateBudgetedAdkModel)||
    !(mutationObserver instanceof AuthenticatedGiteaMutationCompletionObserver)||
    !roles.has(role)||model.phase!==role||
    typeof registeredAgentDid!=="string"||
    !registeredAgentDid.startsWith("did:")||
    !completionExpectation||typeof completionExpectation!=="object"||
    completionExpectation.agent_did!==registeredAgentDid||
    // Task identity + model-call window MUST come from the original
    // owner's independently authenticated signed A2A Task lifecycle.
    // This method never derives it from the model's prompt or tool args.
    !isIssuedOriginalA2ACallWindow(model,ownerObservedTaskCallWindow)||
    !ownerObservedTaskCallWindow||
    typeof ownerObservedTaskCallWindow!=="object"||
    Array.isArray(ownerObservedTaskCallWindow)||
    Object.keys(ownerObservedTaskCallWindow).sort().join(",")!==
     "call_index_after,call_index_before,credential_id,role,runtime_task_id,task_id"||
    ownerObservedTaskCallWindow.task_id!==completionExpectation.task_id||
    ownerObservedTaskCallWindow.credential_id!==completionExpectation.credential_id||
    ownerObservedTaskCallWindow.runtime_task_id!==
     completionExpectation.runtime_task_id||
    ownerObservedTaskCallWindow.role!==role||
    !Number.isSafeInteger(ownerObservedTaskCallWindow.call_index_before)||
    !Number.isSafeInteger(ownerObservedTaskCallWindow.call_index_after)||
    ownerObservedTaskCallWindow.call_index_before<0||
    ownerObservedTaskCallWindow.call_index_after<=
     ownerObservedTaskCallWindow.call_index_before||
    ownerObservedTaskCallWindow.call_index_after>
     model.publicSummary().calls_started)
   deny();
 // This method verifies the ORIGINAL MAC and original Task binding and
 // independently checks the actual Gitea content, CAS parent and current HEAD.
 const mutation=await mutationObserver.observeAuthenticatedSourceDigest(
  completionExpectation);
 const matching=model.proposedSourceWriteFingerprints().filter(row=>
  row.role===role&&row.operation==="update_file"&&
  row.call_index>ownerObservedTaskCallWindow.call_index_before&&
  row.call_index<=ownerObservedTaskCallWindow.call_index_after&&
  row.branch===mutation.branch&&row.path===mutation.path&&
  row.source_sha256===mutation.source_sha256&&
  row.source_bytes===mutation.source_bytes
 );
 if(matching.length!==1)deny();
 // The receipt's signed Task context and independent Gitea re-read were
 // verified above; the same model output or receipt cannot be matched twice.
 try{
  claimIssuedOriginalA2ACallWindow(model,ownerObservedTaskCallWindow);
  model.claimOriginalGatewayMatchedWrite(matching[0],mutation.evidence_sha256);
 }catch{
  // The original owner must see one fail-closed classification for both a
  // replayed Gateway receipt and a previously consumed model proposal.
  // Never expose budget internals or silently grant another match.
  deny();
 }
 return Object.freeze({
  status:"signed_gateway_gitea_cas_matches_model_proposed_bytes_only",
  task_id:mutation.task_id,
  branch:mutation.branch,path:mutation.path,
  commit_sha:mutation.commit_sha,
  source_sha256:mutation.source_sha256,
  source_bytes:mutation.source_bytes,
  gateway_evidence_sha256:mutation.evidence_sha256,
  matched_model_call_index:matching[0].call_index,
  owner_asserted_task_call_window_checked:true,
  model_write_and_gateway_receipt_replay_fenced:true,
  model_emitted_write_matches_committed_bytes:true,
  provider_origin_independently_verified:false,
  model_generated_source_proven:false,
  billing_amount_verified:false,
  approved_permissions_expanded:false
 });
}

/**
 * One original OWNER-only entrypoint for a signed Task's completed UPDATE.
 * The caller supplies its trusted roster DID, immutable Task expectation and
 * the per-role bound model/store; no caller-supplied or model-supplied call
 * index is allowed. Authenticated Gateway receipt + independent Gitea CAS
 * are verified BEFORE claiming the one-shot model call window.
 *
 * The lower-level comparator performs a SECOND independent read immediately
 * before consuming the issued window, so a changed HEAD still fails closed.
 * This is not model-origin proof, durable audit, paid consent or Root issuance.
 */
export async function reconcileOriginalOwnerTaskWriteFromStore({
 model,ownerWindowStore,mutationObserver,completionExpectation,
 role,registeredAgentDid
}={}){
 if(!(model instanceof DisposablePrivateBudgetedAdkModel)||
    !(ownerWindowStore instanceof DisposableOriginalA2AModelCallWindowStore)||
    !(mutationObserver instanceof AuthenticatedGiteaMutationCompletionObserver)||
    !roles.has(role)||model.phase!==role||
    !completionExpectation||typeof completionExpectation!=="object"||
    completionExpectation.agent_did!==registeredAgentDid||
    typeof registeredAgentDid!=="string"||
    !registeredAgentDid.startsWith("did:"))deny();

 // Do not consume a signed Task window for a forged/missing receipt, stale
 // Gitea HEAD or a different file's bytes. A matching SHA alone does NOT
 // authorize another write; the original Gateway CAS already did.
 const mutation=await mutationObserver.observeAuthenticatedSourceDigest(
  completionExpectation);
 const candidates=model.proposedSourceWriteFingerprints().filter(row=>
  row.role===role&&row.operation==="update_file"&&
  row.branch===mutation.branch&&row.path===mutation.path&&
  row.source_sha256===mutation.source_sha256&&
  row.source_bytes===mutation.source_bytes
 );
 // Earlier signed Tasks may have proposed identical bytes on the same
 // path. Only THIS-Task call window can select the unique model output;
 // the preflight merely ensures at least one candidate before claiming.
 if(candidates.length===0)deny();

 // The model/store pair is checked again by the private WeakMap provenance
 // proof within the comparator; a swapped store can never authorize a
 // foreign model. The only accepted Task and Child IDs are receipt-pinned.
 let window;
 try{
  window=ownerWindowStore.takeOriginalWindow({
   task_id:completionExpectation.task_id,
   credential_id:completionExpectation.credential_id,
   runtime_task_id:completionExpectation.runtime_task_id
  });
 }catch{deny();}
 return reconcileOriginalModelWriteWithVerifiedGitea({
  model,mutationObserver,completionExpectation,
  role,registeredAgentDid,ownerObservedTaskCallWindow:window
 });
}

/**
 * Original owner-only CREATE comparator. A real native Rust/OPA admitted,
 * MAC-authenticated, independently reread Gitea CREATE receipt MUST match
 * precisely one model FunctionTool proposal within the original signed
 * Task/Child A2A call window. Does not approve an operation, issue a Root,
 * attest Gemini provenance or infer billable API costs.
 */
export async function reconcileOriginalModelCreateWithVerifiedGitea({
 model,createObserver,completionExpectation,role,registeredAgentDid,
 ownerObservedTaskCallWindow
}={}){
 if(!(model instanceof DisposablePrivateBudgetedAdkModel)||
    !(createObserver instanceof AuthenticatedGiteaCreateCompletionObserver)||
    !roles.has(role)||model.phase!==role||
    typeof registeredAgentDid!=="string"||
    !registeredAgentDid.startsWith("did:")||
    !completionExpectation||typeof completionExpectation!=="object"||
    completionExpectation.agent_did!==registeredAgentDid||
    !isIssuedOriginalA2ACallWindow(model,ownerObservedTaskCallWindow)||
    !ownerObservedTaskCallWindow||
    typeof ownerObservedTaskCallWindow!=="object"||
    Array.isArray(ownerObservedTaskCallWindow)||
    Object.keys(ownerObservedTaskCallWindow).sort().join(",")!==
     "call_index_after,call_index_before,credential_id,role,runtime_task_id,task_id"||
    ownerObservedTaskCallWindow.task_id!==completionExpectation.task_id||
    ownerObservedTaskCallWindow.runtime_task_id!==
     completionExpectation.runtime_task_id||
    ownerObservedTaskCallWindow.credential_id!==
     completionExpectation.credential_id||
    ownerObservedTaskCallWindow.role!==role||
    !Number.isSafeInteger(ownerObservedTaskCallWindow.call_index_before)||
    !Number.isSafeInteger(ownerObservedTaskCallWindow.call_index_after)||
    ownerObservedTaskCallWindow.call_index_before<0||
    ownerObservedTaskCallWindow.call_index_after<=
     ownerObservedTaskCallWindow.call_index_before||
    ownerObservedTaskCallWindow.call_index_after>
     model.publicSummary().calls_started)
  deny();
 const created=await createObserver.observeAuthenticatedSourceDigest(
  completionExpectation);
 if(created.status!=="owner_verified_gateway_gitea_create_digest_only"||
    created.old_path_absent_at_pinned_head!==true||
    created.task_id!==completionExpectation.task_id||
    created.runtime_task_id!==completionExpectation.runtime_task_id||
    created.credential_id!==completionExpectation.credential_id||
    created.agent_did!==registeredAgentDid)
  deny();
 const matches=model.proposedSourceWriteFingerprints().filter(row=>
  row.role===role&&row.operation==="create_file"&&
  row.call_index>ownerObservedTaskCallWindow.call_index_before&&
  row.call_index<=ownerObservedTaskCallWindow.call_index_after&&
  row.branch===created.branch&&row.path===created.path&&
  row.source_sha256===created.source_sha256&&
  row.source_bytes===created.source_bytes
 );
 if(matches.length!==1)deny();
 try{
  claimIssuedOriginalA2ACallWindow(model,ownerObservedTaskCallWindow);
  model.claimOriginalGatewayMatchedWrite(matches[0],created.evidence_sha256);
 }catch{deny();}
 return Object.freeze({
  status:"signed_gateway_gitea_create_cas_matches_model_proposed_bytes_only",
  task_id:created.task_id,branch:created.branch,path:created.path,
  commit_sha:created.commit_sha,
  source_sha256:created.source_sha256,source_bytes:created.source_bytes,
  gateway_evidence_sha256:created.evidence_sha256,
  matched_model_call_index:matches[0].call_index,
  old_path_absent_at_pinned_head:true,
  owner_asserted_task_call_window_checked:true,
  model_write_and_gateway_receipt_replay_fenced:true,
  model_emitted_write_matches_committed_bytes:true,
  provider_origin_independently_verified:false,
  model_generated_source_proven:false,
  billing_amount_verified:false,
  approved_permissions_expanded:false
 });
}
/** Never accept a model-supplied Task window or source SHA as input. */
export async function reconcileOriginalOwnerTaskCreateFromStore({
 model,ownerWindowStore,createObserver,completionExpectation,
 role,registeredAgentDid
}={}){
 if(!(model instanceof DisposablePrivateBudgetedAdkModel)||
    !(ownerWindowStore instanceof DisposableOriginalA2AModelCallWindowStore)||
    !(createObserver instanceof AuthenticatedGiteaCreateCompletionObserver)||
    !roles.has(role)||model.phase!==role||
    !completionExpectation||typeof completionExpectation!=="object"||
    completionExpectation.agent_did!==registeredAgentDid||
    typeof registeredAgentDid!=="string"||
    !registeredAgentDid.startsWith("did:"))deny();
 const created=await createObserver.observeAuthenticatedSourceDigest(
  completionExpectation);
 if(created.status!=="owner_verified_gateway_gitea_create_digest_only"||
    created.old_path_absent_at_pinned_head!==true||
    created.agent_did!==registeredAgentDid||
    created.task_id!==completionExpectation.task_id||
    created.runtime_task_id!==completionExpectation.runtime_task_id||
    created.credential_id!==completionExpectation.credential_id)
  deny();
 const candidates=model.proposedSourceWriteFingerprints().filter(row=>
  row.role===role&&row.operation==="create_file"&&
  row.branch===created.branch&&row.path===created.path&&
  row.source_sha256===created.source_sha256&&
  row.source_bytes===created.source_bytes
 );
 if(candidates.length===0)deny();
 let window;
 try{
  window=ownerWindowStore.takeOriginalWindow({
   task_id:completionExpectation.task_id,
   runtime_task_id:completionExpectation.runtime_task_id,
   credential_id:completionExpectation.credential_id
  });
 }catch{deny();}
 return reconcileOriginalModelCreateWithVerifiedGitea({
  model,createObserver,completionExpectation,
  role,registeredAgentDid,ownerObservedTaskCallWindow:window
 });
}
