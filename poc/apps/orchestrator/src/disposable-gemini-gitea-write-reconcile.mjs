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

const deny=()=>{throw Error("Disposable original model/Gitea digest reconciliation NO-GO");};
const roles=new Set(["backend","frontend","test"]);

/**
 * The registeredAgentDid comes from the original native owner's signed
 * roster, NEVER from the LLM/A2A Task or a workflow JSON input.
 * A digest match is evidence of byte identity, not its causal origin.
 */
export async function reconcileOriginalModelWriteWithVerifiedGitea({
 model,mutationObserver,completionExpectation,role,registeredAgentDid
}={}){
 if(!(model instanceof DisposablePrivateBudgetedAdkModel)||
    !(mutationObserver instanceof AuthenticatedGiteaMutationCompletionObserver)||
    !roles.has(role)||model.phase!==role||
    typeof registeredAgentDid!=="string"||
    !registeredAgentDid.startsWith("did:")||
    !completionExpectation||typeof completionExpectation!=="object"||
    completionExpectation.agent_did!==registeredAgentDid)
   deny();
 // This method verifies the ORIGINAL MAC and original Task binding and
 // independently checks the actual Gitea content, CAS parent and current HEAD.
 const mutation=await mutationObserver.observeAuthenticatedSourceDigest(
  completionExpectation);
 const matching=model.proposedSourceWriteFingerprints().filter(row=>
  row.role===role&&row.operation==="update_file"&&
  row.branch===mutation.branch&&row.path===mutation.path&&
  row.source_sha256===mutation.source_sha256&&
  row.source_bytes===mutation.source_bytes
 );
 if(matching.length!==1)deny();
 return Object.freeze({
  status:"signed_gateway_gitea_cas_matches_model_proposed_bytes_only",
  task_id:mutation.task_id,
  commit_sha:mutation.commit_sha,
  source_sha256:mutation.source_sha256,
  source_bytes:mutation.source_bytes,
  gateway_evidence_sha256:mutation.evidence_sha256,
  matched_model_call_index:matching[0].call_index,
  model_emitted_write_matches_committed_bytes:true,
  provider_origin_independently_verified:false,
  model_generated_source_proven:false,
  billing_amount_verified:false,
  approved_permissions_expanded:false
 });
}
