/**
 * R383.6 — owner-authenticated CREATE_FILE evidence.
 *
 * A success receipt is published only after an independently pinned
 * Gitea read proves: old path absent at the exact parent, new feature
 * HEAD, one Git parent, and the new blob and UTF-8 bytes. The observer
 * reopens the 0600 MAC receipt and repeats the independent provider
 * verification. Neither class issues a write or an authorization.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {GiteaClient,type GiteaHeadCasCreatedFile} from "./gitea-client.ts";
import type {TrustedGiteaCreateIntent}
 from "./trusted-authority-only-create-intent-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver,
 type TrustedCompletionExpectation,type ObservedTrustedTaskCompletion}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";

const SHA40=/^[a-f0-9]{40}$/u,SHA64=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
function deny(reason:string):never{
 throw Error("Authority-only Gitea create evidence NO-GO: "+reason);
}
function canonical(v:unknown):string{
 if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
 if(v!==null&&typeof v==="object"){
  const o=v as Record<string,unknown>;
  return "{"+Object.keys(o).sort().map(k=>
   JSON.stringify(k)+":"+canonical(o[k])).join(",")+"}";
 }
 return JSON.stringify(v);
}
const BINDING=[
 "session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","agent_did","credential_id",
 "request_id","request_fingerprint"
] as const;
const FIELDS=[
 "schema","kind",...BINDING,"repository","branch","path",
 "previous_head_sha","old_path_absent_at_pinned_head",
 "commit_sha","blob_sha","source_sha256","source_bytes",
 "policy_version","completed_at_ms","verification","mac_sha256"
].sort().join(",");
export interface AuthenticatedGatewayGiteaCreate{
 readonly schema:"authority-only-gitea-create-evidence-v1";
 readonly kind:"gateway_atomic_create_file_completed";
 readonly session_id:string;readonly authority_digest:string;
 readonly root_credential_id:string;readonly task_id:string;
 readonly runtime_task_id:string;readonly epoch:number;
 readonly agent_did:string;readonly credential_id:string;
 readonly request_id:string;readonly request_fingerprint:string;
 readonly repository:string;readonly branch:string;readonly path:string;
 readonly previous_head_sha:string;
 readonly old_path_absent_at_pinned_head:true;
 readonly commit_sha:string;readonly blob_sha:string;
 readonly source_sha256:string;readonly source_bytes:number;
 readonly policy_version:string;readonly completed_at_ms:number;
 readonly verification:Readonly<{
  native_rust_vp_verified:true;opa_allow:true;
  atomic_head_cas:true;gateway_provider_result:"success";
  independent_old_path_absent:true
 }>;
 readonly mac_sha256:string;
}
function filename(e:TrustedCompletionExpectation):string{
 if(!ID.test(e.session_id)||!ID.test(e.request_id))
  deny("invalid original owner request ID");
 return sha(e.session_id+"\n"+e.request_id)+".create.json";
}
function validateDirectoryName(dir:string){
 if(!isAbsolute(dir)||resolve(dir)!==dir||dir.length>512)
  deny("absolute owner-private receipt directory required");
}
async function ownerDirectory(dir:string):Promise<void>{
 const st=await lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||
    (st.mode&0o777)!==0o700||
    (typeof process.getuid==="function"&&st.uid!==process.getuid()))
  deny("unsafe owner create receipt directory");
}
async function writeReceipt(dir:string,name:string,
 receipt:AuthenticatedGatewayGiteaCreate):Promise<void>{
 await ownerDirectory(dir);
 const fd=await open(join(dir,name),
  constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,
  0o600);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||
     (st.mode&0o777)!==0o600||
     (typeof process.getuid==="function"&&st.uid!==process.getuid()))
   deny("unsafe create receipt file");
  await fd.writeFile(JSON.stringify(receipt)+"\n","utf8");
  await fd.sync();
 }finally{await fd.close();}
 const d=await open(dir,
  constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await d.sync();}finally{await d.close();}
}
async function readReceipt(dir:string,name:string):Promise<unknown>{
 await ownerDirectory(dir);
 const fd=await open(join(dir,name),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||
     (st.mode&0o777)!==0o600||
     (typeof process.getuid==="function"&&st.uid!==process.getuid())||
     st.size<200||st.size>8192)
   deny("unsafe or ambiguous create receipt");
  return JSON.parse(await fd.readFile("utf8")) as unknown;
 }finally{await fd.close();}
}
function validateReceipt(raw:unknown,expected:TrustedCompletionExpectation,
 repository:string,branch:string):AuthenticatedGatewayGiteaCreate{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))
  deny("missing or malformed authenticated create receipt");
 const r=raw as Record<string,unknown>;
 if(Object.keys(r).sort().join(",")!==FIELDS||
    r.schema!=="authority-only-gitea-create-evidence-v1"||
    r.kind!=="gateway_atomic_create_file_completed"||
    r.repository!==repository||r.branch!==branch||
    BINDING.some(k=>r[k]!==expected[k])||
    !SHA64.test(r.authority_digest as string)||
    !SHA64.test(r.request_fingerprint as string)||
    !SHA64.test(r.source_sha256 as string)||
    !SHA64.test(r.mac_sha256 as string)||
    !SHA40.test(r.previous_head_sha as string)||
    !SHA40.test(r.commit_sha as string)||
    !SHA40.test(r.blob_sha as string)||
    r.previous_head_sha===r.commit_sha||
    r.old_path_absent_at_pinned_head!==true||
    typeof r.path!=="string"||!r.path||r.path.length>512||
    r.path.startsWith("/")||r.path.split("/").some(p=>
      !p||p==="."||p===".."||p.includes("%")||p.includes("\\"))||
    !Number.isSafeInteger(r.source_bytes)||
    Number(r.source_bytes)<1||Number(r.source_bytes)>2_000_000||
    !Number.isSafeInteger(r.completed_at_ms)||
    Number(r.completed_at_ms)<=0||
    typeof r.policy_version!=="string"||!r.policy_version.trim()||
    r.policy_version.length>128)
  deny("create receipt does not match original signed Task/Child");
 const v=r.verification;
 if(!v||typeof v!=="object"||Array.isArray(v)||
    Object.keys(v).sort().join(",")!==[
     "native_rust_vp_verified","opa_allow","atomic_head_cas",
     "gateway_provider_result","independent_old_path_absent"].sort().join(",")||
    (v as Record<string,unknown>).native_rust_vp_verified!==true||
    (v as Record<string,unknown>).opa_allow!==true||
    (v as Record<string,unknown>).atomic_head_cas!==true||
    (v as Record<string,unknown>).independent_old_path_absent!==true||
    (v as Record<string,unknown>).gateway_provider_result!=="success")
  deny("unverified native create provider result");
 return raw as AuthenticatedGatewayGiteaCreate;
}
async function independentlyVerify(client:GiteaClient,
 receipt:AuthenticatedGatewayGiteaCreate):Promise<void>{
 const proof=await client.verifyCreatedFileHeadCas({
  branch:receipt.branch,path:receipt.path,
  expectedHeadSha:receipt.previous_head_sha,
  createdCommitSha:receipt.commit_sha,createdBlobSha:receipt.blob_sha,
  expectedContentSha256:receipt.source_sha256,
  expectedContentBytes:receipt.source_bytes
 });
 if(proof.status!=="gitea_create_head_cas_read_only_verified"||
    proof.provider_write_authorized!==false||
    proof.branch!==receipt.branch||proof.path!==receipt.path||
    proof.previous_head_sha!==receipt.previous_head_sha||
    proof.commit_sha!==receipt.commit_sha||
    proof.blob_sha!==receipt.blob_sha||
    proof.content_sha256!==receipt.source_sha256)
  deny("independent Gitea create proof differs from receipt");
}
export class AuthenticatedGiteaCreateCompletionObserver{
 readonly #dir:string;
 readonly #key:Buffer;
 readonly #repository:string;
 readonly #branch:string;
 readonly #reader:GiteaClient;
 readonly #nowMs:()=>number;
 constructor(opts:{
  directory:string;key:Buffer;repository:string;branch:string;
  independentGiteaClient:GiteaClient;nowMs?:()=>number
 }){
  if(!opts||typeof opts.directory!=="string"||
     !Buffer.isBuffer(opts.key)||opts.key.length!==32||
     !(opts.independentGiteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !GiteaClient.isPinnedRepositoryClient(opts.independentGiteaClient,
      opts.repository.split("/")[0],opts.repository.split("/")[1])||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   deny("owner-independent create observer identity required");
  validateDirectoryName(opts.directory);
  this.#dir=opts.directory;this.#key=Buffer.from(opts.key);
  this.#repository=opts.repository;this.#branch=opts.branch;
  this.#reader=opts.independentGiteaClient;
  this.#nowMs=opts.nowMs??Date.now;
 }
 static isForRepository(value:unknown,repository:string,branch:string):
  value is AuthenticatedGiteaCreateCompletionObserver{
  return value instanceof AuthenticatedGiteaCreateCompletionObserver&&
   #repository in value&&value.#repository===repository&&
   value.#branch===branch&&
   GiteaClient.isPinnedRepositoryClient(value.#reader,
    repository.split("/")[0],repository.split("/")[1]);
 }
 isIndependentOf(client:GiteaClient):boolean{
  return this.#reader!==client;
 }
 async observe(expected:TrustedCompletionExpectation):
 Promise<ObservedTrustedTaskCompletion>{
  const raw=await readReceipt(this.#dir,filename(expected));
  const receipt=validateReceipt(raw,expected,this.#repository,this.#branch);
  const {mac_sha256,...unsigned}=receipt;
  const actual=Buffer.from(mac_sha256,"hex");
  const required=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest();
  if(actual.length!==32||!timingSafeEqual(actual,required))
   deny("forged or altered create receipt MAC");
  const now=this.#nowMs();
  if(!Number.isSafeInteger(now)||
     Math.abs(now-receipt.completed_at_ms)>30*60_000)
   deny("stale or future-dated create receipt");
  await independentlyVerify(this.#reader,receipt);
  return Object.freeze({...expected,
   status:"owner_verified_provider_result" as const,
   evidence_sha256:sha(canonical(receipt)),
   completed_at_ms:receipt.completed_at_ms
  });
 }
 toTrustedObserver():TrustedAuthorityOnlyCompletionObserver{
  return new TrustedAuthorityOnlyCompletionObserver({
   readVerifiedCompletion:expected=>this.observe(expected)
  });
 }
}
export class TrustedGatewayGiteaCreateEvidencePublisher{
 readonly #dir:string;
 readonly #key:Buffer;
 readonly #repository:string;
 readonly #branch:string;
 readonly #reader:GiteaClient;
 readonly #nowMs:()=>number;
 constructor(opts:{
  directory:string;key:Buffer;repository:string;branch:string;
  independentGiteaClient:GiteaClient;nowMs?:()=>number
 }){
  if(!opts||typeof opts.directory!=="string"||
     !Buffer.isBuffer(opts.key)||opts.key.length!==32||
     !(opts.independentGiteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !GiteaClient.isPinnedRepositoryClient(opts.independentGiteaClient,
      opts.repository.split("/")[0],opts.repository.split("/")[1])||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   deny("owner-independent create publisher identity required");
  validateDirectoryName(opts.directory);
  this.#dir=opts.directory;this.#key=Buffer.from(opts.key);
  this.#repository=opts.repository;this.#branch=opts.branch;
  this.#reader=opts.independentGiteaClient;
  this.#nowMs=opts.nowMs??Date.now;
 }
 isForRepository(repository:string,branch:string,writer:GiteaClient):boolean{
  return this.#repository===repository&&this.#branch===branch&&
   this.#reader!==writer;
 }
 async publish(intent:TrustedGiteaCreateIntent,
  effect:TrustedCompletionExpectation,result:GiteaHeadCasCreatedFile,
  policyVersion:string):Promise<string>{
  if(!intent||!effect||!result||
     BINDING.some(k=>intent[k]!==effect[k])||
     intent.provider_write_authorized!==false||
     intent.old_path_absent_at_pinned_head!==true||
     intent.repository!==this.#repository||intent.branch!==this.#branch||
     result.branch!==this.#branch||result.path!==intent.path||
     result.previous_head_sha!==intent.expected_head_sha||
     result.old_path_absent_at_pinned_head!==true||
     result.commit_sha!==result.revision||
     !SHA40.test(result.commit_sha)||!SHA40.test(result.blob_sha)||
     result.commit_sha===intent.expected_head_sha||
     result.next_content_sha256!==intent.next_content_sha256||
     typeof policyVersion!=="string"||!policyVersion.trim()||
     policyVersion.length>128)
   deny("Gitea create CAS result differs from immutable signed intent");
  const now=this.#nowMs();
  if(!Number.isSafeInteger(now)||now<=0)deny("invalid owner time");
  const unsigned:Omit<AuthenticatedGatewayGiteaCreate,"mac_sha256">={
   schema:"authority-only-gitea-create-evidence-v1",
   kind:"gateway_atomic_create_file_completed",
   ...effect,
   repository:this.#repository,branch:this.#branch,path:intent.path,
   previous_head_sha:intent.expected_head_sha,
   old_path_absent_at_pinned_head:true,
   commit_sha:result.commit_sha,blob_sha:result.blob_sha,
   source_sha256:intent.next_content_sha256,
   source_bytes:intent.next_content_bytes,
   policy_version:policyVersion,completed_at_ms:now,
   verification:{native_rust_vp_verified:true,opa_allow:true,
    atomic_head_cas:true,gateway_provider_result:"success",
    independent_old_path_absent:true}
  };
  // Do not write a success receipt unless an independently provisioned
  // read-only Gitea client validates the original parent and old absence.
  await independentlyVerify(this.#reader,{
   ...unsigned,mac_sha256:"0".repeat(64)
  });
  const mac_sha256=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest("hex");
  const receipt:AuthenticatedGatewayGiteaCreate={
   ...unsigned,mac_sha256
  };
  await writeReceipt(this.#dir,filename(effect),receipt);
  return sha(canonical(receipt));
 }
}
