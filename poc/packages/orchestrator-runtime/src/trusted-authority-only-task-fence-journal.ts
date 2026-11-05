/**
 * R293 — dedicated Gateway owner-private, terminal Task/effect-fence journal.
 * One flight per Task while provider-effect replay recovery is unimplemented.
 * A completion marker never by itself authorizes an effect or proves a VP.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{64}$/u;
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
function deny(s:string):never{throw Error("Authority-only Task fence journal: "+s);}
export interface TrustedTaskFenceBase {
 session_id:string;authority_digest:string;root_credential_id:string;
 task_id:string;runtime_task_id:string;epoch:number;credential_id:string;
}
export interface TrustedTaskFlight extends TrustedTaskFenceBase {
 request_id:string;request_fingerprint:string;
}
export interface TrustedTaskCompletion extends TrustedTaskFenceBase {
 request_id:string;request_fingerprint:string;
 evidence_sha256:string;completed_at_ms:number;
}
export class DurableAuthorityOnlyTaskFenceJournal {
 readonly #directory:string;
 constructor(directory:string){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||directory.length>512)
   deny("absolute provisioned owner-private directory required");
  this.#directory=directory;
 }
 async #reserve(kind:"flight"|"completion",record:TrustedTaskFlight|TrustedTaskCompletion){
  const expected=[
   "authority_digest","credential_id","epoch","request_fingerprint",
   "request_id","root_credential_id","runtime_task_id","session_id","task_id",
   ...(kind==="completion"?["completed_at_ms","evidence_sha256"]:[])
  ].sort();
  if(!record||typeof record!=="object"||Array.isArray(record)||
     Object.keys(record).sort().join(",")!==expected.join(",")||
     !ID.test(record.session_id)||!ID.test(record.root_credential_id)||
     !ID.test(record.task_id)||!ID.test(record.runtime_task_id)||
     !ID.test(record.credential_id)||!ID.test(record.request_id)||
     record.credential_id===record.root_credential_id||
     !SHA.test(record.authority_digest)||!SHA.test(record.request_fingerprint)||
     !Number.isSafeInteger(record.epoch)||record.epoch<1||record.epoch>256)
   deny("invalid pinned Task/effect binding");
  if(kind==="completion"){
   const completed=record as TrustedTaskCompletion;
   if(!SHA.test(completed.evidence_sha256)||
      !Number.isSafeInteger(completed.completed_at_ms)||
      completed.completed_at_ms<=0)
    deny("completion evidence is unpinned");
  }
  const dir=await lstat(this.#directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
   deny("unsafe or shared Task fence directory");
  const stem=hash(record.session_id+"\n"+record.task_id);
  if(kind==="completion"){
   // A completion can never precede or contradict a durable flight.
   // Re-read the original exact owner-owned marker, not caller input.
   const first=join(this.#directory,stem+".flight.json");
   let fd;
   try{
    fd=await open(first,constants.O_RDONLY|constants.O_NOFOLLOW);
    const st=await fd.stat();
    if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600||
       st.size<32||st.size>4096)
     deny("unsafe or missing original Task flight");
    const parsed=JSON.parse(await fd.readFile("utf8")) as Record<string,unknown>;
    const candidate=record as TrustedTaskCompletion;
    if(parsed.schema!==1||parsed.kind!=="flight"||
       ![
        "session_id","authority_digest","root_credential_id",
        "task_id","runtime_task_id","epoch","credential_id",
        "request_id","request_fingerprint"
       ].every(k=>parsed[k]===candidate[k as keyof TrustedTaskCompletion]))
     deny("completion does not match protected original flight");
   }catch{deny("no matching crash-durable Task flight for completion");}
   finally{if(fd)await fd.close();}
  }
  const name=stem+"."+kind+".json";
  // No deletion after crash, even when the provider result is unknown.
  const fd=await open(join(this.#directory,name),
   constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{
   const stat=await fd.stat();
   if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600)
    deny("unsafe Task fence entry");
   await fd.writeFile(JSON.stringify({schema:1,kind,...record})+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
  const dirfd=await open(this.#directory,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await dirfd.sync();}finally{await dirfd.close();}
 }
 async reserveFlight(record:TrustedTaskFlight):Promise<void>{
  await this.#reserve("flight",record);
 }
 async reserveCompletion(record:TrustedTaskCompletion):Promise<void>{
  await this.#reserve("completion",record);
 }
}
