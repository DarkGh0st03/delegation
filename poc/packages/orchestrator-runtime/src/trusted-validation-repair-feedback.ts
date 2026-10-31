import {isActionableRepairFailure, type AcceptanceFailureSummary}
  from "../../../apps/test-runner-controller/src/repair-failure-eligibility.ts";
/**
 * R105: only a Gateway-confirmed, terminal failed Test plus the original
 * Engineer-root-bound operational epoch history can enter repair planning.
 *
 * This is NOT a model-facing permission source or a fresh Engineer consent.
 * It creates only a bounded, source-free planning signal. It cannot issue
 * a DC, admit a plan, mark a Task successful, or dispatch an Agent.
 */
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import {approvedWorkBranch} from "../../plan-contracts/src/approved-work-branch.mjs";
import {TrustedApprovedExecutionPlans} from
  "../../../apps/gateway/src/approved-execution-plans.ts";
import {TrustedOperationalEpochIntake} from "./trusted-operational-epoch-intake.ts";
import {TrustedPlanIpcClient} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import type {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import type {TrustedRunnerFailure} from "../../../apps/gateway/src/approved-execution-plans.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const PHASES=new Set([
  "typecheck","backend_tests","frontend_tests","build",
  "playwright_e2e","researcher_acceptance"
]);
const MAX_TOTAL_EPOCHS=3;
const deny=(reason:string):never=>{
 throw Error("Trusted repair feedback NO-GO: "+reason);
};

export interface TrustedRepairFeedbackSignal{
 readonly status:"repair_planning_eligible"|"repair_budget_exhausted";
 readonly provenance:"gateway_verified_docker_runner";
 readonly authority_kind:"existing_rust_operational_root";
 readonly session_id:string;
 readonly failed_plan_digest:string;
 readonly root_plan_digest:string;
 readonly failed_task_id:string;
 readonly failed_runtime_task_id:string;
 readonly failed_request_id:string;
 readonly failed_epoch:number;
 readonly tested_commit_sha:string;
 readonly work_branch:string;
 readonly first_failed_phase:string;
 readonly typecheck_error_codes:ReadonlyArray<string>;
 readonly acceptance_failure?:AcceptanceFailureSummary;
 readonly remaining_repair_epochs:number;
 readonly execution_authorized:false;
 readonly permission_granted:false;
}

/**
 * A private host-owned intake. A2A text, Gemini response, metadata from
 * unverified webhooks and model-chosen Task IDs must never construct this.
 */
/** Common validator: neither the local nor the remote Gateway receipt can
 * authorize a repair by itself. The independently signed Engineer approval,
 * actually issued operational root and durable epoch history are mandatory.
 * Remote IPC is called ONLY after the first owner-root validation, and an
 * identical live-root check is repeated after the asynchronous IPC response. */
async function prepareVerifiedRepairFeedback(config:{
 intake:TrustedOperationalEpochIntake;
 sessionId:string;
 runtimeTestTaskId:string;
 readGatewayFailure:(originalRootPlanDigest:string)=>Promise<Readonly<TrustedRunnerFailure>>;
}):Promise<Readonly<TrustedRepairFeedbackSignal>>{

 // The original signed approval and every sequential epoch are verified
 // against the ACTUALLY issued Rust operational DC by this private intake.
 const epochs=await config.intake.verifiedEpochHistory();
 if(epochs.length<1||epochs.length>MAX_TOTAL_EPOCHS)
  deny("unrecognized or out-of-budget operational epoch history");

 // The original signed digest comes exclusively from this protected ledger:
 // never take a replacement root digest from IPC, model text or operator JSON.
 const initial=epochs[0],current=epochs.at(-1);
 if(!initial||!current)deny("signed operational epoch history unavailable");
 // For IPC, the remote Gateway finalizes a Test FAIL once. A transport error
 // is NOT evidence of failure, and must be handled by terminal host cleanup.
 const failure=await config.readGatewayFailure(initial.plan_digest);

 if(!initial||!current||
    initial.plan.session_id!==config.sessionId||
    current.plan.session_id!==config.sessionId||
    failure.session_id!==config.sessionId||
    failure.root_plan_digest!==initial.plan_digest||
    !SHA.test(failure.tested_commit_sha)||
    failure.runtime_task_id!==config.runtimeTestTaskId||
    failure.epoch_version!==epochs.length||
    failure.branch!==approvedWorkBranch(current.plan)||
    !PHASES.has(failure.first_failed_phase)||
    !current.plan.tasks.some((task:{id:string;agent_id:string})=>
      task.id===failure.plan_task_id&&task.agent_id==="test"))
  deny("failed Runner receipt not bound to latest authenticated epoch");
 if(current.plan_digest!==planDigest(current.plan)||
    initial.plan_digest!==planDigest(initial.plan))
  deny("operational epoch plan digest changed");

 // A revoked root during asynchronous validation must not produce a
 // planning-eligible result. This second check also verifies the most
 // recent persisted epoch still matches the one inspected above.
 const again=await config.intake.verifiedEpochHistory();
 if(again.length!==epochs.length||
    again.at(-1)?.plan_digest!==current.plan_digest||
    again[0]?.plan_digest!==initial.plan_digest||
    again[0]?.root_credential_id!==initial.root_credential_id||
    again.at(-1)?.root_credential_id!==current.root_credential_id)
  deny("operational history changed while obtaining validation evidence");

 const remaining=MAX_TOTAL_EPOCHS-epochs.length;
 const result:TrustedRepairFeedbackSignal={
  status:remaining>0?"repair_planning_eligible":"repair_budget_exhausted",
  provenance:"gateway_verified_docker_runner",
  authority_kind:"existing_rust_operational_root",
  session_id:config.sessionId,
  failed_plan_digest:current.plan_digest,
  root_plan_digest:initial.plan_digest,
  failed_task_id:failure.plan_task_id,
  failed_runtime_task_id:failure.runtime_task_id,
  failed_request_id:failure.request_id,
  failed_epoch:failure.epoch_version,
  tested_commit_sha:failure.tested_commit_sha,
  work_branch:failure.branch,
  first_failed_phase:failure.first_failed_phase,
  typecheck_error_codes:Object.freeze([...failure.typecheck_error_codes]),
  ...(failure.acceptance_failure?{acceptance_failure:failure.acceptance_failure}:{}),
  remaining_repair_epochs:remaining,
  execution_authorized:false,
  permission_granted:false
 };
 return Object.freeze(result);
}

/** R105/R112 same-process route. Retains the existing strict in-process
 * Gateway instance and does not relax any trusted dispatcher requirements. */
export async function prepareTrustedRepairFeedback(config:{
 gateway:TrustedApprovedExecutionPlans;
 intake:TrustedOperationalEpochIntake;
 sessionId:string;
 runtimeTestTaskId:string;
}):Promise<Readonly<TrustedRepairFeedbackSignal>>{
 if(!(config?.gateway instanceof TrustedApprovedExecutionPlans)||
    !(config.intake instanceof TrustedOperationalEpochIntake)||
    typeof config.sessionId!=="string"||!ID.test(config.sessionId)||
    typeof config.runtimeTestTaskId!=="string"||!ID.test(config.runtimeTestTaskId))
  deny("owner-private Gateway and Engineer-root-bound intake required");
 return prepareVerifiedRepairFeedback({
  intake:config.intake,sessionId:config.sessionId,
  runtimeTestTaskId:config.runtimeTestTaskId,
  readGatewayFailure:async()=>config.gateway.readVerifiedTestFailure(
   config.runtimeTestTaskId)
 });
}

/** R115 separate-process private Engineer owner. The HMAC Unix client returns
 * an independently Gateway-corroborated Docker FAIL (R114), and the ORIGINAL
 * owner intake independently re-reads Ed25519 approval, real Rust grants,
 * root credential ID, and every fsynced operational epoch. No supplied
 * A2A/model assertion, fresh permission or new child DC is accepted here.
 *
 * A failed/replayed IPC ACK, loss of root, changed epoch, unsigned plan or
 * revoked Engineer authority is a hard error; caller must closeExecution().
 * This is a read-only eligibility signal, NOT a recovery executor. */
export async function prepareTrustedRemoteRepairFeedback(config:{
 gateway:TrustedPlanIpcClient;
 intake:TrustedOperationalEpochIntake;
 coordinator:Pick<TrustedExecutionCoordinator,"phase"|"trustedOperationalAuthority">;
 sessionId:string;
 runtimeTestTaskId:string;
 /** Dispatcher-confirmed R122 read path; cannot finalize a raw claim. */
 alreadyFinalized?:boolean;
}):Promise<Readonly<TrustedRepairFeedbackSignal>>{
 if(!(config?.gateway instanceof TrustedPlanIpcClient)||
    !(config.intake instanceof TrustedOperationalEpochIntake)||
    !config.coordinator||
    typeof config.sessionId!=="string"||!ID.test(config.sessionId)||
    typeof config.runtimeTestTaskId!=="string"||!ID.test(config.runtimeTestTaskId))
  deny("authenticated private IPC and issued-root owner intake required");
 // The actual same-process Coordinator must be the one used to create the
 // original epoch intake. Never construct a second identity from receipt data.
 config.intake.assertSameCoordinator(config.coordinator);
 return prepareVerifiedRepairFeedback({
  intake:config.intake,sessionId:config.sessionId,
  runtimeTestTaskId:config.runtimeTestTaskId,
  readGatewayFailure:rootPlanDigest=>{
   const pins={session_id:config.sessionId,root_plan_digest:rootPlanDigest,
    runtime_task_id:config.runtimeTestTaskId};
   return config.alreadyFinalized===true
    ?config.gateway.readConfirmedTestFailure(pins)
    :config.gateway.confirmVerifiedTestFailure(pins);
  }
 });
}

/**
 * R151.23: source-FREE remote discovery preflight for the first bounded
 * Backend/Test repair. No discovery Task, Child DC or provider read is
 * created here. Gateway may create a fresh signed ORIGINAL-root VP solely
 * to verify native authority; this is not Task admission or executable scope.
 *
 * The trusted owner independently validates the exact read_file grant in
 * the actually issued Rust root; the live remote Gateway independently
 * validates a previously finalized Test FAIL and fresh original-root VP.
 */
export async function preflightTrustedRemoteRepairDiscovery(config:{
 gateway:TrustedPlanIpcClient;
 intake:TrustedOperationalEpochIntake;
 coordinator:Pick<TrustedExecutionCoordinator,"phase"|"trustedOperationalAuthority">;
 sessionId:string;runtimeTestTaskId:string;discoveryTaskId:string;resource:string;
}):Promise<Readonly<{
 status:"remote_repair_discovery_preflight_only";
 session_id:string;task_id:string;resource:string;failed_epoch:number;
 tested_commit_sha:string;root_plan_digest:string;
 permission_granted:false;child_credential_issued:false;
 source_read:false;execution_authorized:false;
}>>{
 if(!(config?.gateway instanceof TrustedPlanIpcClient)||
    !(config.intake instanceof TrustedOperationalEpochIntake)||
    !config.coordinator||
    !config.gateway.nativeRootVpInspectionConfigured())
  deny("remote discovery requires live Gateway root VP inspection and original owner");
 config.intake.assertSameCoordinator(config.coordinator);
 // R122 read-only: discovery cannot finalize a Runner failure itself.
 const input={
  gateway:config.gateway,intake:config.intake,
  coordinator:config.coordinator,sessionId:config.sessionId,
  runtimeTestTaskId:config.runtimeTestTaskId,alreadyFinalized:true
 };
 const before=await prepareTrustedRemoteRepairFeedback(input);
 if(before.status!=="repair_planning_eligible"||
    !isActionableRepairFailure(before.first_failed_phase,
      before.typecheck_error_codes,before.acceptance_failure))
  deny("only actionable verified Runner FAIL supports bounded Backend discovery");
 const discovery={
  sessionId:config.sessionId,taskId:config.discoveryTaskId,
  agentId:"backend" as const,resource:config.resource
 };
 const scoped=await config.intake.preflightRepairDiscovery(discovery);
 if(scoped.session_id!==before.session_id||
    scoped.root_plan_digest!==before.root_plan_digest||
    scoped.epoch!==before.failed_epoch||
    scoped.work_branch!==before.work_branch||
    scoped.operation!=="read_file"||
    scoped.execution_authorized!==false)
  deny("signed discovery read and failed Gateway epoch differ");
 // IPC transports only the signed root/session/epoch pins, never a
 // caller-supplied grant, credential ID, source body or VP bytes.
 const root=await config.gateway.inspectVerifiedRootVp({
  session_id:before.session_id,root_plan_digest:before.root_plan_digest,
  plan_digest:before.failed_plan_digest,epoch:before.failed_epoch
 });
 if(root.cryptographic_presentation_verified!==true||
    root.native_issued_grants_checked!==true||
    root.execution_authorized!==false||
    root.child_credential_issued!==false)
  deny("native root VP inspection is not non-authorizing");
 const after=await prepareTrustedRemoteRepairFeedback(input);
 const rescoped=await config.intake.preflightRepairDiscovery(discovery);
 if(after.status!==before.status||
    after.root_plan_digest!==before.root_plan_digest||
    after.failed_plan_digest!==before.failed_plan_digest||
    after.failed_epoch!==before.failed_epoch||
    after.failed_request_id!==before.failed_request_id||
    after.tested_commit_sha!==before.tested_commit_sha||
    after.work_branch!==before.work_branch||
    rescoped.root_credential_id!==scoped.root_credential_id||
    rescoped.epoch!==scoped.epoch||
    rescoped.root_plan_digest!==scoped.root_plan_digest||
    rescoped.resource!==scoped.resource)
  deny("Gateway failure, Rust root or signed discovery scope changed");
 return Object.freeze({
  status:"remote_repair_discovery_preflight_only" as const,
  session_id:before.session_id,task_id:scoped.task_id,
  resource:scoped.resource,failed_epoch:before.failed_epoch,
  tested_commit_sha:before.tested_commit_sha,
  root_plan_digest:before.root_plan_digest,
  permission_granted:false as const,child_credential_issued:false as const,
  source_read:false as const,execution_authorized:false as const
 });
}
