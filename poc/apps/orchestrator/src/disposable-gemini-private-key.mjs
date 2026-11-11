/**
 * Zero-inference, owner-only secret-file boundary for experimental Gemini.
 * Never expose this helper to HTTP, ADK FunctionTool, A2A, MCP, or Docker.
 *
 * The operator must provision an absolute, private OS file OUTSIDE the git
 * checkout, under a private (0700) non-symlink directory. The file must be
 * owned by the process user, have no group/other permissions and one link.
 *
 * This protects the filesystem boundary; it is NOT process isolation, a
 * billing limit or evidence that the owner reviewed/signed anything.
 */
import {constants} from "node:fs";
import {open,lstat,realpath} from "node:fs/promises";
import {dirname,isAbsolute,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";

const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
const ISSUED_KEYS=new WeakMap();
const deny=()=>{throw Error("Protected disposable Gemini credential NO-GO");};
const owned=stat=>typeof process.getuid==="function"&&
 stat.uid===process.getuid();
function allowedPath(path){
 return typeof path==="string"&&path.length<=4096&&isAbsolute(path)&&
  resolve(path)===path&&path!==SOURCE_ROOT&&
  !path.startsWith(SOURCE_ROOT+sep);
}

/** Return an opaque, one-use handle; never return the API key to the caller. */
export async function loadProtectedDisposableGeminiKeyFile(filePath){
 if(process.platform!=="linux"||!allowedPath(filePath))deny();
 let handle,bytes;
 try{
  const parent=dirname(filePath);
  const directory=await lstat(parent);
  if(!directory.isDirectory()||directory.isSymbolicLink()||
     (directory.mode&0o077)!==0||!owned(directory)||
     await realpath(parent)!==parent)deny();
  handle=await open(filePath,constants.O_RDONLY|constants.O_NOFOLLOW);
  const st=await handle.stat();
  if(!st.isFile()||st.nlink!==1||!owned(st)||
     (st.mode&0o077)!==0||(st.mode&0o400)===0||
     st.size<10||st.size>4096||
     await realpath(filePath)!==filePath)deny();
  bytes=await handle.readFile();
  if(bytes.length!==st.size)deny();
  // Accept a single final LF (normal secret-file convention), never
  // multiline/space-separated keys or an accidental file dump.
  const key=bytes.toString("utf8").replace(/\n$/u,"");
  if(key.length<10||key.length>4096||/\s/u.test(key)||
     /[^\x21-\x7e]/u.test(key))deny();
  const token=Object.freeze(Object.create(null));
  ISSUED_KEYS.set(token,key);
  return token;
 }catch{deny();}
 finally{
  bytes?.fill(0);
  await handle?.close();
 }
}

/** Consuming an opaque key handle is one-way, even if model assembly fails. */
export function consumeProtectedDisposableGeminiKey(handle){
 const key=handle&&typeof handle==="object"?ISSUED_KEYS.get(handle):undefined;
 if(typeof key!=="string")deny();
 ISSUED_KEYS.delete(handle);
 return key;
}
