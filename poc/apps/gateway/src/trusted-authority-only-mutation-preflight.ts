/**
 * R302.1 — trusted Gateway-side Gitea update preflight, explicitly NO WRITE.
 *
 * This tool NEVER makes a PUT/POST/DELETE request. A caller may not infer
 * permission to mutate from its output. The Gitea contents PUT API only
 * compares the old blob SHA; it does NOT atomically compare the branch HEAD.
 * R302.2 must use an actual branch-ref CAS before any delegated mutation.
 */
import {createHash} from "node:crypto";
import {GiteaClient} from "./gitea-client.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {DurableAuthorityOnlyGiteaMutationIntentJournal,
 type TrustedGiteaMutationIntent}
 from "./trusted-authority-only-mutation-intent-journal.ts";
import type {PreparedRequestRecord} from "./types.ts";

const SHA40=/^[a-f0-9]{40}$/u;
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
function deny(s:string):never{
 throw Error("Authority-only Gitea update preflight NO-WRITE: "+s);
}
export class TrustedAuthorityOnlyGiteaMutationPreflight{
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #client:GiteaClient;
 readonly #journal:DurableAuthorityOnlyGiteaMutationIntentJournal;
 readonly #repository:string;
 readonly #branch:string;
 readonly #nowMs:()=>number;
 #inFlight=false;
 readonly #reserved=new WeakMap<PreparedRequestRecord,TrustedGiteaMutationIntent>();
 constructor(opts:{
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  giteaClient:GiteaClient;
  journal:DurableAuthorityOnlyGiteaMutationIntentJournal;
  repository:string;branch:string;nowMs?:()=>number;
 }){
  if(!opts||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.giteaClient instanceof GiteaClient)||
     !(opts.journal instanceof DurableAuthorityOnlyGiteaMutationIntentJournal)||
     typeof opts.repository!=="string"||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     typeof opts.branch!=="string"||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   deny("trusted owner-only Gitea update dependencies missing");
  this.#admissions=opts.admissions;
  this.#client=opts.giteaClient;
  this.#journal=opts.journal;
  this.#repository=opts.repository;
  this.#branch=opts.branch;
  this.#nowMs=opts.nowMs??Date.now;
 }
 /** Genuine class-private Gateway ownership (not structural impersonation). */
 static isNativeForAdmissions(value:unknown,
  admissions:TrustedAuthorityOnlyGatewayAdmissions):
  value is TrustedAuthorityOnlyGiteaMutationPreflight{
  return value instanceof TrustedAuthorityOnlyGiteaMutationPreflight &&
   #admissions in value && value.#admissions===admissions;
 }
 /** Same real Gateway, actual Gitea object, signed feature branch and
  * repository. This checks PRIVATE fields rather than overridable helpers. */
 static isNativeForOwner(value:unknown,
  admissions:TrustedAuthorityOnlyGatewayAdmissions,
  gitea:GiteaClient,repository:string,branch:string):
  value is TrustedAuthorityOnlyGiteaMutationPreflight{
  return value instanceof TrustedAuthorityOnlyGiteaMutationPreflight &&
   #admissions in value && value.#admissions===admissions &&
   value.#client===gitea && value.#repository===repository &&
   value.#branch===branch;
 }
 isForAdmissions(admissions:TrustedAuthorityOnlyGatewayAdmissions):boolean{
  return this.#admissions===admissions;
 }
 isForClient(client:GiteaClient):boolean{return this.#client===client;}
 /** Only the original in-memory Prepare record may retrieve its own intent. */
 getReservedIntent(record:PreparedRequestRecord):TrustedGiteaMutationIntent{
  const intent=this.#reserved.get(record);
  if(!intent||intent.request_id!==record.request_id||
     intent.request_fingerprint!==record.request_fingerprint||
     intent.runtime_task_id!==record.task_id||
     record.request.tool!=="update_file")
   deny("no owner-reserved mutation intent for original prepared request");
  return intent;
 }
 /**
  * expectedHeadSha is supplied by the trusted OWNER, NOT the agent.
  * Rechecking HEAD makes the reservation useful for later CAS but is NOT
  * itself a CAS. Nothing here permits real provider execution.
  */
 async stageUpdate(record:PreparedRequestRecord,expectedHeadSha:string):
 Promise<Readonly<{
  status:"gitea_update_intent_reserved_without_execution";
  intent:TrustedGiteaMutationIntent;
  provider_write_authorized:false
 }>>{
  if(this.#inFlight)deny("concurrent update intent reservation prohibited");
  if(!SHA40.test(expectedHeadSha))deny("exact owner-pinned Gitea HEAD required");
  const bound=this.#admissions.assertTrustedGiteaUpdateIntentBinding(record);
  if(record.request.tool!=="update_file")deny("wrong canonical tool");
  const {branch,path,content}=record.request.arguments;
  const bytes=Buffer.from(content,"utf8");
  if(branch!==this.#branch||branch==="main"||
     path.length>512||path.startsWith("/")||
     path.split("/").some(x=>!x||x==="."||x===".."||
      x.includes("\\")||x.includes("%"))||
     bytes.length<1||bytes.length>2_000_000||
     bytes.includes(0))
   deny("only bounded canonical UTF-8 update in the signed feature branch");
  this.#inFlight=true;
  try{
   const head1=await this.#client.getBranchMetadata(branch);
   if(head1.commit_sha!==expectedHeadSha)
    deny("owner-pinned HEAD changed before mutation preflight");
   const old=await this.#client.readTextFile(branch,path,expectedHeadSha);
   const head2=await this.#client.getBranchMetadata(branch);
   if(head2.commit_sha!==expectedHeadSha||
      old.branch!==branch||old.path!==path||
      old.revision!==expectedHeadSha||
      !SHA40.test(old.blob_sha))
    deny("Gitea HEAD or existing blob changed during mutation preflight");
   const oldBytes=Buffer.from(old.content,"utf8");
   const newHash=sha(content),oldHash=sha(old.content);
   if(oldHash===newHash)deny("no-op update cannot reserve a provider effect");
   const now=this.#nowMs();
   if(!Number.isSafeInteger(now)||now<=0||
      now>=record.expires_at_ms)
    deny("mutation intent expired before durable reservation");
   const intent:TrustedGiteaMutationIntent=Object.freeze({
    schema:"authority-only-gitea-update-intent-v1",
    kind:"update_file_preflight_only",
    ...structuredClone(bound),
    repository:this.#repository,branch,path,
    expected_head_sha:expectedHeadSha,
    expected_blob_sha:old.blob_sha,
    previous_content_sha256:oldHash,
    next_content_sha256:newHash,
    next_content_bytes:bytes.length,
    prepared_at_ms:now,
    provider_write_authorized:false
   });
   await this.#journal.reserve(intent);
   this.#reserved.set(record,intent);
   // An ambiguous reservation remains terminal even if the HEAD now moves.
   return Object.freeze({
    status:"gitea_update_intent_reserved_without_execution",
    intent,provider_write_authorized:false
   });
  }finally{this.#inFlight=false;}
 }
}
