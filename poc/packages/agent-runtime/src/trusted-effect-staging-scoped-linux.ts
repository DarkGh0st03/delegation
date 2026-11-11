/**
 * Opt-in, Linux cross-UID file boundary for the ORIGINAL R322 private
 * stage/bind IPC. No chmod/chown, new signer, network listener or paid API.
 *
 * Stage socket directory: owner UID / dedicated role GID / mode 2750.
 * Bind socket directory: OWNER UID / dedicated role GID / mode 3770
 * (setgid + sticky; worker can create its own socket but cannot unlink
 * the owner's HMAC file). Bind socket itself stays worker-owned.
 * Both HMAC files: owner UID / role GID / mode 0640, nlink=1.
 * Both sockets: server UID / role GID / mode 0660.
 *
 * These are necessary Unix file access checks. HMAC proves a role-scoped
 * channel, not an original signed Child/Task, Rust DID or mount isolation.
 * Default R322 transports remain 0700/0600 unless explicitly opted in.
 */
import {constants} from "node:fs";
import {open,lstat,readdir,realpath} from "node:fs/promises";
import {basename,dirname,isAbsolute,resolve} from "node:path";

type Role="backend"|"frontend"|"test";
type Channel="stage"|"bind";
type Side="owner"|"worker";
export type TrustedOriginalScopedEffectRole=Readonly<{
 role:Role;ownerUid:number;workerUid:number;roleGid:number
}>;
const NO_GO="Trusted original scoped effect IPC NO-GO";
const deny=():never=>{throw Error(NO_GO);};
const valid=(n:unknown):n is number=>
 Number.isSafeInteger(n)&&typeof n==="number"&&n>0;
const exact=(v:unknown,keys:string[]):boolean=>
 !!v&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join(",")===keys.slice().sort().join(",");
const pathValid=(p:unknown):p is string=>
 typeof p==="string"&&isAbsolute(p)&&resolve(p)===p&&
 !p.includes("\0")&&p.length<=240;

/** Pure identity check for negative and synthetic tests. NEVER a native
 * process-isolation attestation. */
export function assessTrustedOriginalScopedEffectIdentity({
 channel,side,scope,actualUid,actualPrimaryGid,actualGroups
}:{
 channel:Channel;side:Side;scope:TrustedOriginalScopedEffectRole;
 actualUid:number;actualPrimaryGid:number;actualGroups:number[]
}){
 if(process.platform!=="linux"||
    !["stage","bind"].includes(channel)||
    !["owner","worker"].includes(side)||
    !exact(scope,["ownerUid","role","roleGid","workerUid"])||
    !["backend","frontend","test"].includes(scope.role)||
    ![scope.ownerUid,scope.workerUid,scope.roleGid,actualUid,
      actualPrimaryGid].every(valid)||
    scope.ownerUid===scope.workerUid||
    !Array.isArray(actualGroups)||
    !actualGroups.every(valid))deny();
 const groups=new Set([actualPrimaryGid,...actualGroups]);
 const allowed=side==="owner"?
  groups.has(scope.roleGid):
  actualPrimaryGid===scope.roleGid&&
   [...groups].every(g=>g===scope.roleGid);
 return Object.freeze({
  matches:actualUid===(side==="owner"?scope.ownerUid:
   scope.workerUid)&&allowed,
  signedTaskVerified:false,osIsolationVerified:false
 });
}
function actualIdentity(){
 if(typeof process.getuid!=="function"||
    typeof process.getgid!=="function"||
    typeof process.getgroups!=="function")deny();
 return {
  actualUid:process.getuid(),actualPrimaryGid:process.getgid(),
  actualGroups:process.getgroups()
 };
}
function assertIdentity(channel:Channel,side:Side,
 scope:TrustedOriginalScopedEffectRole){
 const check=assessTrustedOriginalScopedEffectIdentity({
  channel,side,scope,...actualIdentity()
 });
 if(!check.matches)deny();
}
function validLocations(socket:string,secret:string){
 if(!pathValid(socket)||socket.length>95||
    !pathValid(secret)||socket===secret||
    dirname(socket)!==dirname(secret))deny();
 return dirname(socket);
}
async function checkedDir(channel:Channel,
 scope:TrustedOriginalScopedEffectRole,
 socketPath:string,secretFile:string){
 const dir=validLocations(socketPath,secretFile);
 const d=await lstat(dir);
 const mode=channel==="stage"?0o2750:0o3770;
 if(!d.isDirectory()||d.isSymbolicLink()||
    d.uid!==scope.ownerUid||d.gid!==scope.roleGid||
    (d.mode&0o7777)!==mode||
    await realpath(dir)!==dir)deny();
 const names=await readdir(dir);
 if(!names.includes(basename(secretFile))||
    names.some(n=>n!==basename(secretFile)&&
      n!==basename(socketPath))||
    names.length>2)deny();
 return dir;
}
/** Call before binding socket, and again immediately before listen(). */
export async function assertTrustedOriginalScopedEffectDirectory({
 channel,side,scope,socketPath,secretFile
}:{
 channel:Channel;side:Side;scope:TrustedOriginalScopedEffectRole;
 socketPath:string;secretFile:string
}){
 assertIdentity(channel,side,scope);
 await checkedDir(channel,scope,socketPath,secretFile);
}
/** Loads ONLY an owner-supplied dedicated role HMAC file. Never a
 * provider/Engineer/Rust key. FD O_NOFOLLOW and inode ownership are pinned. */
export async function loadTrustedOriginalScopedEffectSecret({
 channel,side,scope,socketPath,secretFile
}:{
 channel:Channel;side:Side;scope:TrustedOriginalScopedEffectRole;
 socketPath:string;secretFile:string
}){
 await assertTrustedOriginalScopedEffectDirectory({
  channel,side,scope,socketPath,secretFile
 });
 const fd=await open(secretFile,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await fd.stat();
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
     stat.uid!==scope.ownerUid||stat.gid!==scope.roleGid||
     (stat.mode&0o7777)!==0o640||
     stat.size<64||stat.size>65)deny();
  const text=await fd.readFile("utf8");
  if(!/^[a-f0-9]{64}\n?$/u.test(text))deny();
  return Buffer.from(text.trim(),"hex");
 }finally{await fd.close();}
}
export async function assertTrustedOriginalScopedEffectSocket({
 channel,side,scope,socketPath,secretFile
}:{
 channel:Channel;side:Side;scope:TrustedOriginalScopedEffectRole;
 socketPath:string;secretFile:string
}){
 await assertTrustedOriginalScopedEffectDirectory({
  channel,side,scope,socketPath,secretFile
 });
 const stat=await lstat(socketPath);
 const serverUid=channel==="stage"?scope.ownerUid:scope.workerUid;
 if(!stat.isSocket()||stat.isSymbolicLink()||
    stat.uid!==serverUid||stat.gid!==scope.roleGid||
    (stat.mode&0o7777)!==0o660)deny();
}
