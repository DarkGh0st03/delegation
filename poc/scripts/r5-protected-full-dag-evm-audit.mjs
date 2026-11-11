#!/usr/bin/env node
/**
 * R5 OPERATOR ONLY: full signed DAG public Status List / EVM verifier.
 *
 * Loads original owner-only records and independently pinned issuer public
 * key, then reads UNTRUSTED public JWT artifacts directly from the Rust
 * FilePublicArtifactStore. Does not access Gateway bearer / Adapter, grant
 * authority, issue or revoke any credential, or call a paid model.
 *
 * A valid observation is NOT independent chain finality, root-issuance
 * signature provenance, physical runner identity or complete issuance.
 */
import {constants} from "node:fs";
import {open,lstat,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname,isAbsolute,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {SignedEngineerApprovalFileStore}
  from "../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedChildIssuanceJournal}
  from "../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {TrustedPlanningRecoveryStore}
  from "../packages/orchestrator-runtime/src/trusted-planning-recovery-store.ts";
import {TrustedOperationalRecoveryStore}
  from "../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {observeR5IndependentDagRevocations}
  from "./r5-independent-dag-revocation-audit.mjs";

const SHA=/^[a-f0-9]{40}$/u,RUN=/^[1-9][0-9]{0,19}$/u;
const ADDR=/^0x[a-fA-F0-9]{40}$/u;
const HEX=/^0x(?:0|[1-9a-f][a-f0-9]*)$/u;
const CONFIG_FIELDS=[
  "schema","source_sha","github_run_id","evidence_directory",
  "inventory_directory","approval_directory","engineer_did",
  "engineer_key_id","engineer_public_key_file",
  "planning_recovery_directory","operational_recovery_directory",
  "issuance_journal_directory","root_status_entries_file",
  "public_artifact_root","rpc_url","expected_chain_id",
  "registry_address","issuer_address","issuer_did",
  "issuer_public_jwk_file"
].sort().join(",");
function deny(){throw Error("R5 protected full-DAG EVM audit NO-GO");}
function plain(x){return x!==null&&typeof x==="object"&&
  !Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function pathOk(x){return typeof x==="string"&&isAbsolute(x)&&
  x.length<512&&resolve(x)===x;}
async function directory(path,protectedOwner){
  if(!pathOk(path))deny();
  try{
    const stat=await lstat(path);
    if(!stat.isDirectory()||stat.isSymbolicLink()||
       await realpath(path)!==path||
       (protectedOwner&&((stat.mode&0o777)!==0o700||
         (typeof process.getuid==="function"&&stat.uid!==process.getuid()))))
      deny();
  }catch{deny();}
}
async function file(path,max,protectedOwner){
  if(!pathOk(path)||!Number.isSafeInteger(max)||max<1||
     max>1024*1024)deny();
  await directory(dirname(path),protectedOwner);
  let fd;
  try{
    fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|
      constants.O_NONBLOCK);
    const stat=await fd.stat();
    if(!stat.isFile()||stat.nlink!==1||
       stat.size<1||stat.size>max||
       (protectedOwner&&((stat.mode&0o777)!==0o600||
         (typeof process.getuid==="function"&&stat.uid!==process.getuid()))))
      deny();
    return await fd.readFile("utf8");
  }catch{deny();}finally{if(fd)await fd.close();}
}
async function json(path,max,privateFile=true){
  try{
    const object=JSON.parse(await file(path,max,privateFile));
    if(!plain(object)&&!Array.isArray(object))deny();
    return object;
  }catch{deny();}
}
function publicStatusPath(root,issuerDid,listUrl){
  // Same file identity as Rust FilePublicArtifactStore::key:
  // SHA256(u64be length||UTF8 issuer||u64be length||UTF8 URL).
  const sha=createHash("sha256");
  for(const text of [issuerDid,listUrl]){
    const bytes=Buffer.from(text,"utf8"),length=Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    sha.update(length).update(bytes);
  }
  return join(root,"status-lists",sha.digest("hex")+".jwt");
}
export async function observeProtectedR5FullDagEthereum({
  configPath,expectedSourceSha,expectedRunId,expectedChainId,
  expectedRegistryAddress,expectedIssuerDid,fetchFn=fetch
}={}){
  if(process.env.GITHUB_ACTIONS==="true"||
     !SHA.test(expectedSourceSha??"")||!RUN.test(expectedRunId??"")||
     !HEX.test(expectedChainId??"")||
     !ADDR.test(expectedRegistryAddress??"")||
     typeof expectedIssuerDid!=="string"||
     typeof fetchFn!=="function")deny();
  const cfg=await json(configPath,16384);
  if(!plain(cfg)||Object.keys(cfg).sort().join(",")!==CONFIG_FIELDS||
     cfg.schema!=="r5-owner-full-dag-public-evm-v1"||
     cfg.source_sha!==expectedSourceSha||
     cfg.github_run_id!==expectedRunId||
     cfg.expected_chain_id!==expectedChainId||
     cfg.registry_address!==expectedRegistryAddress||
     cfg.issuer_did!==expectedIssuerDid||
     typeof cfg.engineer_did!=="string"||
     !cfg.engineer_did.startsWith("did:")||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(cfg.engineer_key_id??""))
    deny();
  for(const name of [
    "evidence_directory","inventory_directory","approval_directory",
    "planning_recovery_directory","operational_recovery_directory",
    "issuance_journal_directory"
  ])await directory(cfg[name],true);
  await directory(cfg.public_artifact_root,false);
  await directory(join(cfg.public_artifact_root,"status-lists"),false);
  const ownerEvidence=await json(join(cfg.evidence_directory,
    "r5-scripted-run-"+expectedRunId+".json"),65536);
  const inventory=await json(join(cfg.inventory_directory,
    "r5-issued-credentials-"+expectedRunId+".json"),65536);
  if(inventory?.source_sha!==expectedSourceSha||
     inventory?.github_run_id!==expectedRunId)deny();
  const rootStatusEntries=await json(
    cfg.root_status_entries_file,65536);
  if(!Array.isArray(rootStatusEntries)||rootStatusEntries.length!==2)deny();
  const engineerPublicKey=await file(cfg.engineer_public_key_file,8192,true);
  const issuerPublicJwk=await json(cfg.issuer_public_jwk_file,8192,true);
  const approvalStore=new SignedEngineerApprovalFileStore({
    directory:cfg.approval_directory,engineerDid:cfg.engineer_did,
    trustedKeys:{[cfg.engineer_key_id]:{
      engineer_did:cfg.engineer_did,public_key_pem:engineerPublicKey
    }}
  });
  const planningRecoveryStore=new TrustedPlanningRecoveryStore(
    cfg.planning_recovery_directory);
  const operationalRecoveryStore=new TrustedOperationalRecoveryStore(
    cfg.operational_recovery_directory);
  const issuanceJournal=new TrustedChildIssuanceJournal({
    directory:cfg.issuance_journal_directory,
    sessionId:inventory.session_id,baseRevision:inventory.source_sha,
    planDigest:inventory.approved_plan_digest,
    parentCredentialId:inventory.operational_root_id
  });
  // Every original Host child, including 'issuance_uncertain', contributes
  // its own Status List slot; no ability to select an easier subset.
  const childRecords=await issuanceJournal.records();
  const urls=new Set([
    ...rootStatusEntries.map(r=>r?.status_list_credential),
    ...childRecords.map(r=>r.status_list_credential)
  ]);
  if(urls.size<1||urls.size>130||
     [...urls].some(url=>typeof url!=="string"||
       !/^https:\/\//u.test(url)||url.length>512))deny();
  const publicStatusLists=[];
  for(const url of urls){
    publicStatusLists.push({
      status_list_credential:url,
      signed_status_jwt:await file(publicStatusPath(
        cfg.public_artifact_root,expectedIssuerDid,url),1024*1024,false)
    });
  }
  const result=await observeR5IndependentDagRevocations({
    ownerEvidence,inventory,approvalStore,issuanceJournal,
    planningRecoveryStore,operationalRecoveryStore,
    rootStatusEntries,publicStatusLists,
    chainPins:{
      rpcUrl:cfg.rpc_url,expectedChainId,
      registryAddress:expectedRegistryAddress,
      issuerAddress:cfg.issuer_address,issuerDid:expectedIssuerDid,
      issuerPublicJwk
    },fetchFn
  });
  return Object.freeze({...result,
    public_artifacts_read_directly_from_rust_store:true,
    external_r5_go:false
  });
}
if(process.argv[1]&&import.meta.url===
  pathToFileURL(resolve(process.argv[1])).href){
  try{
    const result=await observeProtectedR5FullDagEthereum({
      configPath:process.env.DELEGATION_R5_FULL_DAG_EVM_CONFIG,
      expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
      expectedRunId:process.env.DELEGATION_R5_EXPECTED_RUN_ID,
      expectedChainId:process.env.DELEGATION_R5_EXPECTED_CHAIN_ID,
      expectedRegistryAddress:process.env.DELEGATION_R5_EXPECTED_REGISTRY_ADDRESS,
      expectedIssuerDid:process.env.DELEGATION_R5_EXPECTED_ISSUER_DID
    });
    process.stdout.write("R5 public same-block status observation: "+
      result.observed_root_count+" known roots, "+
      result.observed_specialized_child_count+" signed Task children; "+
      "chain finality/ledger completeness NOT attested; R5 GO: NO\n");
  }catch{
    // No owner paths, private root IDs, DIDs, raw JWTs or public keys.
    process.stderr.write("R5 protected full-DAG EVM audit NO-GO\n");
    process.exitCode=1;
  }
}
