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
import {open,lstat,realpath,access} from "node:fs/promises";
import {isAbsolute,resolve} from "node:path";
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
// Native MCP uses the SAME original Rust signer and one-shot per-Task
// PrivateMcpTaskRegistry. Both extra pins are owner-only bootstrap data.
const nativeKeys=[...configKeys,"nativeCryptoSocketPath","nativeSignerDid"];
const NATIVE_DID=/^did:[a-z0-9]+:[A-Za-z0-9._:%-]{4,180}$/u;
async function requireOriginalNativeRustSigner(cfg,scoped,isolationRequired){
 if(isolationRequired!==true||!scoped||process.platform!=="linux"||
    !NATIVE_DID.test(cfg.nativeSignerDid??"")||
    typeof cfg.nativeCryptoSocketPath!=="string"||
    !isAbsolute(cfg.nativeCryptoSocketPath)||
    resolve(cfg.nativeCryptoSocketPath)!==cfg.nativeCryptoSocketPath||
    cfg.nativeCryptoSocketPath.length>100||
    cfg.nativeCryptoSocketPath.includes("\\0")||
    process.env.APPROVED_RUNNER_NATIVE_MCP!==undefined||
    process.env.DELEGATION_GATEWAY_ARCHITECTURE!==undefined)deny();
 let st;
 try{
  st=await lstat(cfg.nativeCryptoSocketPath);
  if(!st.isSocket()||st.isSymbolicLink()||
     st.uid!==scoped.ownerUid||st.uid===scoped.workerUid||
     (st.mode&0o007)!==0||
     await realpath(cfg.nativeCryptoSocketPath)!==cfg.nativeCryptoSocketPath)
   deny();
  // A distinct Linux UID must be able to connect through the explicitly
  // provisioned role-specific native Rust mount / ACL. This check does not
  // attest signature correctness; only real native Task+Gateway can do so.
  await access(cfg.nativeCryptoSocketPath,constants.W_OK);
 }catch{deny();}
 // The child starts with a scrubbed environment. Install only the path
 // of the already-inspected ORIGINAL Rust signer, never a bearer or key.
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=cfg.nativeCryptoSocketPath;
 return true;
}
const start=async message=>{
 if(active||stopping||!message||message.type!=="start"||
    !message.config||typeof message.config!=="object"||
    Array.isArray(message.config)||
    ![configKeys.join(","),nativeKeys.slice().sort().join(",")].includes(
     Object.keys(message.config).sort().join(",")))
  deny();
 active=true;
 mustBeClean();
 // Same-UID processes can normally open owner 0600 files. This probe
 // provides negative isolation evidence without reading any secret.
 const ownerCanaryReadable=await canOpenOwnerCanary(message.ownerCanaryPath);
 if(message.requireOwnerFileIsolation!==undefined&&
    typeof message.requireOwnerFileIsolation!=="boolean")deny();
 // Strict Linux role scope comes from the trusted local launcher ONLY.
 // The ORIGINAL private R322 channels stay in use when it is absent.
 const scoped=message.originalScopedRole;
 if(message.requireOwnerFileIsolation===true){
  if(process.platform!=="linux"||
     !scoped||typeof scoped!=="object"||Array.isArray(scoped)||
     Object.keys(scoped).sort().join(",")!==
      "ownerUid,role,roleGid,workerUid"||
     scoped.role!==message.config.role||
     !Number.isSafeInteger(scoped.ownerUid)||scoped.ownerUid<=0||
     !Number.isSafeInteger(scoped.workerUid)||scoped.workerUid<=0||
     !Number.isSafeInteger(scoped.roleGid)||scoped.roleGid<=0||
     scoped.ownerUid===scoped.workerUid||
     typeof process.getuid!=="function"||
     typeof process.getgid!=="function"||
     typeof process.getgroups!=="function"||
     process.getuid()!==scoped.workerUid||
     process.getgid()!==scoped.roleGid||
     process.getgroups().some(gid=>gid!==scoped.roleGid))deny();
 }else if(scoped!==undefined)deny();
 // Refuse an obviously readable owner file BEFORE opening any binder,
 // model proxy, SDK session or A2A HTTP listener. The parent separately
 // requires distinct kernel UIDs before acknowledging startup.
 if(message.requireOwnerFileIsolation===true&&ownerCanaryReadable)deny();
 const cfg=message.config;
 const nativeMcp=Object.hasOwn(cfg,"nativeSignerDid")&&
  Object.hasOwn(cfg,"nativeCryptoSocketPath");
 if(!nativeMcp&&(
    Object.hasOwn(process.env,"APPROVED_RUNNER_NATIVE_MCP")||
    Object.hasOwn(process.env,"DELEGATION_GATEWAY_ARCHITECTURE")))deny();
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
 // No Rust signer configured: preserve the existing offline HMAC-only
 // A2A worker. A partial native config is rejected by the exact-key gate.
 if(nativeMcp)await requireOriginalNativeRustSigner(
  cfg,scoped,message.requireOwnerFileIsolation
 );
 const client=await connectDisposableWorkerModelIpcClient({
  role:cfg.role,socketPath:cfg.modelSocketPath,
  secretFile:cfg.modelSecretFile,
  ...(scoped?{originalScopedModelRole:scoped}:{})
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
  socketPath:cfg.stageSocketPath,secretFile:cfg.stageSecretFile,
  expectedRole:cfg.role,
  ...(scoped?{originalScopedEffectRole:scoped}:{})
 });
 binder=await createTrustedEffectAgentBindingServer({
  socketPath:cfg.bindSocketPath,secretFile:cfg.bindSecretFile,
  expectedRole:cfg.role,registry:trustedEffectTaskRegistry,
  ownerStageClient,
  ...(scoped?{originalScopedEffectRole:scoped}:{})
 });
 await binder.start();
 // This private per-worker MCP key is NOT the Engineer approval signing
 // key. The original native authority/Gateway remains separate.
 const ephemeral=generateKeyPairSync("ed25519");
 server=await startSpecializedAgentServer({
  role:cfg.role,host:"127.0.0.1",port:cfg.port,
  capabilityProfile:"approved-plan",delegatedAuthorization:true,
  ...(nativeMcp?{nativeSignerDid:cfg.nativeSignerDid}:{}),
  adk:{model,gatewayBaseUrl:cfg.gatewayBaseUrl,
   adapterBaseUrl:cfg.adapterBaseUrl,
   adapterToken:cfg.adapterToken,maxModelTurns:cfg.maxCalls,
   trustedEffectTaskRegistry,
   ...(nativeMcp?{nativePresentationTransport:"mcp-stdio"}:{}),
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
  // Cross-UID channels are separately pinned and tested; they never
  // claim a verified OS boundary or native Root/Child evidence.
  crossUidChannelsConfigured:scoped!==undefined,
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
