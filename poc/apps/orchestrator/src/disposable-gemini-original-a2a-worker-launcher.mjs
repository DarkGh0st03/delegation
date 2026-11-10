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
import {mkdtemp,writeFile,rm,readFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const ROLE=new Set(["backend","frontend","test"]);
const KEYS=[
 "adapterBaseUrl","adapterToken","bindSecretFile","bindSocketPath",
 "gatewayBaseUrl","maxCalls","modelSecretFile","modelSocketPath",
 "port","role","stageSecretFile","stageSocketPath","task"
];
const deny=()=>{throw Error("Disposable original A2A subprocess launcher NO-GO");};
export async function startDisposableOriginalA2aWorkerSubprocess(config){
 if(process.env.DELEGATION_DISPOSABLE_LIVE_MODE==="gemini-real"||
    !config||typeof config!=="object"||Array.isArray(config)||
    Object.keys(config).sort().join(",")!==KEYS.join(",")||
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
   if(error)reject(Error("Disposable original A2A subprocess close NO-GO"));
   else resolve();
  };
  const onExit=(code,signal)=>{
   stopped=true;
   finish(code===0?null:Error("abnormal child exit"));
  };
  child.once("exit",onExit);
  const timer=setTimeout(()=>{
   if(child.exitCode===null)child.kill("SIGKILL");
   finish(Error("unconfirmed worker retirement"));
  },10_000);
  if(child.connected)child.send({type:"stop"});
  else if(child.exitCode===null)child.kill("SIGTERM");
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
   child.send({type:"start",config,ownerCanaryPath});
  });
  // Read real kernel credentials, rather than trusting the worker's
  // self-reported UID. This is evidence of a boundary failure only.
  let workerUid=null;
  if(process.platform==="linux"&&child.pid){
   try{
    const status=await readFile("/proc/"+child.pid+"/status","utf8");
    const m=status.match(/^Uid:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/mu);
    const p=status.match(/^Pid:\s*(\d+)/mu);
    if(m&&p&&Number(p[1])===child.pid&&
       [2,3,4].every(i=>m[i]===m[1]))workerUid=Number(m[1]);
   }catch{workerUid=null;}
  }
  if(ready?.type!=="ready"||ready.pid!==child.pid||
     ready.role!==config.role||
     ready.baseUrl!==`http://127.0.0.1:${config.port}`||
     ready.providerCredentialPresent!==false||
     ready.originalNativeTaskBindingPresent!==false||
     ready.originalTaskBindingChannelReady!==true||
     typeof ready.ownerCanaryReadable!=="boolean"||
     ready.osIsolationVerified!==false)deny();
  return Object.freeze({
   role:config.role,pid:child.pid,baseUrl:ready.baseUrl,
   originalNativeTaskBindingPresent:false,
   originalTaskBindingChannelReady:true,
   osIsolationVerified:false,
   ownerCanaryReadableFromWorker:ready.ownerCanaryReadable,
   ownerAndWorkerShareUid:workerUid===null||
    typeof process.getuid!=="function"?null:
    workerUid===process.getuid(),
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
