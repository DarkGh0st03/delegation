/**
 * Phase W (W1): crash-durable owner record of the per-file intents of ONE
 * write-set Task, reserved once (O_EXCL) BEFORE any Gitea write.
 *
 * Owner-private. Every field is produced by the trusted owner preflight from
 * the Gateway-held Prepare records and its own pinned Gitea reads (blob SHA
 * of each updated file, 404 absence of each created file at the pinned HEAD),
 * never from model or A2A arguments. A marker is not an authorization.
 * The single-write intent journals (one intent per Task) are unchanged.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA40=/^[a-f0-9]{40}$/u;
const SHA64=/^[a-f0-9]{64}$/u;
export const MAX_WRITE_SET_BYTES=4_000_000;
export const MAX_FILE_BYTES=2_000_000;
function deny(reason:string):never{
 throw Error("Authority-only write-set intent journal: "+reason);
}
export interface TrustedWriteSetIntentItem{
 readonly sequence:number;
 readonly operation:"update_file"|"create_file";
 readonly path:string;
 readonly resource:string;
 readonly request_id:string;
 readonly request_fingerprint:string;
 /** update: blob at the pinned HEAD, read by the owner; create: null. */
 readonly expected_blob_sha:string|null;
 /** create: 404 at the pinned HEAD observed by the owner; update: false. */
 readonly old_path_absent_at_pinned_head:boolean;
 readonly previous_content_sha256:string|null;
 readonly next_content_sha256:string;
 readonly next_content_bytes:number;
}
export interface TrustedWriteSetIntent{
 readonly schema:"authority-only-gitea-write-set-intent-v1";
 readonly session_id:string;
 readonly authority_digest:string;
 readonly root_credential_id:string;
 readonly task_id:string;
 readonly runtime_task_id:string;
 readonly epoch:number;
 readonly agent_did:string;
 readonly credential_id:string;
 readonly repository:string;
 readonly branch:string;
 readonly expected_head_sha:string;
 readonly challenge:string;
 readonly items:readonly TrustedWriteSetIntentItem[];
 readonly total_content_bytes:number;
 readonly prepared_at_ms:number;
 readonly provider_write_authorized:false;
}
const ITEM_KEYS=["sequence","operation","path","resource","request_id","request_fingerprint",
 "expected_blob_sha","old_path_absent_at_pinned_head","previous_content_sha256",
 "next_content_sha256","next_content_bytes"];
const KEYS=["schema","session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","agent_did","credential_id","repository","branch",
 "expected_head_sha","challenge","items","total_content_bytes","prepared_at_ms",
 "provider_write_authorized"];
function exact(o:unknown,keys:readonly string[]):o is Record<string,unknown>{
 return !!o&&typeof o==="object"&&!Array.isArray(o)&&
  Object.keys(o).sort().join(",")===[...keys].sort().join(",");
}
export function validateWriteSetIntent(x:TrustedWriteSetIntent):void{
 if(!exact(x,KEYS)||x.schema!=="authority-only-gitea-write-set-intent-v1"||
    !ID.test(x.session_id)||!SHA64.test(x.authority_digest)||!ID.test(x.root_credential_id)||
    !ID.test(x.task_id)||!ID.test(x.runtime_task_id)||!ID.test(x.credential_id)||
    !Number.isSafeInteger(x.epoch)||x.epoch<1||typeof x.agent_did!=="string"||!x.agent_did||
    !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(x.repository)||
    !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(x.branch)||
    !SHA40.test(x.expected_head_sha)||typeof x.challenge!=="string"||!x.challenge||
    !Array.isArray(x.items)||x.items.length<2||x.items.length>8||
    x.provider_write_authorized!==false||
    !Number.isSafeInteger(x.prepared_at_ms)||x.prepared_at_ms<=0)
  deny("invalid write-set intent");
 let total=0;
 const paths=new Set<string>(),ids=new Set<string>();
 for(const [i,it] of x.items.entries()){
  if(!exact(it,ITEM_KEYS)||it.sequence!==x.items[0]!.sequence+i||
     (it.operation!=="update_file"&&it.operation!=="create_file")||
     typeof it.path!=="string"||!it.path||typeof it.resource!=="string"||
     !ID.test(it.request_id)||!SHA64.test(it.request_fingerprint)||
     !SHA64.test(it.next_content_sha256)||
     !Number.isSafeInteger(it.next_content_bytes)||it.next_content_bytes<1||
     it.next_content_bytes>MAX_FILE_BYTES||
     (it.operation==="update_file"?
      !SHA40.test(it.expected_blob_sha??"")||it.old_path_absent_at_pinned_head!==false||
      !SHA64.test(it.previous_content_sha256??"")||
      it.previous_content_sha256===it.next_content_sha256:
      it.expected_blob_sha!==null||it.old_path_absent_at_pinned_head!==true||
      it.previous_content_sha256!==null)||
     (i>0&&!(x.items[i-1]!.resource<it.resource)))
   deny("invalid write-set intent item");
  paths.add(it.path);ids.add(it.request_id);total+=it.next_content_bytes;
 }
 if(paths.size!==x.items.length||ids.size!==x.items.length||
    total!==x.total_content_bytes||total>MAX_WRITE_SET_BYTES)
  deny("write-set intent exceeds limits or repeats a file");
}
export class DurableAuthorityOnlyWriteSetIntentJournal{
 readonly #directory:string;
 constructor(directory:string){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||directory.length>512)
   deny("provisioned absolute owner-private directory required");
  this.#directory=directory;
 }
 #name(session:string,task:string){
  return createHash("sha256").update(session+"\n"+task).digest("hex")+".write-set-intent.json";
 }
 async #dir(){
  const s=await lstat(this.#directory);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&s.uid!==process.getuid()))
   deny("unsafe write-set intent directory");
 }
 /** At most ONE write-set intent per Task, ever (O_EXCL). */
 async reserve(intent:TrustedWriteSetIntent):Promise<void>{
  validateWriteSetIntent(intent);
  await this.#dir();
  const fd=await open(join(this.#directory,this.#name(intent.session_id,intent.task_id)),
   constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
   const s=await fd.stat();
   if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600)deny("unsafe new intent marker");
   await fd.writeFile(JSON.stringify(intent)+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
  const d=await open(this.#directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await d.sync();}finally{await d.close();}
 }
 async #exclusive(name:string,record:object):Promise<void>{
  await this.#dir();
  const fd=await open(join(this.#directory,name),
   constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await fd.writeFile(JSON.stringify(record)+"\n","utf8");await fd.sync();}
  finally{await fd.close();}
  const d=await open(this.#directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await d.sync();}finally{await d.close();}
 }
 /**
  * W2: the ONE publication attempt of this write-set, durable BEFORE any
  * Gitea write (staging ref, ChangeFiles, CAS). A second attempt — replay,
  * concurrent call or restart — fails with EEXIST: never a re-publication.
  */
 async reserveAttempt(intent:TrustedWriteSetIntent,writeSetDigest:string,batchId:string):Promise<void>{
  const stored=await this.read(intent.session_id,intent.task_id);
  if(JSON.stringify(stored)!==JSON.stringify(intent)||!SHA64.test(writeSetDigest)||!ID.test(batchId))
   deny("attempt does not match the reserved write-set intent");
  await this.#exclusive(this.#name(intent.session_id,intent.task_id).replace(".write-set-intent.json",
   ".attempt.json"),{schema:"authority-only-write-set-attempt-v1",session_id:intent.session_id,
   task_id:intent.task_id,write_set_digest:writeSetDigest,batch_id:batchId});
 }
 /** W2: the single recorded outcome of the attempt (no retry is ever derived from it). */
 async reserveOutcome(intent:TrustedWriteSetIntent,writeSetDigest:string,outcome:
  "failed_before_cas"|"cas_rejected"|"ambiguous"|"published",commitSha:string|null):Promise<void>{
  if(!SHA64.test(writeSetDigest)||(commitSha!==null&&!SHA40.test(commitSha))||
     (outcome==="published")!==(commitSha!==null))
   deny("invalid write-set outcome");
  await this.#exclusive(this.#name(intent.session_id,intent.task_id).replace(".write-set-intent.json",
   ".outcome.json"),{schema:"authority-only-write-set-outcome-v1",session_id:intent.session_id,
   task_id:intent.task_id,write_set_digest:writeSetDigest,outcome,commit_sha:commitSha});
 }
 async read(sessionId:string,taskId:string):Promise<TrustedWriteSetIntent>{
  await this.#dir();
  const fd=await open(join(this.#directory,this.#name(sessionId,taskId)),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const s=await fd.stat();
   if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||s.size<64||s.size>65536)
    deny("unsafe or incomplete write-set intent marker");
   const intent=JSON.parse(await fd.readFile("utf8")) as TrustedWriteSetIntent;
   validateWriteSetIntent(intent);
   return intent;
  }finally{await fd.close();}
 }
}
