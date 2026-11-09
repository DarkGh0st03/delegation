/**
 * EXPERIMENTAL, potentially BILLABLE only upon explicit operator invocation.
 *
 * Compose one independently OIDC-admitted GitHub manual run with the ORIGINAL
 * authority-only Engineer Review Host. There is deliberately no CLI, workflow
 * or HTTP entrypoint. Import and test never call Gemini or issue a Root.
 *
 * The native Engineer bootstrap assembles the original checked checkpoint,
 * Ed25519 signer pins, Gateway IPC, Rust credential port and journals.
 * The private host consumes ONE original HMAC admission (in model-set.mjs),
 * corroborates the active GitHub Actions run, loads its own private key file,
 * then binds exactly Backend/Frontend/Test and the original Orchestrator.
 *
 * We DO NOT call startAdmittedGithubReviewedGeminiHandoff here: doing so
 * would consume the SAME HMAC receipt a second time and activate a distinct
 * historical owner. No second signer, Review Host, Root or fallback.
 *
 * No billing/spend cap is enforced here. Deployment requires a separately
 * registered workflow, physical host isolation and explicit user consent.
 */
import {loadProtectedCanonicalOwnerManifest,
 assembleProtectedCanonicalOwnerAuthority,
 createProtectedCanonicalOperationalProvision}
 from "./trusted-authority-only-owner-bootstrap.mjs";
import {startTrustedAuthorityOnlyReviewHost}
 from "./trusted-authority-only-review-host.mjs";
import {createDisposableLiveGeminiModelSetFromPrivateHostAdmission}
 from "./disposable-gemini-live-model-set.mjs";
import {bindDisposableLiveGeminiCanonicalInputs}
 from "./disposable-gemini-live-canonical-binding.mjs";
import {bindOriginalBackendCheckpointSigner}
 from "./disposable-gemini-original-checkpoint-signer.mjs";
import {createDisposableOriginalGithubRunWatch}
 from "./disposable-gemini-original-github-run-watch.mjs";

const SHA=/^[a-f0-9]{40}$/u;
const CONFIRM="I AUTHORIZE GEMINI API CHARGES";
const deny=()=>{throw Error("Disposable live original Review Host startup NO-GO");};

/**
 * Original-host terminal cleanup, including the hard race where cancellation
 * is observed before the awaiting caller assigns the startup result to host.
 * The startup promise itself is authoritative: resolve that EXACT original
 * listener and close it, even when the outer variable is not yet assigned.
 *
 * No second Root, listener, approver, model or review is constructed here.
 * An uncertain/failed close MUST reject, never report Root retirement.
 */
export async function retireDisposableOriginalHostAfterStartup({
 starting,host,handoff
}={}){
 let original=host;
 if(starting!==undefined){
  try{
   const started=await starting;
   if(!started||typeof started.close!=="function")deny();
   original=started;
  }catch{deny();}
 }
 if(handoff!==undefined){
  if(!handoff||typeof handoff.close!=="function")deny();
  return handoff.close();
 }
 if(original!==undefined){
  if(!original||typeof original.close!=="function")deny();
  return original.close();
 }
}

/**
 * Explicit operator-only start. DO NOT CALL during offline CI.
 * The returned host exposes only original Engineer review and one canonical,
 * signed, Rust-native operational handoff; it never signs an approval itself.
 *
 * Keep operational functions and actual receipt-store instances entirely
 * private: no workflow_dispatch JSON, A2A Task or Gemini tool may supply
 * them. The original bootstrap validates native dependency types and limits.
 *
 * A refused or stale admission is terminal. The original one-use HMAC
 * marker remains consumed, so callers cannot restart with the same run ID.
 */
export async function startDisposableGeminiOriginalReviewSession({
 configPath,expectedSourceSha,admissionStore,pins,
 githubApiToken,keyFile,backendPrivateKeyFile,operational,
 chargeAuthorization
}={}){
 if(chargeAuthorization!==CONFIRM||
    !SHA.test(expectedSourceSha??"")||
    process.env.GITHUB_ACTIONS==="true"||
    process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    process.env.ENGINEER_CORE_NATIVE_MODE!=="1"||
    process.env.GEMINI_API_KEY!==undefined||
    process.env.GOOGLE_API_KEY!==undefined||
    process.env.OPENAI_API_KEY!==undefined||
    typeof backendPrivateKeyFile!=="string"||
    backendPrivateKeyFile===keyFile||
    backendPrivateKeyFile===configPath||
    !operational||typeof operational!=="object"||
    Array.isArray(operational)||
    // A private native rootGateway is mandatory: no caller-prepared HTTP
    // Branch or PR effect can replace the original Rust/OPA transports.
    !Object.hasOwn(operational,"rootGateway")||
    !Object.hasOwn(operational,"nativeEffects")||
    !Object.hasOwn(operational,"localWorkers")||
    !Object.hasOwn(operational,"rootReservation")||
    !Object.hasOwn(operational,"workflow")||
    // The original owner must be the only source of native effect methods.
    ["createBranch","draftPullRequest"].some(name=>
     ["prepare","execute"].some(key=>
      Object.hasOwn(operational.workflow?.[name]??{},key))))
   deny();

 // Original bootstrap checks owner-only manifest, Native Rust configuration
 // and signer identity. It does not run Planning or issue a Root.
 const loaded=await loadProtectedCanonicalOwnerManifest(
  configPath,{expectedSourceSha}
 );
 const authority=await assembleProtectedCanonicalOwnerAuthority(loaded);

 // SINGLE authenticated OIDC/HMAC consumption and GitHub REST check.
 // Never ask another handoff or owner to consume the admission again.
 const models=await createDisposableLiveGeminiModelSetFromPrivateHostAdmission({
  admissionStore,pins,checkoutSha:expectedSourceSha,
  keyFile,githubApiToken
 });
 const bound=bindDisposableLiveGeminiCanonicalInputs({
  models,authority,operational
 });
 // The original bootstrap pins the BACKEND PUBLIC Ed25519 checkpoint key.
 // Its original Review Host requires the matching private signer too.
 // Load only after authenticated admission, verify the pinned identity
 // AND the original store.assertSigner; never generate a new key.
 const signedAuthority=await bindOriginalBackendCheckpointSigner({
  authority:bound.authority,loaded,backendPrivateKeyFile,
  forbiddenFiles:[configPath,keyFile]
 });

 // All native transports are prepared by the original bootstrap. The
 // callbacks do not execute Git mutations; only reviewed execution can.
 const provision=await createProtectedCanonicalOperationalProvision(
  signedAuthority,bound.operational
 );

 // A one-use OIDC admission is NOT lasting permission to execute.
 // Revalidate the active GitHub job BEFORE launching paid Planning, then
 // every 15 seconds while the original Host and Root may remain active.
 // GitHub cancellation/error fences the same original Host (never an
 // alternate Root or a replacement approved DAG).
 let host,handoff,starting;
 const watch=createDisposableOriginalGithubRunWatch({
  pins,githubApiToken,
  onClose:()=>retireDisposableOriginalHostAfterStartup({
   starting,host,handoff
  })
 });
 try{
  await watch.start();
  // POTENTIALLY BILLABLE: original Review Host starts real ADK Planning.
  // No CI test invokes this function with a valid native owner manifest.
  starting=startTrustedAuthorityOnlyReviewHost(signedAuthority);
  host=await starting;
  starting=undefined;
  await watch.checkNow();
  handoff=host.createReviewedCanonicalHandoff({provision});
  await watch.checkNow();
  return Object.freeze({
   status:"disposable_original_planning_awaiting_signed_engineer_review",
   engineerUrl:host.engineerUrl,
   get phase(){return host.phase;},
   get githubRunStatus(){return watch.status;},
   // The same original Review Host verifies actual Ed25519 approval at
   // every activation; authenticated GitHub identity is NOT approval.
   reviewReadiness:async()=>{
    await watch.checkNow();
    const reviewed=await handoff.reviewReadiness();
    await watch.checkNow();
    return reviewed;
   },
   runApprovedCanonical:async()=>{
    await watch.checkNow();
    try{
     const result=await handoff.runApprovedCanonical();
     await watch.checkNow();
     return result;
    }catch(error){
     // An ambiguous activation may have issued the original Rust Root.
     // Never return success or retry without confirmed original close.
     await watch.close();
     throw error;
    }
   },
   close:()=>watch.close()
  });
 }catch(error){
  // The interval is fenced immediately. Root retirement belongs to the
  // ORIGINAL reviewed handoff/host; uncertainty must propagate.
  await watch.close();
  throw error;
 }
}
