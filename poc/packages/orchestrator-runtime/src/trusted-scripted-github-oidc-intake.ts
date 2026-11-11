/**
 * OWNER-ONLY, ZERO-BILLING SCRIPTED GitHub OIDC intake.
 * Separate mTLS route/receipt. No Gemini or paid consent parsing,
 * no task execution, no root issuance. Identity != Engineer approval.
 */
import {createServer as createHttpServer,type IncomingMessage,type ServerResponse} from "node:http";
import {createServer as createHttpsServer} from "node:https";
import {timingSafeEqual} from "node:crypto";

import type {TLSSocket} from "node:tls";
import {GithubOidcReplayFileStore}
  from "./trusted-github-oidc-replay-store.ts";
import {TrustedScriptedGithubAdmissionStore,
  authenticateScriptedGithubRun}
  from "./trusted-scripted-github-admission.ts";
import type {GithubOidcTrustPolicy}
  from "./trusted-github-oidc.ts";
import type {PinnedGithubDispatch}
  from "./trusted-manual-github-dispatch.ts";
import {isIP} from "node:net";

const PATH="/v1/trusted/github/scripted-offline-oidc-admission";
const STATUS_PATH="/v1/trusted/github/scripted-offline-admission-status";
const RUN=/^[1-9]\d{0,19}$/u;
const MAX_BYTES=48*1024;
/**
 * The only non-loopback listener allowed is an explicitly selected private
 * IPv4 interface (RFC1918) with mutual TLS. Network routing and firewalls
 * must be independently configured. This is NOT a deployment mechanism.
 * No DNS name, 0.0.0.0, public IP, IPv6, or arbitrary loopback alias.
 */
// Independent address validator: the offline listener must never import
// the paid-mode intake or consent schema even transitively.
export function verifiedPrivateOidcBindAddress(
  value:string|undefined,tlsConfigured:boolean
):string{
  const address=value??"127.0.0.1";
  if(address==="127.0.0.1")return address;
  if(isIP(address)!==4)
    throw Error("Trusted scripted intake: invalid private interface address");
  const [first,second]=address.split(".").map(Number);
  if(!(first===10||(first===172&&second>=16&&second<=31)||
       (first===192&&second===168)))
    throw Error("Trusted scripted intake: public/wildcard interface prohibited");
  if(!tlsConfigured)
    throw Error("Trusted scripted intake: private interface requires pinned mTLS");
  return address;
}
const ENV_KEYS=[
  "GITHUB_ACTIONS","GITHUB_EVENT_NAME","GITHUB_RUN_ATTEMPT",
  "GITHUB_REPOSITORY","GITHUB_REF","GITHUB_WORKFLOW_REF",
  "GITHUB_SHA","GITHUB_RUN_ID"
] as const;

type EnvKey=typeof ENV_KEYS[number];
interface Admission{
  env:Record<EnvKey,string>;
  event:unknown;
  oidcJwt:string;
}
function object(value:unknown):value is Record<string,unknown>{
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}
function exact(value:Record<string,unknown>,keys:readonly string[]){
  return Object.keys(value).length===keys.length&&
    keys.every(k=>Object.hasOwn(value,k));
}
function parseAdmission(json:unknown):Admission{
  if(!object(json)||!exact(json,["env","event","oidcJwt"])||
     !object(json.env)||!exact(json.env,ENV_KEYS)||
     ENV_KEYS.some(key=>typeof (json.env as Record<string,unknown>)[key]!=="string")||
     typeof json.oidcJwt!=="string"||
     json.oidcJwt.length<100||json.oidcJwt.length>16000||
     !object(json.event))
    throw Error("invalid admission envelope");
  return json as unknown as Admission;
}
export interface TrustedScriptedGithubOidcIntakeConfig{
  pinned:PinnedGithubDispatch&{sourceSha:string};
  trust:GithubOidcTrustPolicy;
  githubApiToken:string;
  replayStore:GithubOidcReplayFileStore;
  /** Independent host-only one-use session-bound receipt store. */
  admissionStore:TrustedScriptedGithubAdmissionStore;
  /** Useful only for offline unit tests. */
  githubApiFetchFn?:typeof fetch;
  oidcJwksFetchFn?:typeof fetch;
  /**
   * Trusted host-owned, read-only outcome. No caller can start inference,
   * approve a plan, renew authority or produce a synthetic status here.
   * Used only by a previously authenticated private mTLS runner.
   */
  statusForAdmittedRun?:(runId:string)=>(
    "waiting_for_owner"|"execution_active"|"completed_verified"|"terminated"
  );
  port?:number;
  /** Host-selected IPv4 address; default loopback. Non-loopback RFC1918 requires mTLS. */
  bindAddress?:string;
  /** mTLS mandatory for any private network listener. */
  tls?:Readonly<{key:string|Buffer;cert:string|Buffer;ca:string|Buffer;
    /** Host-pinned SHA256 fingerprint of the ONE admitted runner leaf. */
    expectedClientFingerprint256:string}>;
}
export interface TrustedScriptedGithubOidcIntakeServer{
  readonly baseUrl:string;
  readonly endpoint:string;
  close():Promise<void>;
}

export async function startTrustedScriptedGithubOidcIntakeServer(
  config:TrustedScriptedGithubOidcIntakeConfig
):Promise<TrustedScriptedGithubOidcIntakeServer>{
  if(!(config.replayStore instanceof GithubOidcReplayFileStore)||
     !(config.admissionStore instanceof TrustedScriptedGithubAdmissionStore)||
     !config.githubApiToken?.trim()||
     !/^[0-9a-f]{40}$/u.test(config.pinned?.sourceSha??"")||
     !config.trust?.expectedAudience?.trim()||
     !config.trust?.expectedSubject?.trim()||
     !Number.isSafeInteger(config.port??0)||
     (config.port??0)<0||(config.port??0)>65535)
    throw Error("Trusted Github OIDC intake host configuration missing");
  // Reject prohibited interfaces BEFORE allocating sockets or reading tokens.
  const bindAddress=verifiedPrivateOidcBindAddress(
    config.bindAddress,config.tls!==undefined);
  const validPem=(value:unknown)=>
    (typeof value==="string"||Buffer.isBuffer(value))&&
    Buffer.byteLength(value as string|Buffer)>0&&
    Buffer.byteLength(value as string|Buffer)<128*1024;
  if(config.tls&&
     (!validPem(config.tls.key)||!validPem(config.tls.cert)||
      !validPem(config.tls.ca)))
    throw Error("Trusted Github OIDC intake requires pinned mTLS key/cert/CA");
  const fingerprint=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u;
  if(config.tls&&!fingerprint.test(config.tls.expectedClientFingerprint256??""))
    throw Error("Trusted Github OIDC intake requires pinned client certificate fingerprint");
  let active=false;
  // Distinct manual dispatches may be admitted in one Planning session.
  // Every admission is independently HMAC-recorded and one-shot consumed;
  // the host must separately bind the eventual DAG outcome to its run ID.
  const admittedRuns=new Map<string,string>();
  const handler=async(req:IncomingMessage,res:ServerResponse)=>{
    const respond=(status:number,result:Record<string,unknown>)=>{
      if(res.writableEnded)return;
      res.writeHead(status,{
        "content-type":"application/json; charset=utf-8",
        "cache-control":"no-store",
        "x-content-type-options":"nosniff"
      });
      res.end(JSON.stringify(result));
    };
    // A certificate signed by the same CA is NOT necessarily the trusted
    // GitHub runner. The host must pin the exact leaf certificate as well.
    // This check precedes JWT parsing, run queries and replay consumption.
    if(config.tls){
      const socket=req.socket as TLSSocket;
      const presented=socket.getPeerCertificate()?.fingerprint256;
      const expected=config.tls.expectedClientFingerprint256;
      if(!socket.authorized||typeof presented!=="string"||
         !fingerprint.test(presented)||!fingerprint.test(expected)||
         !timingSafeEqual(Buffer.from(presented.replaceAll(":",""),"hex"),
           Buffer.from(expected.replaceAll(":",""),"hex"))){
        respond(403,{status:"denied"});return;
      }
    }
    // Read-only, previously authenticated runner hold. This endpoint
    // cannot issue credentials, sign consent, start tasks or trigger Gemini.
    // It is unavailable in the HTTP/loopback demonstration mode.
    if(req.method==="GET"){
      if(!config.tls||!config.statusForAdmittedRun||
         typeof req.url!=="string"||req.url.length>280){
        respond(404,{status:"denied"});return;
      }
      try{
        const url=new URL(req.url,"https://127.0.0.1");
        const fields=[...url.searchParams.keys()];
        const runId=url.searchParams.get("run_id");
        const sourceSha=url.searchParams.get("source_sha");
        if(url.pathname!==STATUS_PATH||fields.length!==2||
           fields[0]!=="run_id"||fields[1]!=="source_sha"||
           !RUN.test(runId??"")||
           !/^[a-f0-9]{40}$/u.test(sourceSha??"")||
           admittedRuns.get(runId??"")!==sourceSha){
          respond(404,{status:"denied"});return;
        }
        const state=config.statusForAdmittedRun(runId!);
        if(!["waiting_for_owner","execution_active",
             "completed_verified","terminated"].includes(state))
          throw Error("invalid trusted runner status");
        respond(200,{
          status:"scripted_runner_status_only_not_authorization",
          run_id:runId,source_sha:sourceSha,execution_state:state
        });
      }catch{
        respond(403,{status:"denied"});
      }
      return;
    }
    // Serialize admission and replay consumption within this host. O_EXCL
    // in the file store independently serializes across separate processes.
    if(active){respond(429,{status:"denied"});return;}
    if(req.method!=="POST"||req.url!==PATH||
       req.headers["content-type"]!=="application/json"){
      respond(404,{status:"denied"});return;
    }
    active=true;
    try{
      let text="";
      for await(const part of req){
        text+=part.toString("utf8");
        if(Buffer.byteLength(text,"utf8")>MAX_BYTES)
          throw Error("admission request too large");
      }
      const admission=parseAdmission(JSON.parse(text));
      // A separate signed offline workflow JWT, GH REST record, replay
      // store and non-billing HMAC receipt. Paid parser is not imported.
      const dispatch=await authenticateScriptedGithubRun({
        env:admission.env,event:admission.event,
        oidcJwt:admission.oidcJwt,pinned:config.pinned,
        trust:config.trust,githubApiToken:config.githubApiToken,
        replayStore:config.replayStore,
        receiptStore:config.admissionStore,
        githubApiFetchFn:config.githubApiFetchFn,
        oidcJwksFetchFn:config.oidcJwksFetchFn
      });
      if(admittedRuns.size>=16&&!admittedRuns.has(dispatch.run_id))
        throw Error("too many offline admissions");
      admittedRuns.set(dispatch.run_id,dispatch.source_sha);
      respond(200,{
        status:"scripted_github_job_authenticated_only_not_engineer_approved",
        execution_profile:"scripted_offline",
        source_sha:dispatch.source_sha,run_id:dispatch.run_id,
        engineer_approval:"not_checked",
        operational_credential:"not_issued",
        model_inference_allowed:false
      });
    }catch{
      // Uniform response prevents exposing identity, PII, JWT and host keys.
      respond(403,{status:"denied"});
    }finally{active=false;}
  };
  // Non-loopback RFC1918 is allowed only with full mTLS and a pinned
  // client certificate. Password/CSRF Engineer UI remains localhost-only.
  const server=config.tls
    ?createHttpsServer({
      ...config.tls,requestCert:true,rejectUnauthorized:true,
      minVersion:"TLSv1.2"
    },handler)
    :createHttpServer(handler);
  server.requestTimeout=15000;
  server.headersTimeout=16000;
  try{
    await new Promise<void>((resolve,reject)=>{
      server.once("error",reject);
      server.listen(config.port??0,bindAddress,()=>resolve());
    });
  }catch(error){
    server.close();
    throw error;
  }
  const address=server.address();
  if(!address||typeof address==="string"){
    server.close();
    throw Error("Unable to determine trusted loopback port");
  }
  const baseUrl=(config.tls?"https":"http")+"://"+bindAddress+":"+address.port;
  let closed=false;
  return Object.freeze({
    baseUrl,endpoint:baseUrl+PATH,
    close:async()=>{
      if(closed)return;
      closed=true;
      await new Promise<void>((resolve,reject)=>
        server.close(error=>error?reject(error):resolve())
      );
    }
  });
}
