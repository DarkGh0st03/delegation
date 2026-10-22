/**
 * Minimal authenticated intake for an existing trusted Engineer host.
 *
 * Deliberately LOCALHOST ONLY and AUTHENTICATION ONLY. This service never
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
import {createServer,type Server} from "node:http";
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
  let active=false;
  const server:Server=createServer(async(req,res)=>{
    const respond=(status:number,result:Record<string,unknown>)=>{
      if(res.writableEnded)return;
      res.writeHead(status,{
        "content-type":"application/json; charset=utf-8",
        "cache-control":"no-store",
        "x-content-type-options":"nosniff"
      });
      res.end(JSON.stringify(result));
    };
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
  });
  server.requestTimeout=15000;
  server.headersTimeout=16000;
  try{
    await new Promise<void>((resolve,reject)=>{
      server.once("error",reject);
      server.listen(config.port??0,"127.0.0.1",()=>resolve());
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
  const baseUrl="http://127.0.0.1:"+address.port;
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
