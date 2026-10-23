/**
 * Minimal authenticated intake for an existing trusted Engineer host.
 *
 * AUTHENTICATION ONLY. Default is loopback; operational deployments may
 * explicitly bind ONE RFC1918 IPv4 interface under strict mTLS identity
 * pinning. Never bind a wildcard/public interface or forward public HTTP.
 * This service never
 * constructs a Gemini model, accepts API secrets, signs an Engineer receipt,
 * issues DCs, invokes the operational Coordinator or mutates Gitea.
 *
 * A deployed system can transport this over authenticated private IPC /
 * mutually authenticated TLS to an always-on Engineer process. Do not open
 * this loopback socket to untrusted public traffic via a raw reverse proxy.
 *
 * The OIDC token and GitHub workflow JSON MUST arrive in the SAME bounded
 * request. Independently pinned configuration comes from the host, never
 * from the request body. A consumed OIDC token is one-shot even if a later
 * Engineer approval or model activation is rejected.
 */
import {createServer as createHttpServer,type IncomingMessage,type ServerResponse} from "node:http";
import {createServer as createHttpsServer} from "node:https";
import {timingSafeEqual} from "node:crypto";
import {isIP} from "node:net";
import type {TLSSocket} from "node:tls";
import {GithubOidcReplayFileStore}
  from "./trusted-github-oidc-replay-store.ts";
import {TrustedGithubAdmissionReceiptStore}
  from "./trusted-github-admission-store.ts";
import {verifyGithubOidcJobAssertion,
  type GithubOidcTrustPolicy}
  from "./trusted-github-oidc.ts";
import {verifyGithubManualGeminiDispatch,verifyGithubManualRunViaApi,
  type PinnedGithubDispatch}
  from "./trusted-manual-github-dispatch.ts";

const PATH="/v1/trusted/github/oidc-admission";
const MAX_BYTES=48*1024;
/**
 * The only non-loopback listener allowed is an explicitly selected private
 * IPv4 interface (RFC1918) with mutual TLS. Network routing and firewalls
 * must be independently configured. This is NOT a deployment mechanism.
 * No DNS name, 0.0.0.0, public IP, IPv6, or arbitrary loopback alias.
 */
export function verifiedPrivateOidcBindAddress(
  value:string|undefined,tlsConfigured:boolean
):string{
  const address=value??"127.0.0.1";
  if(address==="127.0.0.1")return address;
  if(isIP(address)!==4)
    throw Error("Trusted OIDC intake: invalid private interface address");
  const octets=address.split(".").map(Number);
  const [first,second]=octets;
  const privateRfc1918=first===10||
    (first===172&&second>=16&&second<=31)||
    (first===192&&second===168);
  if(!privateRfc1918)
    throw Error("Trusted OIDC intake: public/wildcard interface prohibited");
  if(!tlsConfigured)
    throw Error("Trusted OIDC intake: private interface requires pinned mTLS");
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
export interface TrustedGithubOidcIntakeConfig{
  pinned:PinnedGithubDispatch&{sourceSha:string};
  trust:GithubOidcTrustPolicy;
  githubApiToken:string;
  replayStore:GithubOidcReplayFileStore;
  /** Independent host-only one-use session-bound receipt store. */
  admissionStore:TrustedGithubAdmissionReceiptStore;
  /** Useful only for offline unit tests. */
  githubApiFetchFn?:typeof fetch;
  oidcJwksFetchFn?:typeof fetch;
  port?:number;
  /** Host-selected IPv4 address; default loopback. Non-loopback RFC1918 requires mTLS. */
  bindAddress?:string;
  /** mTLS mandatory for any private network listener. */
  tls?:Readonly<{key:string|Buffer;cert:string|Buffer;ca:string|Buffer;
    /** Host-pinned SHA256 fingerprint of the ONE admitted runner leaf. */
    expectedClientFingerprint256:string}>;
}
export interface TrustedGithubOidcIntakeServer{
  readonly baseUrl:string;
  readonly endpoint:string;
  close():Promise<void>;
}

export async function startTrustedGithubOidcIntakeServer(
  config:TrustedGithubOidcIntakeConfig
):Promise<TrustedGithubOidcIntakeServer>{
  if(!(config.replayStore instanceof GithubOidcReplayFileStore)||
     !(config.admissionStore instanceof TrustedGithubAdmissionReceiptStore)||
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
      const dispatch=verifyGithubManualGeminiDispatch({
        env:admission.env,event:admission.event,pinned:config.pinned
      });
      const authenticated=await verifyGithubOidcJobAssertion({
        jwt:admission.oidcJwt,dispatch,pinned:config.pinned,
        trust:config.trust,fetchFn:config.oidcJwksFetchFn
      });
      await verifyGithubManualRunViaApi({
        dispatch,pinned:config.pinned,
        githubApiToken:config.githubApiToken,
        fetchFn:config.githubApiFetchFn
      });
      await config.replayStore.claim(authenticated);
      // Durable, signed session-bound consent for the trusted host, never
      // a model/root authorization. Replays and persistence errors fail closed.
      await config.admissionStore.record({dispatch,job:authenticated});
      respond(200,{
        status:"github_job_authenticated_only_not_engineer_approved",
        source_sha:dispatch.source_sha,run_id:dispatch.run_id,
        engineer_approval:"not_checked",
        operational_credential:"not_issued",
        gemini_calls:0
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
