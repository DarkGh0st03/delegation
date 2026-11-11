/**
 * Shared ORIGINAL native operational provision for an admitted Gemini owner.
 *
 * Both the private Engineer Host and future DISPOSABLE Actions owner must
 * call the SAME original Rust/Gateway/OPA/Child/A2A provisioning code.
 * This module deliberately does NOT start the Host, issue a Root, create
 * a signer, read any API key, run Docker, open an endpoint or call Gemini.
 *
 * A one-use model binding must already have come from the canonical binder,
 * and its backend checkpoint signer must already be verified against the
 * original typed store. No model/workflow/A2A input can supply either.
 */
import {createProtectedCanonicalOperationalProvision}
 from "./trusted-authority-only-owner-bootstrap.mjs";
import {claimDisposableOriginalOwnerBinding}
 from "./disposable-gemini-live-canonical-binding.mjs";
import {isIssuedDisposableOwnerSourceGate}
 from "./disposable-gemini-owner-source-gate-brand.mjs";

const deny=()=>{throw Error("Disposable original native provision NO-GO");};
const ROLES="backend,frontend,test";

/**
 * The returned function is a one-shot capability to be consumed only by
 * createReviewedCanonicalHandoff() AFTER original Ed25519 Engineer review.
 * Preparing it is zero-inference/pre-Root; invoking it may reserve a real
 * operational Root and is forbidden from any offline test.
 */
export async function prepareDisposableOriginalGeminiNativeProvision({
 bound,signedAuthority
}={}){
 claimDisposableOriginalOwnerBinding(bound);
 const original=bound.authority;
 const checkpoint=signedAuthority?.checkpoint;
 const sourceGate=bound.reconcileVerifiedOriginalWorkerFileEffect;
 if(!signedAuthority||typeof signedAuthority!=="object"||
    !original||typeof original!=="object"||
    !isIssuedDisposableOwnerSourceGate(sourceGate)||
    signedAuthority.snapshot!==original.snapshot||
    signedAuthority.workBranch!==original.workBranch||
    signedAuthority.approval!==original.approval||
    signedAuthority.trustedAgentRegistry!==original.trustedAgentRegistry||
    signedAuthority.operationalSessionStore!==original.operationalSessionStore||
    checkpoint?.store!==original.checkpoint?.store||
    checkpoint?.backendKeyId!==original.checkpoint?.backendKeyId||
    typeof checkpoint?.backendPrivateKeyPem!=="string"||
    !checkpoint.backendPrivateKeyPem.trim()||
    typeof checkpoint.store?.assertSigner!=="function"||
    Object.keys(bound.operational?.localWorkers?.workers??{}).sort().join(",")!==ROLES)
  deny();
 try{
  // Reuse the ORIGINAL typed pin check even though its private caller has
  // already verified the key; fail before reserving any Root on mismatch.
  checkpoint.store.assertSigner(checkpoint.backendKeyId,
   checkpoint.backendPrivateKeyPem);
 }catch{deny();}
 const nativeProvision=await createProtectedCanonicalOperationalProvision(
  signedAuthority,bound.operational
 );
 let invoked=false;
 const provision=async()=>{
  if(invoked)deny();
  invoked=true; // never retry an ambiguous Root reservation/side effect
  const ready=await nativeProvision();
  if(!ready||typeof ready!=="object"||Array.isArray(ready)||
     Object.hasOwn(ready,"ownerSourceGate"))deny();
  return Object.freeze({...ready,ownerSourceGate:sourceGate});
 };
 return Object.freeze({provision});
}
