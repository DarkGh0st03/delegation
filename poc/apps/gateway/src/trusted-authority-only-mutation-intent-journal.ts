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
 constructor(directory:string){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||directory.length>512)
   deny("absolute, provisioned, owner-private directory required");
  this.#directory=directory;
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
  const dir=await lstat(this.#directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
   deny("unsafe shared or unowned mutation intent directory");
  // One *attempt* per Task, including across process restarts or failure.
  // A changed request ID cannot reserve a second mutation for that Task.
  const name=hash(intent.session_id+"\n"+intent.task_id)+".intent.json";
  const fd=await open(join(this.#directory,name),
   constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,
   0o600);
  try{
   const stat=await fd.stat();
   if(!stat.isFile()||stat.nlink!==1||
      (stat.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
    deny("unsafe mutation intent file");
   await fd.writeFile(JSON.stringify(intent)+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
  const dirfd=await open(this.#directory,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await dirfd.sync();}finally{await dirfd.close();}
 }
}
