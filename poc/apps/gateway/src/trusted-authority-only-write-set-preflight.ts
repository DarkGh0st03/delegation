/**
 * Phase W (W1): owner-private write-set preflight. NO Gitea write.
 *
 * For the exact Gateway-held Prepare records of ONE write-set Task, the
 * trusted owner observes at the owner-pinned HEAD:
 *  - for every update_file, the existing blob SHA and content (no-op updates
 *    are rejected: Gitea would create an empty commit, W0 S8);
 *  - for every create_file, a 404 at the pinned HEAD (only a genuine not-found
 *    counts as absence; timeouts or denials never do);
 * with the HEAD unchanged before and after, then durably reserves ALL the
 * per-file intents ONCE. Blob SHAs and absence proofs come only from these
 * owner reads, never from model, A2A or caller arguments.
 */
import {createHash} from "node:crypto";
import {GiteaClient} from "./gitea-client.ts";
import {ProviderNotFoundError} from "./errors.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "./trusted-authority-only-admissions.ts";
import {DurableAuthorityOnlyWriteSetIntentJournal,MAX_FILE_BYTES,MAX_WRITE_SET_BYTES,
 type TrustedWriteSetIntent,type TrustedWriteSetIntentItem}
 from "./trusted-authority-only-write-set-intent-journal.ts";
import type {PreparedRequestRecord} from "./types.ts";

const SHA40=/^[a-f0-9]{40}$/u;
const sha=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");
function deny(reason:string):never{
 throw Error("Authority-only write-set preflight NO-WRITE: "+reason);
}
export class TrustedAuthorityOnlyWriteSetPreflight{
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #client:GiteaClient;
 readonly #journal:DurableAuthorityOnlyWriteSetIntentJournal;
 readonly #repository:string;
 readonly #branch:string;
 readonly #nowMs:()=>number;
 #inFlight=false;
 /** Keyed by the ORIGINAL first prepared record object of the write-set. */
 readonly #reserved=new WeakMap<PreparedRequestRecord,TrustedWriteSetIntent>();
 constructor(opts:{
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  giteaClient:GiteaClient;
  journal:DurableAuthorityOnlyWriteSetIntentJournal;
  repository:string;branch:string;nowMs?:()=>number;
 }){
  if(!opts||!(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.giteaClient instanceof GiteaClient)||
     !(opts.journal instanceof DurableAuthorityOnlyWriteSetIntentJournal)||
     typeof opts.repository!=="string"||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !GiteaClient.isPinnedRepositoryClient(opts.giteaClient,
       opts.repository.split("/")[0]!,opts.repository.split("/")[1]!)||
     typeof opts.branch!=="string"||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//")||
     /^feature\/(r302-internal-|r3832-create-|w1-write-set-)/u.test(opts.branch))
   deny("original Gateway, pinned Gitea repository and signed branch required");
  this.#admissions=opts.admissions;this.#client=opts.giteaClient;
  this.#journal=opts.journal;this.#repository=opts.repository;
  this.#branch=opts.branch;this.#nowMs=opts.nowMs??Date.now;
 }
 /** Genuine class-private ownership, not structural impersonation. */
 static isNativeForAdmissions(value:unknown,admissions:TrustedAuthorityOnlyGatewayAdmissions):
  value is TrustedAuthorityOnlyWriteSetPreflight{
  return value instanceof TrustedAuthorityOnlyWriteSetPreflight&&
   #admissions in value&&value.#admissions===admissions;
 }
 /** Only the original in-memory first record retrieves the reserved intent. */
 getReservedIntent(records:readonly PreparedRequestRecord[]):TrustedWriteSetIntent{
  const intent=Array.isArray(records)&&records[0]?this.#reserved.get(records[0]):undefined;
  if(!intent||intent.items.length!==records.length||
     intent.runtime_task_id!==records[0]!.task_id)
   deny("no owner-reserved write-set intent for these original records");
  return intent;
 }
 async stageWriteSet(records:readonly PreparedRequestRecord[],expectedHeadSha:string):
 Promise<Readonly<{status:"gitea_write_set_intent_reserved_without_execution";
  intent:TrustedWriteSetIntent;provider_write_authorized:false}>>{
  if(this.#inFlight)deny("concurrent write-set intent reservation prohibited");
  if(!SHA40.test(expectedHeadSha))deny("exact owner-pinned Gitea HEAD required");
  // The admissions bind every record to the signed Task, enrolled Child,
  // write plan, attested reads and pinned HEAD, in canonical order.
  const bound=this.#admissions.assertTrustedWriteSetIntentBinding(records);
  if(bound.branch!==this.#branch||bound.pinned_head_sha!==expectedHeadSha)
   deny("write-set not bound to this signed branch and pinned HEAD");
  this.#inFlight=true;
  try{
   if((await this.#client.getBranchMetadata(this.#branch)).commit_sha!==expectedHeadSha)
    deny("owner-pinned HEAD changed before write-set preflight");
   const items:TrustedWriteSetIntentItem[]=[];
   let total=0;
   for(const it of bound.items){
    const bytes=Buffer.from(it.content,"utf8");
    if(bytes.length<1||bytes.length>MAX_FILE_BYTES||bytes.includes(0))
     deny("only bounded canonical UTF-8 contents may be staged");
    total+=bytes.length;
    if(total>MAX_WRITE_SET_BYTES)deny("write-set exceeds the aggregate content limit");
    const next=sha(it.content);
    if(it.operation==="update_file"){
     const old=await this.#client.readTextFile(this.#branch,it.path,expectedHeadSha);
     if(old.path!==it.path||old.revision!==expectedHeadSha||!SHA40.test(old.blob_sha))
      deny("existing blob not observed at the pinned HEAD");
     const previous=sha(old.content);
     if(previous===next)deny("no-op update cannot reserve a provider effect");
     items.push(Object.freeze({sequence:it.sequence,operation:it.operation,path:it.path,
      resource:it.resource,request_id:it.request_id,request_fingerprint:it.request_fingerprint,
      expected_blob_sha:old.blob_sha,old_path_absent_at_pinned_head:false,
      previous_content_sha256:previous,next_content_sha256:next,next_content_bytes:bytes.length}));
    }else{
     try{
      await this.#client.readTextFile(this.#branch,it.path,expectedHeadSha);
     }catch(error){
      if(!(error instanceof ProviderNotFoundError))throw error;
      items.push(Object.freeze({sequence:it.sequence,operation:it.operation,path:it.path,
       resource:it.resource,request_id:it.request_id,request_fingerprint:it.request_fingerprint,
       expected_blob_sha:null,old_path_absent_at_pinned_head:true,
       previous_content_sha256:null,next_content_sha256:next,next_content_bytes:bytes.length}));
      continue;
     }
     deny("a file to create already exists at the owner-pinned HEAD");
    }
   }
   if((await this.#client.getBranchMetadata(this.#branch)).commit_sha!==expectedHeadSha)
    deny("owner-pinned HEAD changed during write-set preflight");
   const now=this.#nowMs();
   if(!Number.isSafeInteger(now)||now<=0||records.some(r=>now>=r.expires_at_ms))
    deny("write-set intent expired before durable reservation");
   const intent:TrustedWriteSetIntent=Object.freeze({
    schema:"authority-only-gitea-write-set-intent-v1",
    session_id:bound.session_id,authority_digest:bound.authority_digest,
    root_credential_id:bound.root_credential_id,task_id:bound.task_id,
    runtime_task_id:bound.runtime_task_id,epoch:bound.epoch,agent_did:bound.agent_did,
    credential_id:bound.credential_id,repository:this.#repository,branch:this.#branch,
    expected_head_sha:expectedHeadSha,challenge:bound.challenge,
    items:Object.freeze(items),total_content_bytes:total,prepared_at_ms:now,
    provider_write_authorized:false
   });
   await this.#journal.reserve(intent);
   this.#reserved.set(records[0]!,intent);
   return Object.freeze({status:"gitea_write_set_intent_reserved_without_execution",
    intent,provider_write_authorized:false});
  }finally{this.#inFlight=false;}
 }
}
