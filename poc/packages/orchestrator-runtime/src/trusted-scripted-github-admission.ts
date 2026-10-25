/**
 * R5 owner-only, OFFLINE SCRIPTED manual GitHub run identity.
 * No Gemini model, paid consent, engineer signing, or root can be
 * activated by this module. A separate protected Engineer process must
 * independently authenticate an Ed25519 receipt and approve every Task.
 *
 * The workflow must be manually dispatched on exactly the pinned commit.
 * The token must be a real GitHub Actions OIDC RS256 assertion, and the
 * authoritative GitHub run must remain in_progress. The resulting
 * session receipt is HMAC authenticated, bounded, and one-use on disk.
 *
 * NEVER reuse the paid receipt store: its stored charge authorization
 * would falsely state that an offline workflow authorized Gemini.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join,resolve} from "node:path";
import {verifyGithubOidcScriptedManualJob,
  type GithubOidcTrustPolicy,type VerifiedGithubOidcJob}
  from "./trusted-github-oidc.ts";
import {GithubOidcReplayFileStore}
  from "./trusted-github-oidc-replay-store.ts";
import {verifyGithubManualRunViaApi,
  type PinnedGithubDispatch} from "./trusted-manual-github-dispatch.ts";

const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const ACK="I AUTHORIZE A SCRIPTED OFFLINE TEST ONLY";
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SOURCE=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const REF=/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const LIFETIME=5*60*1000;
const MAX_BYTES=4096;
const ENV_KEYS=[
  "GITHUB_ACTIONS","GITHUB_EVENT_NAME","GITHUB_RUN_ATTEMPT",
  "GITHUB_REPOSITORY","GITHUB_REF","GITHUB_WORKFLOW_REF",
  "GITHUB_SHA","GITHUB_RUN_ID"
] as const;
function deny(reason:string):never{
  throw Error("Trusted scripted GitHub admission: "+reason);
}
function exact(value:unknown,fields:readonly string[]):boolean{
  return !!value&&typeof value==="object"&&!Array.isArray(value)&&
    Object.keys(value).length===fields.length&&
    fields.every(k=>Object.hasOwn(value,k));
}
export interface ScriptedGithubDispatch{
  readonly kind:"scripted_offline_manual_job_identity_only";
  readonly run_id:string;
  readonly source_sha:string;
  readonly source_repository:string;
  readonly source_ref:string;
  readonly workflow_path:typeof WORKFLOW;
  readonly execution_profile:"scripted_offline";
}
export function verifyScriptedGithubManualDispatch(input:{
  env:Readonly<Record<string,string|undefined>>;
  event:unknown;
  pinned:PinnedGithubDispatch&{sourceSha:string};
}):Readonly<ScriptedGithubDispatch>{
  const {env,event,pinned}=input;
  if(pinned?.workflowPath!==WORKFLOW||
     !SOURCE.test(pinned.repository??"")||
     !REF.test(pinned.ref??"")||
     !SHA.test(pinned.sourceSha??"")||
     env.GITHUB_ACTIONS!=="true"||
     env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
     env.GITHUB_RUN_ATTEMPT!=="1"||
     env.GITHUB_REPOSITORY!==pinned.repository||
     env.GITHUB_REF!==pinned.ref||
     env.GITHUB_WORKFLOW_REF!==pinned.repository+"/"+WORKFLOW+"@"+pinned.ref||
     !SHA.test(env.GITHUB_SHA??"")||
     env.GITHUB_SHA!==pinned.sourceSha||
     !RUN.test(env.GITHUB_RUN_ID??""))
    deny("pinned first manual offline job identity mismatch");
  // GitHub's authentic event contains many additional repository/event
  // properties; only the workflow_dispatch *inputs* are an exact schema.
  if(!event||typeof event!=="object"||Array.isArray(event)||
     !(event as any).repository||
     typeof (event as any).repository!=="object"||
     Array.isArray((event as any).repository)||
     (event as any).repository.full_name!==pinned.repository||
     (event as any).ref!==pinned.ref||
     !exact((event as any).inputs,["execution_profile","authorization"]))
    deny("strict manual offline event schema required");
  const inputs=(event as any).inputs;
  if(inputs.execution_profile!=="scripted_offline"||
     inputs.authorization!==ACK)
    deny("explicit nonbillable scripted selection required");
  return Object.freeze({
    kind:"scripted_offline_manual_job_identity_only" as const,
    run_id:env.GITHUB_RUN_ID!,
    source_sha:env.GITHUB_SHA!,
    source_repository:pinned.repository,
    source_ref:pinned.ref,
    workflow_path:WORKFLOW,
    execution_profile:"scripted_offline" as const
  });
}
export interface ScriptedGithubAdmissionRecord{
  readonly version:1;
  readonly kind:"oidc_verified_scripted_only_not_engineer_approved";
  readonly session_id:string;
  readonly run_id:string;
  readonly source_sha:string;
  readonly source_repository:string;
  readonly source_ref:string;
  readonly workflow_path:typeof WORKFLOW;
  readonly execution_profile:"scripted_offline";
  readonly model_inference_allowed:false;
  readonly engineer_approved:false;
  readonly issued_at:string;
  readonly expires_at:string;
}
const RECORD_FIELDS=[
  "version","kind","session_id","run_id","source_sha",
  "source_repository","source_ref","workflow_path","execution_profile",
  "model_inference_allowed","engineer_approved","issued_at","expires_at"
];
export class TrustedScriptedGithubAdmissionStore {
  readonly #directory:string;
  readonly #secret:Buffer;
  readonly #session:string;
  constructor(input:{directory:string;hmacSecret:Buffer;expectedSessionId:string}){
    if(!input?.directory?.startsWith("/")||
       !Buffer.isBuffer(input.hmacSecret)||
       input.hmacSecret.length<32||input.hmacSecret.length>128||
       !SESSION.test(input.expectedSessionId??""))
      deny("protected owner directory, 256-bit MAC and session required");
    this.#directory=resolve(input.directory);
    this.#secret=Buffer.from(input.hmacSecret);
    this.#session=input.expectedSessionId;
  }
  async #protectedDirectory(){
    const stat=await lstat(this.#directory);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
       (stat.mode&0o077)!==0||
       (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
      deny("owner-only 0700 durable receipt directory required");
  }
  #filename(id:string){
    if(!RUN.test(id))deny("invalid run ID");
    return createHash("sha256").update("scripted-admission-v1|"+id)
      .digest("hex");
  }
  #mac(record:ScriptedGithubAdmissionRecord){
    return createHmac("sha256",this.#secret)
      .update(JSON.stringify(record)).digest("hex");
  }
  async record(input:{dispatch:ScriptedGithubDispatch;
                      job:VerifiedGithubOidcJob;nowMs?:number}){
    const {dispatch,job}=input;
    if(dispatch?.kind!=="scripted_offline_manual_job_identity_only"||
       dispatch.workflow_path!==WORKFLOW||
       dispatch.execution_profile!=="scripted_offline"||
       job?.kind!=="github_actions_oidc_verified"||
       job.run_id!==dispatch.run_id||
       job.workflow_sha!==dispatch.source_sha)
      deny("authenticated scripted GitHub job proof required");
    const now=input.nowMs??Date.now();
    if(!Number.isFinite(now)||now<0)deny("invalid clock");
    await this.#protectedDirectory();
    const record:ScriptedGithubAdmissionRecord={
      version:1,kind:"oidc_verified_scripted_only_not_engineer_approved",
      session_id:this.#session,run_id:dispatch.run_id,
      source_sha:dispatch.source_sha,
      source_repository:dispatch.source_repository,
      source_ref:dispatch.source_ref,workflow_path:WORKFLOW,
      execution_profile:"scripted_offline",
      model_inference_allowed:false,engineer_approved:false,
      issued_at:new Date(now).toISOString(),
      expires_at:new Date(now+LIFETIME).toISOString()
    };
    const serialized=JSON.stringify({record,mac:this.#mac(record)})+"\n";
    if(Buffer.byteLength(serialized)>MAX_BYTES)
      deny("oversized receipt");
    const name=join(this.#directory,this.#filename(dispatch.run_id)+".json");
    let file;
    try{
      file=await open(name,constants.O_WRONLY|constants.O_CREAT|
        constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    }catch(error){
      if((error as NodeJS.ErrnoException).code==="EEXIST")
        deny("run already recorded");
      throw error;
    }
    try{await file.writeFile(serialized);await file.sync();}
    finally{await file.close();}
  }
  async consume(input:{expectedRunId:string;expectedSourceSha:string;
                       expectedSessionId:string;nowMs?:number}):
    Promise<Readonly<ScriptedGithubAdmissionRecord>>{
    if(!RUN.test(input.expectedRunId??"")||
       !SHA.test(input.expectedSourceSha??"")||
       input.expectedSessionId!==this.#session)
      deny("pinned session/run/SHA required");
    await this.#protectedDirectory();
    const base=this.#filename(input.expectedRunId);
    const path=join(this.#directory,base+".json");
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let raw:string;
    try{
      const stat=await file.stat();
      if(!stat.isFile()||stat.size<1||stat.size>MAX_BYTES||
         (stat.mode&0o077)!==0||
         (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
        deny("untrusted receipt file");
      raw=await file.readFile({encoding:"utf8"});
    }finally{await file.close();}
    let parsed:unknown;
    try{parsed=JSON.parse(raw);}catch{deny("invalid receipt JSON");}
    if(!exact(parsed,["record","mac"])||
       !exact((parsed as any).record,RECORD_FIELDS)||
       typeof (parsed as any).mac!=="string"||
       !/^[a-f0-9]{64}$/u.test((parsed as any).mac))
      deny("invalid scripted receipt structure");
    const record=(parsed as any).record as ScriptedGithubAdmissionRecord;
    if(record.version!==1||
       record.kind!=="oidc_verified_scripted_only_not_engineer_approved"||
       record.workflow_path!==WORKFLOW||
       record.execution_profile!=="scripted_offline"||
       record.model_inference_allowed!==false||
       record.engineer_approved!==false||
       record.session_id!==this.#session||
       record.run_id!==input.expectedRunId||
       record.source_sha!==input.expectedSourceSha)
      deny("wrong profile, run or signed session");
    const issued=Date.parse(record.issued_at);
    const expires=Date.parse(record.expires_at);
    const now=input.nowMs??Date.now();
    if(!Number.isFinite(issued)||!Number.isFinite(expires)||
       !Number.isFinite(now)||now<issued-60000||now>=expires||
       expires<=issued||expires-issued>LIFETIME)
      deny("receipt expired");
    const expected=Buffer.from(this.#mac(record),"hex");
    const mac=Buffer.from((parsed as any).mac,"hex");
    if(expected.length!==mac.length||!timingSafeEqual(expected,mac))
      deny("HMAC does not match");
    const claimed=join(this.#directory,base+".consumed");
    let handle;
    try{
      handle=await open(claimed,constants.O_WRONLY|constants.O_CREAT|
        constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    }catch(error){
      if((error as NodeJS.ErrnoException).code==="EEXIST")
        deny("scripted admission already consumed");
      throw error;
    }
    try{await handle.writeFile("consumed\n");await handle.sync();}
    finally{await handle.close();}
    return Object.freeze(structuredClone(record));
  }
}

/**
 * Pure owner-side manual identity and durable handoff. This cannot
 * approve an Engineer plan, issue a Rust root or start the scripted roles.
 * Do not call from the paid intake; its receipt schema is different.
 */
export async function authenticateScriptedGithubRun(input:{
  env:Readonly<Record<string,string|undefined>>;
  event:unknown;
  pinned:PinnedGithubDispatch&{sourceSha:string};
  oidcJwt:string;
  trust:GithubOidcTrustPolicy;
  githubApiToken:string;
  oidcJwksFetchFn?:typeof fetch;
  githubApiFetchFn?:typeof fetch;
  replayStore:GithubOidcReplayFileStore;
  receiptStore:TrustedScriptedGithubAdmissionStore;
}):Promise<Readonly<ScriptedGithubDispatch>>{
  const dispatch=verifyScriptedGithubManualDispatch(input);
  if(!(input.replayStore instanceof GithubOidcReplayFileStore)||
     !(input.receiptStore instanceof TrustedScriptedGithubAdmissionStore))
    deny("independent durable replay/receipt stores required");
  const job=await verifyGithubOidcScriptedManualJob({
    jwt:input.oidcJwt,dispatch,pinned:input.pinned,trust:input.trust,
    fetchFn:input.oidcJwksFetchFn
  });
  await verifyGithubManualRunViaApi({
    // The REST corroboration uses only the identity fields common to
    // BOTH workflows; this assertion grants no permission or charge consent.
    dispatch,pinned:input.pinned,
    githubApiToken:input.githubApiToken,
    fetchFn:input.githubApiFetchFn
  });
  await input.replayStore.claim(job);
  await input.receiptStore.record({dispatch,job});
  return dispatch;
}
