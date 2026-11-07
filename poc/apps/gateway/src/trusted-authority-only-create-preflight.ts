/**
 * R383.3 — owner-private CREATE_FILE preflight, NO provider mutation.
 * The only permitted Gitea I/O is GET: pin the feature HEAD, prove a
 * genuine old-path 404 at that immutable SHA, pin HEAD again, then
 * durably reserve a non-authorizing intent. Later effects must still
 * obtain a real Rust VP, independent OPA and one-shot Task flight.
 */
import {createHash} from "node:crypto";
import {ProviderNotFoundError} from "./errors.ts";
import {GiteaClient} from "./gitea-client.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {DurableAuthorityOnlyGiteaCreateIntentJournal,
 type TrustedGiteaCreateIntent}
 from "./trusted-authority-only-create-intent-journal.ts";
import type {PreparedRequestRecord} from "./types.ts";

const SHA40=/^[a-f0-9]{40}$/u;
function deny(detail:string):never{
 throw Error("Authority-only Gitea create preflight NO-WRITE: "+detail);
}
export class TrustedAuthorityOnlyGiteaCreatePreflight {
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #client:GiteaClient;
 readonly #journal:DurableAuthorityOnlyGiteaCreateIntentJournal;
 readonly #repository:string;
 readonly #branch:string;
 readonly #nowMs:()=>number;
 #inFlight=false;
 readonly #reserved=new WeakMap<PreparedRequestRecord,TrustedGiteaCreateIntent>();
 readonly #attempted=new WeakSet<PreparedRequestRecord>();
 constructor(opts:{
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  giteaClient:GiteaClient;
  journal:DurableAuthorityOnlyGiteaCreateIntentJournal;
  repository:string;branch:string;nowMs?:()=>number;
 }){
  if(!opts||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.giteaClient instanceof GiteaClient)||
     !(opts.journal instanceof DurableAuthorityOnlyGiteaCreateIntentJournal)||
     typeof opts.repository!=="string"||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !GiteaClient.isPinnedRepositoryClient(opts.giteaClient,
       opts.repository.split("/")[0],opts.repository.split("/")[1])||
     typeof opts.branch!=="string"||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//")||
     opts.branch.startsWith("feature/r302-internal-")||
     opts.branch.startsWith("feature/r3832-create-"))
   deny("original Gateway, Gitea repository and signed branch required");
  this.#admissions=opts.admissions;
  this.#client=opts.giteaClient;
  this.#journal=opts.journal;
  this.#repository=opts.repository;
  this.#branch=opts.branch;
  this.#nowMs=opts.nowMs??Date.now;
 }
 static isNativeForOwner(value:unknown,
   admissions:TrustedAuthorityOnlyGatewayAdmissions,
   client:GiteaClient,repository:string,branch:string):
   value is TrustedAuthorityOnlyGiteaCreatePreflight{
  return value instanceof TrustedAuthorityOnlyGiteaCreatePreflight&&
   #admissions in value&&value.#admissions===admissions&&
   value.#client===client&&value.#repository===repository&&
   value.#branch===branch;
 }
 /**
  * Stored only on the ORIGINAL prepared object. Never consume a
  * serialized Task or let its author select the pinned source SHA.
  */
 getReservedIntent(record:PreparedRequestRecord):TrustedGiteaCreateIntent{
  const intent=this.#reserved.get(record);
  if(!intent||record.request.tool!=="create_file"||
     intent.request_id!==record.request_id||
     intent.request_fingerprint!==record.request_fingerprint||
     intent.runtime_task_id!==record.task_id)
   deny("original prepared request has no reserved create intent");
  return intent;
 }
 async stageCreate(record:PreparedRequestRecord,expectedHeadSha:string):
 Promise<Readonly<{
  status:"gitea_create_intent_reserved_without_execution";
  intent:TrustedGiteaCreateIntent;
  provider_write_authorized:false;
 }>>{
  if(this.#inFlight||this.#attempted.has(record))
   deny("concurrent or repeated create preflight reservation");
  if(!SHA40.test(expectedHeadSha))
   deny("trusted original owner must pin exact Gitea source HEAD");
  // Confirm the ORIGINAL unconsumed canonical Prepare, signed ROOT,
  // enrolled Rust Child and exact per-file Task BEFORE even a GET.
  const binding=this.#admissions.assertTrustedGiteaCreateIntentBinding(record);
  if(record.request.tool!=="create_file")deny("wrong canonical operation");
  const {branch,path,content}=record.request.arguments;
  const bytes=Buffer.from(content,"utf8");
  if(branch!==this.#branch||branch==="main"||
     path.length>512||path.startsWith("/")||
     path.split("/").some(x=>!x||x==="."||x===".."||
       x.includes("%")||x.includes("\\"))||
     bytes.length<1||bytes.length>2_000_000||
     bytes.includes(0)||
     new TextDecoder("utf-8",{fatal:true}).decode(bytes)!==content)
   deny("unsupported or noncanonical UTF-8 create path/source");
  // Burn the original object slot BEFORE the first external HEAD
  // query. A failed or ambiguous preflight is terminal for this
  // in-process Task (a fresh Task needs fresh signed authority).
  this.#attempted.add(record);
  this.#inFlight=true;
  try{
   const head1=await this.#client.getBranchMetadata(branch);
   if(head1.commit_sha!==expectedHeadSha)
    deny("feature HEAD changed before create absence observation");
   try{
    await this.#client.readTextFile(branch,path,expectedHeadSha);
   }catch(error){
    if(!(error instanceof ProviderNotFoundError))throw error;
    // Only an exact original SHA 404 qualifies as old-file absence.
    // Never interpret provider timeout, 503 or permission-denial
    // as proof of a nonexistent file.
    const head2=await this.#client.getBranchMetadata(branch);
    if(head2.commit_sha!==expectedHeadSha)
     deny("feature HEAD changed during create absence observation");
    const now=this.#nowMs();
    if(!Number.isSafeInteger(now)||now<=0||
       now>=record.expires_at_ms)
     deny("create intent expired before durable owner reservation");
    const intent:TrustedGiteaCreateIntent=Object.freeze({
     schema:"authority-only-gitea-create-intent-v1",
     kind:"create_file_preflight_only",
     ...structuredClone(binding),
     repository:this.#repository,branch,path,
     expected_head_sha:expectedHeadSha,
     old_path_absent_at_pinned_head:true,
     next_content_sha256:createHash("sha256").update(bytes).digest("hex"),
     next_content_bytes:bytes.length,prepared_at_ms:now,
     provider_write_authorized:false
    });
    await this.#journal.reserve(intent);
    this.#reserved.set(record,intent);
    return Object.freeze({
     status:"gitea_create_intent_reserved_without_execution",
     intent,provider_write_authorized:false
    });
   }
   deny("file already existed at owner-pinned HEAD");
  }finally{this.#inFlight=false;}
 }
}
