/**
 * Local-only authenticated Software Engineer approval console.
 *
 * This is a single-process PoC, NOT an identity-provider integration.
 * An Engineer password (scrypt verifier) authenticates a short-lived local
 * session; an independent trusted plan and a protected Ed25519 key are the
 * only sources for a signed approval. The browser NEVER supplies authority,
 * repository, plan, Engineer DID or a private key.
 */
import {createServer} from "node:http";
import {readFile,open,lstat,writeFile} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes,randomUUID,scryptSync,timingSafeEqual} from "node:crypto";
import {validatePlan,planDigest,makeApproval} from
  "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval,verifyEngineerApproval} from
  "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../gateway/src/operation-catalog.ts";
import {SignedPlanningCheckpointFileStore} from
  "../../../packages/orchestrator-runtime/src/trusted-planning-checkpoint-store.ts";

const OPERATIONS=new Set(RUST_OPERATIONS);
const MAX_BYTES=256*1024;
const SESSION_MS=15*60*1000;
const RECEIPT_MS=30*60*1000;
const COOKIE="engineer_session";
const sha40=/^[a-f0-9]{40}$/u;
const hex=/^[0-9a-f]+$/iu;
const clientBase=new URL("../../../workflow-ui/",import.meta.url);

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
  if(!config||config.host && config.host!=="127.0.0.1"||
     typeof config.engineerDid!=="string"||!config.engineerDid.startsWith("did:")||
     typeof config.keyId!=="string"||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(config.keyId)||
     !sha40.test(config.expectedBaseRevision||"")||
     !config.trustedPlanFile||!config.privateKeyFile||!config.receiptDirectory||
     typeof config.publicKeyPem!=="string"||!config.publicKeyPem.trim()||
     !hex.test(config.passwordSaltHex||"")||!hex.test(config.passwordScryptHex||"")||
     config.passwordSaltHex.length<32||config.passwordScryptHex.length!==128){
    throw new Error("Invalid local trusted Engineer configuration");
  }
  const planFile=resolve(config.trustedPlanFile);
  const keyFile=resolve(config.privateKeyFile);
  const receiptDir=resolve(config.receiptDirectory);
  const salt=Buffer.from(config.passwordSaltHex,"hex");
  const expected=Buffer.from(config.passwordScryptHex,"hex");
  if(salt.length<16||expected.length!==64){
    throw new Error("Invalid Engineer password verifier");
  }
  await protectedDirectory(receiptDir);
  const initial=JSON.parse(await privateText(planFile));
  validatePlan(initial,{allowedOperations:OPERATIONS});
  if(initial.base_revision!==config.expectedBaseRevision ||
     initial.session_id!==config.expectedSessionId ||
     JSON.stringify(initial.repository)!==JSON.stringify(config.repository)){
    throw new Error("Trusted plan does not match pinned repository/session/revision");
  }
  const pinnedDigest=planDigest(initial);
  // Local historical/test entrypoints may omit a signed backend checkpoint.
  // The deployed Engineer SERVICE must inject an independently pinned store.
  const checkpointStore=config.planningCheckpointStore;
  if(checkpointStore!==undefined&&
     !(checkpointStore instanceof SignedPlanningCheckpointFileStore))
    throw Error("Invalid trusted Planning checkpoint store");
  const verifyCheckpoint=async()=>{
    if(!checkpointStore)return;
    const persisted=await checkpointStore.load();
    if(planDigest(persisted.proposal.plan)!==pinnedDigest||
       persisted.proposal.digest!==pinnedDigest||
       persisted.snapshot.session_id!==config.expectedSessionId||
       persisted.snapshot.base_revision!==config.expectedBaseRevision||
       JSON.stringify(persisted.snapshot.repository)!==
         JSON.stringify(config.repository))
      invalid("Backend-signed Planning checkpoint differs from pinned Engineer plan",409);
  };
  await verifyCheckpoint();
  // Validate signer accessibility and pinned public identity at startup,
  // but re-read the protected key immediately before every signing action.
  const privateKey=await privateText(keyFile);
  const verifierPlan=makeApproval(initial,{
    allowedOperations:OPERATIONS,
    decision_id:"startup-key-check",approved_by:config.engineerDid,
    approved_at:new Date().toISOString(),
    approved_permission_ids:[initial.requested_permissions[0].id]
  });
  const selfTest=signEngineerApproval({
    plan:initial,approval:verifierPlan,engineerDid:config.engineerDid,
    keyId:config.keyId,privateKeyPem:privateKey,
    issuedAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+RECEIPT_MS).toISOString()
  });
  verifyEngineerApproval(selfTest,{
    expectedEngineerDid:config.engineerDid,allowedOperations:OPERATIONS,
    trustedKeys:{[config.keyId]:{
      engineer_did:config.engineerDid,public_key_pem:config.publicKeyPem
    }}
  });

  const sessions=new Map();
  let loginAttempts=0,loginWindow=Date.now(),approvalInProgress=false;

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
      if(req.method==="GET"&&["/","/authenticated.js","/styles.css"].includes(url.pathname)){
        const file=url.pathname==="/"
          ?"authenticated.html":url.pathname.slice(1);
        const content=await readFile(new URL(file,clientBase));
        res.writeHead(200,{
          "Content-Type":file.endsWith(".js")?"text/javascript; charset=utf-8":
            file.endsWith(".css")?"text/css; charset=utf-8":"text/html; charset=utf-8",
          "Cache-Control":"no-store"
        });
        res.end(content);
        return;
      }
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
      if(req.method==="GET"&&url.pathname==="/api/plan"){
        await verifyCheckpoint();
        respond(res,200,{
          plan:initial,plan_digest:pinnedDigest,
          engineer_did:config.engineerDid,csrf_token:session.csrf
        });
        return;
      }
      if(req.method==="POST"&&url.pathname==="/api/logout"){
        if(req.headers["x-csrf-token"]!==session.csrf)invalid("CSRF rejected",403);
        sessions.delete(token);
        respond(res,200,{signed_out:true},{"Set-Cookie":clearCookie()});
        return;
      }
      if(req.method==="POST"&&url.pathname==="/api/approve"){
        if(req.headers["x-csrf-token"]!==session.csrf)invalid("CSRF rejected",403);
        const body=await readJson(req);
        if(!exact(body,["plan_digest","approved_permission_ids","confirmation"])||
           body.plan_digest!==pinnedDigest||
           body.confirmation!=="APPROVE "+pinnedDigest||
           !Array.isArray(body.approved_permission_ids)||
           !body.approved_permission_ids.length||
           body.approved_permission_ids.some(x=>typeof x!=="string")||
           new Set(body.approved_permission_ids).size!==body.approved_permission_ids.length){
          invalid("Invalid Engineer confirmation or plan digest",403);
        }
        if(approvalInProgress)invalid("Approval already in progress",409);
        approvalInProgress=true;
        try{
          // A valid check at startup cannot outlive checkpoint expiry,
          // revocation of provenance, or later filesystem modification.
          await verifyCheckpoint();
          const latest=JSON.parse(await privateText(planFile));
          validatePlan(latest,{allowedOperations:OPERATIONS});
          if(planDigest(latest)!==pinnedDigest ||
             latest.base_revision!==config.expectedBaseRevision){
            invalid("Trusted plan changed; new validation required",409);
          }
          const now=new Date();
          const approvedIds=new Set(latest.requested_permissions.map(p=>p.id));
          if(body.approved_permission_ids.some(id=>!approvedIds.has(id))){
            invalid("Permission outside the trusted plan",403);
          }
          const approval=makeApproval(latest,{
            allowedOperations:OPERATIONS,decision_id:"approval-"+randomUUID(),
            approved_by:config.engineerDid,approved_at:now.toISOString(),
            approved_permission_ids:body.approved_permission_ids
          });
          const signed=signEngineerApproval({
            plan:latest,approval,engineerDid:config.engineerDid,keyId:config.keyId,
            privateKeyPem:await privateText(keyFile),
            issuedAt:now.toISOString(),
            expiresAt:new Date(now.getTime()+RECEIPT_MS).toISOString()
          });
          verifyEngineerApproval(signed,{
            expectedEngineerDid:config.engineerDid,allowedOperations:OPERATIONS,
            trustedKeys:{[config.keyId]:{
              engineer_did:config.engineerDid,public_key_pem:config.publicKeyPem
            }}
          });
          await protectedDirectory(receiptDir);
          await writeFile(join(receiptDir,latest.session_id+".json"),
            JSON.stringify(signed,null,2)+"\n",{mode:0o600,flag:"wx"});
          sessions.clear();
          respond(res,201,{
            decision_id:approval.decision_id,plan_digest:pinnedDigest,
            permission_count:approval.approved_permission_ids.length,
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

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const required=(key)=>{
    if(!process.env[key])throw new Error("Missing mandatory "+key);
    return process.env[key];
  };
  const server=await createAuthenticatedEngineerServer({
    host:"127.0.0.1",
    engineerDid:required("ENGINEER_DID"),
    keyId:required("ENGINEER_SIGNING_KEY_ID"),
    trustedPlanFile:required("ENGINEER_TRUSTED_PLAN_FILE"),
    expectedSessionId:required("ENGINEER_SESSION_ID"),
    expectedBaseRevision:required("ENGINEER_BASE_SHA"),
    repository:JSON.parse(required("ENGINEER_REPOSITORY_JSON")),
    privateKeyFile:required("ENGINEER_SIGNING_KEY_FILE"),
    publicKeyPem:await readFile(required("ENGINEER_PUBLIC_KEY_FILE"),"utf8"),
    receiptDirectory:required("ENGINEER_APPROVAL_DIRECTORY"),
    passwordSaltHex:required("ENGINEER_PASSWORD_SALT_HEX"),
    passwordScryptHex:required("ENGINEER_PASSWORD_SCRYPT_HEX")
  });
  const port=Number(process.env.ENGINEER_APPROVAL_PORT||8787);
  if(!Number.isInteger(port)||port<1024||port>65535){
    throw new Error("Invalid local approval port");
  }
  server.listen(port,"127.0.0.1",()=>{
    process.stdout.write("Local Engineer console: http://127.0.0.1:"+port+"/\n");
  });
}
