/**
 * R290 — owner-only Child DC issuance tied to Engineer-signed authority
 * and the Coordinator's immutable, already registered Task/epoch.
 *
 * The crypto port MUST point to the SAME native Rust issuer as Engineer.
 * NO HTTP Adapter fallback, public request handler, A2A route, or model tool.
 * An issued credential does not activate Gateway execution.
 */
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {RootParameters} from "./trusted-engineer-authority.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";
import type {TrustedChildCryptographyPort,ExactTrustedChildIssuance}
 from "./trusted-child-crypto-port.ts";
import {TrustedAuthorityOnlyExecutionCoordinator} from
 "./trusted-authority-only-execution-coordinator.ts";
import {DurableAuthorityOnlyChildJournal} from "./trusted-authority-only-child-journal.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ROLE=new Set(["backend","frontend","test"]);
const PAIR=(p:DelegatedPermission)=>JSON.stringify([p.resource,p.operation]);
const sha=(value:unknown)=>createHash("sha256")
 .update(JSON.stringify(value)).digest("hex");
function fail(reason:string):never{throw Error("Authority-only Child issuer: "+reason);}
export interface VerifiedStagedChild {
 readonly status:"native_child_response_verified_staged";
 readonly session_id:string;readonly task_id:string;
 readonly epoch:number;readonly agent_id:string;readonly agent_did:string;
 readonly root_credential_id:string;readonly credential_id:string;
 readonly authority_digest:string;
 readonly permissions:readonly DelegatedPermission[];
 readonly expires_at:string;
 readonly gateway_execution_authorized:false;
}
export class TrustedAuthorityOnlyChildIssuer {
 readonly #coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 readonly #port:TrustedChildCryptographyPort;
 readonly #journal:DurableAuthorityOnlyChildJournal;
 readonly #nowMs:()=>number;
 readonly #issued=new Map<string,VerifiedStagedChild>();
 readonly #attempted=new Set<string>();
 #inFlight=false;
 #failed=false;
 constructor(opts:{
  coordinator:TrustedAuthorityOnlyExecutionCoordinator;
  nativeCryptoPort:TrustedChildCryptographyPort;
  journal:DurableAuthorityOnlyChildJournal;
  nowMs?:()=>number;
 }){
  if(!opts||
     !(opts.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
     !(opts.journal instanceof DurableAuthorityOnlyChildJournal)||
     opts.nativeCryptoPort?.kind!=="rust-native"||
     typeof opts.nativeCryptoPort.issueChild!=="function")
   fail("trusted Coordinator, native Rust issuer and private journal required");
  this.#coordinator=opts.coordinator;
  this.#port=opts.nativeCryptoPort;
  this.#journal=opts.journal;
  this.#nowMs=opts.nowMs??Date.now;
 }
 /** Projection for a separately authenticated, owner-only Gateway binder. */
 assertTrustedIssuedChild(taskId:string,coordinator:TrustedAuthorityOnlyExecutionCoordinator)
  :VerifiedStagedChild{
  if(this.#failed||coordinator!==this.#coordinator)
   fail("Child issuer not bound to live trusted Coordinator");
  const row=this.#coordinator.assertTrustedGatewayRegisteredTask(taskId);
  const active=this.#coordinator.assertTrustedGatewayAuthorityBinding();
  const child=this.#issued.get(taskId);
  if(!child||child.session_id!==active.session_id||
     child.root_credential_id!==active.root_credential_id||
     child.authority_digest!==active.authority_digest||
     child.epoch!==row.epoch||child.agent_did!==row.agent_did||
     child.agent_id!==row.agent_id||
     !isDeepStrictEqual(child.permissions,row.permissions)||
     this.#nowMs()>=Date.parse(child.expires_at))
   fail("no valid native-acknowledged Child for trusted Task");
  return Object.freeze({...child,permissions:Object.freeze(structuredClone(child.permissions))});
 }
 /** Only trusted owner backend supplies fresh Child identity/status metadata.
  * It cannot supply delegatee, scope, parent, root, session, or Task epoch. */
 async issueForRegisteredTask(taskId:string,parameters:RootParameters)
  :Promise<VerifiedStagedChild>{
  if(this.#failed||this.#inFlight)fail("ambiguous or concurrent issuance denied");
  if(typeof taskId!=="string"||!ID.test(taskId)||
     this.#attempted.has(taskId))
   fail("invalid or replayed Task issuance");
  const task=this.#coordinator.assertTrustedGatewayRegisteredTask(taskId);
  const root=this.#coordinator.assertTrustedGatewayAuthorityBinding();
  if(task.session_id!==root.session_id||
     task.root_credential_id!==root.root_credential_id||
     task.authority_digest!==root.authority_digest||
     task.status!=="task_registered_preflight_only"||
     task.child_credential_issued!==false||
     task.gateway_registered!==false||
     task.execution_authorized!==false||
     !ROLE.has(task.agent_id)||!task.agent_did.startsWith("did:")||
     !Array.isArray(task.permissions)||task.permissions.length<1||
     task.permissions.length>128)
   fail("Task does not match live Engineer authority");
  const approved=new Set(root.root_permissions.map(PAIR));
  if(task.permissions.some(p=>!approved.has(PAIR(p))))
   fail("Task permissions exceed operational root");
  if(!parameters||typeof parameters!=="object"||
     Object.keys(parameters).sort().join(",")!==
      "credential_id,credential_status,valid_from,validity_seconds"||
     typeof parameters.credential_id!=="string"||
     !ID.test(parameters.credential_id)||
     parameters.credential_id===root.root_credential_id||
     typeof parameters.valid_from!=="string"||
     !Number.isFinite(Date.parse(parameters.valid_from))||
     !Number.isSafeInteger(parameters.validity_seconds)||
     parameters.validity_seconds<1||parameters.validity_seconds>7200)
   fail("invalid owner-generated Child identity or validity");
  const now=this.#nowMs(),start=Date.parse(parameters.valid_from);
  const end=start+parameters.validity_seconds*1000;
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(end)||
     Math.abs(start-now)>60_000||end>Date.parse(root.root_expires_at)||
     end>Date.parse(root.expires_at)||end<=now)
   fail("Child cannot outlive current Engineer operational root");
  const status=parameters.credential_status;
  if(!status||status.type!=="BitstringStatusListEntry"||
     status.statusPurpose!=="revocation"||
     typeof status.statusListCredential!=="string"||
     !/^https:\/\//u.test(status.statusListCredential)||
     typeof status.statusListIndex!=="string"||
     !/^\d{1,12}$/u.test(status.statusListIndex))
   fail("Child requires independent revocable status entry");
  const request:ExactTrustedChildIssuance=Object.freeze({
   parent_credential_id:root.root_credential_id,
   credential_id:parameters.credential_id,
   delegatee:task.agent_id as "backend"|"frontend"|"test",
   valid_from:parameters.valid_from,
   validity_seconds:parameters.validity_seconds,
   credential_status:structuredClone(status),
   permissions:Object.freeze(structuredClone(task.permissions))
  });
  this.#inFlight=true;
  try{
   // Reserve BEFORE native IPC. Network failure and lost ACK remain uncertain.
   await this.#journal.reserveChild({
    session_id:root.session_id,epoch:task.epoch,task_id:task.task_id,
    credential_id:request.credential_id,
    parent_credential_id:request.parent_credential_id,
    authority_digest:root.authority_digest,
    permissions_sha256:sha(task.permissions),
    status_list_credential:status.statusListCredential,
    status_list_index:status.statusListIndex
   });
   this.#attempted.add(taskId);
   // Native signing is executed only after a fresh trusted-root check.
   const current=this.#coordinator.assertTrustedGatewayAuthorityBinding();
   if(current.root_credential_id!==root.root_credential_id||
      current.authority_digest!==root.authority_digest||
      current.session_id!==root.session_id)
    fail("Engineer root changed after Child reservation");
   const signed=await this.#port.issueChild(request);
   // A successful Rust IPC response is NOT yet an EVM/status verification.
   if(!signed||signed.id!==request.credential_id||
      signed.credentialSubject?.sub!==task.agent_did||
      !isDeepStrictEqual(signed.credentialSubject?.per,request.permissions)||
      signed.validFrom!==request.valid_from||
      !isDeepStrictEqual(signed.credentialStatus,request.credential_status))
    fail("native Child credential differs from trusted Task");
   const latest=this.#coordinator.assertTrustedGatewayAuthorityBinding();
   if(latest.root_credential_id!==root.root_credential_id||
      latest.authority_digest!==root.authority_digest||
      this.#nowMs()>=end)
    fail("operational root changed during native Child issuance");
   const receipt:VerifiedStagedChild=Object.freeze({
    status:"native_child_response_verified_staged",session_id:task.session_id,
    task_id:task.task_id,epoch:task.epoch,agent_id:task.agent_id,
    agent_did:task.agent_did,root_credential_id:root.root_credential_id,
    credential_id:signed.id,authority_digest:root.authority_digest,
    permissions:Object.freeze(structuredClone(task.permissions)),
    expires_at:new Date(end).toISOString(),gateway_execution_authorized:false
   });
   this.#issued.set(taskId,receipt);
   return receipt;
  }catch(error){
   // Fail closed even for ambiguous journal/IPC/credential response failures.
   this.#failed=true;
   throw error;
  }finally{this.#inFlight=false;}
 }
}
