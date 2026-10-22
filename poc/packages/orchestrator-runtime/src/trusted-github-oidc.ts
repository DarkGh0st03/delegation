/**
 * Cryptographically verify the job calling the persistent Engineer backend.
 *
 * Hard-coded GitHub OIDC issuer/JWKS, RS256 signature validation, exact
 * independently PINNED audience, subject, numeric repository/owner IDs,
 * workflow source, GitHub SHA, event/run identity and time window.
 *
 * OIDC authenticates the runner, NOT the free-form workflow_dispatch input
 * values and never authenticates the Engineer. The host must receive token
 * and input JSON in the SAME authenticated TLS/IPC request, independently
 * corroborate the Actions run via REST and atomically record jti before
 * granting access. Do not expose raw JWT to ADK or logging.
 */
import {createPublicKey,verify as verifySignature} from "node:crypto";
import type {PinnedGithubDispatch,ReviewedGithubDispatchRequest}
  from "./trusted-manual-github-dispatch.ts";

const ISSUER="https://token.actions.githubusercontent.com";
const JWKS_URL=ISSUER+"/.well-known/jwks";
const B64URL=/^[A-Za-z0-9_-]+$/u;
const SHA=/^[a-f0-9]{40}$/u;
const DECIMAL=/^[1-9][0-9]*$/u;
const MAX_TOKEN_LENGTH=16000;
const MAX_LIFETIME_SECONDS=900;
function fail(reason:string):never{
  throw new Error("Trusted GitHub OIDC assertion: "+reason);
}
function decodeJson(part:string):Record<string,any>{
  if(!B64URL.test(part)||part.length>12000)
    fail("invalid JWT encoding");
  let value:unknown;
  try{
    const data=Buffer.from(part,"base64url");
    if(data.toString("base64url")!==part)fail("noncanonical JWT encoding");
    value=JSON.parse(data.toString("utf8"));
  }catch{fail("invalid JWT JSON");}
  if(!value||typeof value!=="object"||Array.isArray(value))
    fail("JWT header/payload must be objects");
  return value as Record<string,any>;
}
export interface GithubOidcTrustPolicy{
  /** Unique backend-specific value, configured out of band. */
  expectedAudience:string;
  /** Github subject exact value: support configured legacy or immutable IDs. */
  expectedSubject:string;
  /** Stable numeric IDs, never copied from the token itself. */
  expectedRepositoryId:string;
  expectedOwnerId:string;
}
export interface VerifiedGithubOidcJob{
  readonly kind:"github_actions_oidc_verified";
  readonly jti:string;
  readonly run_id:string;
  readonly workflow_sha:string;
  readonly repository_id:string;
  readonly repository_owner_id:string;
  readonly audience:string;
}
/**
 * The JWKS URI is fixed, not accepted from the JWT header. Network errors
 * always fail closed; the trusted backend must use system TLS validation.
 */
async function verifySignedGithubOidcEvent(input:{
  jwt:string;
  dispatch:ReviewedGithubDispatchRequest;
  pinned:PinnedGithubDispatch;
  trust:GithubOidcTrustPolicy;
  fetchFn?:typeof fetch;
  nowMs?:number;
  /** Internal only: paid handoff MUST require manual dispatch. */
  expectedEvent:"workflow_dispatch"|"push";
}):Promise<Readonly<VerifiedGithubOidcJob>>{
  const {jwt,dispatch,pinned,trust}=input;
  if(typeof jwt!=="string"||jwt.length<100||
     jwt.length>MAX_TOKEN_LENGTH)
    fail("missing or oversized signed job assertion");
  const pieces=jwt.split(".");
  if(pieces.length!==3||pieces.some(x=>!B64URL.test(x)))
    fail("invalid compact JWT format");
  const [h,p,sig]=pieces;
  const header=decodeJson(h),claims=decodeJson(p);
  if(header.alg!=="RS256"||typeof header.kid!=="string"||
     header.kid.length<1||header.kid.length>256||
     (header.typ!==undefined&&header.typ!=="JWT")||
     header.crit!==undefined||
     header.jku!==undefined||header.jwk!==undefined||
     header.x5u!==undefined)
    fail("untrusted JWT signing algorithm or header");
  const now=Math.floor((input.nowMs??Date.now())/1000);
  if(!Number.isSafeInteger(now)||
     ![claims.exp,claims.iat,claims.nbf].every(Number.isSafeInteger)||
     claims.exp<=now||claims.nbf>now+60||claims.iat>now+60||
     now-claims.iat>MAX_LIFETIME_SECONDS||
     claims.nbf>claims.exp||claims.exp<=claims.iat||
     claims.exp-claims.iat>MAX_LIFETIME_SECONDS)
    fail("expired, future-dated or unbounded OIDC assertion");
  if(typeof trust.expectedAudience!=="string"||
     trust.expectedAudience.length<16||
     typeof trust.expectedSubject!=="string"||
     !trust.expectedSubject.trim()||
     !DECIMAL.test(trust.expectedRepositoryId)||
     !DECIMAL.test(trust.expectedOwnerId))
    fail("missing independently pinned OIDC trust policy");
  const comparisons={
    issuer:claims.iss===ISSUER,
    audience:claims.aud===trust.expectedAudience,
    subject:claims.sub===trust.expectedSubject,
    repository:claims.repository===pinned.repository,
    repository_id:String(claims.repository_id)===trust.expectedRepositoryId,
    owner_id:String(claims.repository_owner_id)===trust.expectedOwnerId,
    ref:claims.ref===pinned.ref,
    ref_type:claims.ref_type==="branch",
    sha:claims.sha===dispatch.source_sha,
    workflow_sha:claims.workflow_sha===dispatch.source_sha,
    workflow_ref:claims.workflow_ref===pinned.repository+"/"+
      pinned.workflowPath+"@"+pinned.ref,
    event:claims.event_name===input.expectedEvent,
    run_id:String(claims.run_id)===dispatch.run_id,
    run_attempt:String(claims.run_attempt)==="1",
    sha_format:SHA.test(claims.sha??""),
    jti:typeof claims.jti==="string"&&claims.jti.length>=12&&
      claims.jti.length<=256
  };
  const failedNames=Object.entries(comparisons)
    .filter(([,ok])=>!ok).map(([name])=>name);
  if(failedNames.length){
    // Fixed field names ONLY on non-authorizing offline probe. This reports
    // no raw JWT, signed claim values, tokens or identity details.
    fail("OIDC identity does not match trusted job/source/subject pins");
  }
  if(!pinned.sourceSha||pinned.sourceSha!==dispatch.source_sha)
    fail("trusted GitHub source SHA must be pinned independently");
  let response:Response;
  try{
    response=await (input.fetchFn??fetch)(JWKS_URL,{
      headers:{accept:"application/json"},
      // A redirected host is not the pinned GitHub identity provider.
      redirect:"error",
      signal:AbortSignal.timeout(10000)
    });
  }catch{fail("GitHub JWKS unavailable");}
  if(!response.ok)fail("GitHub JWKS returned invalid status");
  let jwks:Record<string,any>;
  try{
    const raw=await response.text();
    if(raw.length>262144)fail("oversized GitHub JWKS");
    jwks=JSON.parse(raw);
  }catch{fail("invalid GitHub JWKS JSON");}
  if(!Array.isArray(jwks.keys)||jwks.keys.length>64)
    fail("invalid GitHub JWKS collection");
  const key=jwks.keys.find((candidate:any)=>candidate?.kid===header.kid);
  if(!key||key.kty!=="RSA"||
     (key.use!==undefined&&key.use!=="sig")||
     (key.alg!==undefined&&key.alg!=="RS256")||
     typeof key.n!=="string"||typeof key.e!=="string")
    fail("unknown or invalid GitHub OIDC signing key");
  let valid=false;
  try{
    const publicKey=createPublicKey({
      key:{kty:"RSA",n:key.n,e:key.e},format:"jwk"
    });
    valid=verifySignature("RSA-SHA256",
      Buffer.from(h+"."+p,"ascii"),publicKey,
      Buffer.from(sig,"base64url"));
  }catch{fail("invalid GitHub OIDC signing key material");}
  if(!valid)fail("invalid OIDC signature");
  return Object.freeze({
    kind:"github_actions_oidc_verified",
    jti:claims.jti,
    run_id:dispatch.run_id,
    workflow_sha:dispatch.source_sha,
    repository_id:trust.expectedRepositoryId,
    repository_owner_id:trust.expectedOwnerId,
    audience:trust.expectedAudience
  });
}


/**
 * STRICT paid authorization path. Deliberately not configurable by callers:
 * only a first, explicitly approved workflow_dispatch is permitted.
 */
export function verifyGithubOidcJobAssertion(input:
  Omit<Parameters<typeof verifySignedGithubOidcEvent>[0],"expectedEvent">
):Promise<Readonly<VerifiedGithubOidcJob>>{
  return verifySignedGithubOidcEvent({
    ...input,expectedEvent:"workflow_dispatch"
  });
}

export interface OfflineGithubOidcProof{
  readonly kind:"offline_push_identity_only";
  readonly run_id:string;
  readonly workflow_sha:string;
  readonly signature_verified:true;
}

/**
 * Separate read-only diagnostic for a real GitHub push job. It intentionally
 * returns a DIFFERENT, non-authorizing proof without any signed job jti.
 *
 * Even a valid push proof cannot satisfy verifyGithubOidcJobAssertion,
 * verifyGithubManualGeminiDispatch or the Engineer signature check.
 * Never pass this result to the operational/root/paid entrypoints.
 */
export async function verifyGithubOidcOfflinePushProbe(input:{
  jwt:string;
  pinned:PinnedGithubDispatch&{sourceSha:string};
  expectedRunId:string;
  trust:GithubOidcTrustPolicy;
  fetchFn?:typeof fetch;
  nowMs?:number;
}):Promise<Readonly<OfflineGithubOidcProof>>{
  if(!DECIMAL.test(input.expectedRunId)||!SHA.test(input.pinned.sourceSha))
    fail("offline push probe requires pinned run and source revision");
  const dispatch={
    source_sha:input.pinned.sourceSha,
    run_id:input.expectedRunId
  } as ReviewedGithubDispatchRequest;
  const checked=await verifySignedGithubOidcEvent({
    jwt:input.jwt,dispatch,pinned:input.pinned,trust:input.trust,
    fetchFn:input.fetchFn,nowMs:input.nowMs,expectedEvent:"push"
  });
  return Object.freeze({
    kind:"offline_push_identity_only",
    run_id:checked.run_id,
    workflow_sha:checked.workflow_sha,
    signature_verified:true
  });
}
