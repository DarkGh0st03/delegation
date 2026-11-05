/**
 * R303.1 — irrevocable owner-only Test Task / Runner commit reservation.
 *
 * NEVER authorizes Docker execution. Runner launch requires a separate
 * native Rust VP, real OPA, enrolled Child DC and verified runner result.
 * A second attempt on the same Task is forbidden, including after crashes.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isDeepStrictEqual} from "node:util";
import {isAbsolute,join,resolve} from "node:path";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA40=/^[a-f0-9]{40}$/u,SHA64=/^[a-f0-9]{64}$/u;
const SHA256=(s:string)=>createHash("sha256").update(s).digest("hex");
function deny(reason:string):never{
 throw Error("Authority-only Runner commitment NO-GO: "+reason);
}
export interface TrustedAuthorityOnlyRunnerIntent{
 readonly schema:"authority-only-runner-intent-v1";
 readonly kind:"runner_test_commit_preflight_only";
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
 readonly expected_head_sha:string;
 readonly runner_profile:"poc-default";
 readonly prepared_at_ms:number;
 readonly runner_execution_authorized:false;
}
const FIELDS=[
 "schema","kind","session_id","authority_digest","root_credential_id",
 "task_id","runtime_task_id","epoch","agent_did","credential_id",
 "request_id","request_fingerprint","repository","branch",
 "expected_head_sha","runner_profile","prepared_at_ms",
 "runner_execution_authorized"
].sort().join(",");
export class DurableAuthorityOnlyRunnerIntentJournal{
 readonly #dir:string;
 #inFlight=false;
 constructor(directory:string){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||directory.length>512)
   deny("owner-provisioned absolute directory required");
  this.#dir=directory;
 }
 async #validateDirectory(){
  const st=await lstat(this.#dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
     (st.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&st.uid!==process.getuid()))
   deny("unsafe shared Runner journal directory");
 }
 #filename(intent:TrustedAuthorityOnlyRunnerIntent,kind:"intent"|"attempt"){
  return SHA256(intent.session_id+"\n"+intent.task_id)+"."+kind+".json";
 }
 async #read(name:string):Promise<unknown>{
  await this.#validateDirectory();
  const fd=await open(join(this.#dir,name),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const st=await fd.stat();
   if(!st.isFile()||st.nlink!==1||
      (st.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&st.uid!==process.getuid())||
      st.size<90||st.size>8192)
    deny("unsafe or incomplete Runner evidence journal record");
   return JSON.parse(await fd.readFile("utf8")) as unknown;
  }finally{await fd.close();}
 }
 async #write(name:string,data:object){
  await this.#validateDirectory();
  const fd=await open(join(this.#dir,name),
   constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,
   0o600);
  try{
   const st=await fd.stat();
   if(!st.isFile()||st.nlink!==1||
      (st.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&st.uid!==process.getuid()))
    deny("unsafe fresh Runner journal record");
   await fd.writeFile(JSON.stringify(data)+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
  const dir=await open(this.#dir,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await dir.sync();}finally{await dir.close();}
 }
 static assertValid(intent:TrustedAuthorityOnlyRunnerIntent):void{
  if(!intent||typeof intent!=="object"||Array.isArray(intent)||
     Object.keys(intent).sort().join(",")!==FIELDS||
     intent.schema!=="authority-only-runner-intent-v1"||
     intent.kind!=="runner_test_commit_preflight_only"||
     intent.runner_execution_authorized!==false||
     intent.runner_profile!=="poc-default"||
     !ID.test(intent.session_id)||!ID.test(intent.task_id)||
     !ID.test(intent.runtime_task_id)||!ID.test(intent.request_id)||
     !ID.test(intent.root_credential_id)||!ID.test(intent.credential_id)||
     intent.root_credential_id===intent.credential_id||
     typeof intent.agent_did!=="string"||
     !/^did:[A-Za-z0-9:._-]+$/u.test(intent.agent_did)||
     !SHA64.test(intent.authority_digest)||
     !SHA64.test(intent.request_fingerprint)||
     !SHA40.test(intent.expected_head_sha)||
     !Number.isSafeInteger(intent.epoch)||intent.epoch<1||intent.epoch>256||
     !Number.isSafeInteger(intent.prepared_at_ms)||intent.prepared_at_ms<=0||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(intent.repository)||
     typeof intent.branch!=="string"||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(intent.branch)||
     intent.branch.includes("..")||intent.branch.includes("//")||
     intent.branch.startsWith("feature/r302-internal-"))
   deny("Runner intent is not a canonical native Task/Child binding");
 }
 async reserve(intent:TrustedAuthorityOnlyRunnerIntent):Promise<void>{
  DurableAuthorityOnlyRunnerIntentJournal.assertValid(intent);
  await this.#write(this.#filename(intent,"intent"),intent);
 }
 async assertReserved(intent:TrustedAuthorityOnlyRunnerIntent):Promise<void>{
  DurableAuthorityOnlyRunnerIntentJournal.assertValid(intent);
  const saved=await this.#read(this.#filename(intent,"intent"));
  if(!isDeepStrictEqual(saved,intent))
   deny("Runner intent differs from original durable commitment");
 }
 /** Reservation must precede all Runner HTTP POSTs. No automatic recovery. */
 async reserveAttempt(intent:TrustedAuthorityOnlyRunnerIntent):Promise<void>{
  if(this.#inFlight)deny("concurrent Test Task runner launch");
  this.#inFlight=true;
  try{
   await this.assertReserved(intent);
   await this.#write(this.#filename(intent,"attempt"),{
    schema:"authority-only-runner-attempt-v1",
    session_id:intent.session_id,
    task_id:intent.task_id,
    authority_digest:intent.authority_digest,
    credential_id:intent.credential_id,
    request_id:intent.request_id,
    request_fingerprint:intent.request_fingerprint,
    expected_head_sha:intent.expected_head_sha,
    runner_profile:intent.runner_profile
   });
  }finally{this.#inFlight=false;}
 }
}
