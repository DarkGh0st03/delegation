/**
 * R302.1 — crash-durable, owner-private update_file intent.
 *
 * A reservation is a PRECONDITION for a future independently reviewed
 * compare-and-swap write. It is never a provider-write authorization.
 * Ambiguous/crashed/duplicate reservations are intentionally NOT retried.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isDeepStrictEqual} from "node:util";
import {isAbsolute,join,resolve} from "node:path";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA40=/^[a-f0-9]{40}$/u;
const SHA256=/^[a-f0-9]{64}$/u;
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function deny(s:string):never{
 throw Error("Authority-only Gitea mutation intent: "+s);
}
export interface TrustedGiteaMutationIntent {
 readonly schema:"authority-only-gitea-update-intent-v1";
 readonly kind:"update_file_preflight_only";
 readonly session_id:string;
 readonly authority_digest:string;
 readonly root_credential_id:string;
 readonly task_id:string;
 readonly runtime_task_id:string;
 readonly epoch:number;
 readonly agent_did:string;
 readonly credential_id:string;
 readonly request_id:string;
 readonly request_fingerprint:string;
 readonly repository:string;
 readonly branch:string;
 readonly path:string;
 readonly expected_head_sha:string;
 readonly expected_blob_sha:string;
 readonly previous_content_sha256:string;
 readonly next_content_sha256:string;
 readonly next_content_bytes:number;
 readonly prepared_at_ms:number;
 readonly provider_write_authorized:false;
}
const FIELDS=[
 "schema","kind","session_id","authority_digest","root_credential_id",
 "task_id","runtime_task_id","epoch","agent_did","credential_id",
 "request_id","request_fingerprint","repository","branch","path",
 "expected_head_sha","expected_blob_sha","previous_content_sha256",
 "next_content_sha256","next_content_bytes","prepared_at_ms",
 "provider_write_authorized"
].sort().join(",");
export class DurableAuthorityOnlyGiteaMutationIntentJournal{
 readonly #directory:string;
 #writeInFlight=false;
 constructor(directory:string){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||directory.length>512)
   deny("absolute, provisioned, owner-private directory required");
  this.#directory=directory;
 }
 async #privateDirectory():Promise<void>{
  const dir=await lstat(this.#directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
   deny("unsafe shared or unowned mutation intent directory");
 }
 async #writeMarker(filename:string,record:object):Promise<void>{
  await this.#privateDirectory();
  const fd=await open(join(this.#directory,filename),
   constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,
   0o600);
  try{
   const stat=await fd.stat();
   if(!stat.isFile()||stat.nlink!==1||
      (stat.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
    deny("unsafe mutation intent file");
   await fd.writeFile(JSON.stringify(record)+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
  const dirfd=await open(this.#directory,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await dirfd.sync();}finally{await dirfd.close();}
 }
 #stem(intent:TrustedGiteaMutationIntent){
  return hash(intent.session_id+"\n"+intent.task_id);
 }
 async #readMarker(filename:string):Promise<Record<string,unknown>>{
  await this.#privateDirectory();
  const fd=await open(join(this.#directory,filename),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const stat=await fd.stat();
   if(!stat.isFile()||stat.nlink!==1||
      (stat.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&stat.uid!==process.getuid())||
      stat.size<60||stat.size>8192)
    deny("unsafe/ambiguous mutation journal marker");
   const parsed=JSON.parse(await fd.readFile("utf8")) as unknown;
   if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
    deny("malformed mutation marker");
   return parsed as Record<string,unknown>;
  }finally{await fd.close();}
 }
 async assertReserved(intent:TrustedGiteaMutationIntent):Promise<void>{
  const recorded=await this.#readMarker(this.#stem(intent)+".intent.json");
  if(!isDeepStrictEqual(recorded,intent))
   deny("immutable signed mutation intent differs from committed record");
 }
 /** Before any Gitea provider I/O, an irrevocable single-attempt marker. */
 async reserveAttempt(intent:TrustedGiteaMutationIntent):Promise<void>{
  if(this.#writeInFlight)deny("concurrent attempt reservation");
  this.#writeInFlight=true;
  try{
   await this.assertReserved(intent);
   await this.#writeMarker(this.#stem(intent)+".attempt.json",{
    schema:"authority-only-gitea-update-attempt-v1",
    session_id:intent.session_id,task_id:intent.task_id,
    request_id:intent.request_id,
    request_fingerprint:intent.request_fingerprint,
    authority_digest:intent.authority_digest,
    expected_head_sha:intent.expected_head_sha,
    expected_blob_sha:intent.expected_blob_sha,
    next_content_sha256:intent.next_content_sha256
   });
  }finally{this.#writeInFlight=false;}
 }
 /** Completion is only a hash bound to independently verified evidence. */
 async reserveCompletedEvidence(
  intent:TrustedGiteaMutationIntent,verifiedEvidenceSha256:string
 ):Promise<void>{
  if(!SHA256.test(verifiedEvidenceSha256))
   deny("untrusted mutation evidence digest");
  await this.assertReserved(intent);
  const attempt=await this.#readMarker(this.#stem(intent)+".attempt.json");
  if(attempt.schema!=="authority-only-gitea-update-attempt-v1"||
     attempt.request_id!==intent.request_id||
     attempt.request_fingerprint!==intent.request_fingerprint||
     attempt.authority_digest!==intent.authority_digest||
     attempt.expected_head_sha!==intent.expected_head_sha||
     attempt.expected_blob_sha!==intent.expected_blob_sha||
     attempt.next_content_sha256!==intent.next_content_sha256)
   deny("missing or changed provider attempt");
  await this.#writeMarker(this.#stem(intent)+".completed.json",{
   schema:"authority-only-gitea-update-completion-v1",
   session_id:intent.session_id,task_id:intent.task_id,
   request_id:intent.request_id,
   request_fingerprint:intent.request_fingerprint,
   verified_evidence_sha256:verifiedEvidenceSha256
  });
 }
 async reserve(intent:TrustedGiteaMutationIntent):Promise<void>{
  if(!intent||typeof intent!=="object"||Array.isArray(intent)||
     Object.keys(intent).sort().join(",")!==FIELDS||
     intent.schema!=="authority-only-gitea-update-intent-v1"||
     intent.kind!=="update_file_preflight_only"||
     intent.provider_write_authorized!==false||
     !ID.test(intent.session_id)||!ID.test(intent.task_id)||
     !ID.test(intent.runtime_task_id)||!ID.test(intent.request_id)||
     !ID.test(intent.root_credential_id)||!ID.test(intent.credential_id)||
     intent.root_credential_id===intent.credential_id||
     typeof intent.agent_did!=="string"||!intent.agent_did.startsWith("did:")||
     intent.agent_did.length>256||
     !SHA256.test(intent.authority_digest)||
     !SHA256.test(intent.request_fingerprint)||
     !SHA256.test(intent.previous_content_sha256)||
     !SHA256.test(intent.next_content_sha256)||
     !SHA40.test(intent.expected_head_sha)||
     !SHA40.test(intent.expected_blob_sha)||
     !Number.isSafeInteger(intent.next_content_bytes)||
     intent.next_content_bytes<1||intent.next_content_bytes>2_000_000||
     !Number.isSafeInteger(intent.epoch)||
     intent.epoch<1||intent.epoch>256||
     !Number.isSafeInteger(intent.prepared_at_ms)||intent.prepared_at_ms<=0||
     typeof intent.repository!=="string"||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(intent.repository)||
     typeof intent.branch!=="string"||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(intent.branch)||
     intent.branch.includes("..")||intent.branch.includes("//")||
     typeof intent.path!=="string"||intent.path.length>512||
     intent.path.startsWith("/")||intent.path.split("/").some(p=>
      !p||p==="."||p===".."||p.includes("\\")||p.includes("%")))
   deny("untrusted Task, Child or canonical update intent");
  await this.#writeMarker(this.#stem(intent)+".intent.json",intent);
 }
}
