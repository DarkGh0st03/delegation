/**
 * Disposable SINGLE specialist A2A process. Deliberately an offline-only
 * component until OS UID/mount isolation and authentic owner->worker native
 * Task binder have been audited. This process has NO provider client/key.
 *
 * The worker role is only Backend, Frontend, or Test. The sender of the
 * authenticated parent IPC is the local bootstrap, never an A2A/LLM user.
 * Its Task identity remains a claim until owner-side original Child+Gateway
 * prebinding has independently authorized each MODEL RPC call.
 */
import {generateKeyPairSync} from "node:crypto";
import {constants} from "node:fs";
import {open} from "node:fs/promises";
import {connectDisposableWorkerModelIpcClient}
 from "./disposable-gemini-owner-worker-ipc.mjs";
import {createDisposableOriginalWorkerIpcAdkModel}
 from "./disposable-gemini-original-worker-ipc-adk-model.mjs";
import {startSpecializedAgentServer}
 from "../../../packages/agent-runtime/src/server.ts";
import {TrustedEffectStagingTaskRegistry}
 from "../../../packages/agent-runtime/src/trusted-effect-staging-task-registry.ts";
import {connectTrustedOwnerEffectStagingClient,
 createTrustedEffectAgentBindingServer}
 from "../../../packages/agent-runtime/src/trusted-effect-staging-unix-ipc.ts";

const ROLES=new Set(["backend","frontend","test"]);
const deny=()=>{throw Error("Disposable original A2A child process NO-GO");};
const mustBeClean=()=>{
 for(const key of ["GEMINI_API_KEY","GOOGLE_API_KEY","GITHUB_TOKEN",
  "GH_TOKEN","OPENAI_API_KEY","NODE_OPTIONS","GOOGLE_APPLICATION_CREDENTIALS",
  "DELEGATION_DISPOSABLE_LIVE_MODE","ADAPTER_ENGINEER_NATIVE_SOCKET",
  "RUNNER_EVIDENCE_KEY_HEX","GIT_ASKPASS"]){
  if(Object.hasOwn(process.env,key))deny();
 }
};
/** Probe a NON-SECRET random owner canary from the actual worker PID.
 * Never read API keys or Engineer private keys and never return bytes. */
async function canOpenOwnerCanary(path){
 if(typeof path!=="string"||!path.startsWith("/")||
    path.length>240||path.includes("\0"))deny();
 try{
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  await fd.close();
  return true;
 }catch(e){
  if(e?.code==="EACCES"||e?.code==="EPERM")return false;
  deny();
 }
}
let server,model,binder,active=false,stopping=false;
const send=message=>{
 if(process.connected&&typeof process.send==="function")process.send(message);
};
const shutdown=async()=>{
 if(stopping)return;
 stopping=true;
 model?.retire();
 // Revoking the original owner->agent Task/Child binder retires all
 // one-shot effects even when the A2A listener has already stopped.
 const closing=[server?.close(),binder?.close()].filter(Boolean);
 const outcomes=await Promise.allSettled(closing);
 if(outcomes.some(outcome=>outcome.status==="rejected"))deny();
};
const configKeys=[
 "adapterBaseUrl","adapterToken","bindSecretFile","bindSocketPath",
 "gatewayBaseUrl","maxCalls","modelSecretFile","modelSocketPath",
 "port","role","stageSecretFile","stageSocketPath","task"
];
const start=async message=>{
 if(active||stopping||!message||message.type!=="start"||
    !message.config||typeof message.config!=="object"||
    Array.isArray(message.config)||
    Object.keys(message.config).sort().join(",")!==configKeys.join(","))
  deny();
 active=true;
 mustBeClean();
 // Same-UID processes can normally open owner 0600 files. This probe
 // provides negative isolation evidence without reading any secret.
 const ownerCanaryReadable=await canOpenOwnerCanary(message.ownerCanaryPath);
 const cfg=message.config;
 if(!ROLES.has(cfg.role)||!Number.isSafeInteger(cfg.port)||
    cfg.port<1024||cfg.port>65535||
    typeof cfg.gatewayBaseUrl!=="string"||
    !cfg.gatewayBaseUrl.startsWith("http://127.0.0.1:")||
    typeof cfg.adapterBaseUrl!=="string"||
    !cfg.adapterBaseUrl.startsWith("http://127.0.0.1:")||
    typeof cfg.adapterToken!=="string"||
    cfg.adapterToken.length<8||cfg.adapterToken.length>512||
    typeof cfg.modelSocketPath!=="string"||
    typeof cfg.modelSecretFile!=="string"||
    typeof cfg.bindSocketPath!=="string"||
    typeof cfg.bindSecretFile!=="string"||
    typeof cfg.stageSocketPath!=="string"||
    typeof cfg.stageSecretFile!=="string"||
    new Set([
     cfg.modelSocketPath,cfg.modelSecretFile,
     cfg.bindSocketPath,cfg.bindSecretFile,
     cfg.stageSocketPath,cfg.stageSecretFile
    ]).size!==6)deny();
 const client=await connectDisposableWorkerModelIpcClient({
  role:cfg.role,socketPath:cfg.modelSocketPath,
  secretFile:cfg.modelSecretFile
 });
 // Trusted parent pins the session once. Signed Task/Child is activated
 // only through the authenticated ORIGINAL registry after A2A dispatch.
 model=createDisposableOriginalWorkerIpcAdkModel({
  role:cfg.role,sessionId:cfg.task?.session_id,
  client,maxCalls:cfg.maxCalls
 });
 // ORIGINAL owner->agent binding and owner staging transports, previously
 // hosted in the same PID as the owner. Now the Task registry and binder
 // live in THIS A2A specialist PID; the owner retains its Stage registry.
 // An A2A request cannot bind itself. Only the owner's HMAC-protected
 // bind socket can prebind the exact signed Child/Task pins.
 const trustedEffectTaskRegistry=new TrustedEffectStagingTaskRegistry();
 const ownerStageClient=await connectTrustedOwnerEffectStagingClient({
  socketPath:cfg.stageSocketPath,secretFile:cfg.stageSecretFile
 });
 binder=await createTrustedEffectAgentBindingServer({
  socketPath:cfg.bindSocketPath,secretFile:cfg.bindSecretFile,
  expectedRole:cfg.role,registry:trustedEffectTaskRegistry,
  ownerStageClient
 });
 await binder.start();
 // This private per-worker MCP key is NOT the Engineer approval signing
 // key. The original native authority/Gateway remains separate.
 const ephemeral=generateKeyPairSync("ed25519");
 server=await startSpecializedAgentServer({
  role:cfg.role,host:"127.0.0.1",port:cfg.port,
  capabilityProfile:"approved-plan",delegatedAuthorization:true,
  adk:{model,gatewayBaseUrl:cfg.gatewayBaseUrl,
   adapterBaseUrl:cfg.adapterBaseUrl,
   adapterToken:cfg.adapterToken,maxModelTurns:cfg.maxCalls,
   trustedEffectTaskRegistry,
   trustedOriginalWorkerIpcTaskBinding:pin=>model.beginOwnerBoundTask(pin)},
  mcpTaskSigning:{
   signingPrivateKeyPem:ephemeral.privateKey.export({
    format:"pem",type:"pkcs8"}).toString(),
   signingPublicKeyPem:ephemeral.publicKey.export({
    format:"pem",type:"spki"}).toString()
  }
 });
 send({type:"ready",pid:process.pid,role:cfg.role,
  baseUrl:server.baseUrl,
  providerCredentialPresent:false,
  originalNativeTaskBindingPresent:false,
  originalTaskBindingChannelReady:true,
  ownerCanaryReadable,
  osIsolationVerified:false});
};
mustBeClean();
process.on("message",async message=>{
 try{
  if(message?.type==="stop"){
   await shutdown();
   send({type:"stopped"});
   process.disconnect?.();
   return;
  }
  await start(message);
 }catch{
  await shutdown().catch(()=>{});
  send({type:"error",code:"NO_GO"});
  process.disconnect?.();
  process.exitCode=1;
 }
});
process.once("disconnect",()=>{
 void shutdown().catch(()=>{process.exitCode=1;});
});
process.once("SIGTERM",()=>{
 void shutdown().then(()=>process.exit(0),
  ()=>process.exit(1));
});
