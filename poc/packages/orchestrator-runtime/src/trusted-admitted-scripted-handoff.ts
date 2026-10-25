/**
 * R5 owner-only, NO-BILLING join of real GitHub OIDC job identity,
 * independent Engineer Ed25519 approval and SAME Coordinator's signed
 * A2A DAG. This never imports Gemini/ADK or accepts an API key.
 *
 * It does not allow OIDC to sign or approve a plan. The original private
 * Engineer host invokes it in-process, never from HTTP, A2A or MCP.
 */
import {TrustedScriptedGithubAdmissionStore}
  from "./trusted-scripted-github-admission.ts";
import {verifyGithubManualRunViaApi}
  from "./trusted-github-run-identity.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import {SignedPlanningCheckpointFileStore}
  from "./trusted-planning-checkpoint-store.ts";
import {startPersistedReviewedScriptedHandoff}
  from "./trusted-scripted-offline-handoff.ts";
import {createReviewedApprovedDagExecution}
  from "./trusted-reviewed-approved-dag.ts";
import type {RootParameters} from "./trusted-engineer-authority.ts";
import type {DeterministicTaskHandler}
  from "../../agent-runtime/src/executor.ts";

const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const REF=/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
type Role="backend"|"frontend"|"test";
function deny(msg:string):never{
  throw Error("Trusted admitted scripted handoff: "+msg);
}
export async function startAdmittedGithubReviewedScriptedHandoff(input:{
  coordinator:TrustedExecutionCoordinator;
  reviewGate:TrustedPlanningReviewGate;
  checkpointStore:SignedPlanningCheckpointFileStore;
  operationalRoot:RootParameters;
  ports:Readonly<Record<Role,number>>;
  handlers:Readonly<Record<Role,DeterministicTaskHandler>>;
  admissionStore:TrustedScriptedGithubAdmissionStore;
  pins:Readonly<{
    sessionId:string;runId:string;sourceSha:string;
    repository:string;ref:string;
  }>;
  githubApiToken:string;
  githubApiFetchFn?:typeof fetch;
}){
  const p=input?.pins;
  if(!(input?.coordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     !(input.checkpointStore instanceof SignedPlanningCheckpointFileStore)||
     !(input.admissionStore instanceof TrustedScriptedGithubAdmissionStore)||
     !SESSION.test(p?.sessionId??"")||
     !RUN.test(p?.runId??"")||
     !SHA.test(p?.sourceSha??"")||
     !REPO.test(p?.repository??"")||
     !REF.test(p?.ref??"")||
     !input.githubApiToken?.trim()||
     input.coordinator.phase!=="planning")
    deny("owner-pinned live Coordinator, separate offline admission and token required");
  // A stale, dead or unleased Coordinator must never be promoted.
  input.coordinator.assertOperationalLeaseConfigured();
  input.coordinator.assertOperationalRecoveryConfigured();
  if(input.coordinator.trustedPlanningAuthority().session_id!==p.sessionId)
    deny("signed Planning session differs from authenticated GitHub job");
  // Validates and consumes exactly ONE non-billable HMAC receipt. All
  // failures after consumption require a NEW signed manual GitHub run.
  const receipt=await input.admissionStore.consume({
    expectedRunId:p.runId,expectedSourceSha:p.sourceSha,
    expectedSessionId:p.sessionId
  });
  const verifyRest=()=>verifyGithubManualRunViaApi({
    dispatch:{run_id:p.runId,source_sha:p.sourceSha},
    pinned:{repository:p.repository,ref:p.ref,
      workflowPath:WORKFLOW,sourceSha:p.sourceSha},
    githubApiToken:input.githubApiToken,
    fetchFn:input.githubApiFetchFn
  });
  let running:Awaited<ReturnType<typeof startPersistedReviewedScriptedHandoff>>;
  try{
    if(receipt.workflow_path!==WORKFLOW||
       receipt.source_repository!==p.repository||
       receipt.source_ref!==p.ref||
       receipt.execution_profile!=="scripted_offline"||
       receipt.engineer_approved!==false||
       receipt.model_inference_allowed!==false)
      deny("signed offline receipt does not match protected owner source");
    await verifyRest();
    // The backend-signed checkpoint, independent Engineer Ed25519 receipt
    // and approved root are checked by the scripted handoff itself.
    running=await startPersistedReviewedScriptedHandoff({
      coordinator:input.coordinator,reviewGate:input.reviewGate,
      checkpointStore:input.checkpointStore,
      operationalRoot:input.operationalRoot,
      ports:input.ports,handlers:input.handlers
    });
  }catch(error){
    // After an authenticated OIDC receipt has been CONSUMED, the same
    // Engineer session cannot be resumed using the old preliminary root.
    // This matters if REST says the job was canceled, the Engineer
    // signature is missing, or the approved root fails before issuance.
    // Never retain live read authority behind a terminal runner status.
    if(input.coordinator.phase==="planning"){
      try{await input.coordinator.closePlanning();}
      catch{
        throw Error("Consumed scripted GitHub admission failed; preliminary root revocation unconfirmed; manual reconciliation required",
          {cause:error});
      }
    }
    throw error;
  }
  type WatchStatus="active"|"closing"|"closed"|"revocation_unconfirmed";
  let status:WatchStatus="active";
  let pending:Promise<void>|undefined;
  let closing:Promise<void>|undefined;
  let timer:ReturnType<typeof setInterval>|undefined;
  const stop=():Promise<void>=>{
    if(closing)return closing;
    status="closing";
    if(timer)clearInterval(timer);
    closing=running.close().then(()=>{
      status="closed";
    },()=>{
      status="revocation_unconfirmed";
      throw Error("scripted GitHub run closure or native root revocation unconfirmed");
    });
    return closing;
  };
  const checkNow=():Promise<void>=>{
    if(status!=="active")
      return Promise.reject(Error("scripted GitHub job no longer active"));
    if(pending)return pending.then(()=>{
      if(status!=="active")
        throw Error("scripted GitHub job closed during verification");
    });
    const checked=(async()=>{
      try{
        await verifyRest();
        if(status!=="active")
          throw Error("scripted host shutting down during GitHub verification");
        await input.coordinator.renewExecutionLease();
        if(status!=="active")
          throw Error("scripted host closed during lease renewal");
      }catch{
        await stop();
        throw Error("scripted GitHub job lost: authority retired or closure unconfirmed");
      }
    })();
    pending=checked;
    void checked.finally(()=>{
      if(pending===checked)pending=undefined;
    }).catch(()=>{});
    return checked;
  };
  timer=setInterval(()=>{
    void checkNow().catch(()=>{});
  },15_000);
  try{
    await checkNow();
    const approvedDag=createReviewedApprovedDagExecution({
      coordinator:input.coordinator,reviewGate:input.reviewGate,
      running,verifyLiveRun:checkNow,close:stop
    });
    return Object.freeze({
      ...running,approvedDag,
      githubRunWatch:Object.freeze({
        checkNow,
        get status(){return status;}
      }),
      close:stop
    });
  }catch(error){
    await stop();
    throw error;
  }
}
