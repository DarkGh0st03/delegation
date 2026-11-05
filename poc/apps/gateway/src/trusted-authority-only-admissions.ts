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
import {deriveRequiredPermission} from "./canonical.ts";
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
import {TrustedAuthorityOnlyCompletionObserver,
 type TrustedCompletionExpectation}
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
export class TrustedAuthorityOnlyGatewayAdmissions {
 readonly #repository:GatewayRepositoryConfig;
 readonly #engineerDid:string;
 readonly #coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 readonly #store:SignedAuthorityOnlyFileStore;
 readonly #activationStore:TrustedOperationalSessionStore;
 readonly #taskJournal:DurableAuthorityTaskJournal;
 readonly #childJournal?:DurableAuthorityOnlyChildJournal;
 readonly #effectFenceJournal?:DurableAuthorityOnlyTaskFenceJournal;
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
 readonly #completed=new Set<string>();
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
  this.#completionObserver=opts.completionObserver;
  this.#nowMs=opts.nowMs??Date.now;
 }
 get phase():Phase{return this.#phase;}
 get registeredTaskCount():number{return this.#tasks.size;}
 get stagedCompletedTaskCount():number{return this.#completed.size;}
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
  if(!bound||!child||this.#flights.has(bound.row.task_id)||
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
  const root=this.#live();
  if(!(this.#effectFenceJournal instanceof DurableAuthorityOnlyTaskFenceJournal)||
     !(this.#completionObserver instanceof TrustedAuthorityOnlyCompletionObserver))
   deny("trusted completion observer or owner-private journal missing");
  if(this.#completionInFlight||this.#completed.has(taskId))
   deny("concurrent or duplicate Task completion attestation");
  const bound=this.#tasks.get(runtimeTaskId);
  const child=this.#enrolledChildren.get(runtimeTaskId);
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
   const observation=await this.#completionObserver.observe(expectation);
   if(!observation||typeof observation!=="object"||
      observation.status!=="owner_verified_provider_result"||
      !Object.keys(expectation).every(key=>
       (observation as unknown as Record<string,unknown>)[key]===
       (expectation as unknown as Record<string,unknown>)[key])||
      Object.keys(observation).sort().join(",")!==[
       ...Object.keys(expectation),"status","evidence_sha256",
       "completed_at_ms"].sort().join(",")||
      !SHA64.test(observation.evidence_sha256)||
      !Number.isSafeInteger(observation.completed_at_ms)||
      observation.completed_at_ms>this.#now()+60_000||
      observation.completed_at_ms<this.#now()-30*60_000)
    deny("independent completion evidence does not match protected Task flight");
   await this.#effectFenceJournal.reserveCompletion({
    ...flight,evidence_sha256:observation.evidence_sha256,
    completed_at_ms:observation.completed_at_ms
   });
   this.#live();
   if(this.#now()>=Date.parse(child.expires_at))
    deny("native Child expired during completion attestation");
   this.#completed.add(taskId);
   return Object.freeze({
    status:"task_completion_observed_staged",
    task_id:taskId,runtime_task_id:runtimeTaskId,
    gateway_execution_authorized:false
   });
  }catch(error){this.#phase="failed_closed";throw error;}
  finally{this.#completionInFlight=false;}
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
    break;
   case "create_pull_request":
    if(args.head_branch!==this.#branch||args.base_branch!=="main")
     deny("PR branch outside approved feature branch");
    deny("trusted Runner acceptance required before PR");
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
