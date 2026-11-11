/**
 * Owner-only immutable REJECTION INTENT, independent of a signed approval.
 * Stored BEFORE calling the native/Gateway root revoker. If the process dies
 * or cancellation is ambiguous, this marker permanently prevents the same
 * Engineer session being served for approval on restart.
 *
 * The provisional-root journal remains the authority for Rust/Gateway
 * reconciliation. A tombstone is not proof that revocation succeeded.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,resolve,join} from "node:path";

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
function fail(message){throw Error("Trusted Engineer rejection intent: "+message);}
function pathFor(directory,sessionId){
  if(typeof sessionId!=="string"||!SESSION.test(sessionId))fail("invalid Engineer session ID");
  return join(directory,createHash("sha256").update(sessionId).digest("hex")+".rejection-intent.json");
}
export class TrustedEngineerRejectionStore{
  #directory;#path;#sessionId;#baseRevision;#planDigest;
  constructor({directory,sessionId,baseRevision,planDigest}={}){
    if(typeof directory!=="string"||!isAbsolute(directory)||
       resolve(directory)!==directory||!SESSION.test(sessionId??"")||
       !SHA.test(baseRevision??"")||!DIGEST.test(planDigest??""))
      fail("exact pinned owner-only directory, session, SHA and digest required");
    this.#directory=directory;
    this.#path=pathFor(directory,sessionId);
    this.#sessionId=sessionId;
    this.#baseRevision=baseRevision;
    this.#planDigest=planDigest;
  }
  async #privateDir(){
    const st=await lstat(this.#directory);
    if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
       (typeof process.getuid==="function"&&st.uid!==process.getuid()))
      fail("Engineer decision directory not owner-only");
  }
  /** Any existing marker, including invalid/partial or symlinked, denies
   * a new review. Never auto-clear on a restart. */
  async assertFresh(){
    await this.#privateDir();
    try{
      await lstat(this.#path);
      fail("prior Engineer rejection intent forbids restarting review");
    }catch(e){
      if(e.code!=="ENOENT")throw e;
    }
  }
  /** An exclusive intent is fsynced BEFORE native revocation is attempted.
   * Cross-process double-host operation is unsupported; run one owner host. */
  async reserve(){
    await this.assertFresh();
    const fd=await open(this.#path,
      constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|
      constants.O_NOFOLLOW,0o600);
    try{
      await fd.writeFile(JSON.stringify({
        schema_version:1,purpose:"terminal_engineer_rejection_intent",
        session_id:this.#sessionId,base_revision:this.#baseRevision,
        plan_digest:this.#planDigest
      })+"\n","utf8");
      await fd.sync();
    }finally{await fd.close();}
    const directory=await open(this.#directory,
      constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await directory.sync();}finally{await directory.close();}
  }
}
