/**
 * R151.38 — owner-private handoff from the ALREADY issued Backend discovery
 * Child into the authenticated remote Gateway and one prebound A2A read.
 *
 * A2A completed text is NEVER evidence of a provider read. Only Gateway
 * Rust/OPA/provider recording followed by the independent Task attestor
 * can confirm this read. This class does not issue a Child, inspect source,
 * authorize a repair DAG or open a PR. No model or MCP caller owns it.
 */
import {randomBytes} from "node:crypto";
import {TaskState} from "@a2a-js/sdk";
import {canonicalFileUri} from "../../../apps/gateway/src/canonical.ts";
import {TrustedPlanIpcClient} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {TrustedOperationalEpochIntake} from "./trusted-operational-epoch-intake.ts";
import {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import {prepareTrustedRemoteRepairFeedback,
 preflightTrustedRemoteRepairDiscovery} from "./trusted-validation-repair-feedback.ts";
import {validateWorkflowArtifact} from "./artifact-validation.ts";
import {observedA2ACompletion} from "./trusted-a2a-observer.ts";
import {approvedWorkBranch} from "../../plan-contracts/src/approved-work-branch.mjs";
import type {IssuedDelegationCredential} from "./authority-client.ts";
import type {ProtectedA2AClientPort,DelegatedA2ARoleTaskResult} from
 "./a2a-workflow.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PATH=/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[^\0\r\n]{1,240}$/u;
const deny=(s:string):never=>{throw Error("Trusted remote discovery A2A NO-GO: "+s);};
type Pins=Readonly<{
 sessionId:string;discoveryTaskId:string;failedRuntimeTestTaskId:string;
 resource:string;path:string;backendAgentBaseUrl:string;
}>;
/**
 * Validate the remote Backend's ONLY accepted read artifact. This is
 * non-authorizing parsing: even a valid Task/Artifact cannot mark success
 * unless the Gateway later corroborates a real provider read.
 */
export function validateTrustedDiscoveryA2AArtifact(
 response:Awaited<ReturnType<ProtectedA2AClientPort["sendProtectedTask"]>>,
 pins:Readonly<{branch:string;tested_commit_sha:string}>
){
 if(!response||typeof response!=="object"||
    typeof response.card?.name!=="string"||
    !response.card.name.trim()||response.card.name.length>160||
    response.task?.status?.state!==TaskState.TASK_STATE_COMPLETED||
    typeof response.task.id!=="string"||!ID.test(response.task.id)||
    !Array.isArray(response.task.artifacts)||
    response.task.artifacts.length!==1)
  deny("remote Backend Task is not exactly completed");
 const artifactParts=response.task.artifacts[0]?.parts;
 // Reject unexpected text/multimedia parts: no source or VP material
 // belongs in a supposedly structured, source-free A2A receipt.
 if(!Array.isArray(artifactParts)||artifactParts.length!==1||
    artifactParts[0]?.content?.$case!=="data")
  deny("remote Backend must return only one structured artifact");
 const artifact=validateWorkflowArtifact(
  artifactParts[0].content.value,"backend",{expectedBranch:pins.branch}
 );
 if(!/^[a-f0-9]{40}$/u.test(pins.tested_commit_sha)||
    artifact.revision!==pins.tested_commit_sha||
    artifact.commit_sha!==pins.tested_commit_sha||
    artifact.test_outcome!=="not_run"||
    artifact.files_modified.length!==0||artifact.files_created.length!==0)
  deny("discovery A2A artifact is not a pure read of failed SHA");
 return Object.freeze(artifact);
}


/** No secrets or VP in the trusted Backend binding receipt. The caller must
 * provide an authenticated owner-only transport (e.g. Unix HMAC IPC).
 * Neither the A2A caller nor the model may invoke this port. */
export interface TrustedBackendDiscoveryTaskBindingPort {
 prepare(input:Readonly<{
  runtime_task_id:string;plan_task_id:string;credential_id:string;
  presenter_id:string;branch:string;path:string;resource:string;
  audience:"cloud-access-gateway";
 }>):Promise<Readonly<{
  status:"backend_discovery_read_prebound_not_executed";
  runtime_task_id:string;plan_task_id:string;credential_id:string;
  presenter_id:string;resource:string;
  execution_authorized:false;source_read:false;
 }>>;
 /** Called even for failed A2A and unknown network outcomes. */
 fence(runtimeTaskId:string):Promise<void>;
}
export function validateTrustedBackendDiscoveryBindAck(
 receipt:Awaited<ReturnType<TrustedBackendDiscoveryTaskBindingPort["prepare"]>>,
 pins:Readonly<{
  runtime_task_id:string;plan_task_id:string;credential_id:string;
  presenter_id:string;resource:string;
 }>
):void{
 if(!receipt||typeof receipt!=="object"||Array.isArray(receipt)||
    Object.keys(receipt).sort().join(",")!==
     "credential_id,execution_authorized,plan_task_id,presenter_id,resource,runtime_task_id,source_read,status"||
    receipt.status!=="backend_discovery_read_prebound_not_executed"||
    receipt.runtime_task_id!==pins.runtime_task_id||
    receipt.plan_task_id!==pins.plan_task_id||
    receipt.credential_id!==pins.credential_id||
    receipt.presenter_id!==pins.presenter_id||
    receipt.resource!==pins.resource||
    receipt.execution_authorized!==false||
    receipt.source_read!==false)
   deny("Backend read signer is not independently prebound to exact Gateway Task");
}

export class TrustedRemoteDiscoveryA2AHandoff {
 readonly #gateway:TrustedPlanIpcClient;
 readonly #intake:TrustedOperationalEpochIntake;
 readonly #coordinator:TrustedExecutionCoordinator;
 readonly #a2a:ProtectedA2AClientPort;
 readonly #backend:TrustedBackendDiscoveryTaskBindingPort;
 readonly #pins:Pins;
 #attempted=false;
 constructor(config:Readonly<{
  gateway:TrustedPlanIpcClient;intake:TrustedOperationalEpochIntake;
  coordinator:TrustedExecutionCoordinator;a2a:ProtectedA2AClientPort;
  backendTaskBinding:TrustedBackendDiscoveryTaskBindingPort;
 }&Pins>){
  if(!(config.gateway instanceof TrustedPlanIpcClient)||
     !(config.intake instanceof TrustedOperationalEpochIntake)||
     !(config.coordinator instanceof TrustedExecutionCoordinator)||
     typeof config.a2a?.sendProtectedTask!=="function"||
     typeof config.backendTaskBinding?.prepare!=="function"||
     typeof config.backendTaskBinding?.fence!=="function"||
     !ID.test(config.sessionId)||!ID.test(config.discoveryTaskId)||
     !ID.test(config.failedRuntimeTestTaskId)||
     !PATH.test(config.path)||config.path.includes("//")||
     typeof config.resource!=="string"||config.resource.length>2048)
   deny("one owner session, live Gateway, pinned read and A2A transport required");
  let url:URL;
  try{url=new URL(config.backendAgentBaseUrl);}catch{
   deny("invalid pinned Backend A2A endpoint");
  }
  if(!["http:","https:"].includes(url.protocol)||!url.hostname||
     url.username||url.password||url.hash||url.search||
     (url.pathname!=="/"&&url.pathname!==""))
   deny("pinned Backend A2A endpoint must be a root URL without credentials");
  config.coordinator.assertSameApprovedGatewayPlans(config.gateway);
  config.intake.assertSameCoordinator(config.coordinator);
  this.#gateway=config.gateway;this.#intake=config.intake;
  this.#coordinator=config.coordinator;this.#a2a=config.a2a;
  this.#backend=config.backendTaskBinding;
  this.#pins=Object.freeze({
   sessionId:config.sessionId,discoveryTaskId:config.discoveryTaskId,
   failedRuntimeTestTaskId:config.failedRuntimeTestTaskId,
   resource:config.resource,path:config.path,
   backendAgentBaseUrl:url.origin
  });
 }
 /**
  * Called ONCE by the trusted owner after a durably ACKnowledged native
  * issuance through TrustedApprovedPlanChildAuthorityIssuer.
  * Unknown A2A/IPC outcomes are never retried with this Child or Task.
  */
 async dispatchIssuedChild(issued:IssuedDelegationCredential){
  if(this.#attempted)deny("one-use discovery handoff already attempted");
  this.#attempted=true; // reserve before any async inspection or side effect
  const p=this.#pins;
  let runtimeId:string|undefined;
  try{
   if(this.#coordinator.phase!=="execution")
    deny("original Rust root is not active");
   const before=await prepareTrustedRemoteRepairFeedback({
    gateway:this.#gateway,intake:this.#intake,
    coordinator:this.#coordinator,
    sessionId:p.sessionId,runtimeTestTaskId:p.failedRuntimeTestTaskId,
    alreadyFinalized:true
   });
   const scoped=await preflightTrustedRemoteRepairDiscovery({
    gateway:this.#gateway,intake:this.#intake,
    coordinator:this.#coordinator,
    sessionId:p.sessionId,runtimeTestTaskId:p.failedRuntimeTestTaskId,
    discoveryTaskId:p.discoveryTaskId,resource:p.resource
   });
   if(before.status!=="repair_planning_eligible"||
      before.first_failed_phase!=="typecheck"||
      !before.typecheck_error_codes.length||
      scoped.status!=="remote_repair_discovery_preflight_only"||
      scoped.failed_epoch!==before.failed_epoch||
      scoped.root_plan_digest!==before.root_plan_digest||
      scoped.tested_commit_sha!==before.tested_commit_sha)
    deny("only unchanged, Gateway-attested Docker TypeScript FAIL may discover");
   const history=await this.#intake.verifiedEpochHistory();
   const latest=history.at(-1);
   if(!latest||latest.plan_digest!==before.failed_plan_digest||
      latest.plan.session_id!==p.sessionId||
      latest.plan.repository===undefined||
      approvedWorkBranch(latest.plan)!==before.work_branch||
      canonicalFileUri(latest.plan.repository,before.work_branch,p.path)!==p.resource)
    deny("source read differs from signed canonical Gitea branch");
   const childPins={
    session_id:p.sessionId,root_plan_digest:before.root_plan_digest,
    plan_digest:before.failed_plan_digest,epoch:before.failed_epoch,
    task_id:p.discoveryTaskId,resource:p.resource
   };
   // Independently verify the protected Gateway journal, not the Child JSON
   // supplied to this function; a forged Child has no authority.
   const candidate=await this.#gateway.inspectDiscoveryChildCandidate(childPins);
   if(candidate.status!=="discovery_child_candidate_verified_not_admitted"||
      candidate.agent_role!=="backend"||
      candidate.operation!=="read_file"||
      candidate.work_branch!==before.work_branch||
      candidate.adapter_response_acknowledged!==true||
      candidate.gateway_task_admitted!==false||
      candidate.execution_authorized!==false||
      !issued||issued.id!==candidate.credential_id||
      issued.credentialSubject?.sub!==candidate.agent_did||
      !Array.isArray(issued.credentialSubject.per)||
      issued.credentialSubject.per.length!==1||
      issued.credentialSubject.per[0]?.resource!==p.resource||
      issued.credentialSubject.per[0]?.operation!=="read_file")
    deny("issued Child differs from independently journalled exact Backend read");
   // Admission performs a FRESH native Child VP verification. It is still
   // not provider authority: Gateway binding, Prepare, Rust and OPA follow.
   const receipt=await this.#gateway.admitRemoteRepairDiscoveryTask({
    ...childPins,runtime_test_task_id:p.failedRuntimeTestTaskId
   });
   if(receipt.status!=="discovery_read_admitted_not_executed"||
      receipt.credential_id!==issued.id||receipt.resource!==p.resource||
      receipt.gateway_task_admitted!==true||
      receipt.execution_authorized!==false||receipt.source_read!==false)
    deny("discovery admission receipt cannot authorize a provider read");
   // Fresh non-caller-chosen Gateway identity. A lost bind/send ACK is a
   // terminal uncertainty; no automated redispatch or credential reissue.
   runtimeId="dispatch_"+randomBytes(16).toString("base64url");
   await this.#gateway.bindTask(
    p.sessionId,p.discoveryTaskId,runtimeId,"backend"
   );
   const renewed=await prepareTrustedRemoteRepairFeedback({
    gateway:this.#gateway,intake:this.#intake,
    coordinator:this.#coordinator,
    sessionId:p.sessionId,runtimeTestTaskId:p.failedRuntimeTestTaskId,
    alreadyFinalized:true
   });
   if(renewed.failed_request_id!==before.failed_request_id||
      renewed.tested_commit_sha!==before.tested_commit_sha||
      renewed.failed_plan_digest!==before.failed_plan_digest||
      this.#coordinator.phase!=="execution")
    deny("root, failed Runner, or epoch changed before A2A dispatch");
   // R151.39: before the A2A message, the owner-only Backend service
   // must bind its PRIVATE Rust signer to this newly allocated runtime ID.
   // A bare credential in A2A JSON MUST NOT select the signing holder.
   const taskPins={
    runtime_task_id:runtimeId,plan_task_id:p.discoveryTaskId,
    credential_id:issued.id,presenter_id:candidate.agent_did,
    branch:before.work_branch,path:p.path,resource:p.resource,
    audience:"cloud-access-gateway" as const
   };
   const bound=await this.#backend.prepare(taskPins);
   validateTrustedBackendDiscoveryBindAck(bound,taskPins);
   const evidence={
    credential:JSON.stringify(issued),credential_id:issued.id,
    presenter_id:candidate.agent_did
   };
   const response=await this.#a2a.sendProtectedTask({
    agent_base_url:p.backendAgentBaseUrl,
    trusted_gateway_task_id:runtimeId,
    delegation_evidence:evidence,
    subtask:{
     subtask_id:p.discoveryTaskId,
     instruction:"Read the single approved source file and report only verified read evidence.",
     branch:before.work_branch,relevant_paths:[p.path],
     approved_file_permissions:[{path:p.path,operation:"read_file"}],
     approved_run_tests:false
    }
   });
   const artifact=validateTrustedDiscoveryA2AArtifact(response,{
    branch:before.work_branch,tested_commit_sha:before.tested_commit_sha
   });
   const checked=await prepareTrustedRemoteRepairFeedback({
    gateway:this.#gateway,intake:this.#intake,
    coordinator:this.#coordinator,
    sessionId:p.sessionId,runtimeTestTaskId:p.failedRuntimeTestTaskId,
    alreadyFinalized:true
   });
   if(checked.failed_request_id!==before.failed_request_id||
      checked.failed_plan_digest!==before.failed_plan_digest||
      checked.tested_commit_sha!==before.tested_commit_sha||
      this.#coordinator.phase!=="execution")
    deny("root or original Test failure changed during A2A source read");
   const observed:DelegatedA2ARoleTaskResult={
    role:"backend",credential:issued,delegation_evidence:evidence,
    remote_agent_name:response.card.name,
    task_id:response.task.id,artifact
   };
   // ONLY Gateway's real successful provider effects can make this succeed.
   await this.#gateway.confirmTaskCompletion(
    runtimeId,observedA2ACompletion(observed,runtimeId)
   );
   // R151.43: independently query the Gateway provider ledger, not A2A.
   const providerRead=await this.#gateway.readConfirmedRemoteDiscoveryEffect({
    ...childPins,runtime_task_id:runtimeId,
    runtime_test_task_id:p.failedRuntimeTestTaskId,
    tested_commit_sha:before.tested_commit_sha
   });
   if(providerRead.credential_id!==issued.id||
      providerRead.branch!==before.work_branch||
      providerRead.revision!==before.tested_commit_sha||
      providerRead.gateway_provider_corroborated!==true||
      providerRead.source_disclosed!==false||
      providerRead.repair_dag_authorized!==false||
      providerRead.pr_authorized!==false)
    deny("Gateway provider ledger did not attest exact signed Child discovery read");
   // Fail closed on an uncertain Backend holder retirement even if the
   // authenticated Gateway has already confirmed the source read.
   await this.#backend.fence(runtimeId);
   return Object.freeze({
    status:"remote_discovery_gateway_provider_confirmed" as const,
    session_id:p.sessionId,task_id:p.discoveryTaskId,
    runtime_task_id:runtimeId,credential_id:issued.id,
    branch:before.work_branch,resource:p.resource,
    verified_revision:before.tested_commit_sha,
    gateway_provider_corroborated:true as const,
    repair_dag_authorized:false as const,
    pr_authorized:false as const
   });
  }catch{
   // A bind/send/cleanup uncertainty cannot be retried or promoted.
   if(runtimeId){
    try{await this.#backend.fence(runtimeId);}
    catch{/* Owner root closure below remains mandatory. */}
   }
   // A2A/IPC uncertainty cannot be resubmitted or promoted to a new epoch.
   // Fail closed on the ORIGINAL owner root even when remote cleanup fails.
   try{await this.#coordinator.closeExecution();}
   catch{
    throw Error("Trusted remote discovery A2A NO-GO: shutdown/revocation reconciliation required");
   }
   deny("discovery dispatch or corroborated Gateway completion failed");
  }
 }
}
