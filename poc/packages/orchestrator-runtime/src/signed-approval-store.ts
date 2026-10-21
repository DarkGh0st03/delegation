/**
 * Read-only durable approval store.
 *
 * The backend receives only pinned Engineer Ed25519 public keys, NEVER
 * the signer key. An authenticated Engineer operator must separately place
 * a signed approval receipt into the protected directory. No methods here
 * accept a model payload, mutate a receipt or confer consent.
 */
import {lstat,open} from "node:fs/promises";
import {constants} from "node:fs";
import {join,resolve} from "node:path";
import {verifyEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import type {TrustedApprovalRecord,TrustedApprovalStore} from "./trusted-engineer-authority.ts";

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_BYTES=256*1024;
const OPERATIONS=new Set<string>(RUST_OPERATIONS);

export interface TrustedApprovalKey {
  engineer_did:string;
  public_key_pem:string;
}

/**
 * Files are named session_id.json under a fixed, trusted deployment
 * directory. The caller cannot choose filenames. All file content is
 * individually verified, including plan, approval, expiry and signer DID.
 *
 * Clock injection exists for deterministic offline tests only.
 */
export class SignedEngineerApprovalFileStore implements TrustedApprovalStore {
  readonly #directory:string;
  readonly #keys:Record<string,TrustedApprovalKey>;
  readonly #engineerDid:string;
  readonly #now:()=>number;

  constructor(config:{
    directory:string;
    engineerDid:string;
    trustedKeys:Record<string,TrustedApprovalKey>;
    nowMs?:()=>number;
  }){
    if(typeof config.directory!=="string"||!config.directory.trim()||
       !config.engineerDid?.startsWith("did:")||
       !config.trustedKeys||!Object.keys(config.trustedKeys).length) {
      throw new Error("Protected approval directory and pinned Engineer keys required");
    }
    this.#directory=resolve(config.directory);
    this.#keys=structuredClone(config.trustedKeys);
    this.#engineerDid=config.engineerDid;
    this.#now=config.nowMs??Date.now;
  }

  async loadAuthenticatedApproval(sessionId:string):Promise<TrustedApprovalRecord> {
    if(typeof sessionId!=="string"||!SESSION.test(sessionId)) {
      throw new Error("Invalid approved Plan session identifier");
    }
    // The protected directory is provisioned by an operator; neither the
    // LLM nor the HTTP caller can supply its path. Reject shared or symlinked
    // directories, rather than treating filesystem presence as authentication.
    const directoryMeta=await lstat(this.#directory);
    if(!directoryMeta.isDirectory() || directoryMeta.isSymbolicLink() ||
       (directoryMeta.mode & 0o077)!==0) {
      throw new Error("Approval directory must be a real owner-only directory");
    }
    const path=join(this.#directory,sessionId+".json");
    // O_NOFOLLOW prevents a link swap between metadata checks and opening
    // the receipt. Read through the SAME file descriptor we verified.
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let data:string;
    try {
      const metadata=await handle.stat();
      if(!metadata.isFile() || metadata.size===0 || metadata.size>MAX_BYTES ||
         (metadata.mode & 0o077)!==0) {
        throw new Error("Signed approval receipt must be an owner-only regular file");
      }
      data=await handle.readFile({encoding:"utf8"});
    } finally {
      await handle.close();
    }
    if(Buffer.byteLength(data,"utf8")>MAX_BYTES){
      throw new Error("Signed approval receipt exceeds bound");
    }
    let envelope:unknown;
    try{envelope=JSON.parse(data);}catch{throw new Error("Invalid signed approval JSON");}
    const verified=verifyEngineerApproval(envelope,{
      trustedKeys:this.#keys,expectedEngineerDid:this.#engineerDid,
      allowedOperations:OPERATIONS,nowMs:this.#now()
    });
    if(verified.plan.session_id!==sessionId){
      throw new Error("Signed approval session ID does not match requested file");
    }
    return verified;
  }
}
