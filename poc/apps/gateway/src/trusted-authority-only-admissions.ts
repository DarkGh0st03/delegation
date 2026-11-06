import {giteaPermissionCovers}
 from "../../../packages/plan-contracts/src/gitea-permission-containment.mjs";
/**
 * R287 — opt-in, in-process Gateway admission of permission-only Engineer
 * authority and trusted dynamic Coordinator Task bindings.
 *
 * IMPORTANT: this is a fail-closed staging registry. Its receipts do NOT
 * authorize prepare, execute, provider I/O, issuance, A2A, PR or merge.
 * The existing signed-DAG Gateway runtime remains the only operational
 * provider path until independently verified native VP, OPA, task completion
 * and Rust child-credential enforcement are connected to this registry.
 *
 * No model, public Gateway HTTP, MCP, A2A or untrusted serialized Task object
 * may invoke its methods; an owner-only host passes concrete trusted objects.
 */
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {RUST_OPERATIONS} from "./operation-catalog.ts";
import {TOOL_NAMES,type AgentRole,type PrepareAuthorizationRequest,
 type GatewayRepositoryConfig,type Permission,type PreparedRequestRecord,
 type VerifiedDelegation} from "./types.ts";
import {AuthenticatedRunnerCompletionObserver}
 from "./trusted-authority-only-runner-evidence.ts";
import {deriveRequiredPermission} from "./canonical.ts";
import {assertOriginalIncompleteTestFlight}
 from "./trusted-authority-only-failed-test-flight.ts";
import {validatePrepareAuthorizationRequest} from "./validation.ts";
import {TrustedOperationalSessionStore} from "./trusted-operational-session-store.ts";
import {SignedAuthorityOnlyFileStore} from
 "../../../packages/orchestrator-runtime/src/signed-authority-only-store.ts";
import {TrustedAuthorityOnlyExecutionCoordinator,type RegisteredAuthorityOnlyTask}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-execution-coordinator.ts";
import {DurableAuthorityTaskJournal}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-task-journal.ts";
import {DurableAuthorityOnlyChildJournal}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-child-journal.ts";
import {DurableAuthorityOnlyTaskFenceJournal,
 type TrustedTaskFlight}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-task-fence-journal.ts";
import {DurableAuthorityOnlySequentialEffectJournal,
 type TrustedSequentialManifest,type TrustedSequentialFlight}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-sequential-effect-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver,
 type TrustedCompletionExpectation,
 type ObservedTrustedTaskCompletion}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";
import {TrustedAuthorityOnlyChildIssuer,type VerifiedStagedChild}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-child-issuer.ts";
import {assertVerifiedAuthorityOnlyGrant}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA40=/^[a-f0-9]{40}$/u;
const SHA64=/^[a-f0-9]{64}$/u;
const OPERATIONS=new Set<string>(RUST_OPERATIONS);
const IMPLEMENTED=new Set<string>(TOOL_NAMES);
function deny(reason:string):never {
 throw Error("Authority-only Gateway admission: "+reason);
}
const pair=(p:Permission)=>JSON.stringify([p.resource,p.operation]);
type Phase="inactive"|"activating"|"active"|"failed_closed";
interface BoundTask {
 readonly row:RegisteredAuthorityOnlyTask;
 readonly runtime_task_id:string;
}
interface SequentialTaskProgress {
 readonly manifest:TrustedSequentialManifest;
 completed:number;
 latest_evidence_sha256:string|null;
 active?:TrustedSequentialFlight;
}
function assertObservedCompletion(
 expected:TrustedCompletionExpectation,observed:unknown,nowMs:number
):asserts observed is ObservedTrustedTaskCompletion{
 if(!observed||typeof observed!=="object"||
    (observed as ObservedTrustedTaskCompletion).status!=="owner_verified_provider_result"||
    !Object.keys(expected).every(key=>
     (observed as Record<string,unknown>)[key]===
     (expected as unknown as Record<string,unknown>)[key])||
    Object.keys(observed).sort().join(",")!==[
     ...Object.keys(expected),"status","evidence_sha256",
     "completed_at_ms"].sort().join(",")||
    !SHA64.test((observed as ObservedTrustedTaskCompletion).evidence_sha256)||
    !Number.isSafeInteger((observed as ObservedTrustedTaskCompletion).completed_at_ms)||
    (observed as ObservedTrustedTaskCompletion).completed_at_ms>nowMs+60_000||
    (observed as ObservedTrustedTaskCompletion).completed_at_ms<nowMs-30*60_000)
  deny("independent completion evidence does not match protected Task flight");
}
export class TrustedAuthorityOnlyGatewayAdmissions {
 readonly #repository:GatewayRepositoryConfig;
 readonly #engineerDid:string;
 readonly #coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 readonly #store:SignedAuthorityOnlyFileStore;
 readonly #activationStore:TrustedOperationalSessionStore;
 readonly #taskJournal:DurableAuthorityTaskJournal;
 readonly #childJournal?:DurableAuthorityOnlyChildJournal;
 readonly #effectFenceJournal?:DurableAuthorityOnlyTaskFenceJournal;
 readonly #sequentialEffectJournal?:DurableAuthorityOnlySequentialEffectJournal;
 readonly #completionObserver?:TrustedAuthorityOnlyCompletionObserver;
 readonly #nowMs:()=>number;
 #phase:Phase="inactive";
 #session?:string;
 #digest?:string;
 #branch?:string;
 #expiry?:number;
 #rootCredentialId?:string;
 #rootExpires?:number;
 #rootPermissions?:readonly Permission[];
 #authorizedPermissions?:readonly Permission[];
 #epoch=0;
 readonly #tasks=new Map<string,BoundTask>();
 readonly #taskIds=new Set<string>();
 readonly #enrolledChildren=new Map<string,VerifiedStagedChild>();
 readonly #flights=new Map<string,TrustedTaskFlight>();
 readonly #sequential=new Map<string,SequentialTaskProgress>();
 readonly #completed=new Set<string>();
 readonly #completionEvidence=new Map<string,string>();
 readonly #branchPins=new Map<string,Readonly<{
  task_id:string;epoch:number;credential_id:string;base_revision:string;
 }>>();
 readonly #prPins=new Map<string,Readonly<{
  task_id:string;epoch:number;credential_id:string;
  source:TrustedCompletionExpectation;tested_commit_sha:string;
  runner_evidence_sha256:string;
 }>>();
 #bindingInFlight=false;
 #enrollmentInFlight=false;
 #flightInFlight=false;
 #completionInFlight=false;

 constructor(opts:{
  repository:GatewayRepositoryConfig;
  engineerDid:string;
  coordinator:TrustedAuthorityOnlyExecutionCoordinator;
  approvals:SignedAuthorityOnlyFileStore;
  operationalSessionStore:TrustedOperationalSessionStore;
  taskJournal:DurableAuthorityTaskJournal;
  childJournal?:DurableAuthorityOnlyChildJournal;
  effectFenceJournal?:DurableAuthorityOnlyTaskFenceJournal;
  sequentialEffectJournal?:DurableAuthorityOnlySequentialEffectJournal;
  completionObserver?:TrustedAuthorityOnlyCompletionObserver;
  nowMs?:()=>number;
 }){
  if(!opts||
     !(opts.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
     !(opts.approvals instanceof SignedAuthorityOnlyFileStore)||
     !(opts.operationalSessionStore instanceof TrustedOperationalSessionStore)||
     !(opts.taskJournal instanceof DurableAuthorityTaskJournal)||
     typeof opts.engineerDid!=="string"||
     !opts.engineerDid.startsWith("did:")||
     !opts.repository||!["authority","owner","repository"].every(k=>
       typeof opts.repository[k as keyof GatewayRepositoryConfig]==="string"&&
       !!opts.repository[k as keyof GatewayRepositoryConfig].trim()))
   deny("trusted Gateway admission dependencies missing");
  this.#repository=structuredClone(opts.repository);
  this.#engineerDid=opts.engineerDid;
  this.#coordinator=opts.coordinator;
  this.#store=opts.approvals;
  this.#activationStore=opts.operationalSessionStore;
  this.#taskJournal=opts.taskJournal;
  if(opts.childJournal!==undefined&&
     !(opts.childJournal instanceof DurableAuthorityOnlyChildJournal))
   deny("trusted native Child enrollment journal missing");
  this.#childJournal=opts.childJournal;
  if(opts.effectFenceJournal!==undefined&&
     !(opts.effectFenceJournal instanceof DurableAuthorityOnlyTaskFenceJournal))
   deny("independent owner-private effect flight journal required");
  if(opts.completionObserver!==undefined&&
     !(opts.completionObserver instanceof TrustedAuthorityOnlyCompletionObserver))
   deny("owner-controlled completion verification reader required");
  this.#effectFenceJournal=opts.effectFenceJournal;
  if(opts.sequentialEffectJournal!==undefined&&
     !(opts.sequentialEffectJournal instanceof DurableAuthorityOnlySequentialEffectJournal))
   deny("independent owner-private sequential effect journal required");
  this.#sequentialEffectJournal=opts.sequentialEffectJournal;
  this.#completionObserver=opts.completionObserver;
  this.#nowMs=opts.nowMs??Date.now;
 }
 get phase():Phase{return this.#phase;}
 get registeredTaskCount():number{return this.#tasks.size;}
 get stagedCompletedTaskCount():number{return this.#completed.size;}
 get stagedSequentialTaskCount():number{return this.#sequential.size;}

 /**
  * R323 — private owner-only, read-only proof that a registered Task and
  * native-issued Child were enrolled under THIS live Gateway/Coordinator.
  * This is NOT permission to stage, issue or execute an effect. Neither the
  * A2A transport nor an ADK model can invoke this method via public routes.
  */
 assertTrustedOwnerRemoteEffectBinding(taskId:string,runtimeTaskId:string):
 Readonly<{
  status:"gateway_owner_child_task_preflight_only";
  task_id:string;runtime_task_id:string;agent_id:string;
  agent_did:string;credential_id:string;authority_digest:string;
  gateway_execution_authorized:false
 }>{
  const root=this.#live();
  if(this.#bindingInFlight||this.#enrollmentInFlight||
     this.#flightInFlight||this.#completionInFlight||
     typeof taskId!=="string"||!ID.test(taskId)||
     typeof runtimeTaskId!=="string"||!ID.test(runtimeTaskId))
   deny("remote owner Task proof requires quiescent active Gateway");
  const bound=this.#tasks.get(runtimeTaskId);
  const child=this.#enrolledChildren.get(runtimeTaskId);
  if(!bound||!child||bound.row.task_id!==taskId||
     bound.row.session_id!==root.session_id||
     bound.row.authority_digest!==root.authority_digest||
     bound.row.root_credential_id!==root.root_credential_id||
     bound.row.agent_did!==child.agent_did||
     bound.row.agent_id!==child.agent_id||
     bound.row.epoch!==child.epoch||
     child.status!=="native_child_response_verified_staged"||
     child.credential_id===root.root_credential_id||
     child.root_credential_id!==root.root_credential_id||
     child.authority_digest!==root.authority_digest||
     child.session_id!==root.session_id||
     this.#now()>=Date.parse(child.expires_at)||
     this.#flights.has(taskId)||this.#sequential.has(taskId)||
     this.#completed.has(taskId)||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep)))
   deny("remote owner Task/Child not enrolled, expired or not ready");
  return Object.freeze({
   status:"gateway_owner_child_task_preflight_only",
   task_id:taskId,runtime_task_id:runtimeTaskId,
   agent_id:bound.row.agent_id,agent_did:bound.row.agent_did,
   credential_id:child.credential_id,
   authority_digest:root.authority_digest,
   gateway_execution_authorized:false
  });
 }

 /**
  * R340: owner-private post-POST flight projection for independent FAIL
  * corroboration. Cannot be called through ADK, A2A, MCP or HTTP.
  */
 assertTrustedFailedRunnerFlight(taskId:string,runtimeTaskId:string){
  const root=this.#live();
  if(this.#bindingInFlight||this.#enrollmentInFlight||
     this.#flightInFlight||this.#completionInFlight)
   deny("original Test flight inspection during concurrent owner transition");
  const bound=this.#tasks.get(runtimeTaskId);
  const child=this.#enrolledChildren.get(runtimeTaskId);
  const flight=this.#flights.get(taskId);
  if(!bound||!child||!flight||this.#sequential.has(taskId))
   deny("no original durable native Test flight to inspect");
  return assertOriginalIncompleteTestFlight({
   root,row:bound.row,child,flight,taskId,runtimeTaskId,
   approved:this.#authorizedPermissions!,
   completed:this.#completed.has(taskId),
   predecessorsComplete:bound.row.depends_on.every(
    predecessor=>this.#completed.has(predecessor)),
   nowMs:this.#now()
  });
 }

 #now():number{
  const now=this.#nowMs();
  if(!Number.isSafeInteger(now)||now<0)deny("trusted Gateway clock invalid");
  return now;
 }
 #live(){
  if(this.#phase!=="active"||!this.#session||!this.#digest||
     !this.#branch||!this.#rootCredentialId||
     !this.#rootPermissions||!this.#authorizedPermissions||
     !this.#expiry||!this.#rootExpires)
   deny("no active trusted authority-only Gateway session");
  const now=this.#now();
  if(now>=this.#expiry||now>=this.#rootExpires){
   this.#phase="failed_closed";
   deny("signed authority or operational root expired");
  }
  // A previous local admission may not outlive Coordinator ownership.
  const root=this.#coordinator.assertTrustedGatewayAuthorityBinding();
  if(root.session_id!==this.#session||
     root.authority_digest!==this.#digest||
     root.root_credential_id!==this.#rootCredentialId||
     root.root_expires_at!==new Date(this.#rootExpires).toISOString()||
     !isDeepStrictEqual(root.root_permissions,this.#rootPermissions))
   deny("operational Engineer root changed");
  return root;
 }
 /**
  * Unlike the legacy signed-plan activation, this requires an already
  * issued, acknowledged Engineer Rust root AND a fresh signed grant,
  * independently verified by the Gateway's own trusted receipt reader.
  */
 async activate(sessionId:string,pinnedGitSha:string):Promise<Readonly<{
  status:"gateway_authority_admitted_preflight_only";
  session_id:string;authority_digest:string;
  gateway_execution_authorized:false
 }>>{
  if(this.#phase!=="inactive")deny("Gateway activation already attempted");
  this.#phase="activating";
  try{
   if(typeof sessionId!=="string"||!ID.test(sessionId)||
      typeof pinnedGitSha!=="string"||!SHA40.test(pinnedGitSha))
    deny("trusted activation must pin session and real Gitea revision");
   const root=this.#coordinator.assertTrustedGatewayAuthorityBinding();
   if(root.session_id!==sessionId||
      root.base_revision!==pinnedGitSha||
      root.engineer_did!==this.#engineerDid||
      !isDeepStrictEqual(root.repository,this.#repository))
    deny("Coordinator root belongs to different trusted session");
   // Durable before any async approval lookup. An ambiguous activation
   // cannot resurrect an earlier root or session after restart.
   await this.#activationStore.reserveActivation(sessionId);
   const signed=await this.#store.loadAuthenticatedAuthority(sessionId);
   const proof=assertVerifiedAuthorityOnlyGrant(signed,{
    allowedOperations:OPERATIONS,nowMs:this.#now()
   });
   const grant=proof.authorization;
   if(proof.authenticated_engineer_did!==this.#engineerDid||
      proof.authority_digest!==root.authority_digest||
      grant.session_id!==sessionId||
      grant.base_revision!==pinnedGitSha||
      !isDeepStrictEqual(grant.repository,this.#repository)||
      grant.branch!==root.branch||
      grant.requirement_sha256!==root.requirement_sha256||
      !SHA64.test(grant.requirement_sha256)||
      !isDeepStrictEqual(grant.permissions,root.root_permissions))
    deny("Gateway grant differs from issued Engineer root");
   const expiresAt=Date.parse(proof.expires_at);
   const rootExpires=Date.parse(root.root_expires_at);
   if(this.#now()>=expiresAt||this.#now()>=rootExpires||
      rootExpires>expiresAt)
    deny("signed grant or native root expired during activation");
   this.#session=sessionId;
   this.#digest=proof.authority_digest;
   this.#branch=grant.branch;
   this.#expiry=expiresAt;
   this.#rootExpires=rootExpires;
   this.#rootCredentialId=root.root_credential_id;
   this.#rootPermissions=structuredClone(root.root_permissions);
   this.#authorizedPermissions=structuredClone(grant.permissions);
   this.#phase="active";
   return Object.freeze({status:"gateway_authority_admitted_preflight_only",
    session_id:sessionId,authority_digest:proof.authority_digest,
    gateway_execution_authorized:false});
  }catch(error){this.#phase="failed_closed";throw error;}
 }
 /**
  * The Gateway obtains a previously journalled Task from the Coordinator
  * instance, NEVER from raw model/A2A supplied signed-plan-like JSON.
  * Distinct durable Gateway journal is needed, separate from Coordinator's.
  */
 async bindTrustedTask(taskId:string,runtimeTaskId:string,role:AgentRole):Promise<
  Readonly<{status:"gateway_task_bound_preflight_only";task_id:string;
   runtime_task_id:string;authority_digest:string;gateway_execution_authorized:false}>>{
  const root=this.#live();
  if(this.#bindingInFlight)deny("concurrent Gateway Task binding");
  if(typeof taskId!=="string"||!ID.test(taskId)||
     typeof runtimeTaskId!=="string"||!ID.test(runtimeTaskId)||
     this.#tasks.has(runtimeTaskId)||this.#taskIds.has(taskId))
   deny("replayed or invalid Gateway runtime Task");
  const row=this.#coordinator.assertTrustedGatewayRegisteredTask(taskId);
  if(row.status!=="task_registered_preflight_only"||
     row.execution_authorized!==false||
     row.gateway_registered!==false||
     row.child_credential_issued!==false||
     row.session_id!==this.#session||
     row.authority_digest!==this.#digest||
     row.root_credential_id!==root.root_credential_id||
     row.agent_id!==role||
     row.epoch!==this.#epoch+1||
     row.epoch>256||
     row.agent_did.length>256||
     !row.agent_did.startsWith("did:")||
     typeof row.card_ref!=="string"||
     !row.card_ref.startsWith("trusted:"))
   deny("Task differs from registered trusted Coordinator state");
  if(!Array.isArray(row.depends_on)||
     row.depends_on.some(id=>!this.#taskIds.has(id)))
   deny("Task depends on unregistered Gateway Task");
  const scoped=this.#authorizedPermissions!;
  const actual=root.root_permissions;
  if(!Array.isArray(row.permissions)||row.permissions.length<1||
     row.permissions.length>128||
     row.permissions.some(p=>!IMPLEMENTED.has(p.operation)||
       !scoped.some(grant=>giteaPermissionCovers(grant,p))||
       !actual.some(grant=>giteaPermissionCovers(grant,p))))
   deny("Task grant exceeds signed Engineer authority");
  const bound:BoundTask={row:structuredClone(row),runtime_task_id:runtimeTaskId};
  this.#bindingInFlight=true;
  try{
   const digest=createHash("sha256").update(JSON.stringify(bound)).digest("hex");
   await this.#taskJournal.reserveTask(this.#session!,row.epoch,
     row.task_id,digest);
   this.#live();
   this.#tasks.set(runtimeTaskId,bound);
   this.#taskIds.add(row.task_id);
   this.#epoch=row.epoch;
   return Object.freeze({status:"gateway_task_bound_preflight_only",
    task_id:row.task_id,runtime_task_id:runtimeTaskId,
    authority_digest:this.#digest!,
    gateway_execution_authorized:false});
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#bindingInFlight=false;}
 }
 /**
  * R291: Gateway independently enrolls a Child previously returned by native
  * Rust to THIS Coordinator and ONE already-admitted runtime Task.
  * Never accepts a serialized Child receipt, model-supplied credential ID
  * or agent DID. A separate crash-durable Gateway ledger is mandatory.
  * Enrollment is evidence, NOT provider authorization.
  */
 async enrollTrustedIssuedChild(
  taskId:string,runtimeTaskId:string,issuer:TrustedAuthorityOnlyChildIssuer
 ):Promise<Readonly<{
  status:"gateway_child_enrolled_preflight_only";
  task_id:string;runtime_task_id:string;credential_id:string;
  gateway_execution_authorized:false
 }>>{
  const root=this.#live();
  if(!(this.#childJournal instanceof DurableAuthorityOnlyChildJournal)||
     !(issuer instanceof TrustedAuthorityOnlyChildIssuer))
   deny("trusted Child issuer or independent Gateway child journal missing");
  if(this.#enrollmentInFlight||this.#enrolledChildren.has(runtimeTaskId))
   deny("concurrent or repeated Child enrollment");
  const bound=this.#tasks.get(runtimeTaskId);
  if(!bound||bound.row.task_id!==taskId)
   deny("Child not bound to admitted runtime Task");
  const child=issuer.assertTrustedIssuedChild(taskId,this.#coordinator);
  if(child.status!=="native_child_response_verified_staged"||
     child.gateway_execution_authorized!==false||
     child.session_id!==root.session_id||
     child.authority_digest!==root.authority_digest||
     child.root_credential_id!==root.root_credential_id||
     child.epoch!==bound.row.epoch||
     child.agent_id!==bound.row.agent_id||
     child.agent_did!==bound.row.agent_did||
     !isDeepStrictEqual(child.permissions,bound.row.permissions)||
     this.#now()>=Date.parse(child.expires_at))
   deny("native Child does not match admitted Gateway Task");
  this.#enrollmentInFlight=true;
  try{
   await this.#childJournal.reserveChild({
    session_id:child.session_id,epoch:child.epoch,task_id:child.task_id,
    credential_id:child.credential_id,
    parent_credential_id:child.root_credential_id,
    authority_digest:child.authority_digest,
    permissions_sha256:createHash("sha256")
     .update(JSON.stringify(child.permissions)).digest("hex"),
    status_list_credential:child.status_list_credential,
    status_list_index:child.status_list_index
   });
   this.#live();
   if(this.#now()>=Date.parse(child.expires_at))
    deny("native Child expired during durable Gateway enrollment");
   this.#enrolledChildren.set(runtimeTaskId,structuredClone(child));
   return Object.freeze({
    status:"gateway_child_enrolled_preflight_only",
    task_id:taskId,runtime_task_id:runtimeTaskId,
    credential_id:child.credential_id,gateway_execution_authorized:false
   });
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#enrollmentInFlight=false;}
 }
 /**
  * R293: reserve exactly ONE Task flight in an independent durable journal.
  * The caller supplies a previously protected local Gateway Prepare record,
  * never permissions or a provider result. This is a staged fence, NOT a
  * replacement for native VP / OPA / provider execution validation.
  */
 async stageTrustedTaskFlight(record:PreparedRequestRecord):Promise<Readonly<{
  status:"task_flight_reserved_no_provider_execution";
  task_id:string;runtime_task_id:string;
  gateway_execution_authorized:false
 }>>{
  const root=this.#live();
  if(!(this.#effectFenceJournal instanceof DurableAuthorityOnlyTaskFenceJournal))
   deny("owner-private Task flight journal missing");
  if(this.#flightInFlight)deny("concurrent Task flight admission denied");
  if(!record||typeof record!=="object"||record.consumed!==false)
   deny("untrusted or already consumed Gateway Prepare binding");
  const bound=this.#tasks.get(record.task_id);
  const child=this.#enrolledChildren.get(record.task_id);
  if(!bound||!child||this.#sequential.has(bound.row.task_id)||
     this.#flights.has(bound.row.task_id)||
     this.#completed.has(bound.row.task_id)||
     bound.row.task_id!==record.authority_only_plan_task_id||
     bound.row.agent_id!==record.agent_role||
     bound.row.agent_did!==record.authority_only_agent_did||
     record.authority_only_digest!==root.authority_digest||
     child.credential_id===root.root_credential_id||
     child.epoch!==bound.row.epoch||
     child.agent_did!==bound.row.agent_did||
     child.authority_digest!==root.authority_digest||
     child.root_credential_id!==root.root_credential_id||
     this.#now()>=Date.parse(child.expires_at))
   deny("Task flight lacks exact native Child and prepared authority binding");
  const allowed=this.preflightCanonicalRequest({
   task_id:record.task_id,agent_role:record.agent_role,
   tool:record.request.tool,arguments:record.request.arguments
  });
  if(pair(allowed.required_permission)!==pair(record.required_permission))
   deny("Task flight request differs from canonical signed grant");
  const flight:TrustedTaskFlight=Object.freeze({
   session_id:root.session_id,authority_digest:root.authority_digest,
   root_credential_id:root.root_credential_id,
   task_id:bound.row.task_id,runtime_task_id:record.task_id,
   epoch:bound.row.epoch,credential_id:child.credential_id,
   request_id:record.request_id,request_fingerprint:record.request_fingerprint
  });
  this.#flightInFlight=true;
  try{
   await this.#effectFenceJournal.reserveFlight(flight);
   this.#live();
   if(this.#now()>=Date.parse(child.expires_at))
    deny("native Child expired during durable Task effect reservation");
   this.#flights.set(bound.row.task_id,flight);
   return Object.freeze({
    status:"task_flight_reserved_no_provider_execution",
    task_id:bound.row.task_id,runtime_task_id:record.task_id,
    gateway_execution_authorized:false
   });
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#flightInFlight=false;}
 }
 /** Original Orchestrator PR uses its operational root, never a Child. */
 async stageTrustedRootPullRequestFlight(record:PreparedRequestRecord){
  const root=this.#live();
  const pin=this.assertTrustedPullRequestIntentBinding(record);
  const bound=this.#tasks.get(record.task_id)!;
  if(!(this.#effectFenceJournal instanceof DurableAuthorityOnlyTaskFenceJournal)||
     this.#flightInFlight||this.#completionInFlight||
     this.#flights.has(pin.task_id)||this.#sequential.has(pin.task_id))
   deny("root PR requires original durable one-flight reservation");
  const flight:TrustedTaskFlight=Object.freeze({
   session_id:root.session_id,authority_digest:root.authority_digest,
   root_credential_id:root.root_credential_id,credential_id:root.root_credential_id,
   task_id:pin.task_id,runtime_task_id:record.task_id,epoch:bound.row.epoch,
   request_id:record.request_id,request_fingerprint:record.request_fingerprint
  });
  this.#flightInFlight=true;
  try{
   await this.#effectFenceJournal.reserveRootPullRequestFlight(flight);
   this.#assertPullRequestPin(record.task_id);
   this.#flights.set(pin.task_id,flight);
   return Object.freeze({status:"task_flight_reserved_no_provider_execution",
    task_id:pin.task_id,runtime_task_id:record.task_id,
    gateway_execution_authorized:false});
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#flightInFlight=false;}
 }
 async stageTrustedRootBranchFlight(record:PreparedRequestRecord){
  const root=this.#live();
  const pin=this.assertTrustedBranchIntentBinding(record);
  const bound=this.#tasks.get(record.task_id)!;
  if(!(this.#effectFenceJournal instanceof DurableAuthorityOnlyTaskFenceJournal)||
     this.#flightInFlight||this.#completionInFlight||
     this.#flights.has(pin.task_id)||this.#sequential.has(pin.task_id))
   deny("root branch requires original durable one-flight reservation");
  const flight:TrustedTaskFlight=Object.freeze({
   session_id:root.session_id,authority_digest:root.authority_digest,
   root_credential_id:root.root_credential_id,credential_id:root.root_credential_id,
   task_id:pin.task_id,runtime_task_id:record.task_id,epoch:bound.row.epoch,
   request_id:record.request_id,request_fingerprint:record.request_fingerprint
  });
  this.#flightInFlight=true;
  try{
   await this.#effectFenceJournal.reserveRootBranchFlight(flight);
   this.#assertBranchPin(record.task_id);
   this.#flights.set(pin.task_id,flight);
   return Object.freeze({status:"task_flight_reserved_no_provider_execution",
    task_id:pin.task_id,runtime_task_id:record.task_id,
    gateway_execution_authorized:false});
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#flightInFlight=false;}
 }
 /**
  * R295 owner-only provenance projection. Not an execution permission.
  * Called exclusively AFTER a real Gateway verifier+OPA decision and a
  * genuine GiteaExecutor success. The latter is separately WeakMap-branded.
  * Requires R293's durable one-flight reservation and exact enrolled Child.
  */
 assertTrustedCompletedReadEvidenceBinding(
  record:PreparedRequestRecord,verified:VerifiedDelegation
 ):Readonly<TrustedCompletionExpectation>{
  const root=this.#live();
  if(!record||record.consumed!==true||
     !record.authority_only_digest||record.authority_only_digest!==this.#digest||
     record.request.tool!=="read_file"||
     record.expires_at_ms<=this.#now())
   deny("successful read lacks live, consumed authority-only Prepare");
  const bound=this.#tasks.get(record.task_id);
  const child=this.#enrolledChildren.get(record.task_id);
  if(!bound||!child||!verified||typeof verified!=="object"||
     !Array.isArray(verified.permissions)||
     record.authority_only_plan_task_id!==bound.row.task_id||
     record.authority_only_agent_did!==bound.row.agent_did||
     record.agent_role!==bound.row.agent_id||
     child.credential_id!==verified.credential_id||
     child.agent_did!==verified.presenter_id||
     verified.presenter_id!==bound.row.agent_did||
     verified.root_credential_id!==root.root_credential_id||
     !Number.isSafeInteger(verified.hierarchy_depth)||
     verified.hierarchy_depth<1||
     child.root_credential_id!==root.root_credential_id||
     child.authority_digest!==root.authority_digest||
     child.epoch!==bound.row.epoch||
     this.#now()>=Date.parse(child.expires_at))
   deny("completed read lacks native-rooted enrolled Task Child");
  const flight=this.#flights.get(bound.row.task_id);
  if(!flight||this.#completed.has(bound.row.task_id)||
     flight.request_id!==record.request_id||
     flight.request_fingerprint!==record.request_fingerprint||
     flight.runtime_task_id!==record.task_id||
     flight.credential_id!==child.credential_id||
     flight.root_credential_id!==root.root_credential_id||
     flight.authority_digest!==root.authority_digest||
     flight.epoch!==bound.row.epoch)
   deny("completed read has no matching durable trusted flight");
  const normalized=this.preflightCanonicalRequest({
   task_id:record.task_id,agent_role:record.agent_role,
   tool:record.request.tool,arguments:record.request.arguments
  });
  const digest=createHash("sha256").update(JSON.stringify({
   task_id:record.task_id,agent_role:record.agent_role,
   request:record.request
  })).digest("hex");
  if(digest!==record.request_fingerprint||
     pair(normalized.required_permission)!==pair(record.required_permission)||
     !verified.permissions.some(p=>giteaPermissionCovers(p,record.required_permission)))
   deny("completed read permission or prepared request fingerprint changed");
  return Object.freeze({
   ...structuredClone(flight),agent_did:bound.row.agent_did
  });
 }
 /**
  * R293: the caller passes IDs only, never an untrusted success claim.
  * A separately owner-injected completion observer must independently
  * inspect provider/Runner evidence against all pinned local fields.
  * This method records a staged completion; it NEVER grants provider I/O.
  */
 async attestTrustedTaskCompletion(
  taskId:string,runtimeTaskId:string
 ):Promise<Readonly<{
  status:"task_completion_observed_staged";
  task_id:string;runtime_task_id:string;
  gateway_execution_authorized:false
 }>>{
  return this.#attestTaskCompletion(taskId,runtimeTaskId,this.#completionObserver,false);
 }
 async attestTrustedPullRequestCompletion(taskId:string,runtimeTaskId:string,
  observer:TrustedAuthorityOnlyCompletionObserver){
  const pin=this.#assertPullRequestPin(runtimeTaskId);
  if(pin.task_id!==taskId)deny("PR completion differs from original Task");
  return this.#attestTaskCompletion(taskId,runtimeTaskId,observer,true);
 }
 async attestTrustedBranchCompletion(taskId:string,runtimeTaskId:string,
  observer:TrustedAuthorityOnlyCompletionObserver){
  if(this.#assertBranchPin(runtimeTaskId).task_id!==taskId)
   deny("branch completion differs from original Task");
  return this.#attestTaskCompletion(taskId,runtimeTaskId,observer,"branch");
 }
 async #attestTaskCompletion(taskId:string,runtimeTaskId:string,
  observer:TrustedAuthorityOnlyCompletionObserver|undefined,pullRequest:boolean|"branch"){
  const root=this.#live();
  if(this.#sequential.has(taskId))
   deny("sequential Task completion must use explicit finalization");
  if(!(this.#effectFenceJournal instanceof DurableAuthorityOnlyTaskFenceJournal)||
     !(observer instanceof TrustedAuthorityOnlyCompletionObserver))
   deny("trusted completion observer or owner-private journal missing");
  if(this.#completionInFlight||this.#completed.has(taskId))
   deny("concurrent or duplicate Task completion attestation");
  const bound=this.#tasks.get(runtimeTaskId);
  const child=pullRequest==="branch"?this.#rootBranchAuthority(runtimeTaskId):
   pullRequest?this.#rootPullRequestAuthority(runtimeTaskId):
   this.#enrolledChildren.get(runtimeTaskId);
  const flight=this.#flights.get(taskId);
  if(!bound||!child||!flight||
     bound.row.task_id!==taskId||flight.task_id!==taskId||
     flight.runtime_task_id!==runtimeTaskId||
     flight.epoch!==bound.row.epoch||
     flight.session_id!==root.session_id||
     flight.authority_digest!==root.authority_digest||
     flight.root_credential_id!==root.root_credential_id||
     flight.credential_id!==child.credential_id||
     child.agent_did!==bound.row.agent_did||
     child.epoch!==bound.row.epoch||
     this.#now()>=Date.parse(child.expires_at)||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep)))
   deny("Task completion not tied to an active enrolled Child flight and dependencies");
  const expectation:TrustedCompletionExpectation=Object.freeze({
   ...flight,agent_did:bound.row.agent_did
  });
  this.#completionInFlight=true;
  try{
   if(!pullRequest&&bound.row.agent_id==="orchestrator"&&
      bound.row.permissions.some(p=>p.operation==="create_pull_request"))
    deny("PR completion requires its independent original provider observer");
   const observation=await observer.observe(expectation);
   assertObservedCompletion(expectation,observation,this.#now());
   if(pullRequest==="branch")this.#assertBranchPin(runtimeTaskId);
   else if(pullRequest)this.#assertPullRequestPin(runtimeTaskId);
   await (pullRequest==="branch"?
    this.#effectFenceJournal.reserveRootBranchCompletion.bind(this.#effectFenceJournal):
    pullRequest?this.#effectFenceJournal.reserveRootPullRequestCompletion.bind(this.#effectFenceJournal):
    this.#effectFenceJournal.reserveCompletion.bind(this.#effectFenceJournal))({
    ...flight,evidence_sha256:observation.evidence_sha256,
    completed_at_ms:observation.completed_at_ms
   });
   this.#live();
   if(this.#now()>=Date.parse(child.expires_at))
    deny("native Child expired during completion attestation");
   if(pullRequest==="branch")this.#assertBranchPin(runtimeTaskId);
   else if(pullRequest)this.#assertPullRequestPin(runtimeTaskId);
   this.#completed.add(taskId);
   this.#completionEvidence.set(taskId,observation.evidence_sha256);
   return Object.freeze({
    status:"task_completion_observed_staged",
    task_id:taskId,runtime_task_id:runtimeTaskId,
    gateway_execution_authorized:false
   });
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#completionInFlight=false;}
 }
 /**
  * R301: only an owner-controlled process can FIX the number of effects
  * before executing any of them. This is NOT an agent-proposed success
  * counter. A manifest cannot be overwritten after a crash or restart.
  */
 async beginTrustedSequentialReadTask(
  taskId:string,runtimeTaskId:string,totalEffects:number
 ):Promise<Readonly<{
  status:"sequential_read_manifest_reserved_staged";
  task_id:string;total_effects:number;gateway_execution_authorized:false
 }>>{
  const root=this.#live();
  if(!(this.#sequentialEffectJournal instanceof DurableAuthorityOnlySequentialEffectJournal)||
     !(this.#completionObserver instanceof TrustedAuthorityOnlyCompletionObserver))
   deny("owner-controlled sequential journal and completion observer required");
  if(!Number.isSafeInteger(totalEffects)||totalEffects<2||totalEffects>32||
     this.#flightInFlight||this.#completionInFlight||
     this.#sequential.has(taskId)||this.#flights.has(taskId)||
     this.#completed.has(taskId))
   deny("invalid, repeated or ambiguous trusted effect manifest");
  const bound=this.#tasks.get(runtimeTaskId);
  const child=this.#enrolledChildren.get(runtimeTaskId);
  if(!bound||!child||bound.row.task_id!==taskId||
     bound.row.root_credential_id!==root.root_credential_id||
     bound.row.authority_digest!==root.authority_digest||
     bound.row.permissions.some(p=>p.operation!=="read_file")||
     child.agent_did!==bound.row.agent_did||
     child.epoch!==bound.row.epoch||
     child.root_credential_id!==root.root_credential_id||
     child.authority_digest!==root.authority_digest||
     this.#now()>=Date.parse(child.expires_at)||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep)))
   deny("sequential Task lacks enrolled read-only Child, root or dependencies");
  const manifest:TrustedSequentialManifest=Object.freeze({
   session_id:root.session_id,authority_digest:root.authority_digest,
   root_credential_id:root.root_credential_id,
   task_id:taskId,runtime_task_id:runtimeTaskId,epoch:bound.row.epoch,
   credential_id:child.credential_id,total_effects:totalEffects
  });
  this.#flightInFlight=true;
  try{
   await this.#sequentialEffectJournal.reserveManifest(manifest);
   this.#live();
   this.#sequential.set(taskId,{
    manifest,completed:0,latest_evidence_sha256:null
   });
   return Object.freeze({
    status:"sequential_read_manifest_reserved_staged",
    task_id:taskId,total_effects:totalEffects,
    gateway_execution_authorized:false
   });
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#flightInFlight=false;}
 }
 /**
  * R301: one Gitea read at a time. Before another flight, the previous
  * result MUST have been independently corroborated and durably sealed.
  * The provider is never called by this method.
  */
 async stageTrustedSequentialReadEffect(
  record:PreparedRequestRecord
 ):Promise<Readonly<{
  status:"sequential_read_effect_reserved_staged";
  task_id:string;sequence:number;gateway_execution_authorized:false
 }>>{
  const root=this.#live();
  const journal=this.#sequentialEffectJournal;
  if(!journal||this.#flightInFlight||this.#completionInFlight)
   deny("missing or concurrent sequential read reservation");
  if(!record||record.consumed!==false||
     record.request.tool!=="read_file")
   deny("only a fresh canonical Gitea read may reserve a sequential effect");
  const bound=this.#tasks.get(record.task_id);
  const child=this.#enrolledChildren.get(record.task_id);
  const taskId=bound?.row.task_id;
  const state=taskId?this.#sequential.get(taskId):undefined;
  if(!bound||!child||!state||state.active||
     this.#flights.has(taskId!)||
     state.completed>=state.manifest.total_effects||
     this.#completed.has(taskId!)||
     record.authority_only_plan_task_id!==taskId||
     record.authority_only_agent_did!==bound.row.agent_did||
     record.authority_only_digest!==root.authority_digest||
     record.agent_role!==bound.row.agent_id||
     child.credential_id!==state.manifest.credential_id||
     child.epoch!==bound.row.epoch||
     child.root_credential_id!==root.root_credential_id||
     this.#now()>=Date.parse(child.expires_at)||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep)))
   deny("sequential read lacks trusted Task, Child or previous evidence");
  const canonical=this.preflightCanonicalRequest({
   task_id:record.task_id,agent_role:record.agent_role,
   tool:record.request.tool,arguments:record.request.arguments
  });
  if(pair(canonical.required_permission)!==pair(record.required_permission))
   deny("sequential read differs from canonical Gateway Prepare");
  const next:TrustedSequentialFlight=Object.freeze({
   ...state.manifest,
   sequence:state.completed+1,
   request_id:record.request_id,
   request_fingerprint:record.request_fingerprint,
   previous_evidence_sha256:state.latest_evidence_sha256
  });
  this.#flightInFlight=true;
  try{
   await journal.reserveEffect(next);
   this.#live();
   if(this.#now()>=Date.parse(child.expires_at))
    deny("Child expired during sequential flight reservation");
   state.active=next;
   this.#flights.set(taskId!,{
    session_id:next.session_id,authority_digest:next.authority_digest,
    root_credential_id:next.root_credential_id,
    task_id:next.task_id,runtime_task_id:next.runtime_task_id,
    epoch:next.epoch,credential_id:next.credential_id,
    request_id:next.request_id,request_fingerprint:next.request_fingerprint
   });
   return Object.freeze({
    status:"sequential_read_effect_reserved_staged",
    task_id:taskId!,sequence:next.sequence,
    gateway_execution_authorized:false
   });
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#flightInFlight=false;}
 }
 /**
  * The observer (not the agent) rechecks a real Gitea outcome against
  * each original prepared request and the protected authenticated receipt.
  * A Task dependency is NOT unlocked by completing an intermediate effect.
  */
 async attestTrustedSequentialReadEffect(
  taskId:string,runtimeTaskId:string
 ):Promise<Readonly<{
  status:"sequential_read_effect_attested_staged";
  task_id:string;sequence:number;gateway_execution_authorized:false
 }>>{
  const root=this.#live();
  const journal=this.#sequentialEffectJournal;
  const observer=this.#completionObserver;
  const state=this.#sequential.get(taskId);
  const bound=this.#tasks.get(runtimeTaskId);
  const child=this.#enrolledChildren.get(runtimeTaskId);
  const active=state?.active;
  if(!journal||!observer||this.#completionInFlight||this.#flightInFlight||
     !state||!bound||!child||!active||
     bound.row.task_id!==taskId||
     active.runtime_task_id!==runtimeTaskId||
     active.sequence!==state.completed+1||
     active.previous_evidence_sha256!==state.latest_evidence_sha256||
     active.session_id!==root.session_id||
     active.authority_digest!==root.authority_digest||
     active.root_credential_id!==root.root_credential_id||
     active.credential_id!==child.credential_id||
     child.epoch!==bound.row.epoch||
     this.#now()>=Date.parse(child.expires_at)||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep)))
   deny("sequential effect not bound to pending native Child flight");
  const expected:TrustedCompletionExpectation=Object.freeze({
   ...this.#flights.get(taskId)!,agent_did:bound.row.agent_did
  });
  if(!expected.request_id||expected.request_id!==active.request_id||
     expected.request_fingerprint!==active.request_fingerprint)
   deny("sequential flight changed before independent evidence verification");
  this.#completionInFlight=true;
  try{
   const observation=await observer.observe(expected);
   assertObservedCompletion(expected,observation,this.#now());
   await journal.reserveEvidence({
    ...active,evidence_sha256:observation.evidence_sha256,
    completed_at_ms:observation.completed_at_ms
   });
   this.#live();
   if(this.#now()>=Date.parse(child.expires_at))
    deny("Child expired while sealing sequential Gitea result");
   state.completed=active.sequence;
   state.latest_evidence_sha256=observation.evidence_sha256;
   delete state.active;
   this.#flights.delete(taskId);
   return Object.freeze({
    status:"sequential_read_effect_attested_staged",
    task_id:taskId,sequence:active.sequence,
    gateway_execution_authorized:false
   });
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#completionInFlight=false;}
 }
 /** Explicit, owner-only final declaration after ALL expected receipts. */
 async finalizeTrustedSequentialReadTask(
  taskId:string,runtimeTaskId:string
 ):Promise<Readonly<{
  status:"sequential_read_task_complete_staged";
  task_id:string;total_effects:number;gateway_execution_authorized:false
 }>>{
  this.#live();
  const journal=this.#sequentialEffectJournal;
  const state=this.#sequential.get(taskId);
  if(!journal||!state||state.active||this.#flights.has(taskId)||
     this.#completed.has(taskId)||this.#flightInFlight||
     this.#completionInFlight||
     state.manifest.runtime_task_id!==runtimeTaskId||
     state.completed!==state.manifest.total_effects||
     !state.latest_evidence_sha256||
     !SHA64.test(state.latest_evidence_sha256))
   deny("incomplete or ambiguous sequential Task cannot unlock dependencies");
  this.#completionInFlight=true;
  try{
   await journal.reserveTaskFinal({
    ...state.manifest,
    latest_evidence_sha256:state.latest_evidence_sha256
   });
   this.#live();
   this.#completed.add(taskId);
   return Object.freeze({
    status:"sequential_read_task_complete_staged",
    task_id:taskId,total_effects:state.completed,
    gateway_execution_authorized:false
   });
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#completionInFlight=false;}
 }
 #rootBranchAuthority(runtimeTaskId:string){
  const root=this.#live(),task=this.#tasks.get(runtimeTaskId);
  if(!task||task.row.agent_id!=="orchestrator"||task.row.epoch!==1||this.#epoch!==1||
     this.#tasks.size!==1||this.#enrolledChildren.has(runtimeTaskId)||
     task.row.depends_on.length!==0||task.row.permissions.length!==1||
     task.row.permissions[0]?.operation!=="create_branch"||
     !root.root_permissions.some(p=>pair(p)===pair(task.row.permissions[0]!)))
   deny("branch requires original first Orchestrator Task and exact root grant");
  return Object.freeze({credential_id:root.root_credential_id,
   root_credential_id:root.root_credential_id,authority_digest:root.authority_digest,
   epoch:task.row.epoch,agent_did:task.row.agent_did,expires_at:root.root_expires_at});
 }
 pinTrustedBranchTask(taskId:string,runtimeTaskId:string){
  const root=this.#live(),authority=this.#rootBranchAuthority(runtimeTaskId);
  if(this.#bindingInFlight||this.#flightInFlight||this.#completionInFlight||
     this.#branchPins.has(runtimeTaskId)||this.#completed.size||
     this.#tasks.get(runtimeTaskId)!.row.task_id!==taskId)
   deny("branch Task admission requires original quiescent owner");
  this.#branchPins.set(runtimeTaskId,Object.freeze({task_id:taskId,
   epoch:authority.epoch,credential_id:authority.credential_id,base_revision:root.base_revision}));
  return this.#assertBranchPin(runtimeTaskId);
 }
 #assertBranchPin(runtimeTaskId:string){
  const root=this.#live(),pin=this.#branchPins.get(runtimeTaskId);
  const authority=this.#rootBranchAuthority(runtimeTaskId),task=this.#tasks.get(runtimeTaskId)!;
  if(!pin||pin.task_id!==task.row.task_id||pin.epoch!==authority.epoch||
     pin.credential_id!==root.root_credential_id||pin.base_revision!==root.base_revision||
     this.#completed.has(pin.task_id))
   deny("original pinned branch Task is missing, changed or complete");
  return pin;
 }
 assertTrustedBranchIntentBinding(record:PreparedRequestRecord){
  const pin=this.#assertBranchPin(record.task_id);
  if(record.consumed!==false||record.request.tool!=="create_branch"||
     record.agent_role!=="orchestrator"||record.expires_at_ms<=this.#now())
   deny("branch intent requires original fresh Orchestrator Prepare");
  const canonical=this.preflightCanonicalRequest({task_id:record.task_id,
   agent_role:record.agent_role,tool:record.request.tool,arguments:record.request.arguments});
  const digest=createHash("sha256").update(JSON.stringify({task_id:record.task_id,
   agent_role:record.agent_role,request:record.request})).digest("hex");
  if(record.authority_only_plan_task_id!==pin.task_id||
     record.authority_only_digest!==canonical.authority_digest||
     record.authority_only_agent_did!==canonical.agent_did||
     pair(record.required_permission)!==pair(canonical.required_permission)||
     record.request_fingerprint!==digest)
   deny("branch intent differs from original canonical Task");
  return pin;
 }
 #rootPullRequestAuthority(runtimeTaskId:string){
  const root=this.#live(),pr=this.#tasks.get(runtimeTaskId);
  if(!pr||pr.row.agent_id!=="orchestrator"||pr.row.epoch!==this.#epoch||
     this.#enrolledChildren.has(runtimeTaskId)||
     pr.row.permissions.length!==1||pr.row.permissions[0]?.operation!=="create_pull_request"||
     !root.root_permissions.some(p=>pair(p)===pair(pr.row.permissions[0]!)))
   deny("PR requires original Orchestrator Task within operational root");
  return Object.freeze({credential_id:root.root_credential_id,
   root_credential_id:root.root_credential_id,authority_digest:root.authority_digest,
   epoch:pr.row.epoch,agent_did:pr.row.agent_did,expires_at:root.root_expires_at});
 }
 /** Owner-only PR admission after the original Test completion. */
 async pinTrustedPullRequestTask(taskId:string,runtimeTaskId:string,
  testTaskId:string,testRuntimeTaskId:string,observer:AuthenticatedRunnerCompletionObserver){
  const root=this.#live();
  if(this.#completionInFlight||this.#flightInFlight||this.#bindingInFlight||
     this.#enrollmentInFlight||this.#prPins.has(runtimeTaskId)||
     !AuthenticatedRunnerCompletionObserver.isForRepository(observer,
      this.#repository.owner+"/"+this.#repository.repository,this.#branch!))
   deny("PR Test pin requires original active Gateway and protected Runner observer");
  const pr=this.#tasks.get(runtimeTaskId),child=this.#rootPullRequestAuthority(runtimeTaskId);
  const test=this.#tasks.get(testRuntimeTaskId),flight=this.#flights.get(testTaskId);
  if(!pr||!child||!test||!flight||pr.row.task_id!==taskId||
     pr.row.agent_id!=="orchestrator"||pr.row.epoch!==this.#epoch||
     pr.row.permissions.length!==1||pr.row.permissions[0]?.operation!=="create_pull_request"||
     !isDeepStrictEqual(pr.row.depends_on,[testTaskId])||
     test.row.task_id!==testTaskId||test.row.agent_id!=="test"||
     !this.#completed.has(testTaskId)||!this.#completionEvidence.has(testTaskId)||
     flight.runtime_task_id!==testRuntimeTaskId||flight.epoch!==test.row.epoch||
     flight.session_id!==root.session_id||flight.authority_digest!==root.authority_digest||
     flight.root_credential_id!==root.root_credential_id||
     child.root_credential_id!==root.root_credential_id||
     child.epoch!==pr.row.epoch||child.agent_did!==pr.row.agent_did||
     this.#now()>=Date.parse(child.expires_at))
   deny("PR Task, original native Child or completed Test differs");
  for(const other of this.#tasks.values())
   if(other.row.agent_id==="test"&&other.row.epoch>test.row.epoch)
    deny("PR requires latest independently completed Test");
  const source=Object.freeze({...flight,agent_did:test.row.agent_did});
  this.#completionInFlight=true;
  try{
   const proof=await AuthenticatedRunnerCompletionObserver.prototype.observeTestedHead
    .call(observer,source);
   const live=this.#live();
   if(live.root_credential_id!==root.root_credential_id||
      this.#epoch!==pr.row.epoch||
      proof.completion.evidence_sha256!==this.#completionEvidence.get(testTaskId))
    deny("PR source changed during independent Test verification");
   this.#prPins.set(runtimeTaskId,Object.freeze({task_id:taskId,
    epoch:pr.row.epoch,credential_id:child.credential_id,source,
    tested_commit_sha:proof.tested_commit_sha,
    runner_evidence_sha256:proof.completion.evidence_sha256}));
   return this.#assertPullRequestPin(runtimeTaskId);
  }finally{this.#completionInFlight=false;}
 }
 #assertPullRequestPin(runtimeTaskId:string){
  const root=this.#live(),pin=this.#prPins.get(runtimeTaskId);
  const pr=this.#tasks.get(runtimeTaskId),child=this.#rootPullRequestAuthority(runtimeTaskId);
  if(!pin||!pr||!child||pin.task_id!==pr.row.task_id||pin.epoch!==this.#epoch||
     child.credential_id!==pin.credential_id||child.epoch!==pin.epoch||
     child.root_credential_id!==root.root_credential_id||
     child.authority_digest!==root.authority_digest||
     this.#now()>=Date.parse(child.expires_at)||
     pin.source.root_credential_id!==root.root_credential_id||
     pin.source.authority_digest!==root.authority_digest||
     !this.#completed.has(pin.source.task_id)||
     this.#completionEvidence.get(pin.source.task_id)!==pin.runner_evidence_sha256||
     this.#completed.has(pin.task_id))
   deny("trusted Runner acceptance required before PR");
  for(const other of this.#tasks.values())
   if(other.row.agent_id==="test"&&other.row.epoch>pin.source.epoch)
    deny("PR Test superseded by later Test");
  return pin;
 }
 async revalidateTrustedPullRequestTest(runtimeTaskId:string,
  observer:AuthenticatedRunnerCompletionObserver){
  const pin=this.#assertPullRequestPin(runtimeTaskId);
  if(!AuthenticatedRunnerCompletionObserver.isForRepository(observer,
     this.#repository.owner+"/"+this.#repository.repository,this.#branch!))
   deny("PR source observer differs from original repository");
  const proof=await AuthenticatedRunnerCompletionObserver.prototype.observeTestedHead
   .call(observer,pin.source);
  this.#assertPullRequestPin(runtimeTaskId);
  if(proof.tested_commit_sha!==pin.tested_commit_sha||
     proof.completion.evidence_sha256!==pin.runner_evidence_sha256)
   deny("PR HEAD or original Runner receipt changed");
  return pin;
 }
 assertTrustedPullRequestIntentBinding(record:PreparedRequestRecord){
  const pin=this.#assertPullRequestPin(record.task_id);
  if(record.consumed!==false||record.request.tool!=="create_pull_request"||
     record.agent_role!=="orchestrator"||record.expires_at_ms<=this.#now())
   deny("PR intent requires original fresh Orchestrator Prepare");
  const canonical=this.preflightCanonicalRequest({task_id:record.task_id,
   agent_role:record.agent_role,tool:record.request.tool,arguments:record.request.arguments});
  const digest=createHash("sha256").update(JSON.stringify({task_id:record.task_id,
   agent_role:record.agent_role,request:record.request})).digest("hex");
  if(record.authority_only_plan_task_id!==pin.task_id||
     record.authority_only_digest!==canonical.authority_digest||
     record.authority_only_agent_did!==canonical.agent_did||
     pair(record.required_permission)!==pair(canonical.required_permission)||
     record.request_fingerprint!==digest)
   deny("PR intent differs from original canonical Task");
  return pin;
 }
 /**
  * Derive the exact permission from a normalized Gateway request,
  * not from an agent-claimed authorization. Scope preflight only:
  * NO challenge, Rust VP verification, OPA evaluation or provider effect.
  */
 preflightCanonicalRequest(raw:PrepareAuthorizationRequest):Readonly<{
  status:"gateway_permission_preflight_only";
  authority_digest:string;runtime_task_id:string;
  required_permission:Permission;
  agent_did:string;plan_task_id:string;
  gateway_execution_authorized:false
 }>{
  this.#live();
  const request=validatePrepareAuthorizationRequest(raw);
  const bound=this.#tasks.get(request.task_id);
  if(!bound||bound.row.agent_id!==request.agent_role)
   deny("unbound runtime Task or presenter role");
  if(bound.row.depends_on.some(dep=>!this.#completed.has(dep)))
   deny("dependency completion not yet Gateway-attested");
  const {tool,arguments:args}=request.request;
  switch(tool){
   case "create_branch":
    if(args.branch!==this.#branch||args.base_branch!=="main")
     deny("branch creation outside approved feature branch");
    this.#assertBranchPin(request.task_id);
    break;
   case "create_pull_request":
    if(args.head_branch!==this.#branch||args.base_branch!=="main")
     deny("PR branch outside approved feature branch");
    this.#assertPullRequestPin(request.task_id);
    break;
   default:
    if("branch" in args&&args.branch!==this.#branch)
     deny("operation outside signed work branch");
  }
  const required=deriveRequiredPermission(this.#repository,request.request);
  if(!bound.row.permissions.some(p=>giteaPermissionCovers(p,required))||
     !this.#authorizedPermissions!.some(p=>giteaPermissionCovers(p,required))||
     !this.#rootPermissions!.some(p=>giteaPermissionCovers(p,required)))
   deny("request operation or resource not in exact signed Task grant");
  return Object.freeze({
   status:"gateway_permission_preflight_only",
   authority_digest:this.#digest!,runtime_task_id:request.task_id,
   required_permission:structuredClone(required),
   agent_did:bound.row.agent_did,plan_task_id:bound.row.task_id,
   gateway_execution_authorized:false
  });
 }
 /**
  * R303.3 check an ACTUALLY consumed Test Agent Prepare against the
  * independently Rust-verified native Child and R293 durable effect flight.
  * Invoked only after real OPA allow. Never trusts Runner output on its own.
  */
 assertTrustedCompletedRunnerEvidenceBinding(
  record:PreparedRequestRecord,verified:VerifiedDelegation
 ):Readonly<TrustedCompletionExpectation>{
  const root=this.#live();
  if(!record||record.consumed!==true||
     !record.authority_only_digest||
     record.authority_only_digest!==root.authority_digest||
     record.request.tool!=="run_tests"||
     record.agent_role!=="test"||
     record.expires_at_ms<=this.#now()||
     this.#flightInFlight||this.#completionInFlight)
   deny("Runner completion requires live consumed Test Agent Prepare");
  const bound=this.#tasks.get(record.task_id);
  const child=this.#enrolledChildren.get(record.task_id);
  const taskId=bound?.row.task_id;
  if(!bound||!child||!taskId||!verified||
     !Array.isArray(verified.permissions)||
     bound.row.agent_id!=="test"||
     record.authority_only_plan_task_id!==taskId||
     record.authority_only_agent_did!==bound.row.agent_did||
     verified.presenter_id!==bound.row.agent_did||
     verified.credential_id!==child.credential_id||
     verified.root_credential_id!==root.root_credential_id||
     !Number.isSafeInteger(verified.hierarchy_depth)||
     verified.hierarchy_depth<1||
     child.root_credential_id!==root.root_credential_id||
     child.authority_digest!==root.authority_digest||
     child.agent_did!==bound.row.agent_did||
     child.agent_id!=="test"||
     child.epoch!==bound.row.epoch||
     this.#now()>=Date.parse(child.expires_at)||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep))||
     this.#sequential.has(taskId)||this.#completed.has(taskId))
   deny("Test result lacks live registered native Child and dependencies");
  const flight=this.#flights.get(taskId);
  if(!flight||
     flight.session_id!==root.session_id||
     flight.authority_digest!==root.authority_digest||
     flight.root_credential_id!==root.root_credential_id||
     flight.task_id!==taskId||
     flight.runtime_task_id!==record.task_id||
     flight.epoch!==bound.row.epoch||
     flight.credential_id!==child.credential_id||
     flight.request_id!==record.request_id||
     flight.request_fingerprint!==record.request_fingerprint)
   deny("Runner has no original durably reserved Task flight");
  const canonical=this.preflightCanonicalRequest({
   task_id:record.task_id,agent_role:record.agent_role,
   tool:record.request.tool,arguments:record.request.arguments
  });
  const fingerprint=createHash("sha256").update(JSON.stringify({
   task_id:record.task_id,agent_role:record.agent_role,
   request:record.request
  })).digest("hex");
  if(fingerprint!==record.request_fingerprint||
     pair(canonical.required_permission)!==pair(record.required_permission)||
     record.request.arguments.profile!=="poc-default"||
     record.request.arguments.branch!==root.branch||
     !verified.permissions.some(p=>giteaPermissionCovers(
       p,record.required_permission)))
   deny("Runner VP permission or canonical tested Task changed");
  return Object.freeze({...structuredClone(flight),
   agent_did:bound.row.agent_did});
 }
 /**
  * R303.1 owner-only Test Agent enrollment and original Gateway Prepare.
  * This yields ONLY a signed Task/Child binding for a future pinned Runner
  * intent; it is not permission to launch Docker or trust a test result.
  */
 assertTrustedRunnerIntentBinding(
  record:PreparedRequestRecord
 ):Readonly<TrustedCompletionExpectation>{
  const root=this.#live();
  if(!record||typeof record!=="object"||
     record.consumed!==false||
     record.request.tool!=="run_tests"||
     record.agent_role!=="test"||
     !record.authority_only_digest||
     record.authority_only_digest!==root.authority_digest||
     record.expires_at_ms<=this.#now())
   deny("unconsumed Test Agent signed Runner Prepare is required");
  const bound=this.#tasks.get(record.task_id);
  const child=this.#enrolledChildren.get(record.task_id);
  const taskId=bound?.row.task_id;
  if(!bound||!child||!taskId||
     bound.row.agent_id!=="test"||
     record.authority_only_plan_task_id!==taskId||
     record.authority_only_agent_did!==bound.row.agent_did||
     bound.row.permissions.every(p=>p.operation!=="run_tests")||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep))||
     this.#flights.has(taskId)||
     this.#sequential.has(taskId)||
     this.#completed.has(taskId)||
     child.credential_id===root.root_credential_id||
     child.root_credential_id!==root.root_credential_id||
     child.authority_digest!==root.authority_digest||
     child.agent_id!=="test"||
     child.agent_did!==bound.row.agent_did||
     child.epoch!==bound.row.epoch||
     this.#now()>=Date.parse(child.expires_at))
   deny("Test Agent lacks exact enrolled native Child and completed dependencies");
  const permission=this.preflightCanonicalRequest({
   task_id:record.task_id,agent_role:record.agent_role,
   tool:record.request.tool,arguments:record.request.arguments
  });
  const fingerprint=createHash("sha256").update(JSON.stringify({
   task_id:record.task_id,agent_role:record.agent_role,
   request:record.request
  })).digest("hex");
  if(pair(permission.required_permission)!==pair(record.required_permission)||
     record.request.arguments.profile!=="poc-default"||
     record.request.arguments.branch!==root.branch||
     fingerprint!==record.request_fingerprint)
   deny("Runner Prepare or permission differs from signed Task binding");
  return Object.freeze({
   session_id:root.session_id,
   authority_digest:root.authority_digest,
   root_credential_id:root.root_credential_id,
   task_id:taskId,runtime_task_id:record.task_id,epoch:bound.row.epoch,
   agent_did:bound.row.agent_did,
   credential_id:child.credential_id,
   request_id:record.request_id,
   request_fingerprint:record.request_fingerprint
  });
 }
 /**
  * R302: owner-only read-only preflight for a future atomic-CAS Gitea UPDATE.
  * This does not permit execution or turn this binding into an authorization.
  * The trusted caller must independently validate the current Gitea HEAD,
  * file blob, durable reservation and Rust/OPA before any future write.
  */
 assertTrustedGiteaUpdateIntentBinding(
  record:PreparedRequestRecord
 ):Readonly<TrustedCompletionExpectation>{
  const root=this.#live();
  if(!record||typeof record!=="object"||record.consumed!==false||
     record.request.tool!=="update_file"||
     !record.authority_only_digest||
     record.authority_only_digest!==root.authority_digest||
     record.expires_at_ms<=this.#now())
   deny("mutation preflight requires unconsumed trusted update_file Prepare");
  const bound=this.#tasks.get(record.task_id);
  const child=this.#enrolledChildren.get(record.task_id);
  const taskId=bound?.row.task_id;
  if(!bound||!child||!taskId||
     record.authority_only_plan_task_id!==taskId||
     record.authority_only_agent_did!==bound.row.agent_did||
     bound.row.agent_id!==record.agent_role||
     bound.row.permissions.every(p=>p.operation!=="update_file")||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep))||
     this.#flights.has(taskId)||this.#sequential.has(taskId)||
     this.#completed.has(taskId)||
     child.credential_id===root.root_credential_id||
     child.epoch!==bound.row.epoch||
     child.agent_did!==bound.row.agent_did||
     child.root_credential_id!==root.root_credential_id||
     child.authority_digest!==root.authority_digest||
     this.#now()>=Date.parse(child.expires_at))
   deny("update preflight has no exact signed Task or enrolled native Child");
  const allowed=this.preflightCanonicalRequest({
   task_id:record.task_id,agent_role:record.agent_role,
   tool:record.request.tool,arguments:record.request.arguments
  });
  const fingerprint=createHash("sha256").update(JSON.stringify({
   task_id:record.task_id,agent_role:record.agent_role,
   request:record.request
  })).digest("hex");
  if(pair(allowed.required_permission)!==pair(record.required_permission)||
     fingerprint!==record.request_fingerprint||
     typeof record.request.arguments.content!=="string"||
     Buffer.byteLength(record.request.arguments.content,"utf8")>2_000_000)
   deny("updated source does not match prepared canonical permission");
  return Object.freeze({
   session_id:root.session_id,
   authority_digest:root.authority_digest,
   root_credential_id:root.root_credential_id,
   task_id:taskId,runtime_task_id:record.task_id,epoch:bound.row.epoch,
   agent_did:bound.row.agent_did,
   credential_id:child.credential_id,
   request_id:record.request_id,
   request_fingerprint:record.request_fingerprint
  });
 }
 /**
  * R302.4 OWNER-ONLY authenticated UPDATE execution binding.
  * Called strictly after native Rust VP, OPA and durable preflight/Task
  * flight. This verifies the exact Child, root, Task, permission and
  * request challenge binding; it never performs a Gitea write itself.
  */
 assertTrustedCompletedMutationEvidenceBinding(
  record:PreparedRequestRecord,verified:VerifiedDelegation
 ):Readonly<TrustedCompletionExpectation>{
  return this.#assertConsumedEffectBinding(record,verified,"update_file");
 }
 assertTrustedCompletedBranchEvidenceBinding(
  record:PreparedRequestRecord,verified:VerifiedDelegation
 ):Readonly<TrustedCompletionExpectation>{
  this.#assertBranchPin(record.task_id);
  return this.#assertConsumedEffectBinding(record,verified,"create_branch");
 }
 assertTrustedCompletedPullRequestEvidenceBinding(
  record:PreparedRequestRecord,verified:VerifiedDelegation
 ):Readonly<TrustedCompletionExpectation>{
  this.#assertPullRequestPin(record.task_id);
  return this.#assertConsumedEffectBinding(record,verified,"create_pull_request");
 }
 #assertConsumedEffectBinding(record:PreparedRequestRecord,verified:VerifiedDelegation,
  tool:"update_file"|"create_pull_request"|"create_branch"):Readonly<TrustedCompletionExpectation>{
  const root=this.#live();
  if(!record||record.consumed!==true||
     !record.authority_only_digest||
     record.authority_only_digest!==root.authority_digest||
     record.request.tool!==tool||
     record.expires_at_ms<=this.#now()||
     this.#flightInFlight||this.#completionInFlight)
   deny("successful mutation lacks live consumed authority-only Prepare");
  const bound=this.#tasks.get(record.task_id);
  const child=tool==="create_branch"?this.#rootBranchAuthority(record.task_id):
   tool==="create_pull_request"?this.#rootPullRequestAuthority(record.task_id):
   this.#enrolledChildren.get(record.task_id);
  const taskId=bound?.row.task_id;
  if(!bound||!child||!taskId||!verified||
     !Array.isArray(verified.permissions)||
     record.authority_only_plan_task_id!==taskId||
     record.authority_only_agent_did!==bound.row.agent_did||
     record.agent_role!==bound.row.agent_id||
     verified.presenter_id!==bound.row.agent_did||
     verified.credential_id!==child.credential_id||
     verified.root_credential_id!==root.root_credential_id||
     !Number.isSafeInteger(verified.hierarchy_depth)||
     (tool!=="update_file"?verified.hierarchy_depth!==0:verified.hierarchy_depth<1)||
     child.root_credential_id!==root.root_credential_id||
     child.authority_digest!==root.authority_digest||
     child.agent_did!==bound.row.agent_did||
     child.epoch!==bound.row.epoch||
     this.#now()>=Date.parse(child.expires_at)||
     bound.row.depends_on.some(dep=>!this.#completed.has(dep))||
     this.#sequential.has(taskId)||this.#completed.has(taskId))
   deny("verified native mutation Child or Task authority differs");
  const flight=this.#flights.get(taskId);
  if(!flight||
     flight.session_id!==root.session_id||
     flight.authority_digest!==root.authority_digest||
     flight.root_credential_id!==root.root_credential_id||
     flight.task_id!==taskId||
     flight.runtime_task_id!==record.task_id||
     flight.epoch!==bound.row.epoch||
     flight.credential_id!==child.credential_id||
     flight.request_id!==record.request_id||
     flight.request_fingerprint!==record.request_fingerprint)
   deny("mutation lacks matching durable one-flight Task reservation");
  const normalized=this.preflightCanonicalRequest({
   task_id:record.task_id,agent_role:record.agent_role,
   tool:record.request.tool,arguments:record.request.arguments
  });
  const digest=createHash("sha256").update(JSON.stringify({
   task_id:record.task_id,agent_role:record.agent_role,
   request:record.request
  })).digest("hex");
  if(digest!==record.request_fingerprint||
     pair(normalized.required_permission)!==pair(record.required_permission)||
     !verified.permissions.some(p=>giteaPermissionCovers(
       p,record.required_permission)))
   deny("native mutation VP does not cover prepared concrete file");
  return Object.freeze({...structuredClone(flight),
   agent_did:bound.row.agent_did});
 }
 /**
  * R288: after the same native VerifierPort and independent OPA, re-check
  * the protected prepared binding against the current trusted Task.
  * Even a valid VP is NOT proof of a Child DC bound to this root yet.
  * This function always throws BEFORE provider execution.
  */
 assertVerifiedVpAndPolicyForExecution(
  record:PreparedRequestRecord,verified:VerifiedDelegation
 ):never{
  this.#live();
  if(!record.authority_only_digest||!record.authority_only_plan_task_id||
     !record.authority_only_agent_did||
     record.authority_only_digest!==this.#digest)
   deny("prepared request lacks pinned authority-only binding");
  const bound=this.#tasks.get(record.task_id);
  if(!bound||bound.row.task_id!==record.authority_only_plan_task_id||
     bound.row.agent_did!==record.authority_only_agent_did||
     bound.row.agent_id!==record.agent_role||
     verified.presenter_id!==bound.row.agent_did||
     typeof verified.credential_id!=="string"||
     !verified.credential_id.trim())
   deny("verified presenter or Task differs from trusted binding");
  // R291: A native-verified VP must use exactly the Child enrolled for this
  // runtime Task. A valid Child issued for another Task or session is denied.
  const child=this.#enrolledChildren.get(record.task_id);
  if(child&&
     (child.task_id!==bound.row.task_id||
      child.agent_did!==verified.presenter_id||
      child.credential_id!==verified.credential_id||
      child.root_credential_id!==this.#rootCredentialId||
      child.authority_digest!==record.authority_only_digest||
      child.epoch!==bound.row.epoch||
      this.#now()>=Date.parse(child.expires_at)))
   deny("verified native Child credential differs from enrolled Task");
  // R289: Rust's verified chain must descend from THIS independently issued
  // operational root. A valid but unrelated root is not session authority.
  // No assertion about an issued Task Child DC follows from this check.
  if(verified.root_credential_id!==this.#rootCredentialId||
     !Number.isSafeInteger(verified.hierarchy_depth)||
     verified.hierarchy_depth<1)
   deny("verified Rust chain does not descend from active Engineer operational root");
  const current=this.preflightCanonicalRequest({
   task_id:record.task_id,agent_role:record.agent_role,
   tool:record.request.tool,arguments:record.request.arguments
  });
  if(current.authority_digest!==record.authority_only_digest||
     current.plan_task_id!==record.authority_only_plan_task_id||
     pair(current.required_permission)!==pair(record.required_permission)||
     !verified.permissions.some(p=>giteaPermissionCovers(p,record.required_permission)))
   deny("prepared canonical Task grant changed during VP and OPA");
  // Missing: native Child DC rooted in this operational grant, status and
  // epoch binding. Do NOT fall back to legacy Gateways or providers.
  deny("native Child DC authority-only execution not enabled");
 }
 /**
  * R287 MUST NOT accidentally be passed to the old Gateway execute() gate:
  * that requires a native Rust VP/Child DC, OPA and trusted completion proofs
  * not yet bound to this authority digest.
  */
 assertExecutionReady():never{
  deny("Gateway provider execution is unavailable on R287 preflight path");
 }
}
