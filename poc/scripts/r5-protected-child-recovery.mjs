#!/usr/bin/env node
/**
 * R5 owner-only read-only recovery for potentially issued child DCs.
 * Protected pins, signed Engineer receipt, journal and Gateway bearer
 * are mandatory. No reissue, status mutation, authority grant or R5 GO.
 */
import {constants} from "node:fs";
import {open,lstat,realpath} from "node:fs/promises";
import {dirname,resolve,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {SignedEngineerApprovalFileStore}
  from "../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedChildIssuanceJournal}
  from "../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {observeR5UncertainChildIssuance}
  from "./r5-child-uncertain-reconciliation.mjs";

const SHA=/^[a-f0-9]{40}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FIELDS=[
 "schema","source_sha","session_id","plan_digest",
 "operational_root_id","issuance_journal_directory",
 "engineer_approval_directory","engineer_public_key_file",
 "engineer_did","engineer_key_id","adapter_base_url",
 "gateway_verifier_bearer_file"
].sort().join(",");
function deny(){throw Error("R5 protected uncertain child recovery NO-GO");}
function validPath(p){return typeof p==="string"&&isAbsolute(p)&&
  p.length<512&&resolve(p)===p;}
async function protectedDirectory(path){
  if(!validPath(path))deny();
  try{
    const s=await lstat(path);
    if(!s.isDirectory()||s.isSymbolicLink()||
       (s.mode&0o777)!==0o700||
       (typeof process.getuid==="function"&&s.uid!==process.getuid())||
       await realpath(path)!==path)deny();
  }catch{deny();}
}
async function protectedFile(path,max){
  if(!validPath(path))deny();
  await protectedDirectory(dirname(path));
  let fd;
  try{
    fd=await open(path,constants.O_RDONLY|
      constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const s=await fd.stat();
    if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||
       s.size<1||s.size>max||
       (typeof process.getuid==="function"&&s.uid!==process.getuid()))deny();
    return await fd.readFile("utf8");
  }catch{deny();}finally{if(fd)await fd.close();}
}
function exactConfig(x){return x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).sort().join(",")===FIELDS;}
export async function observeProtectedR5UncertainChildRecovery({
  configPath,expectedSessionId,expectedSourceSha,
  expectedPlanDigest,expectedRootId,fetchFn=fetch
}={}){
  if(process.env.GITHUB_ACTIONS==="true"||
     !ID.test(expectedSessionId??"")||!SHA.test(expectedSourceSha??"")||
     !DIGEST.test(expectedPlanDigest??"")||!ID.test(expectedRootId??""))
    deny();
  let config;
  try{config=JSON.parse(await protectedFile(configPath,8192));}
  catch{deny();}
  if(!exactConfig(config)||
     config.schema!=="r5-owner-uncertain-child-recovery-v1"||
     config.source_sha!==expectedSourceSha||
     config.session_id!==expectedSessionId||
     config.plan_digest!==expectedPlanDigest||
     config.operational_root_id!==expectedRootId||
     typeof config.engineer_did!=="string"||
     !config.engineer_did.startsWith("did:")||
     !ID.test(config.engineer_key_id??""))deny();
  await protectedDirectory(config.engineer_approval_directory);
  const publicKey=await protectedFile(config.engineer_public_key_file,8192);
  const signed=new SignedEngineerApprovalFileStore({
    directory:config.engineer_approval_directory,
    engineerDid:config.engineer_did,
    trustedKeys:{[config.engineer_key_id]:{
      engineer_did:config.engineer_did,public_key_pem:publicKey
    }}
  });
  // The genuine original Engineer signature is checked BEFORE opening
  // the high-value Gateway verifier bearer.
  try{await signed.loadAuthenticatedApproval(expectedSessionId);}
  catch{deny();}
  const journal=new TrustedChildIssuanceJournal({
    directory:config.issuance_journal_directory,
    sessionId:expectedSessionId,baseRevision:expectedSourceSha,
    planDigest:expectedPlanDigest,parentCredentialId:expectedRootId
  });
  if((await journal.records()).length===0)deny();
  const bearer=(await protectedFile(
    config.gateway_verifier_bearer_file,512)).trim();
  return observeR5UncertainChildIssuance({
    journal,approvalStore:signed,sessionId:expectedSessionId,
    baseRevision:expectedSourceSha,planDigestPin:expectedPlanDigest,
    parentCredentialId:expectedRootId,
    adapterBaseUrl:config.adapter_base_url,
    gatewayVerifierToken:bearer,fetchFn
  });
}
if(process.argv[1]&&import.meta.url===
  pathToFileURL(resolve(process.argv[1])).href){
  try{
    const r=await observeProtectedR5UncertainChildRecovery({
      configPath:process.env.DELEGATION_R5_CHILD_RECOVERY_CONFIG,
      expectedSessionId:process.env.DELEGATION_R5_EXPECTED_SESSION_ID,
      expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
      expectedPlanDigest:process.env.DELEGATION_R5_EXPECTED_PLAN_DIGEST,
      expectedRootId:process.env.DELEGATION_R5_EXPECTED_OPERATIONAL_ROOT_ID
    });
    process.stdout.write("R5 read-only child recovery: "+
      r.observed_child_intent_count+" Adapter-reported revoked; "+
      r.uncertain_issuance_count+" issuance attempts still uncertain; "+
      "manual reconciliation required; R5 GO: NO\n");
  }catch{
    // Never print an operational credential ID, bearer, path or status bit.
    process.stderr.write("R5 protected uncertain child recovery NO-GO\n");
    process.exitCode=1;
  }
}
