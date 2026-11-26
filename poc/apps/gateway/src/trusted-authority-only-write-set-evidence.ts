/**
 * Phase W (W2): owner-authenticated per-file evidence of ONE published
 * write-set. One owner-only publisher seals, AFTER the single HEAD-CAS and
 * an independent reread, one HMAC receipt per file; a separately injected
 * observer verifies the MAC and rereads Gitea independently.
 *
 * Every receipt binds the single effect (request, path, operation, content
 * hash, blob) AND the common publication (commit, write_set_digest,
 * batch_id, pinned parent). Evidence from another commit or write-set is
 * rejected. Nothing here authorizes a provider call.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {GiteaClient} from "./gitea-client.ts";
import type {TrustedWriteSetIntent,TrustedWriteSetIntentItem}
 from "./trusted-authority-only-write-set-intent-journal.ts";
import type {TrustedCompletionExpectation,ObservedTrustedTaskCompletion}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";

const SHA40=/^[a-f0-9]{40}$/u,SHA64=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
function deny(reason:string):never{throw Error("Authority-only write-set evidence NO-GO: "+reason);}
function canonical(v:unknown):string{
 if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
 if(v!==null&&typeof v==="object"){
  const o=v as Record<string,unknown>;
  return "{"+Object.keys(o).sort().map(k=>JSON.stringify(k)+":"+canonical(o[k])).join(",")+"}";
 }
 return JSON.stringify(v);
}
const BINDING=["session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","agent_did","credential_id","request_id","request_fingerprint"] as const;
/** The common publication every per-file receipt must belong to. */
export interface WriteSetPublication{
 readonly write_set_digest:string;
 readonly batch_id:string;
 readonly commit_sha:string;
 readonly previous_head_sha:string;
}
export interface AuthenticatedWriteSetFileReceipt{
 readonly schema:"authority-only-gitea-write-set-evidence-v1";
 readonly kind:"gateway_write_set_file_published";
 readonly session_id:string;readonly authority_digest:string;
 readonly root_credential_id:string;readonly task_id:string;
 readonly runtime_task_id:string;readonly epoch:number;
 readonly agent_did:string;readonly credential_id:string;
 readonly request_id:string;readonly request_fingerprint:string;
 readonly repository:string;readonly branch:string;
 readonly write_set_digest:string;readonly batch_id:string;
 readonly commit_sha:string;readonly previous_head_sha:string;
 readonly sequence:number;readonly path:string;
 readonly operation:"update_file"|"create_file";
 readonly expected_blob_sha:string|null;readonly blob_sha:string;
 readonly source_sha256:string;readonly source_bytes:number;
 readonly policy_version:string;readonly completed_at_ms:number;
 readonly mac_sha256:string;
}
const FIELDS=["schema","kind",...BINDING,"repository","branch","write_set_digest","batch_id",
 "commit_sha","previous_head_sha","sequence","path","operation","expected_blob_sha","blob_sha",
 "source_sha256","source_bytes","policy_version","completed_at_ms","mac_sha256"].sort().join(",");

function filename(sessionId:string,requestId:string){
 if(!ID.test(sessionId)||!ID.test(requestId))deny("invalid protected request ID");
 return sha(sessionId+"\n"+requestId)+".write-set-file.json";
}
function validateDir(path:string){
 if(typeof path!=="string"||!isAbsolute(path)||resolve(path)!==path||path.length>512)
  deny("absolute owner-private receipt directory required");
}
async function ownerDir(dir:string){
 const st=await lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o777)!==0o700||
    (typeof process.getuid==="function"&&st.uid!==process.getuid()))
  deny("unsafe write-set evidence directory");
}
async function readReceipt(dir:string,name:string):Promise<unknown>{
 await ownerDir(dir);
 const fd=await open(join(dir,name),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600||
     (typeof process.getuid==="function"&&st.uid!==process.getuid())||
     st.size<200||st.size>8192)
   deny("unsafe write-set file receipt");
  return JSON.parse(await fd.readFile("utf8")) as unknown;
 }finally{await fd.close();}
}
async function writeReceipt(dir:string,name:string,receipt:AuthenticatedWriteSetFileReceipt){
 await ownerDir(dir);
 const fd=await open(join(dir,name),
  constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600)deny("unsafe new evidence file");
  await fd.writeFile(JSON.stringify(receipt)+"\n","utf8");
  await fd.sync();
 }finally{await fd.close();}
 const d=await open(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await d.sync();}finally{await d.close();}
}
function mac(key:Buffer,unsigned:Omit<AuthenticatedWriteSetFileReceipt,"mac_sha256">){
 return createHmac("sha256",key).update(canonical(unsigned)).digest("hex");
}
/** Independent reread: the file at the common commit has exactly the bytes. */
async function independentlyVerifyFile(client:GiteaClient,r:AuthenticatedWriteSetFileReceipt){
 const changes=await client.getCommitChanges(r.commit_sha);
 if(changes.parents.length!==1||changes.parents[0]!==r.previous_head_sha)
  deny("published commit is not a single child of the pinned HEAD");
 const f=changes.files.find(x=>x.filename===r.path);
 if(!f||f.status!==(r.operation==="update_file"?"modified":"added"))
  deny("file is not changed by the common commit as authorized");
 const file=await client.readTextFile(r.branch,r.path,r.commit_sha);
 if(file.blob_sha!==r.blob_sha||sha(file.content)!==r.source_sha256||
    Buffer.byteLength(file.content,"utf8")!==r.source_bytes)
  deny("committed file differs from authorized bytes");
}

export class TrustedGatewayWriteSetEvidencePublisher{
 readonly #dir:string;readonly #key:Buffer;readonly #repository:string;
 readonly #branch:string;readonly #reader:GiteaClient;readonly #nowMs:()=>number;
 constructor(opts:{directory:string;key:Buffer;repository:string;branch:string;
  independentGiteaClient:GiteaClient;nowMs?:()=>number}){
  if(!opts||!(opts.key instanceof Buffer)||opts.key.length<32||
     !(opts.independentGiteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository??"")||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch??""))
   deny("publisher missing protected owner-only dependencies");
  validateDir(opts.directory);
  this.#dir=opts.directory;this.#key=Buffer.from(opts.key);
  this.#repository=opts.repository;this.#branch=opts.branch;
  this.#reader=opts.independentGiteaClient;this.#nowMs=opts.nowMs??Date.now;
 }
 static isNative(value:unknown):value is TrustedGatewayWriteSetEvidencePublisher{
  return value instanceof TrustedGatewayWriteSetEvidencePublisher&&#key in value;
 }
 /** Seal one receipt per file of the published write-set. Returns digests. */
 async publishAll(intent:TrustedWriteSetIntent,publication:WriteSetPublication,
  policyVersion:string):Promise<string[]>{
  if(intent.repository!==this.#repository||intent.branch!==this.#branch||
     !SHA64.test(publication.write_set_digest)||!ID.test(publication.batch_id)||
     !SHA40.test(publication.commit_sha)||publication.previous_head_sha!==intent.expected_head_sha||
     typeof policyVersion!=="string"||!policyVersion.trim()||policyVersion.length>128)
   deny("publication does not match the immutable write-set intent");
  const now=this.#nowMs();
  if(!Number.isSafeInteger(now)||now<=0)deny("invalid owner time");
  const out:string[]=[];
  for(const it of intent.items){
   const file=await this.#reader.readTextFile(intent.branch,it.path,publication.commit_sha);
   if(sha(file.content)!==it.next_content_sha256||
      Buffer.byteLength(file.content,"utf8")!==it.next_content_bytes||!SHA40.test(file.blob_sha))
    deny("independent post-CAS file differs from authorized bytes");
   const unsigned:Omit<AuthenticatedWriteSetFileReceipt,"mac_sha256">={
    schema:"authority-only-gitea-write-set-evidence-v1",kind:"gateway_write_set_file_published",
    session_id:intent.session_id,authority_digest:intent.authority_digest,
    root_credential_id:intent.root_credential_id,task_id:intent.task_id,
    runtime_task_id:intent.runtime_task_id,epoch:intent.epoch,agent_did:intent.agent_did,
    credential_id:intent.credential_id,request_id:it.request_id,
    request_fingerprint:it.request_fingerprint,repository:intent.repository,branch:intent.branch,
    write_set_digest:publication.write_set_digest,batch_id:publication.batch_id,
    commit_sha:publication.commit_sha,previous_head_sha:publication.previous_head_sha,
    sequence:it.sequence,path:it.path,operation:it.operation,
    expected_blob_sha:it.expected_blob_sha,blob_sha:file.blob_sha,
    source_sha256:it.next_content_sha256,source_bytes:it.next_content_bytes,
    policy_version:policyVersion,completed_at_ms:now};
   const receipt={...unsigned,mac_sha256:mac(this.#key,unsigned)};
   await independentlyVerifyFile(this.#reader,receipt);
   await writeReceipt(this.#dir,filename(intent.session_id,it.request_id),receipt);
   out.push(sha(canonical(receipt)));
  }
  return out;
 }
}

/** What the admissions require one file receipt to prove. */
export interface WriteSetEvidenceExpectation{
 readonly expected:TrustedCompletionExpectation;
 readonly publication:WriteSetPublication;
 readonly item:TrustedWriteSetIntentItem;
}
export class AuthenticatedWriteSetCompletionObserver{
 readonly #dir:string;readonly #key:Buffer;readonly #repository:string;
 readonly #branch:string;readonly #client:GiteaClient;readonly #nowMs:()=>number;
 constructor(opts:{directory:string;key:Buffer;repository:string;branch:string;
  giteaClient:GiteaClient;nowMs?:()=>number}){
  if(!opts||!(opts.key instanceof Buffer)||opts.key.length<32||
     !(opts.giteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository??"")||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch??""))
   deny("independent observer dependencies missing");
  validateDir(opts.directory);
  this.#dir=opts.directory;this.#key=Buffer.from(opts.key);
  this.#repository=opts.repository;this.#branch=opts.branch;
  this.#client=opts.giteaClient;this.#nowMs=opts.nowMs??Date.now;
 }
 static isNative(value:unknown):value is AuthenticatedWriteSetCompletionObserver{
  return value instanceof AuthenticatedWriteSetCompletionObserver&&#key in value;
 }
 /**
  * Verify the receipt of ONE file against the single effect AND the common
  * publication; reread Gitea independently. Returns the evidence digest.
  */
 async observe(x:WriteSetEvidenceExpectation):Promise<ObservedTrustedTaskCompletion&{
  commit_sha:string;write_set_digest:string}>{
  const {expected,publication,item}=x;
  const raw=await readReceipt(this.#dir,filename(expected.session_id,expected.request_id));
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     Object.keys(raw).sort().join(",")!==FIELDS)
   deny("malformed write-set file receipt");
  const r=raw as AuthenticatedWriteSetFileReceipt;
  const {mac_sha256,...unsigned}=r;
  const supplied=Buffer.from(String(mac_sha256),"hex");
  const want=Buffer.from(mac(this.#key,unsigned),"hex");
  if(supplied.length!==32||!timingSafeEqual(supplied,want))
   deny("forged or tampered write-set file receipt");
  if(BINDING.some(k=>r[k]!==expected[k])||r.repository!==this.#repository||r.branch!==this.#branch||
     r.schema!=="authority-only-gitea-write-set-evidence-v1"||r.kind!=="gateway_write_set_file_published")
   deny("receipt belongs to another effect, Task or repository");
  if(r.write_set_digest!==publication.write_set_digest||r.batch_id!==publication.batch_id||
     r.commit_sha!==publication.commit_sha||r.previous_head_sha!==publication.previous_head_sha)
   deny("receipt belongs to another write-set or commit");
  if(r.sequence!==item.sequence||r.path!==item.path||r.operation!==item.operation||
     r.expected_blob_sha!==item.expected_blob_sha||r.source_sha256!==item.next_content_sha256||
     r.source_bytes!==item.next_content_bytes||r.request_id!==item.request_id)
   deny("receipt does not match the authorized file of the write-set");
  if(Math.abs(this.#nowMs()-r.completed_at_ms)>30*60_000)deny("expired or future evidence");
  await independentlyVerifyFile(this.#client,r);
  return Object.freeze({...expected,status:"owner_verified_provider_result" as const,
   evidence_sha256:sha(canonical(r)),completed_at_ms:r.completed_at_ms,
   commit_sha:r.commit_sha,write_set_digest:r.write_set_digest});
 }
}
