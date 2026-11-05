/**
 * R285: durable, fail-closed reservation journal for authority-only root issuance.
 *
 * Exact session reservation happens BEFORE the first native root issue.
 * A subsequent instance cannot replay the session, even after a crash.
 * A failure never deletes either marker: human reconciliation is required.
 * Fixed protected directory, O_EXCL|O_NOFOLLOW, fsync file and directory.
 * It stores only opaque IDs/digests, never credentials or private keys.
 */
import {lstat,open} from "node:fs/promises";
import {constants} from "node:fs";
import {join,resolve} from "node:path";
import type {RootParameters} from "./trusted-engineer-authority.ts";

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA64=/^[a-f0-9]{64}$/u;
const CRED=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface AuthorityOnlyActivationJournal {
 reservePlanning(sessionId:string,root:RootParameters):Promise<void>;
 reserveOperational(sessionId:string,authorityDigest:string,
  root:RootParameters):Promise<void>;
}
export class DurableAuthorityOnlyActivationJournal
 implements AuthorityOnlyActivationJournal {
 readonly #directory:string;
 constructor(directory:string){
  if(typeof directory!=="string"||!directory.trim())
   throw Error("Authority journal needs a provisioned private directory");
  this.#directory=resolve(directory);
 }
 async #reserve(sessionId:string,phase:"planning"|"operational",
  details:Record<string,string>):Promise<void>{
  if(!SESSION.test(sessionId))throw Error("Invalid journal session ID");
  if(!CRED.test(details.credential_id??""))
   throw Error("Invalid journal credential ID");
  const stat=await lstat(this.#directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)
   throw Error("Authority journal directory must be a real owner-only directory");
  const file=join(this.#directory,sessionId+"."+phase+".reserved");
  // A pre-existing marker means an earlier process already attempted this
  // irreversible step. Never retry after a failed/ambiguous native call.
  const fd=await open(file,
   constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,
   0o600);
  try{
   const meta=await fd.stat();
   if(!meta.isFile()||(meta.mode&0o077)!==0||meta.nlink!==1)
    throw Error("Insecure authority journal reservation");
   await fd.writeFile(JSON.stringify({v:1,session_id:sessionId,phase,...details})+"\n",
    {encoding:"utf8"});
   await fd.sync();
  }finally{await fd.close();}
  // Require durable directory entry before the caller issues the credential.
  const dir=await open(this.#directory,
    constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await dir.sync();}
  finally{await dir.close();}
 }
 async reservePlanning(sessionId:string,root:RootParameters):Promise<void>{
  await this.#reserve(sessionId,"planning",{credential_id:root.credential_id,
   status_list_index:root.credential_status.statusListIndex});
 }
 async reserveOperational(sessionId:string,authorityDigest:string,
  root:RootParameters):Promise<void>{
  if(typeof authorityDigest!=="string"||!SHA64.test(authorityDigest))
   throw Error("Invalid journal authority digest");
  await this.#reserve(sessionId,"operational",{
   credential_id:root.credential_id,authority_digest:authorityDigest,
   status_list_index:root.credential_status.statusListIndex
  });
 }
}
