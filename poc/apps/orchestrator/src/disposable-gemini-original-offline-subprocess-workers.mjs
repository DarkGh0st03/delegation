/**
 * Offline-only bridge to the ORIGINAL Review Host SDK worker topology.
 *
 * Returns EXACTLY the original {stageChannels,agentBindingChannels,
 * agentBaseUrls,a2aPolling} contract. It does NOT create an Orchestrator,
 * Engineer signer, Root, Child, Gateway or extra specialist. After startup
 * the trusted original RemoteEffectBootstrap must open the owner-side
 * Stage sockets with its live Coordinator; A2A workers host their native
 * Task registries in independent Node PIDs.
 *
 * This factory is intentionally NOT selected by paid canonical provision:
 * no OS UID/mount isolation or native role DID/VP proof is established.
 * The callbacks below are synthetic ONLY and may NEVER attest a Rust Root.
 */
import {randomBytes} from "node:crypto";
import {lstat,mkdtemp,realpath,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {startDisposableOwnerModelIpcServer}
 from "./disposable-gemini-owner-worker-ipc.mjs";
import {startDisposableOriginalA2aWorkerSubprocess}
 from "./disposable-gemini-original-a2a-worker-launcher.mjs";

const ROLES=["backend","frontend","test"];
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const URL=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/u;
const deny=()=>{throw Error("Disposable original offline native worker bridge NO-GO");};
const only=(value,keys)=>value&&typeof value==="object"&&
 !Array.isArray(value)&&Object.keys(value).sort().join(",")===
 keys.slice().sort().join(",");
const roles=value=>only(value,ROLES);

/** No billing, no providers, no subprocess with owner private-key authority.
 * The caller MUST supply explicit offline synthetic model handlers, never a
 * live Gemini delegate or an unverified boolean claiming Root approval.
 */
export async function startDisposableOriginalOfflineSubprocessWorkers({
 directory,sessionId,workers,offlineModelHandlers,a2aPolling,
 offlineSyntheticOnly
}={}){
 if(offlineSyntheticOnly!==true||
    process.env.DELEGATION_DISPOSABLE_LIVE_MODE==="gemini-real"||
    ["GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY",
     "GOOGLE_APPLICATION_CREDENTIALS"].some(k=>Object.hasOwn(process.env,k))||
    typeof directory!=="string"||!directory.startsWith("/")||
    !ID.test(sessionId??"")||!roles(workers)||!roles(offlineModelHandlers))
  deny();
 const stat=await lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||
    (stat.mode&0o077)!==0||
    (typeof process.getuid==="function"&&stat.uid!==process.getuid())||
    await realpath(directory)!==directory)deny();
 const seenPorts=new Set();
 for(const role of ROLES){
  const config=workers[role],handlers=offlineModelHandlers[role];
  if(!only(config,["port","adk"])||
     !Number.isSafeInteger(config.port)||config.port<1024||
     config.port>65535||seenPorts.has(config.port)||
     !only(config.adk,["gatewayBaseUrl","adapterBaseUrl",
      "adapterToken","maxModelTurns"])||
     !URL.test(config.adk.gatewayBaseUrl??"")||
     !URL.test(config.adk.adapterBaseUrl??"")||
     typeof config.adk.adapterToken!=="string"||
     config.adk.adapterToken.length<8||
     !Number.isSafeInteger(config.adk.maxModelTurns)||
     config.adk.maxModelTurns<1||config.adk.maxModelTurns>20||
     !only(handlers,["authorizeSignedTask","invokeModel"])||
     typeof handlers.authorizeSignedTask!=="function"||
     typeof handlers.invokeModel!=="function")deny();
  seenPorts.add(config.port);
 }
 const location=await mkdtemp(join(directory,"a2a-"));
 const handles=[];
 let closing;
 const close=()=>closing??=(async()=>{
  const outcome=await Promise.allSettled(handles.reverse().map(x=>x.close()));
  // Never erase private evidence while any owner/agent retirement remains
  // ambiguous. A retry cannot turn a failed cleanup into valid execution.
  if(outcome.some(x=>x.status==="rejected"))
   deny();
  await rm(location,{recursive:true,force:true});
 })();
 const stageChannels={},agentBindingChannels={},agentBaseUrls={};
 // Observed kernel/file access facts, NOT an OS isolation attestation.
 // Never place these in the ORIGINAL SDK Agent Card or signed credentials.
 const ownerCanaryAccessibleByRole={},sameUidByRole={};
 try{
  for(const role of ROLES){
   const ch=async name=>{
    const socketPath=join(location,name+"-"+role+".sock");
    const secretFile=join(location,name+"-"+role+".hex");
    await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
     {mode:0o600,flag:"wx"});
    return Object.freeze({socketPath,secretFile});
   };
   const stage=stageChannels[role]=await ch("stage");
   const bind=agentBindingChannels[role]=await ch("bind");
   const model=await ch("model");
   const handlers=offlineModelHandlers[role];
   const owner=await startDisposableOwnerModelIpcServer({
    role,socketPath:model.socketPath,secretFile:model.secretFile,
    authorizeSignedTask:handlers.authorizeSignedTask,
    invokeModel:handlers.invokeModel
   });
   handles.push(owner);
   const w=workers[role];
   const child=await startDisposableOriginalA2aWorkerSubprocess({
    role,port:w.port,task:{session_id:sessionId},
    maxCalls:w.adk.maxModelTurns,
    modelSocketPath:model.socketPath,modelSecretFile:model.secretFile,
    bindSocketPath:bind.socketPath,bindSecretFile:bind.secretFile,
    stageSocketPath:stage.socketPath,stageSecretFile:stage.secretFile,
    adapterToken:w.adk.adapterToken,
    gatewayBaseUrl:w.adk.gatewayBaseUrl,
    adapterBaseUrl:w.adk.adapterBaseUrl
   });
   handles.push(child);
   if(child.osIsolationVerified!==false||
      child.nativeRustSignerVerified!==false||
      child.originalNativeTaskBindingPresent!==false||
      child.originalTaskBindingChannelReady!==true||
      typeof child.ownerCanaryReadableFromWorker!=="boolean"||
      ![true,false,null].includes(child.ownerAndWorkerShareUid))deny();
   ownerCanaryAccessibleByRole[role]=child.ownerCanaryReadableFromWorker;
   sameUidByRole[role]=child.ownerAndWorkerShareUid;
   agentBaseUrls[role]=child.baseUrl;
  }
  return Object.freeze({
   status:"offline_synthetic_original_sdk_worker_topology_not_native_root",
   original_signed_authority_verified_here:false,
   osIsolationVerified:false,
   workerOsBoundary:Object.freeze({
    canaryAccessibleByRole:Object.freeze(ownerCanaryAccessibleByRole),
    sameUidByRole:Object.freeze(sameUidByRole),
    nativeSignerVerifiedByRole:Object.freeze(
     Object.fromEntries(ROLES.map(role=>[role,false])))
   }),
   close,
   sdk:Object.freeze({
    stageChannels:Object.freeze(stageChannels),
    agentBindingChannels:Object.freeze(agentBindingChannels),
    agentBaseUrls:Object.freeze(agentBaseUrls),
    a2aPolling
   })
  });
 }catch(error){
  await close();
  throw error;
 }
}
