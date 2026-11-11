/**
 * R383.3 — crash-durable CREATE_FILE intent (NO provider write).
 *
 * Separate from the R302 update journal because file creation has NO
 * previous blob. The only acceptable precondition is independently
 * observed absence at the exact old branch HEAD. Reservation alone never
 * grants Rust/OPA, permits a provider call or completes a Task.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {isDeepStrictEqual} from "node:util";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA40=/^[a-f0-9]{40}$/u;
const SHA64=/^[a-f0-9]{64}$/u;
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function deny(detail:string):never{
 throw Error("Authority-only Gitea create intent NO-WRITE: "+detail);
}
export interface TrustedGiteaCreateIntent {
 readonly schema:"authority-only-gitea-create-intent-v1";
 readonly kind:"create_file_preflight_only";
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
 readonly old_path_absent_at_pinned_head:true;
 readonly next_content_sha256:string;
 readonly next_content_bytes:number;
 readonly prepared_at_ms:number;
 readonly provider_write_authorized:false;
}
const FIELDS=[
 "schema","kind","session_id","authority_digest",
 "root_credential_id","task_id","runtime_task_id","epoch",
 "agent_did","credential_id","request_id","request_fingerprint",
 "repository","branch","path","expected_head_sha",
 "old_path_absent_at_pinned_head","next_content_sha256",
 "next_content_bytes","prepared_at_ms","provider_write_authorized"
].sort().join(",");

export class DurableAuthorityOnlyGiteaCreateIntentJournal {
 readonly #directory:string;
 #writeInFlight=false;
 constructor(directory:string){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||directory.length>512)
   deny("owner-private absolute intent directory required");
  this.#directory=directory;
 }
 async #privateDirectory():Promise<void>{
  const st=await lstat(this.#directory);
  if(!st.isDirectory()||st.isSymbolicLink()||
     (st.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&st.uid!==process.getuid()))
   deny("unsafe shared or unowned create-intent directory");
 }
 #filename(intent:TrustedGiteaCreateIntent){
  return hash(intent.session_id+"\n"+intent.task_id)+".create-intent.json";
 }
 async #read(file:string):Promise<unknown>{
  await this.#privateDirectory();
  const fd=await open(join(this.#directory,file),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const st=await fd.stat();
   if(!st.isFile()||st.nlink!==1||
      (st.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&st.uid!==process.getuid())||
      st.size<100||st.size>8192)
    deny("create intent marker is unsafe or ambiguous");
   return JSON.parse(await fd.readFile("utf8")) as unknown;
  }finally{await fd.close();}
 }
 static assertCanonicalIntent(intent:unknown):
  asserts intent is TrustedGiteaCreateIntent{
  if(!intent||typeof intent!=="object"||Array.isArray(intent))
   deny("signed owner-created create intent missing");
  const x=intent as Record<string,unknown>;
  if(Object.keys(x).sort().join(",")!==FIELDS||
     x.schema!=="authority-only-gitea-create-intent-v1"||
     x.kind!=="create_file_preflight_only"||
     x.old_path_absent_at_pinned_head!==true||
     x.provider_write_authorized!==false||
     !ID.test(x.session_id as string)||
     !ID.test(x.task_id as string)||
     !ID.test(x.runtime_task_id as string)||
     !ID.test(x.request_id as string)||
     !ID.test(x.root_credential_id as string)||
     !ID.test(x.credential_id as string)||
     x.root_credential_id===x.credential_id||
     typeof x.agent_did!=="string"||
     !x.agent_did.startsWith("did:")||x.agent_did.length>256||
     !SHA64.test(x.authority_digest as string)||
     !SHA64.test(x.request_fingerprint as string)||
     !SHA64.test(x.next_content_sha256 as string)||
     !SHA40.test(x.expected_head_sha as string)||
     !Number.isSafeInteger(x.epoch)||Number(x.epoch)<1||
     Number(x.epoch)>256||
     !Number.isSafeInteger(x.prepared_at_ms)||
     Number(x.prepared_at_ms)<=0||
     !Number.isSafeInteger(x.next_content_bytes)||
     Number(x.next_content_bytes)<1||
     Number(x.next_content_bytes)>2_000_000||
     typeof x.repository!=="string"||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(x.repository)||
     typeof x.branch!=="string"||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(x.branch)||
     x.branch.includes("..")||x.branch.includes("//")||
     x.branch.startsWith("feature/r302-internal-")||
     x.branch.startsWith("feature/r3832-create-")||
     typeof x.path!=="string"||!x.path||
     x.path.length>512||x.path.startsWith("/")||
     x.path.split("/").some(p=>!p||p==="."||p===".."||
       p.includes("%")||p.includes("\\")))
   deny("untrusted Task, Child or canonical create intent");
 }
 async reserve(intent:TrustedGiteaCreateIntent):Promise<void>{
  DurableAuthorityOnlyGiteaCreateIntentJournal.assertCanonicalIntent(intent);
  if(this.#writeInFlight)deny("concurrent durable create reservation");
  this.#writeInFlight=true;
  try{
   await this.#privateDirectory();
   const fd=await open(join(this.#directory,this.#filename(intent)),
    constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|
    constants.O_NOFOLLOW,0o600);
   try{
    const st=await fd.stat();
    if(!st.isFile()||st.nlink!==1||
       (st.mode&0o777)!==0o600||
       (typeof process.getuid==="function"&&st.uid!==process.getuid()))
     deny("unsafe create-intent marker");
    await fd.writeFile(JSON.stringify(intent)+"\n","utf8");
    await fd.sync();
   }finally{await fd.close();}
   const dirfd=await open(this.#directory,
    constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   try{await dirfd.sync();}finally{await dirfd.close();}
  }finally{this.#writeInFlight=false;}
 }
 async assertReserved(intent:TrustedGiteaCreateIntent):Promise<void>{
  DurableAuthorityOnlyGiteaCreateIntentJournal.assertCanonicalIntent(intent);
  const actual=await this.#read(this.#filename(intent));
  if(!isDeepStrictEqual(actual,intent))
   deny("original immutable create intent differs from persistent marker");
 }

 /**
  * R383.4 — crash-durable, irrevocable one-shot attempt fence.
  * Only the trusted owner may invoke this AFTER the Gateway independently
  * verifies the native Rust VP, OPA allow and consumed Task/Child flight.
  * This NO-WRITE marker is NOT an authorization, Gitea result or receipt.
  * An ambiguous attempt is terminal, including after process restart.
  */
 async reserveAttempt(intent:TrustedGiteaCreateIntent):Promise<void>{
  if(this.#writeInFlight)deny("concurrent create attempt reservation");
  this.#writeInFlight=true;
  try{
   await this.assertReserved(intent);
   await this.#privateDirectory();
   const attempt=Object.freeze({
    schema:"authority-only-gitea-create-attempt-v1",
    session_id:intent.session_id,
    authority_digest:intent.authority_digest,
    root_credential_id:intent.root_credential_id,
    task_id:intent.task_id,
    runtime_task_id:intent.runtime_task_id,
    epoch:intent.epoch,
    agent_did:intent.agent_did,
    credential_id:intent.credential_id,
    request_id:intent.request_id,
    request_fingerprint:intent.request_fingerprint,
    repository:intent.repository,
    branch:intent.branch,
    path:intent.path,
    expected_head_sha:intent.expected_head_sha,
    next_content_sha256:intent.next_content_sha256,
    next_content_bytes:intent.next_content_bytes,
    provider_write_authorized:false
   } as const);
   const file=this.#filename(intent).replace(".create-intent.json",
    ".create-attempt.json");
   const fd=await open(join(this.#directory,file),
    constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|
    constants.O_NOFOLLOW,0o600);
   try{
    const st=await fd.stat();
    if(!st.isFile()||st.nlink!==1||
       (st.mode&0o777)!==0o600||
       (typeof process.getuid==="function"&&st.uid!==process.getuid()))
     deny("unsafe create-attempt marker");
    await fd.writeFile(JSON.stringify(attempt)+"\n","utf8");
    await fd.sync();
   }finally{await fd.close();}
   const dirfd=await open(this.#directory,
    constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   try{await dirfd.sync();}finally{await dirfd.close();}
  }finally{this.#writeInFlight=false;}
 }

 /**
  * R383.6 — remember ONLY an independently verified signed CREATE receipt.
  * An existing attempt marker is necessary; a successful Gitea callback
  * without owner MAC and independent observation is NOT sufficient.
  */
 async reserveCompletedEvidence(intent:TrustedGiteaCreateIntent,
  verifiedEvidenceSha256:string):Promise<void>{
  if(!SHA64.test(verifiedEvidenceSha256))
   deny("unauthenticated create completion digest");
  if(this.#writeInFlight)deny("concurrent create completion reservation");
  this.#writeInFlight=true;
  try{
   await this.assertReserved(intent);
   const stem=this.#filename(intent).replace(".create-intent.json","");
   const attempt=await this.#read(stem+".create-attempt.json");
   if(!attempt||typeof attempt!=="object"||Array.isArray(attempt))
    deny("missing durable create provider attempt");
   const a=attempt as Record<string,unknown>;
   if(a.schema!=="authority-only-gitea-create-attempt-v1"||
      a.session_id!==intent.session_id||
      a.root_credential_id!==intent.root_credential_id||
      a.authority_digest!==intent.authority_digest||
      a.task_id!==intent.task_id||
      a.runtime_task_id!==intent.runtime_task_id||
      a.epoch!==intent.epoch||
      a.agent_did!==intent.agent_did||
      a.credential_id!==intent.credential_id||
      a.request_id!==intent.request_id||
      a.request_fingerprint!==intent.request_fingerprint||
      a.repository!==intent.repository||
      a.branch!==intent.branch||a.path!==intent.path||
      a.expected_head_sha!==intent.expected_head_sha||
      a.next_content_sha256!==intent.next_content_sha256||
      a.next_content_bytes!==intent.next_content_bytes||
      a.provider_write_authorized!==false)
    deny("create attempt differs from protected original Task");
   await this.#privateDirectory();
   const file=stem+".create-completed.json";
   const fd=await open(join(this.#directory,file),
    constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|
    constants.O_NOFOLLOW,0o600);
   try{
    const st=await fd.stat();
    if(!st.isFile()||st.nlink!==1||
       (st.mode&0o777)!==0o600||
       (typeof process.getuid==="function"&&st.uid!==process.getuid()))
     deny("unsafe create-completion marker");
    await fd.writeFile(JSON.stringify({
     schema:"authority-only-gitea-create-completion-v1",
     session_id:intent.session_id,task_id:intent.task_id,
     request_id:intent.request_id,
     request_fingerprint:intent.request_fingerprint,
     verified_evidence_sha256:verifiedEvidenceSha256
    })+"\n","utf8");
    await fd.sync();
   }finally{await fd.close();}
   const d=await open(this.#directory,
    constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   try{await d.sync();}finally{await d.close();}
  }finally{this.#writeInFlight=false;}
 }
}
