import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {readFile,writeFile,readdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
const MAGIC=Buffer.from("DRE1");
function key(hex){
 if(typeof hex!=="string"||! /^[a-f0-9]{64}$/iu.test(hex))throw Error("Evidence key must be 32 random bytes encoded as hex");
 return Buffer.from(hex,"hex");
}
export function seal(bytes,hex){
 const nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(hex),nonce);
 cipher.setAAD(MAGIC);
 const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return Buffer.concat([MAGIC,nonce,cipher.getAuthTag(),encrypted]);
}
export function unseal(bytes,hex){
 if(bytes.length<32||!bytes.subarray(0,4).equals(MAGIC))throw Error("Invalid evidence envelope");
 const cipher=createDecipheriv("aes-256-gcm",key(hex),bytes.subarray(4,16));
 cipher.setAAD(MAGIC);cipher.setAuthTag(bytes.subarray(16,32));
 return Buffer.concat([cipher.update(bytes.subarray(32)),cipher.final()]);
}
// Exact allowlist: never collect arbitrary Runner directories or service logs.
export async function sealDirectory(directory,output,hex){
 key(hex);
 const bundles=[];let total=0;
 for(const entry of await readdir(directory,{withFileTypes:true})){
  if(!entry.isDirectory()||!/^failure-[A-Za-z0-9]+$/u.test(entry.name))continue;
  const files={};
  for(const name of ["manifest.json","source.tar.gz","runner.log"]){
   const bytes=await readFile(join(directory,entry.name,name));
   total+=bytes.length;if(total>128*1024*1024)throw Error("Evidence exceeds bounded upload size");
   files[name]=bytes.toString("base64");
  }
  bundles.push({name:entry.name,files});
 }
 if(!bundles.length)return false;
 await writeFile(output,seal(Buffer.from(JSON.stringify({schema:"runner-evidence-bundle-v1",bundles})),hex),{mode:0o600,flag:"wx"});
 return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await sealDirectory(process.argv[2],process.argv[3],process.env.RUNNER_EVIDENCE_KEY_HEX);}
 catch{process.stderr.write("Private evidence sealing failed; no plaintext upload permitted.\n");process.exitCode=1;}
}
