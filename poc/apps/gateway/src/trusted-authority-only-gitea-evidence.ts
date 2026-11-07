/**
 * R294 — concrete read-only verifier of Gateway-owned Gitea read results.
 *
 * A protected owner-side process must FIRST write a MAC-authenticated receipt
 * after actual native Rust VP + OPA + Gateway Gitea provider success. This
 * reader cannot fabricate that receipt, issue an authority, or execute a
 * provider operation. It re-fetches Gitea data with an independent read-only
 * token and verifies the exact byte digest, blob and pinned HEAD.
 *
 * HMAC proves possession of the owner-only evidence key, NOT that the
 * underlying operation ran. The trusted result PUBLISHER is still a
 * separate integration requirement; no publishing API is exported here.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {GiteaClient} from "./gitea-client.ts";
import {TrustedAuthorityOnlyCompletionObserver,
 type TrustedCompletionExpectation,type ObservedTrustedTaskCompletion}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";

const SHA40=/^[a-f0-9]{40}$/u,SHA256=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const NAME=/^[a-z0-9][a-z0-9._-]{0,80}$/u;
function deny(reason:string):never{
 throw Error("Authority-only Gitea evidence NO-GO: "+reason);
}
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function canonical(v:unknown):string {
 if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
 if(v!==null&&typeof v==="object"){
  const o=v as Record<string,unknown>;
  return "{"+Object.keys(o).sort().map(k=>JSON.stringify(k)+":"+canonical(o[k])).join(",")+"}";
 }
 return JSON.stringify(v);
}
export interface AuthenticatedGatewayGiteaRead {
 readonly schema:"authority-only-gitea-read-evidence-v1";
 readonly kind:"gateway_read_file_completed";
 readonly session_id:string;readonly authority_digest:string;
 readonly root_credential_id:string;readonly task_id:string;
 readonly runtime_task_id:string;readonly epoch:number;
 readonly agent_did:string;readonly credential_id:string;
 readonly request_id:string;readonly request_fingerprint:string;
 readonly repository:string;readonly branch:string;readonly path:string;
 readonly revision:string;readonly blob_sha:string;
 readonly source_sha256:string;readonly source_bytes:number;
 readonly policy_version:string;readonly completed_at_ms:number;
 readonly verification:Readonly<{
  native_rust_vp_verified:true;opa_allow:true;
  gateway_provider_result:"success"
 }>;
 readonly mac_sha256:string;
}
const BINDING=[
 "session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","agent_did","credential_id",
 "request_id","request_fingerprint"
] as const;
const FIELDS=[
 "schema","kind",...BINDING,"repository","branch","path","revision",
 "blob_sha","source_sha256","source_bytes","policy_version",
 "completed_at_ms","verification","mac_sha256"
].sort().join(",");
/** Read-only: no receipt writer is available on the authority-only path. */
export class AuthenticatedGiteaReadCompletionObserver{
 readonly #directory:string;
 readonly #key:Buffer;
 readonly #gitea:GiteaClient;
 readonly #repository:string;
 readonly #branch:string;
 readonly #nowMs:()=>number;
 readonly #maxAgeMs:number;
 constructor(opts:{
  directory:string;
  key:Buffer; // separate owner-only 32+ byte evidence MAC secret
  giteaClient:GiteaClient;
  repository:string;
  branch:string;
  maxAgeMs?:number;
  nowMs?:()=>number;
 }){
  if(!opts||typeof opts.directory!=="string"||
     !isAbsolute(opts.directory)||resolve(opts.directory)!==opts.directory||
     opts.directory.length>512||
     !(opts.key instanceof Buffer)||opts.key.length<32||
     !(opts.giteaClient instanceof GiteaClient)||
     !/^([a-z0-9._-]+)\/([a-z0-9._-]+)$/u.test(opts.repository)||
     !opts.repository.split("/").every(x=>NAME.test(x))||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   deny("independent Gitea reader, fixed repository and secret owner directory required");
  const maxAgeMs=opts.maxAgeMs??10*60*1000;
  if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>30*60*1000)
   deny("bounded completion evidence age required");
  this.#directory=opts.directory;
  this.#key=Buffer.from(opts.key);
  this.#gitea=opts.giteaClient;
  this.#repository=opts.repository;
  this.#branch=opts.branch;
  this.#maxAgeMs=maxAgeMs;
  this.#nowMs=opts.nowMs??Date.now;
 }
 /** The original host may install this independent reader only for its
  * exact immutable repository and branch. Not an A2A or model capability. */
 isForRepository(repository:string,branch:string):boolean{
  const [owner,name]=repository.split("/");
  return this.#repository===repository&&this.#branch===branch&&
   !!owner&&!!name&&GiteaClient.isPinnedRepositoryClient(this.#gitea,owner,name);
 }
 toTrustedObserver():TrustedAuthorityOnlyCompletionObserver{
  return new TrustedAuthorityOnlyCompletionObserver({
   readVerifiedCompletion:(expected)=>this.observe(expected)
  });
 }
 async observe(expected:Readonly<TrustedCompletionExpectation>)
  :Promise<ObservedTrustedTaskCompletion>{
  return (await this.#observeVerified(expected)).completion;
 }
 /** R376: only AFTER the same MAC+independent Gitea verification used for
  * Gateway completion, expose a bounded source excerpt to the private owner.
  * Caller must additionally match the returned path to the signed Task URI.
  * Text is untrusted DATA; no new permission or success is asserted. */
 async observeSource(expected:Readonly<TrustedCompletionExpectation>){
  const {completion,source}=await this.#observeVerified(expected);
  // Preserve line breaks but remove terminal controls from model-facing data.
  const excerpt=source.content.slice(0,4096)
   .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu," ");
  return Object.freeze({
   status:"owner_verified_bounded_gitea_source_observation" as const,
   task_id:completion.task_id,runtime_task_id:completion.runtime_task_id,
   path:source.path,revision:source.revision,
   source_sha256:source.source_sha256,source_bytes:source.source_bytes,
   excerpt,excerpt_truncated:excerpt.length<source.content.length,
   evidence_sha256:completion.evidence_sha256
  });
 }
 async #observeVerified(expected:Readonly<TrustedCompletionExpectation>):
  Promise<{completion:ObservedTrustedTaskCompletion;
   source:Readonly<{path:string;revision:string;source_sha256:string;
    source_bytes:number;content:string}>}>{
  if(!expected||typeof expected!=="object"||
     !ID.test(expected.session_id)||!ID.test(expected.request_id)||
     !ID.test(expected.task_id)||!ID.test(expected.credential_id)||
     !SHA256.test(expected.authority_digest)||
     !SHA256.test(expected.request_fingerprint))
   deny("untrusted Gateway Task expectation");
  const dir=await lstat(this.#directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
   deny("evidence directory not owner private");
  const file=join(this.#directory,
   hash(expected.session_id+"\n"+expected.request_id)+".json");
  const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  let value:unknown;
  try{
   const st=await fd.stat();
   if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600||
      st.size<100||st.size>8192||
      (typeof process.getuid==="function"&&st.uid!==process.getuid()))
    deny("unsafe or oversized provider outcome");
   value=JSON.parse(await fd.readFile("utf8"));
  }finally{await fd.close();}
  if(!value||typeof value!=="object"||Array.isArray(value)||
     Object.keys(value).sort().join(",")!==FIELDS)
   deny("malformed Gateway provider evidence");
  const record=value as AuthenticatedGatewayGiteaRead;
  if(record.schema!=="authority-only-gitea-read-evidence-v1"||
     record.kind!=="gateway_read_file_completed"||
     BINDING.some(k=>record[k]!==expected[k])||
     record.repository!==this.#repository||record.branch!==this.#branch||
     typeof record.path!=="string"||!record.path||
     record.path.startsWith("/")||record.path.includes("..")||
     record.path.includes("\\")||record.path.split("/").some(x=>!x)||
     !SHA40.test(record.revision)||!SHA40.test(record.blob_sha)||
     !SHA256.test(record.source_sha256)||
     !Number.isSafeInteger(record.source_bytes)||
     record.source_bytes<0||record.source_bytes>2_000_000||
     typeof record.policy_version!=="string"||
     record.policy_version.length<1||record.policy_version.length>128||
     !Number.isSafeInteger(record.completed_at_ms)||
     record.completed_at_ms<=0||
     !record.verification||typeof record.verification!=="object"||
     Object.keys(record.verification).sort().join(",")!==
      ["native_rust_vp_verified","opa_allow","gateway_provider_result"].sort().join(",")||
     record.verification.native_rust_vp_verified!==true||
     record.verification.opa_allow!==true||
     record.verification.gateway_provider_result!=="success"||
     !SHA256.test(record.mac_sha256))
   deny("provider result lacks authenticated precise permission boundary");
  const now=this.#nowMs();
  if(!Number.isSafeInteger(now)||now<record.completed_at_ms||
     now-record.completed_at_ms>this.#maxAgeMs)
   deny("stale or future provider success evidence");
  const {mac_sha256,...unsigned}=record;
  const candidate=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest();
  if(!timingSafeEqual(candidate,Buffer.from(mac_sha256,"hex")))
   deny("provider evidence authentication failed");
  // The actual provider is queried again, independently of the original
  // result. A stale/advanced branch, different blob or changed bytes deny.
  const before=await this.#gitea.getBranchMetadata(this.#branch);
  if(before.commit_sha!==record.revision)
   deny("Gitea HEAD differs from recorded provider result");
  const observed=await this.#gitea.readTextFile(
   this.#branch,record.path,record.revision);
  const after=await this.#gitea.getBranchMetadata(this.#branch);
  const bytes=Buffer.from(observed.content,"utf8");
  if(after.commit_sha!==record.revision||
     observed.revision!==record.revision||
     observed.branch!==this.#branch||observed.path!==record.path||
     observed.blob_sha!==record.blob_sha||
     bytes.length!==record.source_bytes||
     hash(observed.content)!==record.source_sha256)
   deny("independent Gitea contents do not match authenticated result");
  if(this.#nowMs()>=record.completed_at_ms+this.#maxAgeMs)
   deny("evidence expired during provider verification");
  return Object.freeze({
   completion:Object.freeze({...structuredClone(expected),
    status:"owner_verified_provider_result" as const,
    evidence_sha256:hash(canonical(record)),
    completed_at_ms:record.completed_at_ms}),
   source:Object.freeze({path:record.path,revision:record.revision,
    source_sha256:record.source_sha256,source_bytes:record.source_bytes,
    content:observed.content})
  });
 }
}
