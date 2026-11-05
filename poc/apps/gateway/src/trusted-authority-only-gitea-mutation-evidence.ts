/**
 * R302.4 — independent owner-authenticated Gitea atomic update evidence.
 *
 * One owner-only writer seals a result AFTER a real conditional Gitea
 * branch-CAS; one separately-injected observer verifies the MAC and the
 * actual immutable commit, old parent, current HEAD and new file contents.
 * None of this authorizes a provider call or a model instruction.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {GiteaClient,type GiteaHeadCasFileMutation} from "./gitea-client.ts";
import type {TrustedGiteaMutationIntent}
 from "./trusted-authority-only-mutation-intent-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver,
 type TrustedCompletionExpectation,type ObservedTrustedTaskCompletion}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";

const SHA40=/^[a-f0-9]{40}$/u,SHA64=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
function deny(reason:string):never{throw Error("Authority-only Gitea mutation evidence NO-GO: "+reason);}
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
 "runtime_task_id","epoch","agent_did","credential_id","request_id",
 "request_fingerprint"
] as const;
const FIELDS=[
 "schema","kind",...BINDING,"repository","branch","path",
 "previous_head_sha","previous_blob_sha","commit_sha","blob_sha",
 "source_sha256","source_bytes","policy_version","completed_at_ms",
 "verification","mac_sha256"
].sort().join(",");
export interface AuthenticatedGatewayGiteaMutation{
 readonly schema:"authority-only-gitea-mutation-evidence-v1";
 readonly kind:"gateway_atomic_update_file_completed";
 readonly session_id:string;readonly authority_digest:string;
 readonly root_credential_id:string;readonly task_id:string;
 readonly runtime_task_id:string;readonly epoch:number;
 readonly agent_did:string;readonly credential_id:string;
 readonly request_id:string;readonly request_fingerprint:string;
 readonly repository:string;readonly branch:string;readonly path:string;
 readonly previous_head_sha:string;readonly previous_blob_sha:string;
 readonly commit_sha:string;readonly blob_sha:string;
 readonly source_sha256:string;readonly source_bytes:number;
 readonly policy_version:string;readonly completed_at_ms:number;
 readonly verification:Readonly<{
  native_rust_vp_verified:true;opa_allow:true;
  atomic_head_cas:true;gateway_provider_result:"success"
 }>;
 readonly mac_sha256:string;
}
function filename(e:TrustedCompletionExpectation){
 if(!ID.test(e.session_id)||!ID.test(e.request_id))
  deny("invalid protected request ID");
 return sha(e.session_id+"\n"+e.request_id)+".mutation.json";
}
function validateDir(path:string){
 if(!isAbsolute(path)||resolve(path)!==path||path.length>512)
  deny("absolute owner-private receipt directory required");
}
async function ownerDir(dir:string){
 const st=await lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||
    (st.mode&0o777)!==0o700||
    (typeof process.getuid==="function"&&st.uid!==process.getuid()))
  deny("unsafe mutation evidence directory");
}
async function readPrivateReceipt(
 dir:string,name:string
):Promise<unknown>{
 await ownerDir(dir);
 const fd=await open(join(dir,name),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600||
     (typeof process.getuid==="function"&&st.uid!==process.getuid())||
     st.size<200||st.size>8192)
   deny("unsafe mutation result receipt");
  return JSON.parse(await fd.readFile("utf8")) as unknown;
 }finally{await fd.close();}
}
async function writePrivateReceipt(
 dir:string,name:string,receipt:AuthenticatedGatewayGiteaMutation
):Promise<void>{
 await ownerDir(dir);
 const fd=await open(join(dir,name),
  constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,
  0o600);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600)
   deny("unsafe owner-authenticated mutation evidence file");
  await fd.writeFile(JSON.stringify(receipt)+"\n","utf8");
  await fd.sync();
 }finally{await fd.close();}
 const d=await open(dir,constants.O_RDONLY|constants.O_DIRECTORY|
  constants.O_NOFOLLOW);
 try{await d.sync();}finally{await d.close();}
}
function validateReceipt(
 raw:unknown,expected:TrustedCompletionExpectation,repository:string,
 branch:string
):AuthenticatedGatewayGiteaMutation{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))
  deny("mutation receipt missing or malformed");
 const r=raw as Record<string,unknown>;
 if(Object.keys(r).sort().join(",")!==FIELDS||
    r.schema!=="authority-only-gitea-mutation-evidence-v1"||
    r.kind!=="gateway_atomic_update_file_completed"||
    r.repository!==repository||r.branch!==branch||
    BINDING.some(k=>r[k]!==expected[k])||
    !SHA64.test(r.authority_digest as string)||
    !SHA64.test(r.request_fingerprint as string)||
    !SHA64.test(r.source_sha256 as string)||
    !SHA64.test(r.mac_sha256 as string)||
    !SHA40.test(r.previous_head_sha as string)||
    !SHA40.test(r.previous_blob_sha as string)||
    !SHA40.test(r.commit_sha as string)||
    !SHA40.test(r.blob_sha as string)||
    r.commit_sha===r.previous_head_sha||
    typeof r.path!=="string"||
    r.path.length>512||r.path.startsWith("/")||
    r.path.split("/").some(p=>!p||p==="."||p===".."||
      p.includes("%")||p.includes("\\"))||
    !Number.isSafeInteger(r.source_bytes)||
    (r.source_bytes as number)<1||(r.source_bytes as number)>2_000_000||
    !Number.isSafeInteger(r.completed_at_ms)||
    (r.completed_at_ms as number)<=0||
    typeof r.policy_version!=="string"||
    !r.policy_version.trim()||r.policy_version.length>128)
  deny("receipt differs from protected original Task authority");
 const v=r.verification;
 if(!v||typeof v!=="object"||Array.isArray(v)||
    Object.keys(v).sort().join(",")!==[
     "native_rust_vp_verified","opa_allow","atomic_head_cas",
     "gateway_provider_result"].sort().join(",")||
    (v as Record<string,unknown>).native_rust_vp_verified!==true||
    (v as Record<string,unknown>).opa_allow!==true||
    (v as Record<string,unknown>).atomic_head_cas!==true||
    (v as Record<string,unknown>).gateway_provider_result!=="success")
  deny("mutation proof status is incomplete");
 return raw as AuthenticatedGatewayGiteaMutation;
}
async function independentlyVerifyCas(
 client:GiteaClient,receipt:AuthenticatedGatewayGiteaMutation
):Promise<void>{
 const before=await client.getBranchMetadata(receipt.branch);
 if(before.commit_sha!==receipt.commit_sha)
  deny("feature HEAD is not the authenticated mutated commit");
 const parent=await client.getSingleGitCommitParent(receipt.commit_sha);
 if(parent!==receipt.previous_head_sha)
  deny("new commit did not descend directly from pinned old HEAD");
 const file=await client.readTextFile(
  receipt.branch,receipt.path,receipt.commit_sha);
 const bytes=Buffer.from(file.content,"utf8");
 if(file.revision!==receipt.commit_sha||file.path!==receipt.path||
    file.branch!==receipt.branch||file.blob_sha!==receipt.blob_sha||
    bytes.length!==receipt.source_bytes||
    sha(file.content)!==receipt.source_sha256)
  deny("actual Gitea mutation bytes or blob do not match receipt");
 const after=await client.getBranchMetadata(receipt.branch);
 if(after.commit_sha!==receipt.commit_sha)
  deny("feature HEAD changed during independent mutation proof");
}
export class AuthenticatedGiteaMutationCompletionObserver{
 readonly #dir:string;
 readonly #key:Buffer;
 readonly #repository:string;
 readonly #branch:string;
 readonly #client:GiteaClient;
 readonly #nowMs:()=>number;
 constructor(opts:{
  directory:string;key:Buffer;repository:string;branch:string;
  giteaClient:GiteaClient;nowMs?:()=>number
 }){
  if(!opts||typeof opts.directory!=="string"||
     !(opts.key instanceof Buffer)||opts.key.length<32||
     !(opts.giteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   deny("independent observer dependencies missing");
  validateDir(opts.directory);
  this.#dir=opts.directory;
  this.#key=Buffer.from(opts.key);
  this.#repository=opts.repository;
  this.#branch=opts.branch;
  this.#client=opts.giteaClient;
  this.#nowMs=opts.nowMs??Date.now;
 }
 async observe(expected:TrustedCompletionExpectation):
 Promise<ObservedTrustedTaskCompletion>{
  const raw=await readPrivateReceipt(this.#dir,filename(expected));
  const receipt=validateReceipt(raw,expected,this.#repository,this.#branch);
  const {mac_sha256,...unsigned}=receipt;
  const expectedMac=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest();
  const supplied=Buffer.from(mac_sha256,"hex");
  if(supplied.length!==32||!timingSafeEqual(supplied,expectedMac))
   deny("forged or tampered owner-authenticated mutation receipt");
  const now=this.#nowMs();
  if(Math.abs(now-receipt.completed_at_ms)>30*60_000)
   deny("expired or future mutation evidence");
  await independentlyVerifyCas(this.#client,receipt);
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
/** Never accept an untrusted caller-supplied outcome; the provider result
 * must come from GiteaClient.updateFileWithHeadCas after the reserved flight.
 */
export class TrustedGatewayGiteaMutationEvidencePublisher{
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
     !(opts.key instanceof Buffer)||opts.key.length<32||
     !(opts.independentGiteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   deny("publisher missing protected owner-only dependencies");
  validateDir(opts.directory);
  this.#dir=opts.directory;
  this.#key=Buffer.from(opts.key);
  this.#repository=opts.repository;
  this.#branch=opts.branch;
  this.#reader=opts.independentGiteaClient;
  this.#nowMs=opts.nowMs??Date.now;
 }
 async publish(
  intent:TrustedGiteaMutationIntent,
  effect:TrustedCompletionExpectation,
  result:GiteaHeadCasFileMutation,policyVersion:string
 ):Promise<string>{
  if(BINDING.some(k=>intent[k]!==effect[k])||
     intent.repository!==this.#repository||
     intent.branch!==this.#branch||
     result.branch!==this.#branch||
     result.path!==intent.path||
     result.previous_head_sha!==intent.expected_head_sha||
     result.previous_blob_sha!==intent.expected_blob_sha||
     result.precondition_blob_sha!==intent.expected_blob_sha||
     result.commit_sha!==result.revision||
     result.blob_sha.length!==40||
     result.previous_revision!==intent.expected_head_sha||
     result.next_content_sha256!==intent.next_content_sha256||
     typeof policyVersion!=="string"||!policyVersion.trim()||
     policyVersion.length>128)
   deny("CAS result does not match immutable Task intent");
  const committed=await this.#reader.readTextFile(
   intent.branch,intent.path,result.commit_sha);
  const bytes=Buffer.from(committed.content,"utf8");
  if(committed.blob_sha!==result.blob_sha||
     sha(committed.content)!==intent.next_content_sha256||
     bytes.length!==intent.next_content_bytes)
   deny("independent post-CAS file differs from prepared bytes");
  const now=this.#nowMs();
  if(!Number.isSafeInteger(now)||now<=0)deny("invalid owner time");
  const unsigned:Omit<AuthenticatedGatewayGiteaMutation,"mac_sha256">={
   schema:"authority-only-gitea-mutation-evidence-v1",
   kind:"gateway_atomic_update_file_completed",
   ...effect,
   repository:this.#repository,branch:this.#branch,path:intent.path,
   previous_head_sha:intent.expected_head_sha,
   previous_blob_sha:intent.expected_blob_sha,
   commit_sha:result.commit_sha,blob_sha:result.blob_sha,
   source_sha256:intent.next_content_sha256,
   source_bytes:intent.next_content_bytes,
   policy_version:policyVersion,completed_at_ms:now,
   verification:{native_rust_vp_verified:true,opa_allow:true,
    atomic_head_cas:true,gateway_provider_result:"success"}
  };
  const mac_sha256=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest("hex");
  const receipt:AuthenticatedGatewayGiteaMutation={
   ...unsigned,mac_sha256
  };
  // Do not publish a success before all independent Gitea checks pass.
  await independentlyVerifyCas(this.#reader,receipt);
  await writePrivateReceipt(this.#dir,filename(effect),receipt);
  return sha(canonical(receipt));
 }
}
