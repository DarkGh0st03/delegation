/**
 * R5 owner-side PRE-DISPATCH evidence of a unique private runner inventory.
 * This is a 0600 local observation, NOT independent hardware attestation,
 * a GitHub job receipt, a model charge proof or an authorization token.
 * One reviewed source SHA may be pre-pinned only ONCE (no overwrite).
 */
import {constants} from "node:fs";
import {open,lstat,link,unlink} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {isAbsolute,join,resolve} from "node:path";

const SHA=/^[a-f0-9]{40}$/u;
const SCHEMA="r5-private-runner-pre-dispatch-v1";
const MAX_BYTES=4096;
const FIELDS=[
  "schema","status","source_sha","runner_id","observed_at",
  "independent_physical_attestation","external_r5_go"
].sort().join(",");
function deny(){throw Error("R5 pre-dispatch runner pin NO-GO");}
function validSha(sha){return typeof sha==="string"&&SHA.test(sha);}
function validRunner(id){return Number.isSafeInteger(id)&&id>0;}
async function protectedDir(dir){
  if(typeof dir!=="string"||!isAbsolute(dir)||resolve(dir)!==dir)deny();
  try{
    const d=await lstat(dir);
    if(!d.isDirectory()||d.isSymbolicLink()||(d.mode&0o077)!==0||
       (typeof process.getuid==="function"&&d.uid!==process.getuid()))
      deny();
  }catch{deny();}
}
function filename(directory,sha){
  return join(directory,"r5-pre-dispatch-"+sha+".json");
}
function validate(value,sha){
  if(!value||typeof value!=="object"||Array.isArray(value)||
     Object.getPrototypeOf(value)!==Object.prototype||
     Object.keys(value).sort().join(",")!==FIELDS||
     value.schema!==SCHEMA||
     value.status!=="pre_dispatch_owner_inventory_only"||
     value.source_sha!==sha||
     !validRunner(value.runner_id)||
     value.independent_physical_attestation!==false||
     value.external_r5_go!==false||
     typeof value.observed_at!=="string"||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
       .test(value.observed_at)||
     !Number.isFinite(Date.parse(value.observed_at)))
    deny();
  return Object.freeze({...value});
}
export async function persistR5PreDispatchRunnerPin(directory,{
  sourceSha,runnerId
}={}, {nowMs=Date.now()}={}){
  if(!validSha(sourceSha)||!validRunner(runnerId)||
     !Number.isSafeInteger(nowMs)||nowMs<=0||
     !Number.isFinite(new Date(nowMs).getTime()))deny();
  await protectedDir(directory);
  const value=validate({
    schema:SCHEMA,status:"pre_dispatch_owner_inventory_only",
    source_sha:sourceSha,runner_id:runnerId,
    observed_at:new Date(nowMs).toISOString(),
    independent_physical_attestation:false,external_r5_go:false
  },sourceSha);
  const target=filename(directory,sourceSha);
  const temporary=join(directory,".r5-pin-"+randomBytes(16).toString("hex")+".tmp");
  let fd,linked=false;
  try{
    fd=await open(temporary,constants.O_WRONLY|constants.O_CREAT|
      constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await fd.writeFile(JSON.stringify(value)+"\n","utf8");
    await fd.sync();
    await fd.close();fd=undefined;
    await link(temporary,target); // atomic NO-REPLACE (EEXIST is NO-GO)
    linked=true;
    await unlink(temporary);
    const dirfd=await open(directory,constants.O_RDONLY|
      constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await dirfd.sync();}finally{await dirfd.close();}
  }catch{
    if(linked){
      try{
        await unlink(target);
        const d=await open(directory,constants.O_RDONLY|
          constants.O_DIRECTORY|constants.O_NOFOLLOW);
        try{await d.sync();}finally{await d.close();}
      }catch{/* manual reconciliation, NEVER claim a successful pin */}
    }
    deny();
  }finally{
    if(fd)await fd.close();
    try{await unlink(temporary);}catch{/* already removed */}
  }
  return value;
}
/** Load ONLY the original SHA-bound pin: neither GitHub nor workflow inputs
 * can supply a replacement runner ID for this post-run comparison. */
export async function loadR5PreDispatchRunnerPin(directory,sourceSha){
  if(!validSha(sourceSha))deny();
  await protectedDir(directory);
  let fd;
  try{
    fd=await open(filename(directory,sourceSha),
      constants.O_RDONLY|constants.O_NOFOLLOW);
    const s=await fd.stat();
    if(!s.isFile()||(s.mode&0o077)!==0||
       s.size<20||s.size>MAX_BYTES||
       (typeof process.getuid==="function"&&s.uid!==process.getuid()))
      deny();
    const text=await fd.readFile("utf8");
    return validate(JSON.parse(text),sourceSha);
  }catch{deny();}
  finally{if(fd)await fd.close();}
}
