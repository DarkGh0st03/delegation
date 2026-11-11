/**
 * One-time OIDC job-token replay ledger for a persistent, trusted host.
 *
 * O_EXCL atomically consumes a signed token's jti before any operational
 * authority is issued. Replays after process restarts or across workers
 * sharing this local filesystem are rejected; stale failures are intentionally
 * not retried. Never use an ephemeral CI workspace for this store.
 *
 * Operators must choose a PRIVATE persistent directory on a filesystem
 * that supports atomic exclusive creates, with strict ownership and backup.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join,resolve} from "node:path";
import type {VerifiedGithubOidcJob}
  from "./trusted-github-oidc.ts";

function deny(reason:string):never{
  throw Error("Trusted GitHub OIDC replay protection: "+reason);
}
export class GithubOidcReplayFileStore{
  readonly #directory:string;
  constructor(directory:string){
    if(typeof directory!=="string"||!directory.trim())
      deny("persistent trusted directory required");
    this.#directory=resolve(directory);
  }
  async claim(job:VerifiedGithubOidcJob):Promise<void>{
    if(job?.kind!=="github_actions_oidc_verified"||
       typeof job.jti!=="string"||job.jti.length<12||
       job.jti.length>256||
       !/^[1-9]\d{0,19}$/u.test(job.run_id??""))
      deny("verified signed job identity required");
    const parent=await lstat(this.#directory);
    if(!parent.isDirectory()||parent.isSymbolicLink()||
       (parent.mode&0o077)!==0||
       (typeof process.getuid==="function"&&
        parent.uid!==process.getuid()))
      deny("replay directory must be owned by host and mode 0700");
    const digest=createHash("sha256").update(
      job.repository_id+"|"+job.run_id+"|"+job.jti
    ).digest("hex");
    const filepath=join(this.#directory,digest+".claimed");
    let handle;
    try{
      handle=await open(filepath,
        constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|
          constants.O_NOFOLLOW,0o600);
    }catch(error){
      if((error as NodeJS.ErrnoException)?.code==="EEXIST")
        deny("repeated job OIDC assertion rejected");
      throw error;
    }
    try{
      // No raw JWT, API key, source files, Engineer receipt or token jti
      // is persisted. Do not remove on a downstream execution failure.
      await handle.writeFile(JSON.stringify({
        run_id:job.run_id,source_sha:job.workflow_sha,
        claimed_at:new Date().toISOString()
      })+"\n",{encoding:"utf8"});
      await handle.sync();
    }finally{
      await handle.close();
    }
  }
}
