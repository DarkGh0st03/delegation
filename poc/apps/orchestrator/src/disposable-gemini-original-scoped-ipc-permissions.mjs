/**
 * ORIGINAL disposable specialist IPC: cross-UID role group ACCESS CONTRACT.
 *
 * This checks a possible Linux filesystem layout with one dedicated group
 * for ONE specialist, but DOES NOT provision/chown/drop privileges or modify
 * the existing owner-only 0700/0600 transports. Those stay fail-closed.
 *
 * Proposed layout for a separate OS principal, only after a privileged
 * launcher has safely created it:
 *
 * owner model/stage dirs: owner uid + unique role gid, mode 2750
 * bind dir: OWNER uid + unique role gid, mode 3770 (setgid + sticky).
 * A worker may create its own socket but cannot delete the OWNER HMAC.
 * all sockets: mode 0660; role-scoped HMAC files: owner uid, mode 0640
 *
 * The sticky, owner-owned bind directory contains ONLY worker bind.sock
 * and an owner-created role-scoped HMAC file. Without the sticky bit or
 * owner directory ownership, a compromised worker could unlink/replace
 * that owner file regardless of the file's 0640 permissions. No Gemini/Engineer/Rust keys may
 * ever be placed in any group-readable or worker-writable location.
 *
 * A structurally correct layout is NOT proof of peer credentials,
 * HMAC authority, native Rust role DID, process isolation or readiness
 * for paid Gemini. The production transport is not switched by this module.
 */
import {lstat,realpath,readdir,readFile} from "node:fs/promises";
import {dirname,basename,resolve,isAbsolute} from "node:path";

const ROLES=new Set(["backend","frontend","test"]);
const CHANNELS=["model","stage","bind"];
const DENY="Disposable original role-scoped IPC permissions NO-GO";
const deny=()=>{throw Error(DENY);};
const exact=(x,keys)=>!!x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join(",")===keys.slice().sort().join(",");
const uid=x=>Number.isSafeInteger(x)&&x>0;
const pathOk=x=>typeof x==="string"&&isAbsolute(x)&&
 resolve(x)===x&&!x.includes("\0")&&x.length<=240;
const unixSocket=x=>pathOk(x)&&x.length<=95;
const statOk=(v,kind,uidExpected,gidExpected,modeExpected)=>{
 return exact(v,["kind","uid","gid","mode","nlink"])&&
  v.kind===kind&&v.uid===uidExpected&&v.gid===gidExpected&&
  v.mode===modeExpected&&v.nlink>=1&&
  (kind!=="file"||v.nlink===1);
};

/**
 * Pure, fully checkable contract. All input is untrusted; a success is
 * ONLY a proposed permission layout, not a kernel/peer assertion.
 */
export function evaluateDisposableOriginalScopedIpcPermissions({
 role,ownerUid,workerUid,ownerPrimaryGid,workerPrimaryGid,
 roleGid,ownerGroups,workerGroups,channels,ownerPrivate
}={}){
 if(!ROLES.has(role)||![ownerUid,workerUid,ownerPrimaryGid,
     workerPrimaryGid,roleGid].every(uid)||
    !Array.isArray(ownerGroups)||!Array.isArray(workerGroups)||
    !ownerGroups.every(uid)||!workerGroups.every(uid)||
    !exact(channels,CHANNELS)||
    !exact(ownerPrivate,["directory","keyFile"]))deny();

 const conditions={};
 conditions.distinctUnprivilegedUids=ownerUid!==workerUid;
 conditions.distinctRolePrimaryGroup=workerPrimaryGid===roleGid&&
  roleGid!==ownerPrimaryGid;
 conditions.ownerHasScopedGroup=ownerGroups.includes(roleGid);
 conditions.workerHasNoOtherSupplementaryGroups=
  workerGroups.every(g=>g===roleGid);
 const usedDirectories=new Set(),usedFiles=new Set();

 for(const channel of CHANNELS){
  const entry=channels[channel];
  if(!exact(entry,["directory","secretFile","socket"]))deny();
  const {directory,secretFile,socket}=entry;
  for(const component of [directory,secretFile,socket])
   if(!exact(component,["path","stat"]))deny();
  if(!pathOk(directory.path)||!pathOk(secretFile.path)||
     !unixSocket(socket.path)||dirname(socket.path)!==directory.path||
     dirname(secretFile.path)!==directory.path||
     directory.path===secretFile.path||
     directory.path===socket.path||
     socket.path===secretFile.path)deny();
  usedDirectories.add(directory.path);
  usedFiles.add(secretFile.path);usedFiles.add(socket.path);
  const socketUid=channel==="bind"?workerUid:ownerUid;
  // The directory must always be owned by the OWNER. If the worker owns
  // it, sticky mode cannot protect the owner's HMAC from unlink/rename.
  conditions[channel+"Directory"]=statOk(directory.stat,"directory",
   ownerUid,roleGid,channel==="bind"?0o3770:0o2750);
  conditions[channel+"Socket"]=statOk(socket.stat,"socket",
   socketUid,roleGid,0o660);
  conditions[channel+"HmacSecret"]=statOk(secretFile.stat,"file",
   ownerUid,roleGid,0o640);
 }
 conditions.uniqueChannels=usedDirectories.size===3&&usedFiles.size===6;
 const priv=ownerPrivate;
 if(!exact(priv.directory,["path","stat"])||
    !exact(priv.keyFile,["path","stat"])||
    !pathOk(priv.directory.path)||!pathOk(priv.keyFile.path)||
    dirname(priv.keyFile.path)!==priv.directory.path)deny();
 conditions.ownerKeyDirectoryPrivate=statOk(
  priv.directory.stat,"directory",ownerUid,ownerPrimaryGid,0o700);
 conditions.ownerKeyFilePrivate=statOk(
  priv.keyFile.stat,"file",ownerUid,ownerPrimaryGid,0o600);
 conditions.ownerPrivateSeparate=!usedDirectories.has(priv.directory.path)&&
  !usedFiles.has(priv.keyFile.path)&&
  [...usedDirectories].every(d=>!d.startsWith(priv.directory.path+"/")&&
   !priv.directory.path.startsWith(d+"/"));
 const layoutPotentiallyUsable=Object.values(conditions).every(x=>x===true);
 return Object.freeze({
  role,layoutPotentiallyUsable,
  conditions:Object.freeze(conditions),
  // Never infer isolation or a Rust signature from Unix file metadata.
  ownerCredentialsProtectedFromWorkerVerified:false,
  nativeRustRoleSignerVerified:false,
  osIsolationVerified:false,
  paidGeminiAdmission:false
 });
}

/**
 * Owner-only aggregate validation: three specialists mean three DIFFERENT
 * unprivileged UIDs and three DIFFERENT role GIDs. An individual channel
 * audit would otherwise miss cross-role group reuse or aliasing.
 *
 * This function is a pure contract, NOT authorization and NOT evidence
 * that any OS process/mount exists. A privileged launcher must later call
 * the real lstat/proc inspectors on each live PID and reconcile all three.
 */
export function evaluateDisposableOriginalThreeRoleIpcPermissions({
 workers
}={}){
 if(!exact(workers,["backend","frontend","test"]))deny();
 const audits={};
 const identities=[],roleGids=[],directories=[],secretAndSocketPaths=[];
 const ownerUids=[],ownerPrimaryGids=[],ownerPrivateKeyPaths=[];
 for(const role of ["backend","frontend","test"]){
  const info=workers[role];
  if(!info||typeof info!=="object"||info.role!==role)deny();
  audits[role]=evaluateDisposableOriginalScopedIpcPermissions(info);
  identities.push(info.workerUid);roleGids.push(info.roleGid);
  ownerUids.push(info.ownerUid);ownerPrimaryGids.push(info.ownerPrimaryGid);
  ownerPrivateKeyPaths.push(info.ownerPrivate.keyFile.path);
  for(const channel of CHANNELS){
   directories.push(info.channels[channel].directory.path);
   secretAndSocketPaths.push(info.channels[channel].secretFile.path,
    info.channels[channel].socket.path);
  }
 }
 const conditions=Object.freeze({
  eachRolePermissionLayout:CHANNELS.length===3&&
   Object.values(audits).every(a=>a.layoutPotentiallyUsable),
  oneOwnerUid:new Set(ownerUids).size===1,
  oneOwnerPrimaryGid:new Set(ownerPrimaryGids).size===1,
  threeDistinctWorkerUids:new Set(identities).size===3,
  threeDistinctWorkerGroups:new Set(roleGids).size===3,
  threeOwnerPrivateKeyPathsConsistent:
   new Set(ownerPrivateKeyPaths).size===1,
  nineSeparateChannelDirectories:new Set(directories).size===9,
  eighteenSeparateChannelPaths:
   new Set(secretAndSocketPaths).size===18
 });
 return Object.freeze({
  status:Object.values(conditions).every(Boolean)?
   "three_role_layout_well_formed_not_kernel_attestation":
   "three_role_layout_no_go",
  conditions,
  layouts:Object.freeze(audits),
  threeRoleLayoutPotentiallyUsable:Object.values(conditions).every(Boolean),
  // No proof of Rust identities, peer credentials or owner key isolation.
  signedOriginalRootVerified:false,
  kernelNamespaceIsolationVerified:false,
  paidGeminiAdmission:false
 });
}

const kernelStat=async path=>{
 const st=await lstat(path);
 const kind=st.isSymbolicLink()?"symlink":st.isDirectory()?"directory":
  st.isSocket()?"socket":st.isFile()?"file":"other";
 return Object.freeze({
  kind,uid:st.uid,gid:st.gid,mode:st.mode&0o7777,nlink:st.nlink
 });
};
const readProcNumbers=(status,label)=>{
 if(typeof status!=="string")deny();
 const match=status.match(new RegExp("^"+label+":\\s*([^\\n]*)$","mu"));
 if(!match)deny();
 const values=match[1].trim();
 if(values==="")return [];
 const parts=values.split(/\s+/u);
 if(!parts.every(x=>/^(0|[1-9][0-9]*)$/u.test(x)))deny();
 const numbers=parts.map(Number);
 if(!numbers.every(Number.isSafeInteger))deny();
 return numbers;
};
const getChannel=async ({socketPath,secretFile})=>{
 if(!unixSocket(socketPath)||!pathOk(secretFile)||
    dirname(socketPath)!==dirname(secretFile))deny();
 const directory=dirname(socketPath);
 if(await realpath(directory)!==directory)deny();
 const entries=await readdir(directory);
 // Two names, no unknown files/keys. The owner may not accidentally
 // place a protected Gemini key in a worker-group-readable directory.
 if(entries.length!==2||
    !entries.includes(basename(socketPath))||
    !entries.includes(basename(secretFile)))deny();
 return {
  directory:{path:directory,stat:await kernelStat(directory)},
  socket:{path:socketPath,stat:await kernelStat(socketPath)},
  secretFile:{path:secretFile,stat:await kernelStat(secretFile)}
 };
};

/**
 * Read-only owner-side inspection of a privileged launcher's directory
 * metadata. Does not change permissions or authorize an IPC operation.
 * The caller MUST separately verify the actual Linux PID and mount
 * namespace boundary against the owner process (R7 linux boundary audit).
 */
export async function inspectDisposableOriginalScopedIpcPermissions({
 role,workerPid,ownerPrivateDirectory,ownerPrivateKeyFile,
 modelSocketPath,modelSecretFile,stageSocketPath,stageSecretFile,
 bindSocketPath,bindSecretFile
}={}){
 if(process.platform!=="linux"||!ROLES.has(role)||
    !Number.isSafeInteger(workerPid)||workerPid<=1||
    workerPid===process.pid||
    !pathOk(ownerPrivateDirectory)||!pathOk(ownerPrivateKeyFile))deny();
 try{
  const [owner,worker]=await Promise.all([
   readFile("/proc/"+process.pid+"/status","utf8"),
   readFile("/proc/"+workerPid+"/status","utf8")
  ]);
  const ownerUid=readProcNumbers(owner,"Uid"),
    workerUid=readProcNumbers(worker,"Uid"),
    ownerGid=readProcNumbers(owner,"Gid"),
    workerGid=readProcNumbers(worker,"Gid");
  if(ownerUid.length!==4||workerUid.length!==4||
     ownerGid.length!==4||workerGid.length!==4||
     ownerUid.some(v=>v!==ownerUid[0])||
     workerUid.some(v=>v!==workerUid[0])||
     ownerGid.some(v=>v!==ownerGid[0])||
     workerGid.some(v=>v!==workerGid[0])||
     readProcNumbers(owner,"Pid")[0]!==process.pid||
     readProcNumbers(worker,"Pid")[0]!==workerPid||
     readProcNumbers(worker,"PPid")[0]!==process.pid)deny();
  const channels={
   model:await getChannel({socketPath:modelSocketPath,
    secretFile:modelSecretFile}),
   stage:await getChannel({socketPath:stageSocketPath,
    secretFile:stageSecretFile}),
   bind:await getChannel({socketPath:bindSocketPath,
    secretFile:bindSecretFile})
  };
  const ownerPrivate={
   directory:{path:ownerPrivateDirectory,
    stat:await kernelStat(ownerPrivateDirectory)},
   keyFile:{path:ownerPrivateKeyFile,
    stat:await kernelStat(ownerPrivateKeyFile)}
  };
  if(await realpath(ownerPrivateDirectory)!==ownerPrivateDirectory)deny();
  return evaluateDisposableOriginalScopedIpcPermissions({
   role,ownerUid:ownerUid[0],workerUid:workerUid[0],
   ownerPrimaryGid:ownerGid[0],workerPrimaryGid:workerGid[0],
   roleGid:channels.model.directory.stat.gid,
   ownerGroups:readProcNumbers(owner,"Groups"),
   workerGroups:readProcNumbers(worker,"Groups"),
   channels,ownerPrivate
  });
 }catch{deny();}
}
