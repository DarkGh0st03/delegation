/**
 * Optional ORIGINAL cross-UID MODEL channel. Free/offline only.
 *
 * A privileged external launcher would need to prepare this exact Linux
 * directory before either endpoint starts:
 *   model dir: owner UID + dedicated specialist role GID, mode 2750
 *   model HMAC: owner UID + role GID, mode 0640, nlink=1
 *   model socket: owner UID + role GID, mode 0660
 *
 * The worker's only capability is this role-scoped HMAC. NEVER put Gemini,
 * Engineer, Rust or GitHub credentials into this directory. This module
 * makes NO chown/chmod of directories, changes NO identity, and asserts NO
 * complete OS isolation or paid-Gemini readiness. Native Root/Child/Task
 * admission is still separately required for EVERY model invocation.
 */
import {constants} from "node:fs";
import {open,lstat,realpath,readdir} from "node:fs/promises";
import {dirname,basename,isAbsolute,resolve} from "node:path";

const ROLES=new Set(["backend","frontend","test"]);
const HEX=/^[a-f0-9]{64}$/u;
const DENY="Disposable original scoped model IPC NO-GO";
const deny=()=>{throw Error(DENY);};
const exact=(x,keys)=>!!x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join(",")===keys.slice().sort().join(",");
const validUid=x=>Number.isSafeInteger(x)&&x>0;
const pathValid=x=>typeof x==="string"&&isAbsolute(x)&&
 resolve(x)===x&&!x.includes("\0")&&x.length<=240;

/**
 * Evaluate a claimed role scope for the actual process identity. Passing
 * this simple check is NOT positive isolation evidence: the caller still
 * needs a kernel audit, mount isolation, native Rust DID and signed Child.
 */
export function assessOriginalScopedModelRoleProcess({
 role,scope,side,actualUid,actualPrimaryGid,actualGroups
}={}){
 if(process.platform!=="linux"||
    !ROLES.has(role)||
    !exact(scope,["role","ownerUid","workerUid","roleGid"])||
    !ROLES.has(scope.role)||scope.role!==role||
    ![scope.ownerUid,scope.workerUid,scope.roleGid,
      actualUid,actualPrimaryGid].every(validUid)||
    scope.ownerUid===scope.workerUid||
    !["owner","worker"].includes(side)||
    !Array.isArray(actualGroups)||
    !actualGroups.every(validUid))deny();
 const groups=new Set([actualPrimaryGid,...actualGroups]);
 const expectedUid=side==="owner"?scope.ownerUid:scope.workerUid;
 const groupAllowed=side==="owner"?
  groups.has(scope.roleGid):
  actualPrimaryGid===scope.roleGid&&
   [...groups].every(g=>g===scope.roleGid);
 const matches=actualUid===expectedUid&&groupAllowed;
 return Object.freeze({
  role,side,matches,
  // Never upgrade claimed metadata to authorization or a security verdict.
  osIsolationVerified:false,paidGeminiAdmission:false
 });
}
function actualIdentity(){
 if(typeof process.getuid!=="function"||
    typeof process.getgid!=="function"||
    typeof process.getgroups!=="function")deny();
 return {actualUid:process.getuid(),actualPrimaryGid:process.getgid(),
  actualGroups:process.getgroups()};
}
function assessIdentity(role,scope,side){
 const audit=assessOriginalScopedModelRoleProcess({
  role,scope,side,...actualIdentity()
 });
 if(audit.matches!==true)deny();
}
async function validateNames(socketPath,secretFile){
 if(!pathValid(socketPath)||socketPath.length>94||
    !pathValid(secretFile)||socketPath===secretFile||
    dirname(socketPath)!==dirname(secretFile)||
    basename(socketPath)===basename(secretFile))deny();
 const dir=dirname(socketPath),st=await lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||
    await realpath(dir)!==dir)deny();
 const contents=await readdir(dir);
 if(!contents.includes(basename(secretFile))||
    contents.some(name=>name!==basename(secretFile)&&
     name!==basename(socketPath))||
    contents.length<1||contents.length>2)deny();
 return {dir,dirStat:st};
}
async function validDirectory(scope,socketPath,secretFile){
 const v=await validateNames(socketPath,secretFile);
 if(v.dirStat.uid!==scope.ownerUid||
    v.dirStat.gid!==scope.roleGid||
    (v.dirStat.mode&0o7777)!==0o2750)deny();
 return v;
}
/**
 * Real path and FD metadata validation, with O_NOFOLLOW for the ONLY
 * HMAC secret being read. Caller must supply a trusted role/UID pin.
 */
export async function readOriginalScopedModelSecret({
 role,scope,side,socketPath,secretFile
}={}){
 assessIdentity(role,scope,side);
 await validDirectory(scope,socketPath,secretFile);
 const fd=await open(secretFile,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
     st.uid!==scope.ownerUid||st.gid!==scope.roleGid||
     (st.mode&0o7777)!==0o640||st.size<64||st.size>65)deny();
  const raw=await fd.readFile("utf8");
  if(!/^[a-f0-9]{64}\n?$/u.test(raw))deny();
  return Buffer.from(raw.trim(),"hex");
 }finally{await fd.close();}
}
/**
 * Called AFTER listen()+chmod for the trusted owner; called BEFORE any
 * worker model requests. No permission is granted by this check.
 */
export async function assertOriginalScopedModelSocket({
 role,scope,side,socketPath,secretFile
}={}){
 assessIdentity(role,scope,side);
 await validDirectory(scope,socketPath,secretFile);
 const st=await lstat(socketPath);
 if(!st.isSocket()||st.isSymbolicLink()||
    st.uid!==scope.ownerUid||st.gid!==scope.roleGid||
    (st.mode&0o7777)!==0o660)deny();
 return true;
}
