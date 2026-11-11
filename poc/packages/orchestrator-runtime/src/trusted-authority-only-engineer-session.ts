/**
 * R285 opt-in migration: Engineer issues an independent operational Rust root
 * from PERMISSIONS ONLY, never from an approved Task/Agent/DAG.
 *
 * Not exposed as an ADK tool, public HTTP handler, MCP root issuer or
 * automatic human approval. The old signed-DAG runtime is unchanged.
 *
 * Requirements: locally verified Engineer Ed25519 receipt (branded),
 * revision-pinned preliminary read DC, durable fail-closed reservations,
 * confirmed Gateway Planning retirement AND native Rust revocation,
 * independent Status List entry, and authority-lifetime-bound root.
 */
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {MAX_PRELIMINARY_ROOT_SECONDS}
 from "../../plan-contracts/src/planning-limits.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TOOL_NAMES} from "../../../apps/gateway/src/types.ts";
import {assertVerifiedAuthorityOnlyGrant}
 from "../../plan-contracts/src/authority-only-approval.mjs";
import {preliminaryReadPermissions,
 type TrustedPlanningSnapshot,type RootParameters,
 type EngineerCredentialPort,type TrustedPlanningRevisionPort}
 from "./trusted-engineer-authority.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";
import type {TrustedAuthorityOnlyStore}
 from "./signed-authority-only-store.ts";
import type {AuthorityOnlyActivationJournal}
 from "./authority-only-activation-journal.ts";

type Phase="not_started"|"planning"|"revocation_pending"|
 "revoked"|"operational"|"failed_closed";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA40=/^[a-f0-9]{40}$/u;
const OPERATIONS=new Set<string>(RUST_OPERATIONS);
const IMPLEMENTED=new Set<string>(TOOL_NAMES);
function fail(code:string):never {
 throw Error("Authority-only Engineer transition: "+code);
}
function validRoot(root:RootParameters,maxSeconds:number,nowMs:number){
 if(!root||!ID.test(root.credential_id)||
    typeof root.valid_from!=="string"||
    !Number.isFinite(Date.parse(root.valid_from))||
    Math.abs(Date.parse(root.valid_from)-nowMs)>60_000||
    !Number.isSafeInteger(root.validity_seconds)||
    root.validity_seconds<1||root.validity_seconds>maxSeconds)
   fail("invalid or stale Engineer root request");
 const status=root.credential_status;
 if(!status||status.type!=="BitstringStatusListEntry"||
    status.statusPurpose!=="revocation"||
    typeof status.statusListIndex!=="string"||
    !/^\d+$/u.test(status.statusListIndex)||
    typeof status.statusListCredential!=="string"||
    !status.statusListCredential.trim())
   fail("invalid revocation status entry");
}
function permissionPairs(rows:readonly DelegatedPermission[]){
 if(!Array.isArray(rows)||rows.length<1||rows.length>128)
   fail("invalid operational permission count");
 const seen=new Set<string>();
 for(const p of rows){
  if(!p||typeof p.resource!=="string"||
     !p.resource.startsWith("gitea://")||
     !OPERATIONS.has(p.operation)||!IMPLEMENTED.has(p.operation))
   fail("unimplemented or invalid approved operation");
  const key=JSON.stringify([p.resource,p.operation]);
  if(seen.has(key))fail("duplicate authority pair");
  seen.add(key);
 }
}
function equality(a:unknown,b:unknown):boolean{
 return isDeepStrictEqual(a,b);
}
export class TrustedAuthorityOnlyEngineerSession{
 readonly #snapshot:TrustedPlanningSnapshot;
 readonly #requirementHash:string;
 readonly #credentials:EngineerCredentialPort;
 readonly #approvals:TrustedAuthorityOnlyStore;
 readonly #journal:AuthorityOnlyActivationJournal;
 readonly #engineerDid:string;
 readonly #revisions:TrustedPlanningRevisionPort;
 readonly #nowMs:()=>number;
 #phase:Phase="not_started";
 #preliminary?:RootParameters;
 #authorityDigest?:string;
 #operationalRoot?:RootParameters;
 #operationalPermissions?:DelegatedPermission[];
 constructor(options:{
  snapshot:TrustedPlanningSnapshot;
  requirement:string;
  credentials:EngineerCredentialPort;
  approvals:TrustedAuthorityOnlyStore;
  journal:AuthorityOnlyActivationJournal;
  planningRevisions:TrustedPlanningRevisionPort;
  authenticatedEngineerDid:string;
  nowMs?:()=>number;
 }){
  // A fully pinned trusted Gateway snapshot is mandatory on this path.
  preliminaryReadPermissions(options.snapshot);
  if(typeof options.requirement!=="string"||
     !options.requirement.trim()||options.requirement.length>8000)
   fail("trusted requirement missing");
  if(!options.authenticatedEngineerDid?.startsWith("did:")||
     !options.credentials?.issueScopedOrchestratorRoot||
     !options.credentials?.revokeRoot||
     !options.approvals?.loadAuthenticatedAuthority||
     !options.journal?.reservePlanning||
     !options.journal?.reserveOperational||
     !options.planningRevisions?.begin||
     !options.planningRevisions?.end)
   fail("trusted owner dependencies missing");
  this.#snapshot=structuredClone(options.snapshot);
  this.#requirementHash=createHash("sha256")
   .update(options.requirement,"utf8").digest("hex");
  this.#credentials=options.credentials;
  this.#approvals=options.approvals;
  this.#journal=options.journal;
  this.#engineerDid=options.authenticatedEngineerDid;
  this.#revisions=options.planningRevisions;
  this.#nowMs=options.nowMs??Date.now;
 }
 get phase():Phase{return this.#phase;}
 get approvedAuthorityDigest():string|undefined{return this.#authorityDigest;}
 /** Owner-only read binding to the SAME preliminary root later retired by
  * permission-only approval. No credential or signing secret is returned. */
 trustedPlanningAuthority(){
  if(this.#phase!=="planning"||!this.#preliminary||
     this.#nowMs()>=Date.parse(this.#preliminary.valid_from)+
       this.#preliminary.validity_seconds*1000)
   fail("preliminary root is inactive or expired");
  return {session_id:this.#snapshot.session_id,
   base_revision:this.#snapshot.base_revision,
   credential_id:this.#preliminary.credential_id,
   permissions:preliminaryReadPermissions(this.#snapshot)};
 }
 assertTrustedPlanningSnapshot(snapshot:TrustedPlanningSnapshot):void{
  if(!equality(snapshot,this.#snapshot))fail("Planning snapshot mismatch");
  this.trustedPlanningAuthority();
 }
 /** Trusted in-process proof produced ONLY after native root issue success.
  * Root credentials or Task binding are never minted by this accessor. */
 assertLiveOperationalRoot():Readonly<{
  session_id:string;credential_id:string;engineer_did:string;authority_digest:string;
  root_expires_at:string;permissions:DelegatedPermission[]
 }>{
  if(this.#phase!=="operational"||!this.#authorityDigest||
     !this.#operationalRoot||!this.#operationalPermissions)
    fail("operational root is not active");
  const expiresAt=new Date(Date.parse(this.#operationalRoot.valid_from)+
    this.#operationalRoot.validity_seconds*1000).toISOString();
  if(this.#nowMs()>=Date.parse(expiresAt))
    fail("operational root expired");
  return Object.freeze({
   session_id:this.#snapshot.session_id,
   credential_id:this.#operationalRoot.credential_id,
   engineer_did:this.#engineerDid,
   authority_digest:this.#authorityDigest,
   root_expires_at:expiresAt,
   permissions:structuredClone(this.#operationalPermissions)
  });
 }

 async startPlanning(root:RootParameters):Promise<{
  credential_id:string;phase:"planning";permissions:DelegatedPermission[]
 }>{
  if(this.#phase!=="not_started")fail("session already reserved");
  const pinned=structuredClone(root);
  validRoot(pinned,MAX_PRELIMINARY_ROOT_SECONDS,this.#nowMs());
  const permissions=preliminaryReadPermissions(this.#snapshot);
  this.#phase="failed_closed";
  // Durable reservation precedes all service side effects. Crash => no replay.
  await this.#journal.reservePlanning(this.#snapshot.session_id,pinned);
  let active=false;
  try{
   const rev=await this.#revisions.begin(this.#snapshot.session_id,
    pinned.validity_seconds*1000);
   active=true;
   if(rev.task_id!==this.#snapshot.session_id||
      !SHA40.test(rev.base_revision)||
      rev.base_revision!==this.#snapshot.base_revision||
      !Number.isFinite(Date.parse(rev.expires_at)))
    fail("Gateway revision pin mismatch");
   const issued=await this.#credentials.issueScopedOrchestratorRoot({
    ...pinned,permissions
   });
   if(issued.id!==pinned.credential_id||
      !equality(issued.credentialSubject?.per,permissions))
    fail("preliminary Rust issuer output mismatch");
   this.#preliminary=pinned;
   this.#phase="planning";
   return {credential_id:issued.id,phase:"planning",permissions};
  }catch(error){
   if(active){
    try{await this.#revisions.end(this.#snapshot.session_id);}
    catch{fail("ambiguous Planning retirement; manual reconciliation required");}
   }
   throw error;
  }
 }

 /**
  * Private Engineer cancellation of unused preliminary authority.
  * Terminal, no retry or operational root in the same session.
  */
 async cancelPlanning():Promise<void>{
  if(this.#phase!=="planning"||!this.#preliminary)
   fail("no active preliminary root to cancel");
  this.#phase="failed_closed";
  let retired=false,revoked=false;
  try{await this.#revisions.end(this.#snapshot.session_id);retired=true;}
  catch{/* Still attempt native Rust revocation. */}
  try{await this.#credentials.revokeRoot(this.#preliminary.credential_id);revoked=true;}
  catch{/* Never claim cancellation without native status confirmation. */}
  if(!retired||!revoked)
   fail("Planning cancellation unconfirmed; manual reconciliation required");
  this.#phase="revoked";
 }
 /** Private owner teardown. Existing Coordinators immediately lose their
  * live-root proof before the asynchronous native revocation can yield. */
 async retireOperationalRoot():Promise<void>{
  if(this.#phase!=="operational"||!this.#operationalRoot)
   fail("no active operational root to retire");
  const id=this.#operationalRoot.credential_id;
  this.#phase="failed_closed";
  await this.#credentials.revokeRoot(id);
  this.#phase="revoked";
 }
 /**
  * Never accepts a plan, arbitrary permission, signer or auth JSON argument.
  * The authenticated receipt is fetched from the protected host store.
  * Validation precedes the irreversible preliminary root revocation.
  */
 async approveAndIssueOperationalRoot(root:RootParameters):Promise<{
  credential_id:string;phase:"operational";authority_digest:string;
  permissions:DelegatedPermission[]
 }>{
  if(this.#phase!=="planning"||!this.#preliminary)
   fail("active preliminary root missing");
  const pinned=structuredClone(root);
  const now=this.#nowMs();
  validRoot(pinned,7200,now);
  if(pinned.credential_id===this.#preliminary.credential_id)
   fail("root credential identity must be independent");
  const a=pinned.credential_status,b=this.#preliminary.credential_status;
  if(a.statusListCredential===b.statusListCredential&&
     a.statusListIndex===b.statusListIndex)
   fail("root revocation status entry must be independent");
  this.#phase="failed_closed"; // no concurrent/replayed approval attempt
  const loaded=await this.#approvals.loadAuthenticatedAuthority(
   this.#snapshot.session_id);
  // Rechecks local verification brand, digest, canonical permissions and expiry.
  const checked=assertVerifiedAuthorityOnlyGrant(loaded,{
   allowedOperations:OPERATIONS,nowMs:this.#nowMs()
  });
  const grant=checked.authorization;
  if(checked.authenticated_engineer_did!==this.#engineerDid||
     grant.session_id!==this.#snapshot.session_id||
     !equality(grant.repository,this.#snapshot.repository)||
     grant.base_revision!==this.#snapshot.base_revision||
     grant.requirement_sha256!==this.#requirementHash)
   fail("authority outside trusted Engineer snapshot or requirement");
  if(Date.parse(pinned.valid_from)+pinned.validity_seconds*1000>
     Date.parse(checked.expires_at))
   fail("operational credential would outlive approved authority");
  const selected:DelegatedPermission[]=structuredClone(grant.permissions);
  permissionPairs(selected);
  // Record the precise approved ceiling before any revocation or new issuance.
  await this.#journal.reserveOperational(this.#snapshot.session_id,
   checked.authority_digest,pinned);
  this.#phase="revocation_pending";
  try{
   await this.#revisions.end(this.#snapshot.session_id);
   await this.#credentials.revokeRoot(this.#preliminary.credential_id);
  }catch{
   this.#phase="failed_closed";
   fail("preliminary revocation or Gateway retirement unconfirmed");
  }
  this.#phase="revoked";
  // Do not issue the new root if the approval expired during revocation.
  if(this.#nowMs()>=Date.parse(checked.expires_at)||
     this.#nowMs()>=Date.parse(pinned.valid_from)+
       pinned.validity_seconds*1000){
   this.#phase="failed_closed";
   fail("authority expired before operational issuance");
  }
  this.#phase="failed_closed";
  const issued=await this.#credentials.issueScopedOrchestratorRoot({
   ...pinned,permissions:selected
  });
  if(issued.id!==pinned.credential_id||
     !equality(issued.credentialSubject?.per,selected))
   fail("operational Rust issuer output mismatch");
  this.#authorityDigest=checked.authority_digest;
  this.#operationalRoot=structuredClone(pinned);
  this.#operationalPermissions=structuredClone(selected);
  this.#phase="operational";
  return {credential_id:issued.id,phase:"operational",
   authority_digest:checked.authority_digest,permissions:selected};
 }
}
