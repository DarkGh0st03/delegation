/**
 * R123: arm a LIVE owner-only operational epoch recovery bridge AFTER
 * Engineer-signed Rust root issuance, BEFORE original A2A dispatch.
 *
 * This does not infer, repair, allocate children or authorize a provider.
 * It is deliberately opt-in and never exposed through HTTP/A2A/MCP.
 */
import {randomBytes} from "node:crypto";
import {TrustedOperationalEpochJournal}
 from "./trusted-operational-epoch-journal.mjs";
import {TrustedOperationalRepairPlanner,
 type TrustedRepairModelInput}
 from "./trusted-operational-repair-planner.ts";
import {TrustedAdkOperationalRepairProposer}
 from "./trusted-adk-operational-repair-proposer.ts";
import {TrustedOperationalFeatureHeadReader}
 from "../../../apps/gateway/src/trusted-operational-feature-head.ts";
import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
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
import {TrustedExecutionCoordinator}
 from "./trusted-execution-coordinator.ts";
import {executeTrustedAdmittedRepairDag}
 from "./trusted-repair-dag-controller.ts";
import {completeTrustedRemoteDiscoveryForPlanning} from
 "./trusted-remote-discovery-planner-bridge.ts";
import type {TrustedRemoteDiscoveryA2AHandoff} from
 "./trusted-remote-discovery-a2a-handoff.ts";
import {TrustedRemoteDiscoveryOwnerBindings} from
 "./trusted-remote-discovery-owner-bindings.ts";

import {assembleTrustedRemoteDiscoveryOwner,type TrustedRemoteDiscoveryOwnerPorts}
 from "./trusted-remote-discovery-owner-assembly.ts";

/** Local operator data ports only. Session/root/Gateway/epoch/Engineer
 * identity are derived exclusively from signed owner state. */
export type TrustedOwnerRepairDagPorts=Omit<
 Parameters<typeof executeTrustedAdmittedRepairDag>[0],
 "sessionId"|"epoch"|"planDigest"|"coordinator"|"intake"|"gateway"|"engineerDid"|"verifyLiveRun"
>;
const SHA=/^[0-9a-f]{40}$/u;
const DIGEST=/^[0-9a-f]{64}$/u;
const fail=(msg:string):never=>{throw Error("Trusted owner recovery R123: "+msg);};

/** Shared host/runtime gate. A proposer supplies data, never authority. */
export function isTrustedOwnerRepairPlannerConfig(config:unknown):boolean{
 if(!config||typeof config!=="object")return false;
 const c=config as Record<string,unknown>;
 const callback=typeof c.proposeRepairPlan==="function";
 const adk=c.trustedAdkProposer instanceof TrustedAdkOperationalRepairProposer;
 return c.giteaClient instanceof GiteaClient&&callback!==adk&&
  (c.proposeRepairPlan===undefined||callback)&&
  (c.trustedAdkProposer===undefined||adk)&&
  (c.admitReservedEpoch===undefined||typeof c.admitReservedEpoch==="boolean");
}

export async function armTrustedOwnerOperationalRecovery(config:{
 coordinator:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority"> &
  Partial<Pick<TrustedExecutionCoordinator,"closeExecution">>;
 signedApprovals:SignedEngineerApprovalFileStore;
 gateway:TrustedPlanIpcClient;
 epochDirectory:string;
 /** Current original GitHub run watch and root lease, not caller input. */
 verifyLiveRun?:()=>Promise<void>;
 running:Readonly<{
  readiness:Readonly<{
   session_id:string;base_revision:string;plan_digest:string;
   authenticated_engineer_did:string
  }>;
  operational_root_id:string
 }>;
 /** Existing R123 custom owner continuation, mutually exclusive with R124. */
 continueWithinActiveRoot?:(signal:Readonly<TrustedRepairFeedbackSignal>,
  intake:TrustedOperationalEpochIntake)=>Promise<void>;
 /** R124 concrete owner-only no-authority repair DAG planning after Test FAIL.
  * The supplied proposal function is not an authorization source; an operator
  * must separately approve any paid inference before using a paid adapter. */
 planRepairEpoch?:Readonly<{
  giteaClient:GiteaClient;
  /** R151.3: either the existing local callback OR a concrete, bounded
   * ADK proposer constructed privately by the original owner. ADK has no
   * authorization, credential or execution access; it supplies only a draft.
   * The trusted planner STILL independently validates every proposed grant. */
  proposeRepairPlan?:(input:Readonly<TrustedRepairModelInput>)=>Promise<unknown>;
  trustedAdkProposer?:TrustedAdkOperationalRepairProposer;
  /** Optional exact Task selectors for a Gateway-confirmed discovery read. */
  completedDiscoveryRead?:Readonly<{
   task_id:string;runtime_task_id:string;resource:string;
  }>;
  /** Owner-private source from completed Gateway/Backend read. This function
   * cannot derive authorization and must NOT bypass Gateway to query Gitea.
   * Planner checks exact SHA-256 and bytes against the Gateway effect BEFORE
   * permitting source data in the model's one-turn draft context. */
  loadCompletedDiscoverySource?:(
   pins:Readonly<{task_id:string;runtime_task_id:string;resource:string}>
  )=>Promise<string>;
  /** R151.45 owner-only callback: perform an already-authorized, journaled
   * remote discovery A2A dispatch AFTER the authentic Docker Test FAIL.
   * Receipts are independently reverified against the same Gateway, and
   * a failed/uncertain callback closes the original Rust root. Never pass
   * a model or external A2A callback here. */
  dispatchRemoteDiscovery?:()=>ReturnType<
   TrustedRemoteDiscoveryA2AHandoff["dispatchIssuedChild"]>;
  /** R151.49: preferred concrete paired issuer/remote private read.
   * Cannot be mixed with loose discovery or source callbacks. */
  trustedRemoteDiscovery?:TrustedRemoteDiscoveryOwnerBindings;
  /** Late assembly uses this owner's intake and attested failed Task, never
   * an intake/Task selected by an external callback or model. */
  remoteDiscoveryPorts?:TrustedRemoteDiscoveryOwnerPorts;
  /** Native host endpoints become available after startup. Resolve only
   * after verified Test FAIL, under the original one-use owner. */
  prepareRemoteDiscoveryPorts?:()=>Promise<TrustedRemoteDiscoveryOwnerPorts>;
  /** R125: explicit owner opt-in to ACTUAL Gateway epoch admission.
   * Requires a genuinely Gateway-bound independently signed epoch Intake. */
  admitReservedEpoch?:boolean;
  /** R138: only after R133 independently admitted the reserved DAG. */
  executeAdmittedRepairDag?:Readonly<TrustedOwnerRepairDagPorts>;
 }>;
}):Promise<Readonly<{
 gateway:TrustedPlanIpcClient;
 intake:TrustedOperationalEpochIntake;
 continueWithinActiveRoot:(signal:Readonly<TrustedRepairFeedbackSignal>)=>Promise<void>;
}>>{
 const r=config?.running?.readiness;
 const custom=typeof config?.continueWithinActiveRoot==="function";
 const structured=config?.planRepairEpoch!==undefined;
 const typedAdk=config?.planRepairEpoch?.trustedAdkProposer
   instanceof TrustedAdkOperationalRepairProposer;
 if(custom===structured||
    (config?.continueWithinActiveRoot!==undefined&&!custom)||
    (structured&&!isTrustedOwnerRepairPlannerConfig(config.planRepairEpoch)))
  fail("exactly one trusted owner continuation or configured repair planner required");
 const paired=config.planRepairEpoch?.trustedRemoteDiscovery;
 const remotePorts=config.planRepairEpoch?.remoteDiscoveryPorts;
 const prepareRemotePorts=config.planRepairEpoch?.prepareRemoteDiscoveryPorts;
 if(prepareRemotePorts!==undefined&&
    (typeof prepareRemotePorts!=="function"||remotePorts!==undefined))
  fail("late discovery requires one private ports factory or fixed ports");
 if((remotePorts!==undefined||prepareRemotePorts!==undefined)&&
    ((!remotePorts&&!prepareRemotePorts)||!(config.coordinator instanceof TrustedExecutionCoordinator)||
     paired!==undefined||config.planRepairEpoch!.completedDiscoveryRead!==undefined||
     config.planRepairEpoch!.dispatchRemoteDiscovery!==undefined||
     config.planRepairEpoch!.loadCompletedDiscoverySource!==undefined))
  fail("late discovery requires native owner and exclusive private ports");
 if(paired!==undefined&&
    (!(paired instanceof TrustedRemoteDiscoveryOwnerBindings)||
     config.planRepairEpoch!.completedDiscoveryRead!==undefined||
     config.planRepairEpoch!.dispatchRemoteDiscovery!==undefined||
     config.planRepairEpoch!.loadCompletedDiscoverySource!==undefined))
  fail("paired discovery cannot mix signer, Task or private source callbacks");
 if(config.planRepairEpoch?.loadCompletedDiscoverySource&&
    (!config.planRepairEpoch.dispatchRemoteDiscovery&&
     !config.planRepairEpoch.completedDiscoveryRead))
  fail("source delivery needs a verified Backend discovery Task");
 if((paired||remotePorts||prepareRemotePorts||config.planRepairEpoch?.dispatchRemoteDiscovery)&&
    (config.planRepairEpoch?.completedDiscoveryRead!==undefined||
     typeof config.coordinator?.closeExecution!=="function"))
  fail("dynamic discovery requires exclusive owner callback and fail-closed root shutdown");
 if(config.planRepairEpoch?.executeAdmittedRepairDag&&
    (config.planRepairEpoch.admitReservedEpoch!==true||
     typeof config.verifyLiveRun!=="function"))
  fail("R138 DAG requires admitted Gateway epoch and live original GitHub run");
 if(!(config.signedApprovals instanceof SignedEngineerApprovalFileStore)||
    !(config.gateway instanceof TrustedPlanIpcClient)||
    !config.gateway.operationalLeaseConfigured()||
    !config.gateway.operationalSessionDurableConfigured()||
    config.coordinator?.phase!=="execution"||
    typeof config.coordinator.trustedOperationalAuthority!=="function"||
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
   if(structured){
    let activeDiscovery=paired;
    try{
    // R124: the signed Engineer's exact ORIGINAL candidates/repository
    // are the only provenance for identities and work branch. The proposed
    // DAG may add NEW Task IDs but never pairs outside the issued Rust root.
    const before=await intake.verifiedEpochHistory();
    if(before.length!==proof.failed_epoch||
       before[0]?.plan_digest!==r.plan_digest)
     fail("verified Test FAIL does not match the active original epoch");
    const agents=record.plan.candidate_agents.map(a=>({
     agent_id:a.agent_id as "backend"|"frontend"|"test",
     did:a.did,card_ref:a.card_ref
    }));
    // Dynamic random runtime Task ID is only known AFTER remote A2A
    // dispatch. Its source-free selectors must be re-attested directly
    // through the original Gateway before any paid model proposal.
    let discovered:Readonly<{
      task_id:string;runtime_task_id:string;resource:string;
    }>|undefined;
    if(paired||remotePorts||prepareRemotePorts||config.planRepairEpoch!.dispatchRemoteDiscovery){
      try{
        await config.verifyLiveRun?.();
        if(remotePorts||prepareRemotePorts){
          const resolvedPorts=remotePorts??await prepareRemotePorts!();
          await config.verifyLiveRun?.();
          activeDiscovery=await assembleTrustedRemoteDiscoveryOwner(resolvedPorts,{
            coordinator:config.coordinator as TrustedExecutionCoordinator,
            gateway:config.gateway,intake,sessionId:r.session_id,
            engineerDid:r.authenticated_engineer_did,
            failedRuntimeTestTaskId:proof.failed_runtime_task_id
          });
          await config.verifyLiveRun?.();
        }
        discovered=await completeTrustedRemoteDiscoveryForPlanning({
          gateway:config.gateway,intake,coordinator:config.coordinator,
          signal:proof,
          dispatchRemoteDiscovery:activeDiscovery
           ?()=>activeDiscovery!.dispatchRemoteDiscovery()
           :config.planRepairEpoch!.dispatchRemoteDiscovery!
        });
        await config.verifyLiveRun?.();
      }catch{
        // Transport/issuance/read uncertainty can never be retried under
        // this root. A potentially admitted Child may still be live.
        if(config.coordinator.phase==="execution"){
          try{await config.coordinator.closeExecution!();}
          catch{
            fail("dynamic discovery failed; original root shutdown reconciliation required");
          }
        }
        fail("dynamic discovery failed closed before model repair proposal");
      }
    }
    const planner=new TrustedOperationalRepairPlanner({
     gateway:config.gateway,coordinator:config.coordinator,
     intake,sessionId:r.session_id,
     runtimeTestTaskId:proof.failed_runtime_task_id,
     failedTestAlreadyFinalized:true,
     ...(discovered||config.planRepairEpoch!.completedDiscoveryRead
       ?{completedDiscoveryRead:discovered??config.planRepairEpoch!.completedDiscoveryRead}:{}),
     ...(activeDiscovery
       ?{loadCompletedDiscoverySource:(pins:Readonly<{
         task_id:string;runtime_task_id:string;resource:string;
        }>)=>activeDiscovery!.loadCompletedDiscoverySource(pins)}
       :config.planRepairEpoch!.loadCompletedDiscoverySource
       ?{loadCompletedDiscoverySource:config.planRepairEpoch!.loadCompletedDiscoverySource}:{}),
     nextPlanId:"repair-"+randomBytes(12).toString("hex"),
     pinnedAgentRegistry:agents,
     featureHeadReader:new TrustedOperationalFeatureHeadReader({
      giteaClient:config.planRepairEpoch!.giteaClient,
      intake,repository:record.plan.repository
     }),
     proposeRepairPlan:typedAdk
       ?input=>config.planRepairEpoch!.trustedAdkProposer!.propose(input)
       :config.planRepairEpoch!.proposeRepairPlan!
    });
    const reserved=await planner.proposeAndReserve();
    if(reserved.status!=="repair_epoch_reserved_no_execution_authority"||
       reserved.execution_authorized!==false||
       reserved.child_credential_issued!==false||
       reserved.epoch!==before.length+1||
       reserved.source_failed_sha!==proof.tested_commit_sha)
     fail("repair reservation cannot be promoted to execution authority");
    const after=await intake.verifiedEpochHistory();
    if(after.length!==reserved.epoch||
       after.at(-1)?.plan_digest!==reserved.plan_digest)
     fail("durable repair epoch differs from owner planner reservation");
    if(config.planRepairEpoch!.admitReservedEpoch===true){
     await config.verifyLiveRun?.();
     // The real remote Gateway MUST already hold a separately valid
     // original-root-bound intake. Never upload the proposed plan or
     // treat this source-free IPC request as a grant of authority.
     const admission=await config.gateway.admitVerifiedOperationalEpoch({
      session_id:r.session_id,root_plan_digest:r.plan_digest,
      plan_digest:reserved.plan_digest,epoch:reserved.epoch
     });
     if(admission.status!=="gateway_epoch_admitted"||
        admission.plan_digest!==reserved.plan_digest||
        admission.epoch!==reserved.epoch)
      fail("Gateway epoch admission did not match reserved signed DAG");
     if(config.planRepairEpoch!.executeAdmittedRepairDag){
      await config.verifyLiveRun!();
      const report=await executeTrustedAdmittedRepairDag({
       ...config.planRepairEpoch!.executeAdmittedRepairDag,
       sessionId:r.session_id,epoch:reserved.epoch,
       planDigest:reserved.plan_digest,
       coordinator:config.coordinator,intake,gateway:config.gateway,
       engineerDid:r.authenticated_engineer_did,
       verifyLiveRun:config.verifyLiveRun
      });
      if(report.status!==
          "repair_dag_gateway_confirmed_not_final_runner_verified"||
         report.session_id!==r.session_id||
         report.plan_digest!==reserved.plan_digest||
         report.epoch!==reserved.epoch||
         report.docker_pass_verified!==false||
         report.pull_request_created!==false)
       fail("R138 repair outcome cannot claim final Runner PASS or PR");
      await config.verifyLiveRun!();
     }
    }
    }catch(error){
      // R151.46: once the remote discovery Child has been issued and its
      // provider read confirmed, this one-use owner has no safe retry path.
      // A malformed model draft, lost preflight ACK, stale feature HEAD or
      // failed DAG admission/execution must not leave its Rust root alive.
      if((paired||remotePorts||prepareRemotePorts||config.planRepairEpoch!.dispatchRemoteDiscovery)&&
         config.coordinator.phase==="execution"){
        try{await config.coordinator.closeExecution!();}
        catch{
          fail("post-discovery planning failed; original Rust root shutdown reconciliation required");
        }
      }
      throw error;
    }
   }else{
    await config.continueWithinActiveRoot!(proof,intake);
   }
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
