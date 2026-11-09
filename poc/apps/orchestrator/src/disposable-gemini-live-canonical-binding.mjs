/**
 * Disposable pilot: pure, non-billable binding to the ORIGINAL trusted
 * authority-only Review Host and its native operational provision inputs.
 *
 * This does not start Planning, approval, a Root, workers, A2A, Docker, a PR
 * or a provider request. The trusted operator supplies and verifies native
 * effects, signed Engineer review, immutable authority and private secrets
 * separately. The returned objects are host-only; do not serialize them.
 */
import {assertIssuedDisposableLiveGeminiModelSet}
 from "./disposable-gemini-live-model-set.mjs";

const ROLES=Object.freeze(["backend","frontend","test"]);
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
    !shape(operational.workflow.createBranch,[
     "branch","baseBranch","permission","prepare","execute"
    ])||
    operational.workflow.createBranch.branch!==authority.workBranch||
    operational.workflow.createBranch.baseBranch!=="main"||
    !shape(operational.workflow.draftPullRequest,[
     "headBranch","baseBranch","title","body","permission",
     "prepare","execute"
    ])||
    operational.workflow.draftPullRequest.headBranch!==authority.workBranch||
    operational.workflow.draftPullRequest.baseBranch!=="main"||
    typeof operational.workflow.createBranch.prepare!=="function"||
    typeof operational.workflow.createBranch.execute!=="function"||
    typeof operational.workflow.draftPullRequest.prepare!=="function"||
    typeof operational.workflow.draftPullRequest.execute!=="function"||
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
      "generateContentConfig","ownerAdditionalCardPin"].some(key=>
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
 const workflow=Object.freeze({
  ...operational.workflow,adaptive,
  createBranch:Object.freeze({...operational.workflow.createBranch,
   model:models.adaptive.model}),
  draftPullRequest:Object.freeze({
   ...operational.workflow.draftPullRequest,model:models.adaptive.model
  })
 });
 const workers=Object.freeze(Object.fromEntries(ROLES.map(role=>{
  const current=operational.localWorkers.workers[role];
  return [role,Object.freeze({
   ...current,adk:Object.freeze({...current.adk,...models.workers[role]})
  })];
 })));
 const nextAuthority=Object.freeze({...authority,planner});
 const nextOperational=Object.freeze({
  ...operational,workflow,
  localWorkers:Object.freeze({...operational.localWorkers,workers})
 });
 return Object.freeze({authority:nextAuthority,operational:nextOperational});
}
