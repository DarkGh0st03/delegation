/**
 * EXPERIMENT ONLY: continuous original-owner GitHub job liveness fence.
 * Never consumes another OIDC/HMAC admission, accesses the Gemini key,
 * grants an Engineer approval, signs Root/VP or starts a provider action.
 *
 * The original private Review Host is closed on any unavailable, changed,
 * completed, canceled or replaced manual run. Its original close path is
 * responsible for revoking Root/Child authority; we cannot claim revocation
 * succeeded until the close callback resolves.
 *
 * A network/poll delay cannot instantly interrupt an already in-flight ADK
 * call. Real deployment still requires independent process isolation,
 * operator kill-switch and provider billing controls.
 */
import {verifyGithubManualRunViaApi}
 from "../../../packages/orchestrator-runtime/src/trusted-github-run-identity.ts";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9]\d{0,19}$/u;
const POLL_MS=15000;
const deny=()=>{throw Error("Disposable original Gemini GitHub run watch NO-GO");};
const exact=(value,keys)=>!!value&&typeof value==="object"&&
 !Array.isArray(value)&&
 Object.keys(value).sort().join(",")===keys.slice().sort().join(",");

export function createDisposableOriginalGithubRunWatch({
 pins,githubApiToken,onClose
}={}){
 if(process.env.GITHUB_ACTIONS==="true"||
    !exact(pins,["repository","ref","sourceSha","runId","sessionId"])||
    pins.repository!==REPO||pins.ref!==REF||
    !SHA.test(pins.sourceSha??"")||
    !RUN.test(pins.runId??"")||
    typeof pins.sessionId!=="string"||!pins.sessionId||
    typeof githubApiToken!=="string"||
    githubApiToken.length<16||githubApiToken.length>512||
    /\s/u.test(githubApiToken)||
    typeof onClose!=="function")deny();
 let status="active",started=false,timer,pending,closing;
 const stop=()=>{
  if(closing)return closing;
  status="closing"; // SYNCHRONOUS fence before any async revocation.
  if(timer)clearInterval(timer);
  closing=Promise.resolve().then(()=>onClose()).then(()=>{
   status="closed";
  },()=>{
   status="revocation_unconfirmed";
   deny();
  });
  return closing;
 };
 const checkNow=()=>{
  if(status!=="active")return Promise.reject(
   Error("Disposable original Gemini GitHub run watch NO-GO"));
  if(pending)return pending.then(()=>{if(status!=="active")deny();});
  const call=(async()=>{
   try{
    await verifyGithubManualRunViaApi({
     dispatch:{run_id:pins.runId,source_sha:pins.sourceSha},
     pinned:{repository:REPO,ref:REF,
      workflowPath:WORKFLOW,sourceSha:pins.sourceSha},
     githubApiToken
    });
    if(status!=="active")deny();
   }catch{
    try{await stop();}catch{deny();}
    deny();
   }
  })();
  pending=call;
  void call.finally(()=>{if(pending===call)pending=undefined;})
   .catch(()=>{});
  return call;
 };
 const start=async()=>{
  if(started||status!=="active")deny();
  started=true;
  await checkNow(); // No timer or owner launch if the first REST check fails.
  if(status!=="active")deny();
  timer=setInterval(()=>{
   void checkNow().catch(()=>{/* closed/revocation state is authoritative */});
  },POLL_MS);
 };
 return Object.freeze({
  start,checkNow,close:stop,
  get status(){return status;}
 });
}
