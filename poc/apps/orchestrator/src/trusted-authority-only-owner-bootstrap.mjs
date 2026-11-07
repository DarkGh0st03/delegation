/**
 * R382.7 — canonical Engineer Review Host 0600 bootstrap.
 *
 * There is exactly ONE owner-constructed checkpoint, approval store,
 * Engineer Root port, Gateway planning IPC and original durable journals.
 * JSON contains only pins and file paths; no executable functions, grants,
 * signed approval, credentials, bearer tokens or model-selected overrides.
 * Native Rust and authenticated Gateway connections are built ONLY here,
 * after all local data has been verified. No API model calls or Root issue.
 */
import {constants} from "node:fs";
import {lstat,open,realpath} from "node:fs/promises";
import {isAbsolute,dirname,resolve} from "node:path";
import {createPublicKey,createPrivateKey,timingSafeEqual} from "node:crypto";
import {AuthorityPlanningCheckpointStore}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts";
import {DurableAuthorityOnlyActivationJournal}
 from "../../../packages/orchestrator-runtime/src/authority-only-activation-journal.ts";
import {DurableAuthorityTaskJournal}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-task-journal.ts";
import {TrustedOperationalRecoveryStore}
 from "../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {TrustedOperationalSessionStore}
 from "../../gateway/src/trusted-operational-session-store.ts";
import {TrustedPlanIpcClient}
 from "../../gateway/src/trusted-plan-ipc.ts";
import {createTrustedEngineerCredentialPort}
 from "../../../packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts";

const SHA=/^[0-9a-f]{40}$/u;
const HEX=/^[0-9a-f]+$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ROLES=["backend","frontend","test","orchestrator"];
const CONFIG_KEYS=["schema","source_sha","snapshot","requirement",
 "workBranch","preliminaryRoot","planner","trustedAgentRegistry",
 "gateway","checkpoint","approval","directories","native"];
const DIRS=["checkpoint","activation","tasks","recovery","operationalSessions","receipts"];
const AGENTS={
 backend:["read_file","update_file","create_file"],
 frontend:["read_file","update_file","create_file"],
 test:["read_file","update_file","create_file","run_tests"],
 orchestrator:["create_branch","create_pull_request"]
};
const URL_ALLOWED=new Set(["127.0.0.1"]);
// A caller cannot forge the result of the protected 0600 manifest reader,
// nor use it twice to assemble two native Roots after an ambiguous startup.
const verifiedManifest=new WeakSet();
function deny(){throw Error("Protected canonical authority bootstrap denied");}
function plain(x){return x!==null&&typeof x==="object"&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype;}
function exact(v,keys){return plain(v)&&
 Object.keys(v).sort().join(",")===keys.slice().sort().join(",");}
function frozen(value){
 if(Array.isArray(value)){
  value.forEach(frozen);return Object.freeze(value);
 }
 if(plain(value)){
  Object.values(value).forEach(frozen);return Object.freeze(value);
 }
 return value;
}
function path(value){
 return typeof value==="string"&&isAbsolute(value)&&
  resolve(value)===value&&value.length<=255;
}
function endpoint(value){
 if(typeof value!=="string")return false;
 try{
  const u=new URL(value);
  return u.protocol==="http:"&&URL_ALLOWED.has(u.hostname)&&
   u.port!==""&&Number(u.port)>0&&Number(u.port)<=65535&&
   u.pathname==="/"&&!u.username&&!u.password&&!u.search&&!u.hash;
 }catch{return false;}
}
async function dirOwned(value){
 if(!path(value))deny();
 const st=await lstat(value);
 if(!st.isDirectory()||st.isSymbolicLink()||
    (st.mode&0o077)!==0||
    (typeof process.getuid==="function"&&st.uid!==process.getuid())||
    await realpath(value)!==value)deny();
}
async function privateText(file,maxBytes=32768){
 if(!path(file))deny();
 await dirOwned(dirname(file));
 let handle;
 try{
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const st=await handle.stat();
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
    st.size<1||st.size>maxBytes||(st.mode&0o077)!==0||
    (typeof process.getuid==="function"&&st.uid!==process.getuid())||
    await realpath(file)!==file)deny();
  return await handle.readFile("utf8");
 }catch{deny();}
 finally{await handle?.close();}
}
function assertPublicKey(pem){
 try{
  if(createPublicKey(pem).asymmetricKeyType!=="ed25519")deny();
 }catch{deny();}
}
function assertManifest(x,expectedSourceSha){
 if(!exact(x,CONFIG_KEYS)||
    x.schema!=="r3827-original-authority-only-v1"||
    x.source_sha!==expectedSourceSha||!SHA.test(x.source_sha)||
    !exact(x.planner,["planId"])||
    !ID.test(x.planner.planId??"")||
    !exact(x.gateway,["gatewayBaseUrl","adapterBaseUrl"])||
    !endpoint(x.gateway.gatewayBaseUrl)||
    !endpoint(x.gateway.adapterBaseUrl)||
    !exact(x.checkpoint,["backendKeyId","backendPublicKeyFile"])||
    !ID.test(x.checkpoint.backendKeyId??"")||
    !exact(x.approval,["engineerDid","keyId","publicKeyFile",
     "privateKeyFile","passwordSaltHexFile","passwordScryptHexFile"])||
    !x.approval.engineerDid?.startsWith?.("did:")||
    !ID.test(x.approval.keyId??"")||
    !exact(x.directories,DIRS)||
    !exact(x.native,["gatewaySocketPath","gatewaySecretFile",
     "engineerRustTokenFile","gatewayAdapterTokenFile"])||
    !exact(x.snapshot,["session_id","repository","base_revision",
     "directories","files"])||
    !ID.test(x.snapshot.session_id??"")||
    !SHA.test(x.snapshot.base_revision??"")||
    !plain(x.snapshot.repository)||
    !Array.isArray(x.snapshot.directories)||
    !Array.isArray(x.snapshot.files)||
    !exact(x.preliminaryRoot,["credential_id","valid_from",
     "validity_seconds","credential_status"])||
    typeof x.preliminaryRoot.credential_id!=="string"||
    !Number.isSafeInteger(x.preliminaryRoot.validity_seconds)||
    typeof x.requirement!=="string"||!x.requirement.trim()||
    typeof x.workBranch!=="string"||
    !x.workBranch.startsWith("feature/")||
    !exact(x.trustedAgentRegistry,ROLES)||
    !ROLES.every(role=>{
     const p=x.trustedAgentRegistry[role];
     return exact(p,["did","card_ref","capabilities"])&&
      typeof p.did==="string"&&p.did.startsWith("did:ethr:")&&
      p.did===process.env["ADAPTER_ID_"+role.toUpperCase()]&&
      typeof p.card_ref==="string"&&p.card_ref.length>0&&
      p.card_ref.length<=256&&
      Array.isArray(p.capabilities)&&p.capabilities.length>0&&
      new Set(p.capabilities).size===p.capabilities.length&&
      p.capabilities.every(c=>AGENTS[role].includes(c));
    })||
    !Object.values(x.directories).every(path)||
    new Set(Object.values(x.directories)).size!==DIRS.length||
    !Object.values(x.native).every(path)||
    !path(x.checkpoint.backendPublicKeyFile)||
    !["publicKeyFile","privateKeyFile","passwordSaltHexFile",
      "passwordScryptHexFile"].every(k=>path(x.approval[k])))
  deny();
}

/**
 * Complete non-billable, strict source-pinned manifest validation.
 * Returns immutable owner pins, but NEVER creates a fake Root/Gateway,
 * imports Gemini, starts Planning or signs any Engineer approval.
 */
export async function loadProtectedCanonicalOwnerManifest(
 configPath,{expectedSourceSha}={}
){
 if(process.env.GITHUB_ACTIONS==="true"||
    process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    process.env.ENGINEER_CORE_NATIVE_MODE!=="1"||
    !path(process.env.ADAPTER_ENGINEER_NATIVE_SOCKET)||
    !SHA.test(expectedSourceSha??""))
  deny();
 let data;
 try{data=JSON.parse(await privateText(configPath));}
 catch{deny();}
 assertManifest(data,expectedSourceSha);
 for(const directory of Object.values(data.directories))
  await dirOwned(directory);
 const [backendPublicKeyPem,engineerPublicKeyPem,salt,scrypt]=
  await Promise.all([
   privateText(data.checkpoint.backendPublicKeyFile,8192),
   privateText(data.approval.publicKeyFile,8192),
   privateText(data.approval.passwordSaltHexFile,512),
   privateText(data.approval.passwordScryptHexFile,512)
  ]);
 assertPublicKey(backendPublicKeyPem);
 assertPublicKey(engineerPublicKeyPem);
 // The public review key and protected Engineer signing key must be the
 // SAME Ed25519 identity before permitting a live Planning host. A
 // mismatched file cannot create a second approved authority later.
 const engineerPrivateKeyPem=await privateText(
  data.approval.privateKeyFile,8192);
 try{
  const actual=createPublicKey(createPrivateKey(engineerPrivateKeyPem));
  if(actual.asymmetricKeyType!=="ed25519")deny();
  const a=actual.export({format:"der",type:"spki"});
  const b=createPublicKey(engineerPublicKeyPem)
   .export({format:"der",type:"spki"});
  if(a.length!==b.length||!timingSafeEqual(a,b))deny();
 }catch{deny();}
 for(const p of Object.values(data.native))
  await dirOwned(dirname(p));
 const saltHex=salt.trim(),scryptHex=scrypt.trim();
 if(!HEX.test(saltHex)||saltHex.length!==32||
    !HEX.test(scryptHex)||scryptHex.length!==128)deny();
 const pins=frozen(data);
 const result=Object.freeze({
  pins,
  backendPublicKeyPem,engineerPublicKeyPem,
  passwordSaltHex:saltHex,passwordScryptHex:scryptHex
 });
 verifiedManifest.add(result);
 return result;
}

/**
 * Build only the same original classes used by the native R3818 E2E.
 * The native Core is loaded by createTrustedEngineerCredentialPort
 * with ENGINEER_CORE_NATIVE_MODE=1 (no HTTP Adapter fallback).
 * The Gateway owns its authenticated IPC session, not the JSON manifest.
 */
export async function assembleProtectedCanonicalOwnerAuthority(loaded){
 const x=loaded?.pins;
 if(!x||!verifiedManifest.delete(loaded)||
    process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    process.env.ENGINEER_CORE_NATIVE_MODE!=="1")
  deny();
 let ipc,credentials,adapterToken;
 try{
  // The first external dependency is the authenticated original Gateway.
  ipc=await TrustedPlanIpcClient.connect({
   socketPath:x.native.gatewaySocketPath,
   secretFile:x.native.gatewaySecretFile
  });
  if(!ipc.operationalLeaseConfigured()||
     !ipc.planningRetirementDurableConfigured()||
     !ipc.operationalSessionDurableConfigured())deny();
  const rootToken=(await privateText(x.native.engineerRustTokenFile,8192)).trim();
  adapterToken=(await privateText(x.native.gatewayAdapterTokenFile,8192)).trim();
  if(rootToken.length<8||adapterToken.length<8||
     /\s/u.test(rootToken)||/\s/u.test(adapterToken))deny();
  // Original Engineer -> Rust Core (direct native Node binding).
  credentials=createTrustedEngineerCredentialPort({bearerToken:rootToken});
 }catch{deny();}
 return Object.freeze({
  snapshot:x.snapshot,requirement:x.requirement,workBranch:x.workBranch,
  preliminaryRoot:x.preliminaryRoot,
  checkpoint:{
   store:new AuthorityPlanningCheckpointStore({
    directory:x.directories.checkpoint,
    trust:{
     trustedKeys:{[x.checkpoint.backendKeyId]:{
      public_key_pem:loaded.backendPublicKeyPem
     }},
     expectedSessionId:x.snapshot.session_id,
     expectedRepository:x.snapshot.repository,
     expectedBaseRevision:x.snapshot.base_revision,
     expectedWorkBranch:x.workBranch,
     expectedRequirement:x.requirement
    }
   }),
   backendKeyId:x.checkpoint.backendKeyId
  },
  activationJournal:new DurableAuthorityOnlyActivationJournal(x.directories.activation),
  taskJournal:new DurableAuthorityTaskJournal(x.directories.tasks),
  operationalRecoveryStore:new TrustedOperationalRecoveryStore(x.directories.recovery),
  operationalSessionStore:new TrustedOperationalSessionStore(
   x.directories.operationalSessions),
  approval:{
   engineerDid:x.approval.engineerDid,
   keyId:x.approval.keyId,
   publicKeyPem:loaded.engineerPublicKeyPem,
   privateKeyFile:x.approval.privateKeyFile,
   receiptDirectory:x.directories.receipts,
   passwordSaltHex:loaded.passwordSaltHex,
   passwordScryptHex:loaded.passwordScryptHex
  },
  planner:{planId:x.planner.planId},
  trustedAgentRegistry:x.trustedAgentRegistry,
  credentials,planningRevisions:ipc,
  gateway:{
   gatewayBaseUrl:x.gateway.gatewayBaseUrl,
   adapterBaseUrl:x.gateway.adapterBaseUrl,
   adapterToken,fetchFn:fetch,timeoutMs:60000
  }
 });
}
