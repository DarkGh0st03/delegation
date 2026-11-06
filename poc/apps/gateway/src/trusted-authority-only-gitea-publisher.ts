/**
 * R295 — owner-private, append-only writer for authenticated Gateway
 * read_file outcomes. This is NOT a provider executor or an execution gate.
 *
 * Authority-only reads are fail-closed by default. The only intended
 * invocation is the opt-in Gateway post-provider-success hook after a
 * durably pinned read flight, Rust VP, OPA and a real GiteaExecutor read.
 * The read must remain at the exact owner-pinned current HEAD, corroborated
 * by a separately authenticated read-only Gitea client before MAC signing.
 * This is not a general ADK file-read capability: NEVER expose this
 * object via HTTP/A2A/MCP or infer permission from update_file.
 */
import {createHash,createHmac} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {GiteaClient} from "./gitea-client.ts";
import {assertTrustedGatewayGiteaReadResult}
 from "./gitea-executor.ts";
import type {GiteaReadFileExecutionResult,PolicyDecision,
 PreparedRequestRecord,VerifiedDelegation}
 from "./types.ts";
import type {AuthenticatedGatewayGiteaRead}
 from "./trusted-authority-only-gitea-evidence.ts";

const SHA40=/^[a-f0-9]{40}$/u;
const SHA64=/^[a-f0-9]{64}$/u;
function fail(s:string):never{
 throw Error("Authority-only Gitea evidence publisher NO-GO: "+s);
}
function canonical(value:unknown):string{
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 if(value!==null&&typeof value==="object"){
  const obj=value as Record<string,unknown>;
  return "{"+Object.keys(obj).sort().map(k=>
    JSON.stringify(k)+":"+canonical(obj[k])).join(",")+"}";
 }
 return JSON.stringify(value);
}
const sha=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");

/**
 * The key and directory MUST be supplied only by a trusted Gateway owner,
 * separate from Engineer Ed25519 keys, Runner signing keys and agent secrets.
 */
export class TrustedGatewayGiteaReadEvidencePublisher{
 readonly #directory:string;
 readonly #key:Buffer;
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #reader:GiteaClient;
 readonly #repository:string;
 readonly #branch:string;
 readonly #nowMs:()=>number;
 #inFlight=false;
 constructor(opts:{
  directory:string;key:Buffer;
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  independentGiteaClient:GiteaClient;
  repository:string;branch:string;nowMs?:()=>number;
 }){
  if(!opts||typeof opts.directory!=="string"||
     !isAbsolute(opts.directory)||resolve(opts.directory)!==opts.directory||
     opts.directory.length>512||
     !(opts.key instanceof Buffer)||opts.key.length<32||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.independentGiteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   fail("owner-private publisher dependencies missing");
  this.#directory=opts.directory;
  this.#key=Buffer.from(opts.key);
  this.#admissions=opts.admissions;
  this.#reader=opts.independentGiteaClient;
  this.#repository=opts.repository;
  this.#branch=opts.branch;
  this.#nowMs=opts.nowMs??Date.now;
 }
 isForAdmissions(admissions:TrustedAuthorityOnlyGatewayAdmissions):boolean{
  return this.#admissions===admissions;
 }
 /**
  * Accepts only an actual GiteaExecutor-produced result for THIS exact
  * PreparedRequestRecord (private WeakMap, not an agent-provided payload).
  * Gateway independently corroborates enrolled native Child and staged
  * effect flight; the *caller* must be the real Rust+OPA+provider pipeline.
  */
 async publishSuccessfulRead(input:Readonly<{
  record:PreparedRequestRecord;
  verified:VerifiedDelegation;
  policy:PolicyDecision;
  execution:GiteaReadFileExecutionResult;
 }>):Promise<Readonly<{
  status:"gateway_read_evidence_published_staged";
  request_id:string;evidence_sha256:string;
  provider_execution_enabled:false
 }>>{
  if(this.#inFlight)fail("concurrent evidence publication denied");
  const {record,verified,policy,execution}=input;
  if(!record||!verified||!policy||!execution||
     record.request.tool!=="read_file"||
     record.authority_only_digest===undefined||
     policy.allow!==true||
     typeof policy.policy_version!=="string"||
     !policy.policy_version.trim()||
     policy.policy_version.length>128||
     execution.provider!=="gitea"||
     execution.performed!==true||
     execution.tool!=="read_file"||
     execution.path!==record.request.arguments.path||
     execution.branch!==record.request.arguments.branch||
     execution.branch!==this.#branch||
     !SHA40.test(record.pinned_revision??"")||
     execution.revision!==record.pinned_revision||
     !SHA40.test(execution.revision)||
     !SHA40.test(execution.blob_sha))
   fail("provider success or independent OPA decision missing");
  const observed=assertTrustedGatewayGiteaReadResult(record,execution);
  const expected=this.#admissions.assertTrustedCompletedReadEvidenceBinding(
   record,verified);
  // A read of an old commit cannot be published as the current Task context.
  // Independently confirm the same HEAD and blob while the Gateway owner is
  // still live, before authoring any MAC that could unlock a later Task.
  const before=await this.#reader.getBranchMetadata(this.#branch);
  if(before.commit_sha!==record.pinned_revision)
   fail("read HEAD changed before owner evidence publication");
  const source=await this.#reader.readTextFile(
   this.#branch,execution.path,execution.revision);
  const after=await this.#reader.getBranchMetadata(this.#branch);
  if(source.branch!==this.#branch||source.path!==execution.path||
     source.revision!==record.pinned_revision||
     source.blob_sha!==execution.blob_sha||
     Buffer.byteLength(source.content,"utf8")!==observed.source_bytes||
     sha(source.content)!==observed.source_sha256||
     after.commit_sha!==record.pinned_revision)
   fail("independently reread provider source, blob or HEAD differs");
  const now=this.#nowMs();
  if(!Number.isSafeInteger(now)||now<=0||
     !SHA64.test(expected.authority_digest)||
     !SHA64.test(expected.request_fingerprint)||
     observed.source_bytes>2_000_000)
   fail("invalid owner time, original Task flight or source bounds");
  const dir=await lstat(this.#directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
   fail("evidence publisher directory is not owner-private");
  const unsigned:Omit<AuthenticatedGatewayGiteaRead,"mac_sha256">={
   schema:"authority-only-gitea-read-evidence-v1",
   kind:"gateway_read_file_completed",...expected,
   repository:this.#repository,branch:this.#branch,
   path:execution.path,revision:execution.revision,
   blob_sha:execution.blob_sha,source_sha256:observed.source_sha256,
   source_bytes:observed.source_bytes,
   policy_version:policy.policy_version,completed_at_ms:now,
   verification:{
    native_rust_vp_verified:true,
    opa_allow:true,
    gateway_provider_result:"success"
   }
  };
  const mac_sha256=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest("hex");
  const receipt:AuthenticatedGatewayGiteaRead={
   ...unsigned,mac_sha256
  };
  this.#inFlight=true;
  try{
   // The name is fixed by the prepared request, never a caller-supplied path.
   // A crash, cancellation or duplicate write requires manual reconciliation.
   const name=sha(expected.session_id+"\n"+expected.request_id)+".json";
   const fd=await open(join(this.#directory,name),
    constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,
    0o600);
   try{
    const st=await fd.stat();
    if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600)
     fail("unsafe authenticated provider result file");
    await fd.writeFile(JSON.stringify(receipt)+"\n","utf8");
    await fd.sync();
   }finally{await fd.close();}
   const dirfd=await open(this.#directory,
    constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   try{await dirfd.sync();}finally{await dirfd.close();}
  }finally{this.#inFlight=false;}
  return Object.freeze({
   status:"gateway_read_evidence_published_staged",
   request_id:expected.request_id,
   evidence_sha256:sha(canonical(receipt)),
   provider_execution_enabled:false
  });
 }
}
