/**
 * Disposable pilot: pure, non-billable binding to the ORIGINAL trusted
 * authority-only Review Host and its native operational provision inputs.
 *
 * This does not start Planning, approval, a Root, workers, A2A, Docker, a PR
 * or a provider request. The trusted operator supplies and verifies native
 * effects, signed Engineer review, immutable authority and private secrets
 * separately. The returned objects are host-only; do not serialize them.
 */
import {assertIssuedDisposableLiveGeminiModelSet,
 claimIssuedDisposableLiveGeminiModelSet}
 from "./disposable-gemini-live-model-set.mjs";
import {DisposablePrivateBudgetedAdkModel}
 from "./disposable-gemini-live-budgeted-model.mjs";
import {DisposableOriginalA2AModelCallWindowStore}
 from "./disposable-gemini-original-task-call-window.mjs";
import {reconcileOriginalOwnerTaskWriteFromStore,
 reconcileOriginalOwnerTaskCreateFromStore}
 from "./disposable-gemini-gitea-write-reconcile.mjs";

// The brand is shared with the original offline-capable Review Host through
// a PURE ESM module, not by loading the provider SDK on every host import.
import {mintDisposableOwnerSourceGate}
 from "./disposable-gemini-owner-source-gate-brand.mjs";
export {isIssuedDisposableOwnerSourceGate}
 from "./disposable-gemini-owner-source-gate-brand.mjs";
const ROLES=Object.freeze(["backend","frontend","test"]);
const ISSUED_BINDINGS=new WeakSet();
const deny=()=>{throw Error("Disposable live canonical binding NO-GO");};
const plain=x=>!!x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype;
const shape=(x,allowed,required=allowed)=>plain(x)&&
 Object.keys(x).every(key=>allowed.includes(key))&&
 required.every(key=>Object.hasOwn(x,key));
const uniqueRoles=x=>plain(x)&&
 Object.keys(x).sort().join(",")==="backend,frontend,test";
const noModel=x=>plain(x)&&!Object.hasOwn(x,"model");
const boundedPort=n=>Number.isSafeInteger(n)&&n>=1024&&n<=65535;

/**
 * Bind one consented model set to all ORIGINAL model-facing slots:
 * - Engineer Review Host's Planning, with its existing planId/store/signer
 * - original adaptive Orchestrator Loop, Branch and Draft PR decisions
 * - the EXACT three native A2A workers; no additional signer or Card.
 *
 * All authority, ports, evidence, permission ceilings and callbacks are
 * inherited unchanged from the trusted operator's provision. Injection of
 * pre-existing or externally supplied model overrides is denied.
 */
export function bindDisposableLiveGeminiCanonicalInputs({
 models,authority,operational
}={}){
 assertIssuedDisposableLiveGeminiModelSet(models);
 // The native rootGateway path intentionally has NO caller-defined
 // provider callbacks. The original bootstrap installs exact trusted
 // Rust/Gateway Prepare/Execute transports after Root admission.
 const nativeGateway=Object.hasOwn(operational??{},"rootGateway");
 const branchFields=["branch","baseBranch","permission","prepare","execute"];
 const prFields=["headBranch","baseBranch","title","body","permission",
  "prepare","execute"];
 if(!plain(authority)||!plain(operational)||
    !shape(authority.planner,["planId","onObservation"],["planId"])||
    typeof authority.planner.planId!=="string"||
    !authority.planner.planId.trim()||
    (authority.planner.onObservation!==undefined&&
     typeof authority.planner.onObservation!=="function")||
    typeof authority.workBranch!=="string"||
    !authority.workBranch.startsWith("feature/")||
    !plain(authority.trustedAgentRegistry)||
    !uniqueRoles(Object.fromEntries(Object.entries(
     authority.trustedAgentRegistry).filter(([role])=>role!=="orchestrator")))||
    !plain(operational.workflow)||
    !shape(operational.workflow,
     ["adaptive","createBranch","draftPullRequest"])||
    !noModel(operational.workflow.adaptive)||
    !shape(operational.workflow.adaptive,[
     "nextChildParameters","signal","requireVerifiedRepairDiagnostic",
     "maxSteps","maxVerifiedFailures"
    ],["nextChildParameters"])||
    typeof operational.workflow.adaptive.nextChildParameters!=="function"||
    // Existing ceilings may only be retained when equal to the pinned
    // experiment; a model or config file may not widen/reduce them.
    (operational.workflow.adaptive.maxSteps!==undefined&&
     operational.workflow.adaptive.maxSteps!==models.adaptive.maxSteps)||
    (operational.workflow.adaptive.maxVerifiedFailures!==undefined&&
     operational.workflow.adaptive.maxVerifiedFailures!==
      models.adaptive.maxVerifiedFailures)||
    !shape(operational.workflow.createBranch,branchFields,
     nativeGateway?branchFields.slice(0,3):branchFields)||
    operational.workflow.createBranch.branch!==authority.workBranch||
    operational.workflow.createBranch.baseBranch!=="main"||
    !shape(operational.workflow.draftPullRequest,prFields,
     nativeGateway?prFields.slice(0,5):prFields)||
    operational.workflow.draftPullRequest.headBranch!==authority.workBranch||
    operational.workflow.draftPullRequest.baseBranch!=="main"||
    (nativeGateway?(
      !shape(operational.rootGateway,["audit","verifier","policy","executor"])||
      !Object.hasOwn(operational,"nativeEffects")||
      ["audit","verifier","policy","executor"].some(
       key=>!operational.rootGateway[key])||
      [operational.workflow.createBranch,
       operational.workflow.draftPullRequest].some(effect=>
        Object.hasOwn(effect,"prepare")||Object.hasOwn(effect,"execute"))
    ):(
      typeof operational.workflow.createBranch.prepare!=="function"||
      typeof operational.workflow.createBranch.execute!=="function"||
      typeof operational.workflow.draftPullRequest.prepare!=="function"||
      typeof operational.workflow.draftPullRequest.execute!=="function"
    ))||
    !shape(operational.localWorkers,["directory","workers","a2aPolling"],
     ["directory","workers"])||
    !uniqueRoles(operational.localWorkers.workers)||
    !uniqueRoles(models.workers))
   deny();
 const ports=new Set();
 for(const role of ROLES){
  const w=operational.localWorkers.workers[role];
  if(!shape(w,["port","adk"])||
     !boundedPort(w.port)||ports.has(w.port)||!plain(w.adk)||
     ["model","maxModelTurns","maxModelCallMs",
      "generateContentConfig","ownerAdditionalCardPin",
      "trustedOriginalModelCallWindow"].some(key=>
       Object.hasOwn(w.adk,key))||
     typeof w.adk.gatewayBaseUrl!=="string"||
     !w.adk.gatewayBaseUrl.startsWith("http://127.0.0.1:")||
     typeof w.adk.adapterToken!=="string"||
     w.adk.adapterToken.length<8)deny();
  ports.add(w.port);
 }
 // Preserve original native/protected objects (not JSON clones).
 const planner=Object.freeze({...authority.planner,...models.planner});
 const adaptive=Object.freeze({
  ...operational.workflow.adaptive,...models.adaptive
 });
 // Branch and PR use the SAME owner-controlled generative orchestrator;
 // a scripted branch/PR model cannot silently remain in a "live" pilot.
 // When rootGateway is present, these configs stay callback-free until the
 // ORIGINAL trusted bootstrap creates native Rust/Gateway effect wrappers.
 const workflow=Object.freeze({
  ...operational.workflow,adaptive,
  createBranch:Object.freeze({...operational.workflow.createBranch,
   model:models.adaptive.model}),
  draftPullRequest:Object.freeze({
   ...operational.workflow.draftPullRequest,model:models.adaptive.model
  })
 });
 // Original owner-local call-window collectors: never A2A, ADK, model,
 // workflow input, signed grant or unauthenticated event payload.
 // Synthetic research-only Gemini constructors have NO budgeted wrapper,
 // so receive no callback and cannot claim provenance.
 const ownerModelTaskWindowStores={};
 const workers=Object.freeze(Object.fromEntries(ROLES.map(role=>{
  const current=operational.localWorkers.workers[role];
  const model=models.workers[role].model;
  let audit={};
  if(model instanceof DisposablePrivateBudgetedAdkModel){
   const store=new DisposableOriginalA2AModelCallWindowStore({role,model});
   ownerModelTaskWindowStores[role]=store;
   audit={trustedOriginalModelCallWindow:store.callbackForOriginalA2A()};
  }
  return [role,Object.freeze({
   ...current,adk:Object.freeze({...current.adk,...models.workers[role],...audit})
  })];
 })));
 const nextAuthority=Object.freeze({...authority,planner});
 const nextOperational=Object.freeze({
  ...operational,workflow,
  localWorkers:Object.freeze({...operational.localWorkers,workers})
 });
 // A host-only reconciler closes over the signed roster, models and private
 // call-window stores. The LLM/A2A Task cannot inject an agent DID, model
 // instance, read witness or window. No provider or Gateway call here.
 const allMetered=ROLES.every(role=>
  models.workers[role].model instanceof DisposablePrivateBudgetedAdkModel);
 const ownerReconcile=allMetered?async({
  role,operation,mutationObserver,createObserver,completionExpectation
 }={})=>{
  if(!ROLES.includes(role)||
     !["update_file","create_file"].includes(operation)||
     !nextAuthority.trustedAgentRegistry[role]?.did||
     completionExpectation?.agent_did!==
      nextAuthority.trustedAgentRegistry[role].did)deny();
  const inputs={
   model:models.workers[role].model,
   ownerWindowStore:ownerModelTaskWindowStores[role],
   completionExpectation,role,
   registeredAgentDid:nextAuthority.trustedAgentRegistry[role].did
  };
  return operation==="create_file"?
   reconcileOriginalOwnerTaskCreateFromStore({...inputs,createObserver}):
   reconcileOriginalOwnerTaskWriteFromStore({...inputs,mutationObserver});
 }:undefined;
 if(ownerReconcile)mintDisposableOwnerSourceGate(ownerReconcile);
 // Claim only AFTER the entire original-host configuration validates.
 // One OIDC-admitted set may bind only ONE owner session; no model reuse
 // as a second parallel Root/Planning launch with the same admission.
 claimIssuedDisposableLiveGeminiModelSet(models);
 const issued=Object.freeze({authority:nextAuthority,operational:nextOperational,
  ownerModelTaskWindowStores:Object.freeze(ownerModelTaskWindowStores),
  ...(ownerReconcile?{
   // Host-only: before the next independently signed Task changes Gitea HEAD.
   reconcileVerifiedOriginalWorkerFileEffect:ownerReconcile
  }:{})});
 ISSUED_BINDINGS.add(issued);
 return issued;
}
/** Consume a genuine, original owner-local binding once per native provision.
 * A plain object containing copied models or a forged callback cannot pass. */
export function claimDisposableOriginalOwnerBinding(candidate){
 if(!candidate||typeof candidate!=="object"||
    !ISSUED_BINDINGS.delete(candidate))deny();
 return candidate;
}
