#!/usr/bin/env node
/**
 * R5 public-status verifier, executed only by a protected human operator.
 * Reads Rust public artifacts, authenticates a separately pinned issuer JWK,
 * and queries a separately pinned EVM registry. No Gateway / Adapter bearer.
 * One bit, one block; not issuance completeness, chain finality or R5 GO.
 */
import {constants} from "node:fs";
import {open,lstat,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname,join,resolve,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {observeR5IndependentEvmStatus}
  from "./r5-independent-status-evm-verifier.mjs";

const ADDR=/^0x[0-9a-fA-F]{40}$/u;
const CHAIN=/^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const CONFIG_FIELDS=[
 "schema","rpc_url","expected_chain_id","registry_address",
 "issuer_address","issuer_did","status_list_credential",
 "status_list_index","public_artifact_root","issuer_public_jwk_file"
].sort().join(",");
function deny(){throw Error("R5 protected independent Ethereum verification NO-GO");}
function pathOk(x){return typeof x==="string"&&isAbsolute(x)&&
  x.length<512&&resolve(x)===x;}
async function directory(path,ownerOnly=false){
  if(!pathOk(path))deny();
  try{
    const stat=await lstat(path);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
       await realpath(path)!==path||
       (ownerOnly&&((stat.mode&0o777)!==0o700||
         (typeof process.getuid==="function"&&stat.uid!==process.getuid()))))
      deny();
  }catch{deny();}
}
async function file(path,max,ownerOnly=false){
  if(!pathOk(path))deny();
  await directory(dirname(path),ownerOnly);
  let fd;
  try{
    fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|
      constants.O_NONBLOCK);
    const stat=await fd.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>max||
       (ownerOnly&&((stat.mode&0o777)!==0o600||
         (typeof process.getuid==="function"&&stat.uid!==process.getuid()))))
      deny();
    return await fd.readFile("utf8");
  }catch{deny();}finally{if(fd)await fd.close();}
}
function publicJwtFilename(issuerDid,url){
  // Mirrors Rust FilePublicArtifactStore::key length-prefixed SHA256.
  const h=createHash("sha256");
  for(const item of [issuerDid,url]){
    const data=Buffer.from(item,"utf8"),size=Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(data.length));
    h.update(size).update(data);
  }
  return h.digest("hex")+".jwt";
}
export async function observeProtectedR5PublicEvmStatus({
  configPath,expectedChainId,expectedRegistryAddress,
  expectedIssuerDid,expectedStatusListUrl,expectedIndex,fetchFn=fetch
}={}){
  if(process.env.GITHUB_ACTIONS==="true"||
     !CHAIN.test(expectedChainId??"")||!ADDR.test(expectedRegistryAddress??"")||
     typeof expectedIssuerDid!=="string"||
     typeof expectedStatusListUrl!=="string"||
     !Number.isSafeInteger(expectedIndex)||expectedIndex<0)
    deny();
  let config;
  try{config=JSON.parse(await file(configPath,8192,true));}
  catch{deny();}
  if(!config||typeof config!=="object"||Array.isArray(config)||
     Object.getPrototypeOf(config)!==Object.prototype||
     Object.keys(config).sort().join(",")!==CONFIG_FIELDS||
     config.schema!=="r5-independent-evm-public-status-v1"||
     config.expected_chain_id!==expectedChainId||
     config.registry_address!==expectedRegistryAddress||
     config.issuer_did!==expectedIssuerDid||
     config.status_list_credential!==expectedStatusListUrl||
     config.status_list_index!==expectedIndex)
    deny();
  await directory(config.public_artifact_root);
  const statusDir=join(config.public_artifact_root,"status-lists");
  await directory(statusDir);
  // Public source is UNTRUSTED; signature, chain hash and bit are rechecked.
  const signedStatusJwt=await file(join(statusDir,
    publicJwtFilename(expectedIssuerDid,expectedStatusListUrl)),1024*1024);
  let issuerPublicJwk;
  try{issuerPublicJwk=JSON.parse(
    await file(config.issuer_public_jwk_file,8192,true));}
  catch{deny();}
  return observeR5IndependentEvmStatus({
    rpcUrl:config.rpc_url,expectedChainId,
    registryAddress:expectedRegistryAddress,
    issuerAddress:config.issuer_address,
    issuerDid:expectedIssuerDid,
    statusListCredential:expectedStatusListUrl,
    statusListIndex:expectedIndex,
    signedStatusJwt,issuerPublicJwk,fetchFn
  });
}
if(process.argv[1]&&import.meta.url===
  pathToFileURL(resolve(process.argv[1])).href){
  try{
    const r=await observeProtectedR5PublicEvmStatus({
      configPath:process.env.DELEGATION_R5_INDEPENDENT_EVM_CONFIG,
      expectedChainId:process.env.DELEGATION_R5_EXPECTED_CHAIN_ID,
      expectedRegistryAddress:process.env.DELEGATION_R5_EXPECTED_REGISTRY_ADDRESS,
      expectedIssuerDid:process.env.DELEGATION_R5_EXPECTED_ISSUER_DID,
      expectedStatusListUrl:process.env.DELEGATION_R5_EXPECTED_STATUS_LIST_ID,
      expectedIndex:Number(process.env.DELEGATION_R5_EXPECTED_STATUS_INDEX)
    });
    process.stdout.write("R5 independent public JWT, EVM commitment and revoked bit "+
      "verified; independent finality and full issuance NOT proven; R5 GO: NO\n");
  }catch{
    process.stderr.write("R5 protected independent Ethereum verification NO-GO\n");
    process.exitCode=1;
  }
}
