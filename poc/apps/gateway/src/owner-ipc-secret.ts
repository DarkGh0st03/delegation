import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {dirname,resolve} from "node:path";

/** Owner-private IPC shared secret: 32 random bytes in lowercase hex. */
function fail(message:string):never{
  throw new Error("Owner IPC secret: "+message);
}

async function ownerDirectory(dir:string):Promise<void>{
  const meta=await lstat(dir);
  if(!meta.isDirectory()||meta.isSymbolicLink()||(meta.mode&0o077)!==0){
    fail("socket and secret must have owner-only parent directories");
  }
}

export async function loadOwnerIpcSecret(file:string):Promise<Buffer>{
  const path=resolve(file);
  await ownerDirectory(dirname(path));
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  let content:string;
  try{
    const meta=await fd.stat();
    if(!meta.isFile()||(meta.mode&0o077)!==0||meta.size<64||meta.size>65){
      fail("invalid owner-only IPC secret file");
    }
    content=await fd.readFile({encoding:"utf8"});
  }finally{await fd.close();}
  if(!/^[a-f0-9]{64}\n?$/u.test(content)){
    fail("secret must be 32 random bytes encoded in lowercase hex");
  }
  return Buffer.from(content.trim(),"hex");
}
