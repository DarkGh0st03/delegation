/**
 * Persistent one-use transfer from a VERIFIED GitHub OIDC intake to the
 * independent trusted Engineer host. This is NOT Engineer approval, a DC,
 * API-charge permission, or permission to invoke Gemini.
 *
 * The intake writes a strictly bounded, HMAC-authenticated record AFTER
 * GitHub OIDC signature/run verification and the independent jti replay
 * claim. A trusted host consumes it by an independently pinned session ID,
 * GitHub run ID and source SHA. Both sides require the same host-only HMAC
 * secret and an owner-only persistent POSIX directory.
 *
 * Atomic O_EXCL protects one record per run and one consumption across
 * restarts/processes. Uncertain failures remain consumed; never auto-retry.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join,resolve} from "node:path";
import type {VerifiedGithubOidcJob}
  from "./trusted-github-oidc.ts";
import type {ReviewedGithubDispatchRequest}
  from "./trusted-manual-github-dispatch.ts";

const RUN=/^[1-9]\d{0,19}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LIFETIME_MS=5*60*1000;
const MAX_BYTES=8192;

function deny(reason:string):never{
  throw Error("Trusted Github admission receipt: "+reason);
}
function keys(value:unknown,expected:readonly string[]):boolean{
  return value!==null&&typeof value==="object"&&
    !Array.isArray(value)&&
    Object.keys(value).length===expected.length&&
    expected.every(k=>Object.hasOwn(value,k));
}
const PAYLOAD_FIELDS=[
  "version","kind","session_id","run_id","source_sha","source_repository",
  "source_ref","model_name","max_model_turns","max_output_tokens",
  "max_model_call_ms","authorization_input","issued_at","expires_at"
] as const;

export interface StoredGithubAdmission{
  readonly version:1;
  readonly kind:"oidc_authenticated_only_not_engineer_approved";
  readonly session_id:string;
  readonly run_id:string;
  readonly source_sha:string;
  readonly source_repository:string;
  readonly source_ref:string;
  readonly model_name:string;
  readonly max_model_turns:number;
  readonly max_output_tokens:number;
  readonly max_model_call_ms:number;
  readonly authorization_input:"I AUTHORIZE GEMINI API CHARGES";
  readonly issued_at:string;
  readonly expires_at:string;
}
function recordName(runId:string){
  if(!RUN.test(runId))deny("invalid GitHub run identifier");
  return createHash("sha256").update("admission-v1|"+runId)
    .digest("hex");
}
export class TrustedGithubAdmissionReceiptStore{
  readonly #dir:string;
  readonly #secret:Buffer;
  readonly #sessionId:string;
  constructor(config:{
    directory:string;
    hmacSecret:Buffer;
    expectedSessionId:string;
  }){
    if(!config.directory?.trim()||
       !SESSION.test(config.expectedSessionId??"")||
       !Buffer.isBuffer(config.hmacSecret)||
       config.hmacSecret.length<32||config.hmacSecret.length>128)
      deny("trusted owner-only store, session and 256-bit HMAC secret required");
    this.#dir=resolve(config.directory);
    this.#secret=Buffer.from(config.hmacSecret);
    this.#sessionId=config.expectedSessionId;
  }
  async #privateDir(){
    const stat=await lstat(this.#dir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
       (stat.mode&0o077)!==0||
       (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
      deny("persistent directory must be owner-owned and 0700");
  }
  #mac(payload:StoredGithubAdmission):string{
    return createHmac("sha256",this.#secret)
      .update(JSON.stringify(payload),"utf8").digest("hex");
  }
  async record(input:{
    dispatch:ReviewedGithubDispatchRequest;
    job:VerifiedGithubOidcJob;
    nowMs?:number;
  }):Promise<void>{
    const {dispatch,job}=input;
    if(dispatch?.status!=="manual_workflow_input_only_not_authorized"||
       job?.kind!=="github_actions_oidc_verified"||
       job.run_id!==dispatch.run_id||
       job.workflow_sha!==dispatch.source_sha||
       !SHA.test(dispatch.source_sha??"")||
       !RUN.test(dispatch.run_id??"")||
       dispatch.authorization_input!=="I AUTHORIZE GEMINI API CHARGES"||
       !Number.isSafeInteger(dispatch.max_model_turns)||
       dispatch.max_model_turns<1||dispatch.max_model_turns>32||
       !Number.isSafeInteger(dispatch.max_output_tokens)||
       dispatch.max_output_tokens<1||dispatch.max_output_tokens>32000||
       !Number.isSafeInteger(dispatch.max_model_call_ms)||
       dispatch.max_model_call_ms<1000||dispatch.max_model_call_ms>360000||
       typeof dispatch.model_name!=="string"||
       !/^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(dispatch.model_name))
      deny("independently authenticated bounded OIDC dispatch required");
    const now=input.nowMs??Date.now();
    if(!Number.isFinite(now)||now<0)deny("invalid trusted clock");
    await this.#privateDir();
    const payload:StoredGithubAdmission={
      version:1,kind:"oidc_authenticated_only_not_engineer_approved",
      session_id:this.#sessionId,run_id:dispatch.run_id,
      source_sha:dispatch.source_sha,
      source_repository:dispatch.source_repository,
      source_ref:dispatch.source_ref,model_name:dispatch.model_name,
      max_model_turns:dispatch.max_model_turns,
      max_output_tokens:dispatch.max_output_tokens,
      max_model_call_ms:dispatch.max_model_call_ms,
      authorization_input:"I AUTHORIZE GEMINI API CHARGES",
      issued_at:new Date(now).toISOString(),
      expires_at:new Date(now+LIFETIME_MS).toISOString()
    };
    const data=JSON.stringify({payload,mac:this.#mac(payload)})+"\n";
    if(Buffer.byteLength(data)>MAX_BYTES)
      deny("admission receipt exceeds fixed size bound");
    const filepath=join(this.#dir,recordName(dispatch.run_id)+".json");
    let file;
    try{
      file=await open(filepath,constants.O_WRONLY|constants.O_CREAT|
        constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    }catch(error){
      if((error as NodeJS.ErrnoException)?.code==="EEXIST")
        deny("GitHub workflow run already admitted");
      throw error;
    }
    try{
      await file.writeFile(data,"utf8");
      await file.sync();
    }finally{await file.close();}
  }
  async consume(input:{
    expectedRunId:string;
    expectedSourceSha:string;
    expectedSessionId:string;
    nowMs?:number;
  }):Promise<Readonly<StoredGithubAdmission>>{
    if(!RUN.test(input.expectedRunId??"")||
       !SHA.test(input.expectedSourceSha??"")||
       input.expectedSessionId!==this.#sessionId)
      deny("trusted caller session/run/source pin missing");
    await this.#privateDir();
    const name=recordName(input.expectedRunId);
    const filepath=join(this.#dir,name+".json");
    const file=await open(filepath,constants.O_RDONLY|constants.O_NOFOLLOW);
    let contents:string;
    try{
      const stat=await file.stat();
      if(!stat.isFile()||stat.size<1||stat.size>MAX_BYTES||
         (stat.mode&0o077)!==0)
        deny("untrusted or insecure receipt file");
      contents=await file.readFile({encoding:"utf8"});
    }finally{await file.close();}
    let envelope:unknown;
    try{envelope=JSON.parse(contents);}
    catch{deny("malformed receipt JSON");}
    if(!keys(envelope,["payload","mac"]))deny("unexpected receipt fields");
    const {payload,mac}=envelope as {payload:unknown;mac:unknown};
    if(!keys(payload,PAYLOAD_FIELDS)||
       typeof mac!=="string"||!/^[0-9a-f]{64}$/u.test(mac))
      deny("invalid receipt envelope");
    const receipt=payload as unknown as StoredGithubAdmission;
    if(receipt.version!==1||
       receipt.kind!=="oidc_authenticated_only_not_engineer_approved"||
       receipt.session_id!==input.expectedSessionId||
       receipt.run_id!==input.expectedRunId||
       receipt.source_sha!==input.expectedSourceSha||
       receipt.authorization_input!=="I AUTHORIZE GEMINI API CHARGES")
      deny("receipt differs from trusted session/run/source");
    const issued=Date.parse(receipt.issued_at),expires=Date.parse(receipt.expires_at);
    const now=input.nowMs??Date.now();
    if(!Number.isFinite(issued)||!Number.isFinite(expires)||
       !Number.isFinite(now)||now<issued-60000||now>=expires||
       expires<=issued||expires-issued>LIFETIME_MS)
      deny("receipt expired or outside trusted admission window");
    const expected=Buffer.from(this.#mac(receipt),"hex");
    const received=Buffer.from(mac,"hex");
    if(expected.length!==received.length||
       !timingSafeEqual(expected,received))
      deny("receipt HMAC verification failed");
    // No deletion: a single claimed marker is durable across restarts.
    const claimed=join(this.#dir,name+".consumed");
    let handle;
    try{
      handle=await open(claimed,constants.O_WRONLY|constants.O_CREAT|
        constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    }catch(error){
      if((error as NodeJS.ErrnoException)?.code==="EEXIST")
        deny("authenticated GitHub admission already consumed");
      throw error;
    }
    try{
      await handle.writeFile("consumed\n","utf8");
      await handle.sync();
    }finally{await handle.close();}
    return Object.freeze(structuredClone(receipt));
  }
}
