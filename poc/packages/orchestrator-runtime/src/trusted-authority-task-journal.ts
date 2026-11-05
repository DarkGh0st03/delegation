/**
 * R286 — Coordinator-private, append-only Task admission ledger.
 *
 * Neither this class nor its records authorize a Gateway provider action.
 * Reservations are crash-durable and never replaced: replay/ambiguous
 * failures are terminal until an operator reconciles the session.
 */
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join,resolve} from "node:path";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{64}$/u;
function deny(msg:string):never{throw Error("Authority Task journal: "+msg);}
export interface AuthorityTaskJournal{
 reserveActivation(sessionId:string,rootCredentialId:string,
  authorityDigest:string):Promise<void>;
 reserveTask(sessionId:string,epoch:number,taskId:string,
  recordDigest:string):Promise<void>;
}
export class DurableAuthorityTaskJournal implements AuthorityTaskJournal{
 readonly #root:string;
 constructor(directory:string){
  if(typeof directory!=="string"||!directory.trim())
   deny("trusted private directory required");
  this.#root=resolve(directory);
 }
 async #write(sessionId:string,name:string,body:Record<string,unknown>):Promise<void>{
  if(!ID.test(sessionId)||!name||name.length>210||name.includes("/")||
     name.includes("\\")||name.includes(".."))
   deny("invalid session or record name");
  const st=await lstat(this.#root);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
   deny("non-private or non-directory journal");
  const fd=await open(join(this.#root,sessionId+"."+name),
   constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,
   0o600);
  try{
   const f=await fd.stat();
   if(!f.isFile()||f.nlink!==1||(f.mode&0o077)!==0)
    deny("unsafe journal entry");
   await fd.writeFile(JSON.stringify(body)+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
  const directory=await open(this.#root,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await directory.sync();}finally{await directory.close();}
 }
 async reserveActivation(sessionId:string,rootCredentialId:string,
  authorityDigest:string){
  if(!ID.test(rootCredentialId)||!SHA.test(authorityDigest))
   deny("invalid root binding");
  await this.#write(sessionId,"activated",{
   schema:1,phase:"activation",session_id:sessionId,
   root_credential_id:rootCredentialId,authority_digest:authorityDigest
  });
 }
 async reserveTask(sessionId:string,epoch:number,taskId:string,
  recordDigest:string){
  if(!Number.isSafeInteger(epoch)||epoch<1||epoch>256||
     !ID.test(taskId)||!SHA.test(recordDigest))
   deny("invalid Task reservation");
  await this.#write(sessionId,"task."+String(epoch).padStart(4,"0")+
   "."+taskId,{schema:1,phase:"task_registered",session_id:sessionId,
   epoch,task_id:taskId,record_digest:recordDigest});
 }
}
