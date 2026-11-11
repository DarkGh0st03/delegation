/**
 * Offline-only, fail-closed separate Node PID launcher for ONE of the
 * three ORIGINAL A2A roles. No inherited environment, owner key, provider
 * delegate, Github token, Engineer private key or native Rust authority.
 *
 * NOT safe for paid Gemini yet: sibling processes with the same UID may
 * read owner-private filesystem. A real signed Task binder and a proven
 * different-UID/mount boundary are required before lifting the paid gate.
 */
import {fork} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm,lstat,realpath} from "node:fs/promises";
import {join,resolve,isAbsolute} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {inspectDisposableOriginalLinuxBoundary}
 from "./disposable-gemini-original-linux-boundary-audit.mjs";
import {inspectDisposableOriginalScopedIpcPermissions}
 from "./disposable-gemini-original-scoped-ipc-permissions.mjs";

const ROLE=new Set(["backend","frontend","test"]);
const KEYS=[
 "adapterBaseUrl","adapterToken","bindSecretFile","bindSocketPath",
 "gatewayBaseUrl","maxCalls","modelSecretFile","modelSocketPath",
 "port","role","stageSecretFile","stageSocketPath","task"
];
const deny=()=>{throw Error("Disposable original A2A subprocess launcher NO-GO");};
const NATIVE_KEYS=[...KEYS,"nativeCryptoSocketPath","nativeSignerDid"].sort();
const NATIVE_DID=/^did:[a-z0-9]+:[A-Za-z0-9._:%-]{4,180}$/u;
async function verifyOwnerNativeRustSocket(config,scope){
 const path=config.nativeCryptoSocketPath;
 if(!NATIVE_DID.test(config.nativeSignerDid??"")||
    typeof path!=="string"||!isAbsolute(path)||
    resolve(path)!==path||path.includes("\0")||
    path.length>100||[
     config.modelSocketPath,config.modelSecretFile,
     config.stageSocketPath,config.stageSecretFile,
     config.bindSocketPath,config.bindSecretFile
    ].includes(path))deny();
 try{
  const st=await lstat(path);
  if(!st.isSocket()||st.isSymbolicLink()||
     st.uid!==scope.ownerUid||st.uid===scope.workerUid||
     (st.mode&0o007)!==0||await realpath(path)!==path)deny();
 }catch{deny();}
}
export async function startDisposableOriginalA2aWorkerSubprocess(
 config,{
  requireOwnerFileIsolation=false,ownerPrivateBoundary,
  originalScopedRole
 }={}
){
 const nativeMcp=!!config&&typeof config==="object"&&
  Object.hasOwn(config,"nativeCryptoSocketPath")&&
  Object.hasOwn(config,"nativeSignerDid");
 // The owner-only file path is never sent to the worker; only the trusted
 // parent may inspect its metadata through /proc and lstat. This is a
 // necessary cross-UID boundary check, not production proof of isolation.
 if(typeof requireOwnerFileIsolation!=="boolean"||
    (requireOwnerFileIsolation?
     !originalScopedRole||
     typeof originalScopedRole!=="object"||
     Array.isArray(originalScopedRole)||
     Object.keys(originalScopedRole).sort().join(",")!==
      "ownerUid,role,roleGid,workerUid"||
     originalScopedRole.role!==config?.role||
     !Number.isSafeInteger(originalScopedRole.ownerUid)||
     originalScopedRole.ownerUid<=0||
     !Number.isSafeInteger(originalScopedRole.workerUid)||
     originalScopedRole.workerUid<=0||
     !Number.isSafeInteger(originalScopedRole.roleGid)||
     originalScopedRole.roleGid<=0||
     originalScopedRole.ownerUid===originalScopedRole.workerUid||
     typeof process.getuid!=="function"||
     originalScopedRole.ownerUid!==process.getuid()
     :originalScopedRole!==undefined)||
    (requireOwnerFileIsolation
     ?(!ownerPrivateBoundary||
       Object.keys(ownerPrivateBoundary).sort().join(",")!==
        "directory,keyFile"||
       typeof ownerPrivateBoundary.directory!=="string"||
       typeof ownerPrivateBoundary.keyFile!=="string")
     :ownerPrivateBoundary!==undefined)||
    process.env.DELEGATION_DISPOSABLE_LIVE_MODE==="gemini-real"||
    !config||typeof config!=="object"||Array.isArray(config)||
    Object.keys(config).sort().join(",")!==(
     nativeMcp?NATIVE_KEYS.join(","):KEYS.join(","))||
    (nativeMcp&&!requireOwnerFileIsolation)||
    !ROLE.has(config.role)||
    !Number.isSafeInteger(config.port)||config.port<1024||
    config.port>65535||
    typeof config.adapterToken!=="string"||
    config.adapterToken.length<8||
    typeof config.gatewayBaseUrl!=="string"||
    typeof config.adapterBaseUrl!=="string"||
    typeof config.modelSocketPath!=="string"||
    typeof config.modelSecretFile!=="string"||
    typeof config.bindSocketPath!=="string"||
    typeof config.bindSecretFile!=="string"||
    typeof config.stageSocketPath!=="string"||
    typeof config.stageSecretFile!=="string"||
    new Set([
     config.modelSocketPath,config.modelSecretFile,
     config.bindSocketPath,config.bindSecretFile,
     config.stageSocketPath,config.stageSecretFile
    ]).size!==6)deny();
 // The original worker accepts ONLY cross-UID native Rust signer pins.
 // A same-UID/offline subprocess cannot enable native MCP by configuration.
 if(nativeMcp)await verifyOwnerNativeRustSocket(config,originalScopedRole);
 const entry=fileURLToPath(new URL(
  "./disposable-gemini-original-a2a-worker-child.mjs",import.meta.url
 ));
 // The owner-created random canary is harmless, mode 0600 in mode 0700.
 // It is intentionally NOT an Engineer key, Gemini key or bearer token.
 const probeDir=await mkdtemp(join(tmpdir(),"delegation-owner-canary-"));
 const ownerCanaryPath=join(probeDir,"canary.bin");
 try{
  await writeFile(ownerCanaryPath,randomBytes(32),
   {mode:0o600,flag:"wx"});
 }catch{
  await rm(probeDir,{recursive:true,force:true}).catch(()=>{});
  deny();
 }
 // Explicit allowlist: never spread process.env (provider key, Github token,
 // NODE_OPTIONS, credential discovery variables, native owner socket).
 const child=fork(entry,[],{
  execArgv:["--experimental-strip-types"],
  env:{
   PATH:process.env.PATH??"/usr/bin:/bin",
   LANG:"C.UTF-8",TZ:"UTC",HOME:"/nonexistent",
   // Require the ORIGINAL per-Task authenticated registry inside A2A,
   // even in an offline subprocess. Native Rust MCP remains disabled
   // until the complete privileged OS isolation is established.
   DELEGATION_GATEWAY_ARCHITECTURE:"authority-only"
  },
  stdio:["ignore","ignore","ignore","ipc"],
  windowsHide:true
 });
 let stopped=false,closing;
 const close=()=>closing??=new Promise((resolve,reject)=>{
  if(stopped){resolve();return;}
  let settled=false;
  const finish=error=>{
   if(settled)return;
   settled=true;
   clearTimeout(timer);
   child.off("exit",onExit);
   child.off("error",onError);
   if(error)reject(Error("Disposable original A2A subprocess close NO-GO"));
   else resolve();
  };
  const onExit=(code,signal)=>{
   stopped=true;
   finish(code===0?null:Error("abnormal child exit"));
  };
  // A child that refuses owner isolation may disconnect its IPC channel
  // BEFORE the parent sends 'stop'. IPC EPIPE must never become an
  // unhandled exception (and must never turn a NO-GO into a retry).
  const onError=()=>{if(child.exitCode===null)child.kill("SIGKILL");};
  child.once("exit",onExit);
  child.once("error",onError);
  const timer=setTimeout(()=>{
   if(child.exitCode===null)child.kill("SIGKILL");
   finish(Error("unconfirmed worker retirement"));
  },10_000);
  if(child.connected){
   try{
    child.send({type:"stop"},error=>{
     if(error&&child.exitCode===null)child.kill("SIGKILL");
    });
   }catch{
    if(child.exitCode===null)child.kill("SIGKILL");
   }
  }else if(child.exitCode===null)child.kill("SIGTERM");
 });
 try{
  const ready=await new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(error,value)=>{
    if(settled)return;
    settled=true;
    clearTimeout(timer);
    child.off("message",onMessage);
    child.off("exit",onExit);
    child.off("error",onError);
    if(error)reject(Error("Disposable original A2A subprocess start NO-GO"));
    else resolve(value);
   };
   const onExit=()=>{stopped=true;finish(Error("exit before ready"));};
   const onError=()=>finish(Error("spawn failed"));
   const onMessage=message=>{
    if(message?.type==="error")finish(Error("worker refused config"));
    else if(message?.type==="ready")finish(null,message);
   };
   const timer=setTimeout(()=>finish(Error("worker startup timed out")),
    15_000);
   child.on("message",onMessage);
   child.once("exit",onExit);
   child.once("error",onError);
   child.send({type:"start",config,ownerCanaryPath,
    requireOwnerFileIsolation,
    ...(originalScopedRole?{originalScopedRole}:{})});
  });
  if(ready?.type!=="ready"||ready.pid!==child.pid||
     ready.role!==config.role||
     ready.baseUrl!==`http://127.0.0.1:${config.port}`||
     ready.providerCredentialPresent!==false||
     ready.originalNativeTaskBindingPresent!==false||
     ready.originalTaskBindingChannelReady!==true||
     typeof ready.ownerCanaryReadable!=="boolean"||
     ready.crossUidChannelsConfigured!==requireOwnerFileIsolation||
     ready.osIsolationVerified!==false)deny();
  // The parent inspects BOTH kernel UIDs, mount namespaces, effective
  // capabilities, NoNewPrivs and parent/child PID relationship.
  // No worker-supplied "isolation verified" boolean is accepted.
  let linuxBoundaryAudit=null;
  if(process.platform==="linux"){
   linuxBoundaryAudit=await inspectDisposableOriginalLinuxBoundary({
    workerPid:child.pid,ownerCanaryReadable:ready.ownerCanaryReadable
   });
  }
  let scopedIpcPermissions=null;
  if(requireOwnerFileIsolation){
   if(linuxBoundaryAudit?.requiredKernelConditionsPassed!==true||
      linuxBoundaryAudit.ownerUid!==originalScopedRole.ownerUid||
      linuxBoundaryAudit.workerUid!==originalScopedRole.workerUid)deny();
   // A different Linux UID is NOT enough. The model/stage socket files
   // and secrets must be group-scoped to exactly this specialist, while
   // the owner Gemini/Engineer key remains owner-private (0700/0600).
   // This auditor reads metadata only and cannot authorize a paid launch.
   scopedIpcPermissions=await inspectDisposableOriginalScopedIpcPermissions({
    role:config.role,workerPid:child.pid,
    ownerPrivateDirectory:ownerPrivateBoundary.directory,
    ownerPrivateKeyFile:ownerPrivateBoundary.keyFile,
    modelSocketPath:config.modelSocketPath,
    modelSecretFile:config.modelSecretFile,
    stageSocketPath:config.stageSocketPath,
    stageSecretFile:config.stageSecretFile,
    bindSocketPath:config.bindSocketPath,
    bindSecretFile:config.bindSecretFile
   });
   if(scopedIpcPermissions.layoutPotentiallyUsable!==true||
      scopedIpcPermissions.conditions.distinctRolePrimaryGroup!==true||
      scopedIpcPermissions.conditions.workerHasNoOtherSupplementaryGroups!==true)deny();
  }
  return Object.freeze({
   role:config.role,pid:child.pid,baseUrl:ready.baseUrl,
   originalNativeTaskBindingPresent:false,
   originalTaskBindingChannelReady:true,
   crossUidChannelsConfigured:ready.crossUidChannelsConfigured,
   osIsolationVerified:false,
   ownerCanaryReadableFromWorker:ready.ownerCanaryReadable,
   ownerAndWorkerShareUid:linuxBoundaryAudit?
    linuxBoundaryAudit.workerUid===linuxBoundaryAudit.ownerUid:null,
   linuxBoundaryAudit,
   // Pure filesystem metadata is never promoted to a Rust/DID/secret
   // isolation attestation. No implicit permission to run live Gemini.
   scopedIpcPermissions,
   nativeRustSignerVerified:false,
   close
  });
 }catch{
  if(child.exitCode===null)child.kill("SIGKILL");
  await close().catch(()=>{});
  deny();
 }finally{
  // Probe does not outlive child startup or an error path.
  await rm(probeDir,{recursive:true,force:true}).catch(()=>{});
 }
}
