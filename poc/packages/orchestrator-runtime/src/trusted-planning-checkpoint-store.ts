/**
 * File-backed import of an already SIGNED trusted Planning checkpoint.
 * Owner-only disk persistence is NOT authentication: the imported envelope
 * must also verify against an independently pinned backend Ed25519 public key,
 * Gitea SHA, repository, session and branch.
 *
 * Unlike a GUI upload, no request may choose the file path or trust keys.
 */
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join,resolve} from "node:path";
import {verifyTrustedPlanningCheckpoint,
  stageVerifiedPlanningCheckpoint,
  type SignedPlanningCheckpoint}
  from "./trusted-planning-checkpoint.ts";
import type {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_BYTES=256*1024;
function ownerOnly(meta:{mode:number;uid:number;isDirectory():boolean;isSymbolicLink():boolean},
  directory:boolean):boolean{
  return (directory?meta.isDirectory():!meta.isDirectory())&&
    !meta.isSymbolicLink()&&(meta.mode&0o077)===0&&
    (typeof process.getuid!=="function"||meta.uid===process.getuid());
}

export class SignedPlanningCheckpointFileStore{
  readonly #directory:string;
  readonly #trust:Parameters<typeof verifyTrustedPlanningCheckpoint>[1];

  constructor(config:{
    directory:string;
    trust:Parameters<typeof verifyTrustedPlanningCheckpoint>[1];
  }){
    if(typeof config.directory!=="string"||
       !config.directory.trim()||
       !SESSION.test(config.trust?.expectedSessionId??""))
      throw Error("Trusted checkpoint directory and pinned session required");
    this.#directory=resolve(config.directory);
    // Copy pinned identity/keys, but preserve an optional deterministic clock
    // callback (structuredClone cannot copy functions).
    this.#trust={
      ...config.trust,
      trustedKeys:structuredClone(config.trust.trustedKeys),
      expectedRepository:structuredClone(config.trust.expectedRepository)
    };
  }

  async #assertPrivateDirectory():Promise<void>{
    const meta=await lstat(this.#directory);
    if(!ownerOnly(meta,true))
      throw Error("Trusted Planning checkpoint directory must be owner-only");
  }

  /**
   * Persist the already-signed backend checkpoint before Engineer review.
   * The independent backend Ed25519 signature and host-pinned context are
   * verified BEFORE disk effects. One session => one exclusive file.
   * No overwrite, signing-key access, inference or root issuance.
   */
  async persistVerified(ticket:SignedPlanningCheckpoint):Promise<void>{
    verifyTrustedPlanningCheckpoint(ticket,this.#trust);
    await this.#assertPrivateDirectory();
    const encoded=Buffer.from(JSON.stringify(ticket)+"\n","utf8");
    if(encoded.length===0||encoded.length>MAX_BYTES)
      throw Error("Trusted Planning checkpoint exceeds size bound");
    const path=join(this.#directory,this.#trust.expectedSessionId+".json");
    // A stale or partially written record remains an explicit fail-closed
    // operator recovery condition; never replace or silently retry it.
    const fd=await open(path,constants.O_WRONLY|constants.O_CREAT|
      constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{
      await fd.writeFile(encoded);
      await fd.sync();
    }finally{await fd.close();}
    const dir=await open(this.#directory,
      constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await dir.sync();}finally{await dir.close();}
  }

  async load():Promise<SignedPlanningCheckpoint>{
    await this.#assertPrivateDirectory();
    const path=join(this.#directory,this.#trust.expectedSessionId+".json");
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let data:string;
    try{
      const stat=await file.stat();
      if(!stat.isFile()||!ownerOnly(stat,false)||
         stat.size===0||stat.size>MAX_BYTES)
        throw Error("Trusted Planning checkpoint file must be owner-only and bounded");
      data=await file.readFile({encoding:"utf8"});
    }finally{await file.close();}
    if(Buffer.byteLength(data,"utf8")>MAX_BYTES)
      throw Error("Trusted Planning checkpoint exceeds size bound");
    let checkpoint:unknown;
    try{checkpoint=JSON.parse(data);}
    catch{throw Error("Invalid persisted Planning checkpoint JSON");}
    verifyTrustedPlanningCheckpoint(checkpoint,this.#trust);
    return structuredClone(checkpoint) as SignedPlanningCheckpoint;
  }

  /** Revalidate with this store's PINNED keys, never caller-supplied keys. */
  stageVerified(gate:TrustedPlanningReviewGate,ticket:SignedPlanningCheckpoint){
    return stageVerifiedPlanningCheckpoint(gate,ticket,this.#trust);
  }
}
