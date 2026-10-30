/**
 * R123: arm a LIVE owner-only operational epoch recovery bridge AFTER
 * Engineer-signed Rust root issuance, BEFORE original A2A dispatch.
 *
 * This does not infer, repair, allocate children or authorize a provider.
 * It is deliberately opt-in and never exposed through HTTP/A2A/MCP.
 */
import {TrustedOperationalEpochJournal}
 from "./trusted-operational-epoch-journal.mjs";
import {TrustedOperationalEpochIntake}
 from "./trusted-operational-epoch-intake.ts";
import {SignedEngineerApprovalFileStore}
 from "./signed-approval-store.ts";
import {TrustedPlanIpcClient}
 from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {prepareTrustedRemoteRepairFeedback,
 type TrustedRepairFeedbackSignal}
 from "./trusted-validation-repair-feedback.ts";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import type {TrustedExecutionCoordinator}
 from "./trusted-execution-coordinator.ts";

const SHA=/^[0-9a-f]{40}$/u;
const DIGEST=/^[0-9a-f]{64}$/u;
const fail=(msg:string):never=>{throw Error("Trusted owner recovery R123: "+msg);};

export async function armTrustedOwnerOperationalRecovery(config:{
 coordinator:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority">;
 signedApprovals:SignedEngineerApprovalFileStore;
 gateway:TrustedPlanIpcClient;
 epochDirectory:string;
 running:Readonly<{
  readiness:Readonly<{
   session_id:string;base_revision:string;plan_digest:string;
   authenticated_engineer_did:string
  }>;
  operational_root_id:string
 }>;
 continueWithinActiveRoot:(signal:Readonly<TrustedRepairFeedbackSignal>,
  intake:TrustedOperationalEpochIntake)=>Promise<void>;
}):Promise<Readonly<{
 gateway:TrustedPlanIpcClient;
 intake:TrustedOperationalEpochIntake;
 continueWithinActiveRoot:(signal:Readonly<TrustedRepairFeedbackSignal>)=>Promise<void>;
}>>{
 const r=config?.running?.readiness;
 if(!(config.signedApprovals instanceof SignedEngineerApprovalFileStore)||
    !(config.gateway instanceof TrustedPlanIpcClient)||
    !config.gateway.operationalLeaseConfigured()||
    !config.gateway.operationalSessionDurableConfigured()||
    config.coordinator?.phase!=="execution"||
    typeof config.coordinator.trustedOperationalAuthority!=="function"||
    typeof config.continueWithinActiveRoot!=="function"||
    !r?.session_id||!SHA.test(r.base_revision)||!DIGEST.test(r.plan_digest)||
    !r.authenticated_engineer_did?.startsWith("did:")||
    !config.running.operational_root_id)
  fail("original approved Coordinator, root and durable IPC required");
 const root=config.coordinator.trustedOperationalAuthority();
 if(root.credential_id!==config.running.operational_root_id||
    root.plan_digest!==r.plan_digest)
  fail("issued Rust root differs from approved signed Execution");
 const record=await config.signedApprovals.loadAuthenticatedApproval(r.session_id);
 if(record.authenticated_engineer_did!==r.authenticated_engineer_did||
    record.plan.session_id!==r.session_id||
    record.plan.base_revision!==r.base_revision||
    planDigest(record.plan)!==r.plan_digest)
  fail("authenticated Engineer approval not bound to original root");

 // Journal constructor and reserveInitial both enforce absolute protected
 // directories, exact original plan and fsynced exclusive one-use record.
 const journal=new TrustedOperationalEpochJournal({
  directory:config.epochDirectory,sessionId:r.session_id,
  baseRevision:r.base_revision,rootCredentialId:root.credential_id,
  originalPlanDigest:r.plan_digest,
  allowedOperations:new Set<string>(RUST_OPERATIONS)
 });
 const intake=TrustedOperationalEpochIntake.create({
  coordinator:config.coordinator,approvals:config.signedApprovals,
  journal,sessionId:r.session_id,engineerDid:r.authenticated_engineer_did,
  pinnedAgentRegistry:record.plan.candidate_agents
 });
 await intake.reserveInitialEpoch();
 const history=await intake.verifiedEpochHistory();
 if(history.length!==1||history[0].plan_digest!==r.plan_digest||
    history[0].root_credential_id!==root.credential_id)
  fail("initial signed epoch was not durably reserved");
 let started=false;
 return Object.freeze({
  gateway:config.gateway,intake,
  async continueWithinActiveRoot(signal:Readonly<TrustedRepairFeedbackSignal>){
   if(started)fail("recovery owner callback is one-use");
   started=true;
   if(!signal||signal.status!=="repair_planning_eligible"||
      signal.session_id!==r.session_id||
      signal.root_plan_digest!==r.plan_digest||
      signal.execution_authorized!==false||
      signal.permission_granted!==false)
    fail("dispatcher feedback does not match signed owner session");
   // Re-attest only an ALREADY FINALIZED failure from the ACTUAL Gateway.
   // No second terminal finalization and no model-invented failure receipt.
   const proof=await prepareTrustedRemoteRepairFeedback({
    gateway:config.gateway,intake,coordinator:config.coordinator,
    sessionId:r.session_id,runtimeTestTaskId:signal.failed_runtime_task_id,
    alreadyFinalized:true
   });
   if(JSON.stringify(proof)!==JSON.stringify(signal))
    fail("Gateway proof changed since dispatcher suspension");
   await config.continueWithinActiveRoot(proof,intake);
   const now=config.coordinator.trustedOperationalAuthority();
   if(config.coordinator.phase!=="execution"||
      now.credential_id!==root.credential_id||
      now.plan_digest!==root.plan_digest)
    fail("original Rust root retired or replaced during owner recovery");
   // A callback can reserve a new epoch; the original signed ledger
   // still must be valid. It can NEVER claim completed PASS from here.
   const after=await intake.verifiedEpochHistory();
   if(after[0]?.plan_digest!==r.plan_digest)
    fail("original signed plan changed during recovery");
  }
 });
}
