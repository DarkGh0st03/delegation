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
import {roleWalletSocket} from "../../../packages/agent-runtime/src/native-crypto-ipc.ts";
import {constants} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {verifyGithubManualRunViaApi}
 from "../../../packages/orchestrator-runtime/src/trusted-github-run-identity.ts";
import {lstat,open,realpath} from "node:fs/promises";
import {isAbsolute,dirname,join,resolve} from "node:path";
import {createPublicKey,createPrivateKey,randomUUID,timingSafeEqual} from "node:crypto";
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
import {preliminaryReadPermissions}
 from "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";

import {createNativeRustChildCryptographyPort}
 from "../../../packages/orchestrator-runtime/src/trusted-child-crypto-port.ts";
import {DurableAuthorityOnlyChildJournal}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-child-journal.ts";
import {DurableAuthorityOnlyTaskFenceJournal}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-task-fence-journal.ts";
import {DurableAuthorityOnlySequentialEffectJournal}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-sequential-effect-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";
import {assembleTrustedAuthorityOnlyNativeEffects}
 from "./trusted-authority-only-native-effects.mjs";
import {createTrustedAuthorityOnlyRootEffectTransport}
 from "./trusted-authority-only-root-effect-transport.mjs";
import {startTrustedAuthorityOnlyLocalA2AWorkers}
 from "./trusted-authority-only-local-a2a-workers.mjs";
import {prepareAuthorization} from "../../gateway/src/prepare.ts";
import {executeAuthorization} from "../../gateway/src/execute.ts";
import {persistStatusIndexReservation}
 from "../../../packages/orchestrator-runtime/src/trusted-status-index-reservation.ts";

const SHA=/^[0-9a-f]{40}$/u;
const ACTIONS_REPO="DarkGh0st03/delegation";
const ACTIONS_REF="refs/heads/experiment/disposable-gemini-live-20261109";
const ACTIONS_WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
const ACTIONS_CONFIRM="I AUTHORIZE GEMINI API CHARGES";
const ACTIONS_CAP="I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES";
const RUN=/^[1-9][0-9]{0,19}$/u;
const HEX=/^[0-9a-f]+$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ROLES=["backend","frontend","test","orchestrator"];
const ADDITIONAL_ROLE=/^[a-z][a-z0-9_-]{0,23}$/u;
const REQUIRED_ROLES=new Set(ROLES);
// A new specialist only gets a read ceiling here. Widening role operations
// requires separately reviewed native owner/Gateway support, not a Card claim.
function trustedRegistry(registry){
 if(!plain(registry))return false;
 const roles=Object.keys(registry);
 const extras=roles.filter(role=>!REQUIRED_ROLES.has(role)).sort();
 // The manifest is not a second Rust signer registry. It must describe
 // exactly the additional roles already provisioned inside the one
 // Engineer-owned native Rust process; no silent default signer.
 const raw=process.env.ADAPTER_ADDITIONAL_SPECIALISTS??"";
 const nativeExtras=raw===""?[]:raw.split(",").sort();
 if(extras.length!==nativeExtras.length||
    !extras.every((role,i)=>role===nativeExtras[i])||
    extras.some(role=>!process.env["ADAPTER_CALLER_"+role.toUpperCase()]?.trim()))
  return false;
 if(roles.length<ROLES.length||roles.length>17||
    !ROLES.every(role=>Object.hasOwn(registry,role))||
    roles.some(role=>!ADDITIONAL_ROLE.test(role)||
     ["constructor","prototype","__proto__"].includes(role)))
  return false;
 const dids=new Set();
 for(const role of roles){
  const p=registry[role];
  const allowed=REQUIRED_ROLES.has(role)?AGENTS[role]:["read_file"];
  if(!exact(p,["did","card_ref","capabilities"])||
     typeof p.did!=="string"||!/^did:ethr:[A-Za-z0-9:._%-]+$/u.test(p.did)||
     p.did!==process.env["ADAPTER_ID_"+role.toUpperCase()]||
     dids.has(p.did)||
     typeof p.card_ref!=="string"||!p.card_ref.trim()||
     p.card_ref.length>256||
     !Array.isArray(p.capabilities)||!p.capabilities.length||
     p.capabilities.length>allowed.length||
     new Set(p.capabilities).size!==p.capabilities.length||
     p.capabilities.some(cap=>!allowed.includes(cap)))
   return false;
  dids.add(p.did);
 }
 return true;
}
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
/** Repository base branch: a safe name outside the agents' feature/ space. */
const safeBaseBranch=b=>typeof b==="string"&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/u.test(b)&&
 !b.startsWith("feature/")&&!b.includes("..")&&!b.includes("//")&&!b.endsWith("/");
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
export {privateText as readProtectedCanonicalOwnerFile};
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
    !trustedRegistry(x.trustedAgentRegistry)||
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
 // R5 private signed-Engineer owner is NEVER admitted by GitHub Actions.
 if(process.env.GITHUB_ACTIONS==="true")deny();
 return loadVerifiedOriginalCanonicalManifest(configPath,expectedSourceSha);
}

/** Actions-only original native authority manifest (ZERO inference).
 *
 * Distinct from the R5 private-human admission, but the actual protected
 * manifest verification, typed checkpoint, Engineer keys, Rust port,
 * Gateway IPC and single-use assembler are IDENTICAL to R5. The one-use
 * original assembler accepts only objects minted by that same verifier.
 * This is source/run admission, NOT credential process isolation, spending
 * authorization or an implementation of an independent authority.
 *
 * No current workflow invokes this; the manual CI remains free-only.
 */
export async function loadProtectedDisposableActionsCanonicalOwnerManifest(
 configPath,{expectedSourceSha,githubApiToken}={}
){
 let head,dirty;
 try{
  head=execFileSync("git",["rev-parse","--verify","HEAD"],{
   cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
  dirty=execFileSync("git",["status","--porcelain",
   "--untracked-files=all"],{
   cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
 }catch{deny();}
 const e=process.env;
 if(e.GITHUB_ACTIONS!=="true"||
    e.GITHUB_REPOSITORY!==ACTIONS_REPO||
    e.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    e.GITHUB_REF!==ACTIONS_REF||
    e.GITHUB_WORKFLOW_REF!==
     ACTIONS_REPO+"/"+ACTIONS_WORKFLOW+"@"+ACTIONS_REF||
    e.GITHUB_RUN_ATTEMPT!=="1"||
    !RUN.test(e.GITHUB_RUN_ID??"")||
    !SHA.test(expectedSourceSha??"")||
    expectedSourceSha!==e.GITHUB_SHA||
    expectedSourceSha!==head||dirty||
    e.DELEGATION_DISPOSABLE_LIVE_MODE!=="gemini-real"||
    e.DELEGATION_GEMINI_CHARGE_CONFIRMATION!==ACTIONS_CONFIRM||
    e.DELEGATION_BILLING_CAP_ACK!==ACTIONS_CAP||
    e.DELEGATION_LIVE_CI_PREFLIGHT_MODE!==undefined||
    e.DELEGATION_DISPOSABLE_CI_MODE!==undefined||
    e.DELEGATION_SIGNED_GEMINI_PILOT!==undefined||
    e.R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING!==undefined||
    e.R38513_NATIVE_STRICT_FULL_RECOVERY!==undefined||
    e.GEMINI_API_KEY!==undefined||
    e.GOOGLE_API_KEY!==undefined||
    e.OPENAI_API_KEY!==undefined||
    e.GH_TOKEN!==undefined||
    e.GITHUB_TOKEN!==undefined||
    e.ADAPTER_ADDITIONAL_SPECIALISTS!==undefined&&
     e.ADAPTER_ADDITIONAL_SPECIALISTS!==""||
    typeof githubApiToken!=="string"||
    githubApiToken.length<16||githubApiToken.length>512||
    /\s/u.test(githubApiToken))deny();
 try{
  await verifyGithubManualRunViaApi({
   dispatch:{run_id:e.GITHUB_RUN_ID,source_sha:head},
   pinned:{repository:ACTIONS_REPO,ref:ACTIONS_REF,
    workflowPath:ACTIONS_WORKFLOW,sourceSha:head},
   githubApiToken
  });
 }catch{deny();}
 // Use the EXACT R5 file validator and the EXACT original one-shot
 // authority assembler, not a parallel Actions manifest or gateway.
 return loadVerifiedOriginalCanonicalManifest(configPath,expectedSourceSha);
}

async function loadVerifiedOriginalCanonicalManifest(
 configPath,expectedSourceSha
){
 if(process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    process.env.ENGINEER_CORE_NATIVE_MODE!=="1"||
    !path(process.env.ADAPTER_ENGINEER_NATIVE_SOCKET)||
    !SHA.test(expectedSourceSha??""))
  deny();
 let data;
 try{data=JSON.parse(await privateText(configPath));}
 catch{deny();}
 assertManifest(data,expectedSourceSha);
 // Independently validate real Gitea source pins and the read-only Root
 // permission ceiling BEFORE any Rust issue or paid Planner invocation.
 try{preliminaryReadPermissions(data.snapshot);}catch{deny();}
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

// Only trusted in-process clients and transports can supply this input.
async function prepareCanonicalNativeEffects(authority,options){
 const fields=["store","giteaClient","independentGiteaClient","runnerClient",
  "runnerPassObserver","directories","evidenceKey","installAuthorization"];
 if(!exact(options,fields)&&!exact(options,[...fields,"readObserver"]))deny();
 const {installAuthorization,directories,evidenceKey,...clients}=options;
 const repository=authority.snapshot?.repository;
 const baseDirs=["mutationIntent","giteaReceipts","runnerIntent",
  "runnerFailureReceipts","runnerPassReceipts"];
 const nativeCreateDirs=[...baseDirs,"createIntent","createReceipts"];
 const hasCreate=Object.hasOwn(directories??{},"createIntent")||
  Object.hasOwn(directories??{},"createReceipts");
 if(typeof installAuthorization!=="function"||
    typeof repository?.owner!=="string"||typeof repository.repository!=="string"||
    !Buffer.isBuffer(evidenceKey)||evidenceKey.length!==32||
    !(hasCreate?exact(directories,nativeCreateDirs):exact(directories,baseDirs))||
    new Set(Object.values(directories)).size!==(hasCreate?7:5))
  deny();
 const pins={...directories},key=Buffer.from(evidenceKey);
 await Promise.all(Object.values(pins).map(dirOwned));
 return gateway=>{
  const effects=assembleTrustedAuthorityOnlyNativeEffects({
   ...clients,gateway,directories:pins,evidenceKey:key,
   repository:repository.owner+"/"+repository.repository,branch:authority.workBranch
  });
  return Object.freeze({
   binding:effects.binding,
   authorization:Object.freeze({
    store:effects.binding.store,authorityOnlyAdmissions:gateway,...effects.authorization
   }),
   install:installAuthorization
  });
 };
}

async function prepareOperationalRootReservation(authority,options){
 const preliminary=authority.preliminaryRoot?.credential_status;
 const list=preliminary?.statusListCredential;
 const sessionId=authority.snapshot?.session_id;
 if(!exact(options,["directory","index","validitySeconds"])||
    !ID.test(sessionId??"")||
    typeof options.index!=="string"||!/^(0|[1-9][0-9]{0,7})$/u.test(options.index)||
    !/^\d+$/u.test(preliminary?.statusListIndex??"")||
    Number(options.index)===Number(preliminary.statusListIndex)||
    !Number.isSafeInteger(options.validitySeconds)||
    options.validitySeconds<1||options.validitySeconds>7200||
    typeof list!=="string"||list.length>1024)
  deny();
 const uri=URL.canParse(list)?new URL(list):undefined;
 if(uri?.protocol!=="https:"||uri.href!==list||
    uri.username||uri.password||uri.hash||uri.search)deny();
 const {directory,index,validitySeconds}=options;
 await dirOwned(directory);
 return async()=>{
  await dirOwned(directory);
  const credentialId="urn:operational-root:"+randomUUID();
  await persistStatusIndexReservation(directory,list,index,{
   version:1,session_id:sessionId,credential_id:credentialId,status_list:list,index
  });
  return {
   credential_id:credentialId,valid_from:new Date().toISOString(),
   validity_seconds:validitySeconds,
   credential_status:{
    type:"BitstringStatusListEntry",statusPurpose:"revocation",
    statusListCredential:list,statusListIndex:index
   }
  };
 };
}

/** Assemble the fixed operational dependencies without reserving or issuing
 * a Root. Provider and A2A capabilities are supplied by the trusted host. */
export async function createProtectedCanonicalOperationalProvision(
 authority,operational
){
 if(process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    !exact(operational,["journalDirectory","orchestratorTokenFile",
    operational?.rootReservation===undefined?"reserveRoot":"rootReservation",
    "completionObserver","workflow",
    operational?.nativeEffects===undefined?"prepareNativeEffects":"nativeEffects",
    ...(Object.hasOwn(operational??{},"rootGateway")?["rootGateway"]:[]),
    ...(Object.hasOwn(operational??{},"localWorkers")?["localWorkers"]:[])])||
    (operational.rootReservation===undefined&&typeof operational.reserveRoot!=="function")||
    (operational.nativeEffects===undefined&&
     typeof operational.prepareNativeEffects!=="function")||
    !(operational.completionObserver instanceof TrustedAuthorityOnlyCompletionObserver)||
    !(authority?.operationalSessionStore instanceof TrustedOperationalSessionStore)||
    operational.workflow?.createBranch?.branch!==authority.workBranch||
    !safeBaseBranch(operational.workflow?.createBranch?.baseBranch))
  deny();
 const {journalDirectory,orchestratorTokenFile,completionObserver,workflow}=operational;
 const reserveRoot=operational.rootReservation===undefined?operational.reserveRoot:
  await prepareOperationalRootReservation(authority,operational.rootReservation);
 const assembleEffects=operational.nativeEffects===undefined?undefined:
  await prepareCanonicalNativeEffects(authority,operational.nativeEffects);
 const {localWorkers}=operational;
 if(Object.hasOwn(operational,"localWorkers")&&
    (!localWorkers||![["directory","workers"],["directory","workers","a2aPolling"],
      ["directory","workers","projectTestSourceProfile"],
      ["directory","workers","a2aPolling","projectTestSourceProfile"]]
      .some(keys=>exact(localWorkers,keys))||
     Object.hasOwn(workflow,"sdk")))
  deny();
 const workerOptions=localWorkers?{
  ...localWorkers,native:true,
  // Only the protected, previously verified canonical manifest may enlarge
  // this role roster; never accept role pins from an A2A request or model.
  trustedAgentRegistry:authority.trustedAgentRegistry
 }:undefined;
 const {rootGateway}=operational;
 if(Object.hasOwn(operational,"rootGateway")&&
    (!assembleEffects||!exact(rootGateway,["audit","verifier","policy","executor"])||
     !rootGateway.audit||!rootGateway.verifier||!rootGateway.policy||!rootGateway.executor||
     [workflow.createBranch,workflow.draftPullRequest].some(effect=>
      effect&&(Object.hasOwn(effect,"prepare")||Object.hasOwn(effect,"execute")))||
     (workflow.draftPullRequest&&
      (workflow.draftPullRequest.headBranch!==authority.workBranch||
       workflow.draftPullRequest.baseBranch!==workflow.createBranch.baseBranch))))
  deny();
 const repository=authority.snapshot?.repository;
 // The Orchestrator's own WALLET (only its key): Child DCs and its VPs.
 const socketPath=roleWalletSocket("orchestrator");
 if(!path(socketPath)||socketPath.length>100)deny();
 await dirOwned(journalDirectory);
 const directories=["gateway-tasks","issuer-children","gateway-children",
  "effect-fences","sequences"].map(name=>join(journalDirectory,name));
 await Promise.all(directories.map(dirOwned));
 const bearerToken=(await privateText(orchestratorTokenFile,8192)).trim();
 if(bearerToken.length<8||/\s/u.test(bearerToken))deny();

 const [tasks,issuer,gateway,fences,sequences]=directories;
 const dependencies=Object.freeze({
  operationalSessionStore:authority.operationalSessionStore,
  gatewayTaskJournal:new DurableAuthorityTaskJournal(tasks),
  issuerChildJournal:new DurableAuthorityOnlyChildJournal(issuer),
  gatewayChildJournal:new DurableAuthorityOnlyChildJournal(gateway),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(fences),
  sequentialEffectJournal:new DurableAuthorityOnlySequentialEffectJournal(sequences),
  completionObserver,
  nativeCryptoPort:createNativeRustChildCryptographyPort({
   bearerToken,timeoutMs:60000
  },socketPath)
 });
 let consumed=false;
 return async()=>{
  if(consumed)deny();
  consumed=true;
  const root=await reserveRoot();
  const local=workerOptions?{
   startLocalWorkers:()=>startTrustedAuthorityOnlyLocalA2AWorkers(workerOptions)
  }:{};
  if(!assembleEffects)return {root,dependencies,workflow,...local,
   prepareNativeEffects:operational.prepareNativeEffects};
  let effects,authorization;
  const withRootTransport=effect=>{
   const transport=createTrustedAuthorityOnlyRootEffectTransport({
    native:{socketPath,token:bearerToken,timeoutMs:60000},
    credentialId:root.credential_id,permission:effect.permission,
    prepareGateway(request){
     if(!authorization)deny();
     return prepareAuthorization(request,{
      audience:"cloud-access-gateway",request_ttl_ms:120000,repository
     },{...authorization,audit:rootGateway.audit});
    },
    executeGateway(input){
     return executeAuthorization(input,{...rootGateway,...authorization,repository});
    }
   });
   return {...effect,...transport};
  };
  return {
   root,dependencies,...local,
   workflow:rootGateway?{
    ...workflow,createBranch:withRootTransport(workflow.createBranch),
    ...(workflow.draftPullRequest?{draftPullRequest:withRootTransport(workflow.draftPullRequest)}:{})
   }:workflow,
   prepareNativeEffects(gateway){
    effects=assembleEffects(gateway);
    return effects.binding;
   },
   async installNativeAuthorization(){
    if(!effects||authorization)deny();
    await effects.install(effects.authorization);
    authorization=effects.authorization;
   }
  };
 };
}
