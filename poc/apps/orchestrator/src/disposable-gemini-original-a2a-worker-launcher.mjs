/**
 * Offline-only, fail-closed separate Node PID launcher for ONE of the
 * three ORIGINAL A2A roles. No inherited environment, owner key, provider
 * delegate, Github token, Engineer private key or native Rust authority.
 *
 * NOT safe for paid Gemini yet: sibling processes with the same UID may
 * read owner-private filesystem. A real signed Task binder and a proven
 * different-UID/mount boundary are required before lifting the paid gate.
 */
import {fork,spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm,lstat,realpath,readFile} from "node:fs/promises";
import {join,dirname,resolve,isAbsolute} from "node:path";
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
  const [st,dir]=await Promise.all([lstat(path),lstat(dirname(path))]);
  // A real Rust signer must expose a DISTINCT owner-created socket for
  // this specialist's Linux GID. An owner-only socket, another role's
  // group, a world-accessible path or a worker-writable directory may
  // never be interpreted as cross-UID native signer access.
  if(!st.isSocket()||st.isSymbolicLink()||st.nlink!==1||
     st.uid!==scope.ownerUid||st.uid===scope.workerUid||
     st.gid!==scope.roleGid||(st.mode&0o777)!==0o660||
     !dir.isDirectory()||dir.isSymbolicLink()||
     dir.uid!==scope.ownerUid||dir.gid!==scope.roleGid||
     (dir.mode&0o7777)!==0o2750||
     await realpath(dirname(path))!==dirname(path)||
     await realpath(path)!==path)deny();
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


/**
 * FREE / NO-GEMINI privileged Linux sibling launcher for the THREE ORIGINAL
 * specialist A2A processes, NOT a new orchestrator, signer or agent.
 *
 * The parent is an explicit UID=0 provisioner; Owner is a SEPARATE
 * unprivileged UID process already running. The launcher executes ONLY the
 * repository's existing A2A worker entrypoint through fixed /usr/bin/setpriv,
 * dropping to three unique unprivileged UIDs/GIDs with no supplementary
 * groups, no effective capabilities and NoNewPrivs.
 *
 * Unlike startDisposableOriginalA2aWorkerSubprocess (same-UID fork), this
 * actually changes Linux credentials. It DOES NOT create distinct mount
 * namespaces, attest a native Rust signature, grant provider effects or
 * authorize Gemini. Never launch in a paid workflow.
 */
export async function startDisposableOriginalPrivilegedThreeRoleWorkers({
 configs,scopes,ownerPid,ownerCanaryPath,offlineSyntheticOnly
}={}){
 const names=["backend","frontend","test"];
 const precise=value=>value&&typeof value==="object"&&
  !Array.isArray(value)&&
  Object.keys(value).sort().join(",")===names.slice().sort().join(",");
 const allowed=value=>Number.isSafeInteger(value)&&value>0&&value<65536;
 const statusNumbers=(status,key,count)=>{
  // /proc Groups: may be empty; \\s would swallow its newline and the next field.
  const line=status.match(new RegExp("^"+key+":[ \\t]*([^\\n]*)$","mu"));
  if(!line)deny();
  const parts=line[1].trim()?line[1].trim().split(/\s+/u):[];
  if(parts.length!==count||parts.some(x=>!/^[0-9]+$/u.test(x)))deny();
  const result=parts.map(Number);
  if(!result.every(Number.isSafeInteger))deny();
  return result;
 };
 if(offlineSyntheticOnly!==true||process.platform!=="linux"||
    process.getuid?.()!==0||process.geteuid?.()!==0||
    process.env.DELEGATION_DISPOSABLE_LIVE_MODE!==undefined||
    ["GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY",
     "GOOGLE_APPLICATION_CREDENTIALS"].some(k=>Object.hasOwn(process.env,k))||
    !precise(configs)||!precise(scopes)||
    !Number.isSafeInteger(ownerPid)||ownerPid<2||ownerPid===process.pid||
    typeof ownerCanaryPath!=="string"||
    !isAbsolute(ownerCanaryPath)||resolve(ownerCanaryPath)!==ownerCanaryPath||
    ownerCanaryPath.length>240||ownerCanaryPath.includes("\0"))deny();
 const uidSet=new Set(),gidSet=new Set(),ports=new Set(),channels=new Set();
 let ownerUid;
 try{
  const [stat,dir,owner,priv]=await Promise.all([
   lstat(ownerCanaryPath),lstat(resolve(ownerCanaryPath,"..")),
   readFile("/proc/"+ownerPid+"/status","utf8"),
   lstat("/usr/bin/setpriv")
  ]);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
     (stat.mode&0o777)!==0o600||
     !dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o777)!==0o700||stat.uid!==dir.uid||
     !priv.isFile()||priv.isSymbolicLink()||priv.uid!==0||
     (priv.mode&0o022)!==0||
     await realpath(ownerCanaryPath)!==ownerCanaryPath||
     statusNumbers(owner,"Pid",1)[0]!==ownerPid||
     statusNumbers(owner,"PPid",1)[0]!==process.pid)deny();
  const uids=statusNumbers(owner,"Uid",4);
  const ownerGids=statusNumbers(owner,"Gid",4);
  // The Rust/Model Owner is not a privileged root helper: it must be an
  // ordinary stable Linux principal without effective capabilities, with
  // NoNewPrivs already locked before any specialist is launched.
  if(!uids.every(u=>u===uids[0])||uids[0]===0||
     uids[0]!==stat.uid||
     !ownerGids.every(g=>g===ownerGids[0])||ownerGids[0]===0||
     statusNumbers(owner,"NoNewPrivs",1)[0]!==1||
     !/^CapEff:[ \t]*0+[ \t]*$/mu.test(owner))deny();
  ownerUid=uids[0];
  for(const name of names){
   const conf=configs[name],scope=scopes[name];
   if(!conf||typeof conf!=="object"||Array.isArray(conf)||
      !scope||typeof scope!=="object"||Array.isArray(scope)||
      Object.keys(scope).sort().join(",")!=="ownerUid,role,roleGid,workerUid"||
      scope.role!==name||conf.role!==name||
      scope.ownerUid!==ownerUid||!allowed(scope.workerUid)||
      !allowed(scope.roleGid)||scope.workerUid===ownerUid||
      Object.keys(conf).sort().join(",")!==(
       (Object.hasOwn(conf,"nativeCryptoSocketPath")||
        Object.hasOwn(conf,"nativeSignerDid"))?NATIVE_KEYS.join(","):KEYS.join(","))||
      !Number.isSafeInteger(conf.port)||conf.port<1024||
      conf.port>65535||ports.has(conf.port)||
      typeof conf.adapterToken!=="string"||conf.adapterToken.length<8||
      typeof conf.gatewayBaseUrl!=="string"||
      typeof conf.adapterBaseUrl!=="string"||
      !conf.task||typeof conf.task.session_id!=="string")deny();
   uidSet.add(scope.workerUid);gidSet.add(scope.roleGid);
   ports.add(conf.port);
   for(const key of ["modelSocketPath","modelSecretFile",
     "bindSocketPath","bindSecretFile","stageSocketPath","stageSecretFile"]){
    if(typeof conf[key]!=="string"||!isAbsolute(conf[key])||
       resolve(conf[key])!==conf[key]||conf[key].includes("\0")||
       channels.has(conf[key]))deny();
    channels.add(conf[key]);
   }
   if(Object.hasOwn(conf,"nativeCryptoSocketPath"))
    await verifyOwnerNativeRustSocket(conf,scope);
  }
  const actualOwnerGroups=statusNumbers(owner,"Groups",3);
  // The Owner may join precisely the three original role transport
  // groups and NO other supplementary group (especially not GID 0).
  // Workers retain zero supplementary groups after setpriv.
  if(uidSet.size!==3||gidSet.size!==3||ports.size!==3||
     channels.size!==18||
     gidSet.has(ownerGids[0])||
     new Set(actualOwnerGroups).size!==3||
     actualOwnerGroups.some(g=>!gidSet.has(g)))deny();
 }catch{deny();}
 const entry=fileURLToPath(new URL(
  "./disposable-gemini-original-a2a-worker-child.mjs",import.meta.url
 ));
 const children=new Map(),results={};
 const halt=async()=>{
  const done=[];
  for(const child of children.values()){
   done.push(new Promise(resolveDone=>{
    if(child.exitCode!==null||child.signalCode!==null){
     resolveDone();return;
    }
    let settled=false;
    const finish=()=>{if(settled)return;settled=true;
      clearTimeout(timer);resolveDone();};
    child.once("exit",finish);
    const timer=setTimeout(()=>{
     if(child.exitCode===null)child.kill("SIGKILL");
     finish();
    },5000);
    try{
     if(child.connected)child.send({type:"stop"},err=>{
      if(err&&child.exitCode===null)child.kill("SIGTERM");
     });
     else if(child.exitCode===null)child.kill("SIGTERM");
    }catch{if(child.exitCode===null)child.kill("SIGTERM");}
   }));
  }
  await Promise.all(done);
 };
 const ownerEnv=Object.freeze({
  PATH:"/usr/bin:/bin",LANG:"C.UTF-8",TZ:"UTC",HOME:"/nonexistent",
  DELEGATION_GATEWAY_ARCHITECTURE:"authority-only"
 });
 try{
  for(const name of names){
   const scope=scopes[name],conf=configs[name];
   const child=spawn("/usr/bin/setpriv",[
    "--reuid",String(scope.workerUid),
    "--regid",String(scope.roleGid),
    "--clear-groups","--no-new-privs","--bounding-set=-all",
    process.execPath,"--experimental-strip-types",entry
   ],{
    env:ownerEnv,stdio:["ignore","ignore","ignore","ipc"],
    windowsHide:true
   });
   children.set(name,child);
   const reported=await new Promise((accept,reject)=>{
    let settled=false;
    const finish=(error,value)=>{
     if(settled)return;
     settled=true;clearTimeout(timer);
     child.off("message",message);child.off("exit",exit);
     child.off("error",failure);
     if(error)reject(error);else accept(value);
    };
    const message=data=>data?.type==="ready"?
      finish(null,data):data?.type==="error"?finish(Error("NO-GO")):undefined;
    const exit=()=>finish(Error("worker exited before trusted readiness"));
    const failure=()=>finish(Error("privileged drop failed"));
    const timer=setTimeout(()=>finish(Error("worker readiness timeout")),18000);
    child.on("message",message);child.once("exit",exit);
    child.once("error",failure);
    child.send({type:"start",config:conf,ownerCanaryPath,
     requireOwnerFileIsolation:true,originalScopedRole:scope},err=>{
      if(err)finish(Error("privileged worker IPC unavailable"));
    });
   });
   if(reported.pid!==child.pid||reported.role!==name||
      reported.baseUrl!=="http://127.0.0.1:"+conf.port||
      reported.ownerCanaryReadable!==false||
      reported.providerCredentialPresent!==false||
      reported.originalNativeTaskBindingPresent!==false||
      reported.originalTaskBindingChannelReady!==true||
      reported.crossUidChannelsConfigured!==true||
      reported.osIsolationVerified!==false)deny();
   const status=await readFile("/proc/"+child.pid+"/status","utf8");
   if(statusNumbers(status,"Pid",1)[0]!==child.pid||
      statusNumbers(status,"PPid",1)[0]!==process.pid||
      !statusNumbers(status,"Uid",4).every(u=>u===scope.workerUid)||
      !statusNumbers(status,"Gid",4).every(g=>g===scope.roleGid)||
      statusNumbers(status,"Groups",0).length!==0||
      statusNumbers(status,"NoNewPrivs",1)[0]!==1||
      !/^CapEff:\s*0+\s*$/mu.test(status))deny();
   results[name]=Object.freeze({
    role:name,pid:child.pid,baseUrl:reported.baseUrl,
    workerUid:scope.workerUid,roleGid:scope.roleGid,
    canReadOwnerCanary:false,
    originalNativeTaskBindingPresent:false,
    osIsolationVerified:false,nativeRustSignerVerified:false
   });
  }
 }catch{
  await halt();deny();
 }
 let closing;
 return Object.freeze({
  workers:Object.freeze(results),close:()=>closing??=halt(),
  osIsolationVerified:false,nativeRustSignerVerified:false,
  paidGeminiAuthorized:false
 });
}
