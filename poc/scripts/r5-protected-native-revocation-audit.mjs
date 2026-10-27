#!/usr/bin/env node
/**
 * R5 OWNER ONLY: read protected original-owner completion, explicit issuance
 * inventory and Gateway verifier bearer, then query live native Adapter.
 *
 * This is a read-only observation of Adapter-reported EVM status. Neither
 * a complete issuance journal nor independent chain attestation. NO R5 GO.
 * Never invoke on a GitHub runner, from an A2A tool or in a model prompt.
 */
import {constants} from "node:fs";
import {open,lstat,realpath} from "node:fs/promises";
import {dirname,isAbsolute,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {observeR5AdapterEvmRevocations,validateR5RevocationInventory}
  from "./r5-native-revocation-observer.mjs";

const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const MAX_JSON=65536;
const CONFIG_FIELDS=[
  "schema","source_sha","github_run_id","adapter_base_url",
  "gateway_verifier_bearer_file"
].sort().join(",");
function deny(){throw Error("R5 protected native revocation audit NO-GO");}
function plain(x){return !!x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;}
function exact(x,fields){return plain(x)&&
  Object.keys(x).sort().join(",")===fields;}
function validPath(path){
  return typeof path==="string"&&isAbsolute(path)&&
    path.length<512&&resolve(path)===path;
}
async function assertOwnedDirectory(directory){
  if(!validPath(directory))deny();
  try{
    const s=await lstat(directory);
    if(!s.isDirectory()||s.isSymbolicLink()||
       (s.mode&0o777)!==0o700||
       (typeof process.getuid==="function"&&s.uid!==process.getuid())||
       await realpath(directory)!==directory)deny();
  }catch{deny();}
}
/** Open with NOFOLLOW, reject symlinks/hardlinks/special files and leaks. */
async function protectedText(path,maximum){
  if(!validPath(path)||!Number.isSafeInteger(maximum)||
     maximum<1||maximum>MAX_JSON)deny();
  await assertOwnedDirectory(dirname(path));
  let fd;
  try{
    fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|
      constants.O_NONBLOCK);
    const s=await fd.stat();
    if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||
       s.size<1||s.size>maximum||
       (typeof process.getuid==="function"&&s.uid!==process.getuid()))
      deny();
    return await fd.readFile("utf8");
  }catch{deny();}
  finally{if(fd)await fd.close();}
}
async function protectedJson(path){
  let parsed;
  try{parsed=JSON.parse(await protectedText(path,MAX_JSON));}
  catch{deny();}
  if(!plain(parsed))deny();
  return parsed;
}
/**
 * Immutable operator pins must be provided separately from any local
 * receipt or inventory. The protected config is not authorization.
 * The fetch seam exists ONLY for local offline unit tests.
 */
export async function observeProtectedR5NativeRevocations({
  configPath,evidenceDirectory,inventoryDirectory,
  expectedSourceSha,expectedRunId,fetchFn=fetch
}={}){
  if(process.env.GITHUB_ACTIONS==="true"||
     !SHA.test(expectedSourceSha??"")||!RUN.test(expectedRunId??""))
    deny();
  const config=await protectedJson(configPath);
  if(!exact(config,CONFIG_FIELDS)||
     config.schema!=="r5-native-revocation-audit-config-v1"||
     config.source_sha!==expectedSourceSha||
     config.github_run_id!==expectedRunId)deny();
  await assertOwnedDirectory(evidenceDirectory);
  await assertOwnedDirectory(inventoryDirectory);
  // Never take receipt/inventory filenames from model, job or config fields.
  const evidence=await protectedJson(join(evidenceDirectory,
    "r5-scripted-run-"+expectedRunId+".json"));
  const inventory=await protectedJson(join(inventoryDirectory,
    "r5-issued-credentials-"+expectedRunId+".json"));
  if(inventory.source_sha!==expectedSourceSha||
     inventory.github_run_id!==expectedRunId)deny();
  // Validation happens BEFORE opening the high-value Gateway verifier bearer.
  validateR5RevocationInventory({ownerEvidence:evidence,inventory});
  const token=(await protectedText(
    config.gateway_verifier_bearer_file,512)).trim();
  return observeR5AdapterEvmRevocations({
    ownerEvidence:evidence,inventory,
    adapterBaseUrl:config.adapter_base_url,
    gatewayVerifierToken:token,fetchFn
  });
}
if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  try{
    const result=await observeProtectedR5NativeRevocations({
      configPath:process.env.DELEGATION_R5_REVOCATION_CONFIG,
      evidenceDirectory:process.env.DELEGATION_R5_EVIDENCE_DIRECTORY,
      inventoryDirectory:process.env.DELEGATION_R5_ISSUANCE_INVENTORY_DIRECTORY,
      expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
      expectedRunId:process.env.DELEGATION_R5_EXPECTED_RUN_ID
    });
    process.stdout.write("R5 read-only Adapter EVM status observed for "+
      result.observed_root_count+" roots and "+
      result.observed_task_child_count+
      " supplied children; independently attested: NO; R5 GO: NO\n");
  }catch{
    // No secrets, local paths, credential IDs, private endpoints or tokens.
    process.stderr.write("R5 protected native revocation audit NO-GO\n");
    process.exitCode=1;
  }
}
