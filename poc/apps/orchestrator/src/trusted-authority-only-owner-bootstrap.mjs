/**
 * Canonical operational provisioning of the trusted Engineer host.
 *
 * Assembles, from the console-owned session (snapshot, preliminary Root,
 * session store, agent registry), the fixed operational dependencies: the
 * operational Root reservation, the native Gateway effects and the local
 * A2A workers. No API model calls and no Root issue happen here.
 */
import {roleWalletSocket} from "../../../packages/agent-runtime/src/native-crypto-ipc.ts";
import {constants} from "node:fs";
import {lstat,open,realpath} from "node:fs/promises";
import {isAbsolute,dirname,join,resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {DurableAuthorityTaskJournal}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-task-journal.ts";
import {TrustedOperationalSessionStore}
 from "../../gateway/src/trusted-operational-session-store.ts";

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

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
// Known roles (registry + Orchestrator); the required ones must be present,
// optional specialists (Documentation, Data, DevOps) when provisioned.
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
async function dirOwned(value){
 if(!path(value))deny();
 const st=await lstat(value);
 if(!st.isDirectory()||st.isSymbolicLink()||
    (st.mode&0o077)!==0||
    (typeof process.getuid==="function"&&st.uid!==process.getuid())||
    await realpath(value)!==value)deny();
}
/** Read a small owner-only (0600, no symlink) secret file. */
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
