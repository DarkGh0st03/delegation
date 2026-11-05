/**
 * R1 new-path trusted authority-only store. No Task/DAG approval is loaded.
 *
 * It is intentionally NOT a substitute for the deployed legacy approval
 * store: until the Gateway and Rust root issuer migrate, this store has no
 * execution side effects and no public HTTP/A2A/MCP entrypoint.
 */
import {lstat,open} from "node:fs/promises";
import {constants} from "node:fs";
import {join,resolve} from "node:path";
import {verifyAuthorityOnlyGrant}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_BYTES=128*1024;
const OPERATIONS=new Set<string>(RUST_OPERATIONS);

export interface TrustedAuthorityOnlyKey{
 engineer_did:string;
 public_key_pem:string;
}
export interface TrustedAuthorityOnlyStore {
 loadAuthenticatedAuthority(sessionId:string):Promise<Readonly<{
   authorization:unknown;authority_digest:string;
   authenticated_engineer_did:string;
   expires_at:string;authenticated:true
 }>>;
}

/**
 * Read a receipt from a fixed owner-only deployment directory, never a
 * model/tool/request-supplied path. The signed session must match the
 * requested filename. The public keys are independently trusted, not
 * loaded from the receipt. No root issuance or task registration here.
 */
export class SignedAuthorityOnlyFileStore implements TrustedAuthorityOnlyStore {
 readonly #directory:string;
 readonly #trustedKeys:Record<string,TrustedAuthorityOnlyKey>;
 readonly #engineerDid:string;
 readonly #nowMs:()=>number;

 constructor(config:{
  directory:string;
  engineerDid:string;
  trustedKeys:Record<string,TrustedAuthorityOnlyKey>;
  nowMs?:()=>number;
 }){
  if(!config||typeof config.directory!=="string"||
     !config.directory.trim()||
     typeof config.engineerDid!=="string"||
     !config.engineerDid.startsWith("did:")||
     !config.trustedKeys||!Object.keys(config.trustedKeys).length)
    throw Error("Authority store needs protected directory and pinned Engineer keys");
  this.#directory=resolve(config.directory);
  this.#engineerDid=config.engineerDid;
  this.#trustedKeys=structuredClone(config.trustedKeys);
  this.#nowMs=config.nowMs??Date.now;
 }

 async loadAuthenticatedAuthority(sessionId:string){
  if(typeof sessionId!=="string"||!SESSION.test(sessionId))
   throw Error("Invalid authority session ID");
  const directory=await lstat(this.#directory);
  if(!directory.isDirectory()||directory.isSymbolicLink()||
     (directory.mode&0o077)!==0)
   throw Error("Authority receipt directory must be a private real directory");
  const fd=await open(join(this.#directory,sessionId+".json"),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  let raw:string;
  try{
   const meta=await fd.stat();
   if(!meta.isFile()||meta.size<1||meta.size>MAX_BYTES||
      (meta.mode&0o077)!==0||meta.nlink!==1)
    throw Error("Authority receipt must be an owner-only regular unlinked file");
   raw=await fd.readFile({encoding:"utf8"});
  }finally{
   await fd.close();
  }
  if(Buffer.byteLength(raw,"utf8")>MAX_BYTES)
   throw Error("Authority receipt exceeds trusted size bound");
  let receipt:unknown;
  try{receipt=JSON.parse(raw);}
  catch{throw Error("Invalid signed authority receipt JSON");}
  const verified=verifyAuthorityOnlyGrant(receipt,{
   trustedKeys:this.#trustedKeys,
   expectedEngineerDid:this.#engineerDid,
   allowedOperations:OPERATIONS,
   nowMs:this.#nowMs()
  });
  if(verified.authorization.session_id!==sessionId)
   throw Error("Authority receipt session differs from trusted filename");
  return verified;
 }
}
