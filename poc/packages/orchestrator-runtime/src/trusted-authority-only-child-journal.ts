/**
 * R290: trusted, owner-private, durable authority-only Child DC intent ledger.
 * An uncertain Rust IPC result is terminal. Neither intent nor ACK is a VP,
 * Gateway permission, or evidence that EVM/status verification passed.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join,resolve} from "node:path";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{64}$/u;
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function reject(s:string):never{throw Error("Authority-only Child journal: "+s);}
export interface AuthorityOnlyChildIntent {
 session_id:string;epoch:number;task_id:string;credential_id:string;
 parent_credential_id:string;authority_digest:string;
 permissions_sha256:string;status_list_credential:string;status_list_index:string;
}
export class DurableAuthorityOnlyChildJournal {
 readonly #directory:string;
 constructor(directory:string){
  if(typeof directory!=="string"||!directory.trim())reject("private directory missing");
  this.#directory=resolve(directory);
 }
 async #write(name:string,body:Readonly<Record<string,unknown>>){
  const fd=await open(join(this.#directory,name),
   constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{
   const st=await fd.stat();
   if(!st.isFile()||st.nlink!==1||(st.mode&0o077)!==0)
    reject("unsafe child intent file");
   await fd.writeFile(JSON.stringify(body)+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
 }
 async reserveChild(intent:AuthorityOnlyChildIntent):Promise<void>{
  if(!intent||typeof intent!=="object"||
     Object.keys(intent).sort().join(",")!==[
       "authority_digest","credential_id","epoch","parent_credential_id",
       "permissions_sha256","session_id","status_list_credential",
       "status_list_index","task_id"].join(",")||
     !ID.test(intent.session_id)||!ID.test(intent.task_id)||
     !ID.test(intent.credential_id)||!ID.test(intent.parent_credential_id)||
     intent.credential_id===intent.parent_credential_id||
     !Number.isSafeInteger(intent.epoch)||intent.epoch<1||intent.epoch>256||
     !SHA.test(intent.authority_digest)||!SHA.test(intent.permissions_sha256)||
     typeof intent.status_list_credential!=="string"||
     !/^https:\/\//u.test(intent.status_list_credential)||
     intent.status_list_credential.length>512||
     typeof intent.status_list_index!=="string"||
     !/^\d{1,12}$/u.test(intent.status_list_index))
    reject("invalid or unpinned issuance intent");
  const dir=await lstat(this.#directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
   reject("issuance journal is not private");
  const prefix=intent.session_id+"\n";
  const taskMarker="task-"+hash(prefix+intent.task_id)+".reserved";
  const idMarker="credential-"+hash(prefix+intent.credential_id)+".reserved";
  // Two O_EXCL markers prevent both Task replay and Child ID reuse in
  // concurrent processes. An interruption between them leaves a safe,
  // non-retryable Task. Never remove or overwrite either marker.
  await this.#write(taskMarker,{v:1,kind:"task",...intent});
  await this.#write(idMarker,{v:1,kind:"credential",
   session_id:intent.session_id,credential_id:intent.credential_id,
   task_id:intent.task_id,authority_digest:intent.authority_digest});
  const d=await open(this.#directory,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await d.sync();}finally{await d.close();}
 }
}
