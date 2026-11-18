/**
 * Loopback Engineer approval API of one review host.
 *
 * This is a single-process PoC, NOT an identity-provider integration.
 * An Engineer password (scrypt verifier) authenticates a short-lived local
 * session; the backend-signed authority proposal and a protected Ed25519 key
 * are the only sources for a signed approval. The caller NEVER supplies
 * authority, repository, proposal, Engineer DID or a private key.
 */
import {createServer} from "node:http";
import {createAuthorityOnlyEngineerReview} from "./authority-only-engineer-review.mjs";
import {open,lstat,writeFile} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {randomBytes,randomUUID,scryptSync,timingSafeEqual} from "node:crypto";
import {TrustedEngineerRejectionStore}
  from "./trusted-engineer-rejection-store.mjs";

const MAX_BYTES=256*1024;
const SESSION_MS=15*60*1000;
const COOKIE="engineer_session";
const sha40=/^[a-f0-9]{40}$/u;
const hex=/^[0-9a-f]+$/iu;

function invalid(message,status=400){
  const error=new Error(message);
  error.status=status;
  throw error;
}
function same(a,b){
  return Buffer.isBuffer(a)&&Buffer.isBuffer(b)&&a.length===b.length&&
    timingSafeEqual(a,b);
}
function exact(object,keys){
  return object!==null&&typeof object==="object"&&!Array.isArray(object)&&
    Object.keys(object).length===keys.length&&
    keys.every(k=>Object.hasOwn(object,k));
}
async function protectedDirectory(path){
  const meta=await lstat(path);
  if(!meta.isDirectory()||meta.isSymbolicLink()||(meta.mode&0o077)!==0){
    invalid("Protected directory must be owner-only",403);
  }
}
async function privateText(path){
  await protectedDirectory(dirname(path));
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=await fd.stat();
    if(!stat.isFile()||stat.size===0||stat.size>MAX_BYTES||
       (stat.mode&0o077)!==0)invalid("Protected file must be owner-only",403);
    return await fd.readFile({encoding:"utf8"});
  }finally{await fd.close();}
}
async function readJson(req){
  if(!String(req.headers["content-type"]||"").startsWith("application/json")){
    invalid("Expected application/json",415);
  }
  let data="",size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>32*1024)invalid("Request body too large",413);
    data+=chunk.toString("utf8");
  }
  try{return JSON.parse(data);}catch{invalid("Invalid JSON");}
}
function respond(res,status,data,extra={}){
  res.writeHead(status,{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    ...extra
  });
  res.end(JSON.stringify(data));
}
function issueCookie(token){
  return COOKIE+"="+token+"; HttpOnly; SameSite=Strict; Path=/; Max-Age=900";
}
function clearCookie(){
  return COOKIE+"=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

export async function createAuthenticatedEngineerServer(config){
  if(config?.architecture!=="authority-only")
    throw Error("Engineer approval requires the authority-only architecture");
  if(config.host && config.host!=="127.0.0.1"||
     typeof config.engineerDid!=="string"||!config.engineerDid.startsWith("did:")||
     typeof config.keyId!=="string"||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(config.keyId)||
     !sha40.test(config.expectedBaseRevision||"")||
     !config.privateKeyFile||!config.receiptDirectory||
     typeof config.publicKeyPem!=="string"||!config.publicKeyPem.trim()||
     !hex.test(config.passwordSaltHex||"")||!hex.test(config.passwordScryptHex||"")||
     config.passwordSaltHex.length<32||config.passwordScryptHex.length!==128||
     (config.rejectPlanning!==undefined&&
      typeof config.rejectPlanning!=="function")||
     (config.planningIsActive!==undefined&&
      typeof config.planningIsActive!=="function")){
    throw new Error("Invalid local trusted Engineer configuration");
  }
  const keyFile=resolve(config.privateKeyFile);
  const receiptDir=resolve(config.receiptDirectory);
  const salt=Buffer.from(config.passwordSaltHex,"hex");
  const expected=Buffer.from(config.passwordScryptHex,"hex");
  if(salt.length<16||expected.length!==64){
    throw new Error("Invalid Engineer password verifier");
  }
  await protectedDirectory(receiptDir);
  const authorityReview=await createAuthorityOnlyEngineerReview(config);
  const initial=authorityReview.initial;
  if(initial.base_revision!==config.expectedBaseRevision ||
     initial.session_id!==config.expectedSessionId ||
     JSON.stringify(initial.repository)!==JSON.stringify(config.repository)){
    throw new Error("Authority proposal does not match pinned repository/session/revision");
  }
  const pinnedDigest=authorityReview.digest;
  const rejectionStore=new TrustedEngineerRejectionStore({
    directory:receiptDir,sessionId:config.expectedSessionId,
    baseRevision:config.expectedBaseRevision,planDigest:pinnedDigest
  });
  // A previous rejection cannot be silently reused as a new approval
  // session, even when the root has already been retired and UI restarted.
  await rejectionStore.assertFresh();
  const verifyCheckpoint=async()=>{await authorityReview.loadVerified();};
  await verifyCheckpoint();
  // Validate signer accessibility and pinned public identity at startup,
  // but re-read the protected key immediately before every signing action.
  await authorityReview.signSelected(["permission-1"],await privateText(keyFile));

  const sessions=new Map();
  let loginAttempts=0,loginWindow=Date.now(),approvalInProgress=false;
  let decision="reviewing"; // rejection and uncertain revocation are terminal

  const server=createServer(async(req,res)=>{
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("X-Frame-Options","DENY");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "+
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try{
      const address=server.address();
      const host="127.0.0.1:"+address?.port;
      const origin="http://"+host;
      if(req.headers.host!==host)invalid("Untrusted Host",403);
      if(req.method==="POST"&&req.headers.origin!==origin){
        invalid("Invalid browser origin",403);
      }
      const url=new URL(req.url||"/",origin);
      if(url.search || url.hash)invalid("Unexpected request parameters");
      if(req.method==="POST"&&url.pathname==="/api/login"){
        const body=await readJson(req);
        if(!exact(body,["password"])||typeof body.password!=="string"||
           body.password.length>512)invalid("Invalid login",401);
        if(Date.now()-loginWindow>=60000){loginWindow=Date.now();loginAttempts=0;}
        if(++loginAttempts>6)invalid("Try again later",429);
        const password=scryptSync(body.password,salt,64);
        if(!same(password,expected))invalid("Invalid login",401);
        loginAttempts=0;
        const token=randomBytes(32).toString("base64url");
        const csrf=randomBytes(32).toString("base64url");
        sessions.set(token,{csrf,expires:Date.now()+SESSION_MS});
        respond(res,200,{authenticated:true},{
          "Set-Cookie":issueCookie(token)
        });
        return;
      }
      const token=/((?:^|;\s*))engineer_session=([A-Za-z0-9_-]{43})(?:;|$)/u
        .exec(String(req.headers.cookie||""))?.[2];
      const session=sessions.get(token);
      if(!session||session.expires<=Date.now()){
        if(token)sessions.delete(token);
        invalid("Engineer authentication required",401);
      }
      if(req.method==="GET"&&(url.pathname==="/api/review"||
        url.pathname==="/api/authorization")){
        if(decision==="rejected"||decision==="rejection_unconfirmed")
          invalid("Engineer decision already final",409);
        await verifyCheckpoint();
        respond(res,200,{
          protocol:"authority-only",authorization_proposal:initial,
          proposal_digest:pinnedDigest,permissions:authorityReview.permissions(initial),
          engineer_did:config.engineerDid,csrf_token:session.csrf,
          reject_enabled:typeof config.rejectPlanning==="function"
        });
        return;
      }
      if(req.method==="POST"&&url.pathname==="/api/logout"){
        if(req.headers["x-csrf-token"]!==session.csrf)invalid("CSRF rejected",403);
        sessions.delete(token);
        respond(res,200,{signed_out:true},{"Set-Cookie":clearCookie()});
        return;
      }
      if(req.method==="POST"&&url.pathname==="/api/reject"){
        if(typeof config.rejectPlanning!=="function")
          invalid("Trusted Planning rejection is not configured",404);
        if(req.headers["x-csrf-token"]!==session.csrf)
          invalid("CSRF rejected",403);
        const body=await readJson(req);
        if(!exact(body,["proposal_digest","confirmation"])||
           body.proposal_digest!==pinnedDigest||
           body.confirmation!=="REJECT "+pinnedDigest)
          invalid("Invalid Engineer rejection confirmation",403);
        if(decision!=="reviewing"||approvalInProgress)
          invalid("Engineer decision already final or in progress",409);
        // Fence signing synchronously, BEFORE filesystem checks can yield
        // to another request. A prior signed receipt stays authoritative.
        decision="rejecting";
        try{
          try{
            await lstat(join(receiptDir,initial.session_id+".json"));
            invalid("Signed Engineer approval already exists",409);
          }catch(error){
            if(error.code!=="ENOENT")throw error;
          }
          await verifyCheckpoint();
          const latest=await authorityReview.loadVerified();
          if(authorityReview.digest!==pinnedDigest||latest.session_id!==initial.session_id)
            invalid("Authority proposal changed before rejection",409);
          // Durable decision is recorded first; a crash during native
          // retirement must never reopen this session for approval.
          await rejectionStore.reserve();
          await config.rejectPlanning();
          decision="rejected";
          sessions.clear();
          respond(res,200,{
            rejected:true,provisional_credential_revoked:true,
            operational_credential_issued:false,
            proposal_digest:pinnedDigest
          },{"Set-Cookie":clearCookie()});
          return;
        }catch(error){
          // Rust or Gateway retirement may be incomplete. Never reapprove.
          decision="rejection_unconfirmed";
          throw error;
        }
      }
      if(req.method==="POST"&&url.pathname==="/api/approve"){
        if(req.headers["x-csrf-token"]!==session.csrf)invalid("CSRF rejected",403);
        const body=await readJson(req);
        if(!exact(body,["proposal_digest","approved_permission_ids","confirmation"])||
           body.proposal_digest!==pinnedDigest||
           body.confirmation!=="APPROVE "+pinnedDigest||
           !Array.isArray(body.approved_permission_ids)||
           !body.approved_permission_ids.length||
           body.approved_permission_ids.some(x=>typeof x!=="string")||
           new Set(body.approved_permission_ids).size!==body.approved_permission_ids.length){
          invalid("Invalid Engineer confirmation or plan digest",403);
        }
        if(decision!=="reviewing"||approvalInProgress)
          invalid("Engineer decision already final or in progress",409);
        approvalInProgress=true;
        try{
          // A valid check at startup cannot outlive checkpoint expiry,
          // revocation of provenance, or later filesystem modification.
          await verifyCheckpoint();
          const latest=await authorityReview.loadVerified();
          if(authorityReview.digest!==pinnedDigest ||
             latest.base_revision!==config.expectedBaseRevision){
            invalid("Authority proposal changed; new validation required",409);
          }
          const now=new Date();
          const signed=await authorityReview.signSelected(
            body.approved_permission_ids,await privateText(keyFile),now);
          const decisionId="approval-"+randomUUID();
          const permissionCount=signed.authorization.permissions.length;
          await protectedDirectory(receiptDir);
          if(config.planningIsActive&&config.planningIsActive()!==true)
            invalid("Live Planning root revoked before receipt persistence",409);
          const encoded=JSON.stringify(signed,null,2)+"\n";
          if(Buffer.byteLength(encoded)>128*1024)
            invalid("Authority receipt exceeds bound",413);
          await writeFile(join(receiptDir,latest.session_id+".json"),
            encoded,{mode:0o600,flag:"wx"});
          decision="approved";
          sessions.clear();
          respond(res,201,{
            decision_id:decisionId,
            proposal_digest:pinnedDigest,
            permission_count:permissionCount,
            signed:true,operational_credential_issued:false
          },{"Set-Cookie":clearCookie()});
          return;
        }finally{approvalInProgress=false;}
      }
      invalid("Route not found",404);
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:
        error?.code==="EEXIST"?409:500;
      respond(res,status,{
        error:status===500?"Trusted approval unavailable":
          String(error.message).slice(0,180)
      });
    }
  });
  return server;
}
