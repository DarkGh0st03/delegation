/**
 * Read-only durable approval store.
 *
 * The backend receives only pinned Engineer Ed25519 public keys, NEVER
 * the signer key. An authenticated Engineer operator must separately place
 * a signed approval receipt into the protected directory. No methods here
 * accept a model payload, mutate a receipt or confer consent.
 */
import {readFile,stat} from "node:fs/promises";
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
    const path=join(this.#directory,sessionId+".json");
    const metadata=await stat(path);
    if(!metadata.isFile()||metadata.size===0||metadata.size>MAX_BYTES) {
      throw new Error("Invalid size or type of signed approval receipt");
    }
    const data=await readFile(path,"utf8");
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
