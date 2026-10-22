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
  type SignedPlanningCheckpoint}
  from "./trusted-planning-checkpoint.ts";

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_BYTES=256*1024;

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

  async load():Promise<SignedPlanningCheckpoint>{
    const meta=await lstat(this.#directory);
    if(!meta.isDirectory()||meta.isSymbolicLink()||
       (meta.mode&0o077)!==0)
      throw Error("Trusted Planning checkpoint directory must be owner-only");
    const path=join(this.#directory,this.#trust.expectedSessionId+".json");
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let data:string;
    try{
      const stat=await file.stat();
      if(!stat.isFile()||stat.size===0||stat.size>MAX_BYTES||
         (stat.mode&0o077)!==0)
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
}
