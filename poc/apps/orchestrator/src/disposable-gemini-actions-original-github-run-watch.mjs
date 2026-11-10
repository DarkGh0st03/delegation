/**
 * Zero-provider original Actions-owner GitHub manual-run liveness fence.
 *
 * A verified manual workflow_dispatch is NOT Engineer approval, permission
 * to bill, or a replacement for native Root/Child revocation. This watcher
 * only verifies that the ONE original disposable GitHub run remains active.
 * The original Review Host is retired through the owner's onClose closure.
 *
 * No CLI, model, key-file access, worker, Root, Gitea or Docker call here.
 * Network delays cannot abort an in-flight ADK call; real deployment still
 * needs process isolation, a kill switch, and a provider billing guard.
 */
import {verifyGithubManualRunViaApi}
 from "../../../packages/orchestrator-runtime/src/trusted-github-run-identity.ts";
import {assertDisposableActionsOriginalOwnerContext}
 from "./disposable-gemini-actions-original-owner-bootstrap.mjs";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/experiment/disposable-gemini-live-20261109";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const POLL_MS=15000;
const deny=()=>{throw Error("Disposable Actions original Github run watch NO-GO");};

/** Only a trusted owner may construct the watcher, after GitHub REST
 * admission/source validation and before ORIGINAL Review Host startup.
 * The read-only API token never appears in process.env or child arguments.
 */
export function createDisposableActionsOriginalGithubRunWatch({
 runId,sourceSha,githubApiToken,onClose,onFence=()=>{}
}={}){
 try{assertDisposableActionsOriginalOwnerContext(process.env,sourceSha);}
 catch{deny();}
 if(!SHA.test(sourceSha??"")||
    !RUN.test(runId??"")||
    runId!==process.env.GITHUB_RUN_ID||
    typeof githubApiToken!=="string"||
    githubApiToken.length<16||githubApiToken.length>512||
    /\s/u.test(githubApiToken)||
    typeof onClose!=="function"||
    typeof onFence!=="function")deny();

 let status="active",started=false,timer,pending,closing;
 const stop=()=>{
  if(closing)return closing;
  // Synchronous fence: a concurrent approval/Root call cannot observe
  // "active" after cancellation begins.
  status="closing";
  if(timer)clearInterval(timer);
  // Poison all private ADK requests SYNCHRONOUSLY before awaiting native
  // Root/Child retirement. A fence failure cannot skip retirement.
  let fenceFailed=false;
  try{onFence();}catch{fenceFailed=true;}
  closing=Promise.resolve().then(()=>onClose()).then(()=>{
   if(fenceFailed){status="revocation_unconfirmed";deny();}
   status="closed";
  },()=>{
   status="revocation_unconfirmed";
   deny();
  });
  return closing;
 };
 const checkNow=()=>{
  if(status!=="active")
   return Promise.reject(Error("Disposable Actions original Github run watch NO-GO"));
  if(pending)return pending.then(()=>{if(status!=="active")deny();});
  const call=(async()=>{
   try{
    // Never assume admission from an earlier poll remains valid.
    assertDisposableActionsOriginalOwnerContext(process.env,sourceSha);
    await verifyGithubManualRunViaApi({
     dispatch:{run_id:runId,source_sha:sourceSha},
     pinned:{repository:REPO,ref:REF,
      workflowPath:WORKFLOW,sourceSha},
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
  await checkNow(); // If first REST check fails, never start the owner.
  if(status!=="active")deny();
  timer=setInterval(()=>{
   void checkNow().catch(()=>{/* close/revocation status is authoritative */});
  },POLL_MS);
 };
 return Object.freeze({
  start,checkNow,close:stop,
  get status(){return status;}
 });
}
