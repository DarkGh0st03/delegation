/**
 * CI-ONLY, non-billable simulated Engineer decision for the ORIGINAL
 * authority-only Planning checkpoint and Review Host approval store.
 *
 * Called by the trusted owner AFTER the original signed Planning checkpoint
 * exists. The exact SAME session receipt is re-read by the original host
 * before the Rust operational Root is issued. No alternative signers,
 * synthetic VP, second independent approval or extra agent is introduced.
 * This helper does NOT itself start Gemini, issue Rust roots or execute Tasks.
 *
 * The human decision is explicitly SIMULATED; Ed25519 and verifier are real.
 */
import {createPrivateKey,createPublicKey} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join,resolve} from "node:path";
import {isDeepStrictEqual} from "node:util";
import {AuthorityPlanningCheckpointStore}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts";
import {SignedAuthorityOnlyFileStore}
 from "../../../packages/orchestrator-runtime/src/signed-authority-only-store.ts";
import {selectAuthorityOnlyGrant,signAuthorityOnlyGrant,authorityOnlyDigest}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";
import {RUST_OPERATIONS} from "../../gateway/src/operation-catalog.ts";
import {scriptedResearchProposal} from "./run-disposable-gemini-ci-pilot.mjs";

const OPS=new Set(RUST_OPERATIONS);
const CEILING=scriptedResearchProposal();
const PERMITTED=new Set(CEILING.requested_permissions.map(p=>
 JSON.stringify([p.resource,p.operation])));
const deny=()=>{throw Error("Disposable original CI Engineer review NO-GO");};

function protectedMeta(meta,isDirectory){
 if(!meta||(isDirectory?!meta.isDirectory():!meta.isFile())||
    meta.isSymbolicLink()||
    (meta.mode&0o777)!==(isDirectory?0o700:0o600)||
    (typeof process.getuid==="function"&&meta.uid!==process.getuid())||
    (!isDirectory&&meta.nlink!==1))deny();
}
async function readOwnerKey(path){
 if(typeof path!=="string"||!path.startsWith("/")||
    resolve(path)!==path)deny();
 protectedMeta(await lstat(resolve(path,"..")),true);
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await fd.stat();
  protectedMeta(stat,false);
  if(stat.size<60||stat.size>8192)deny();
  return await fd.readFile({encoding:"utf8"});
 }finally{await fd.close();}
}
/**
 * Owner-private API only: checkpointStore is the SAME backend-signed store
 * passed to the original Review Host; key identity/receipt directory must
 * match that Host's independently pinned approval configuration.
 *
 * No API key, model output authority, workflow input or Task supplies a
 * permission ceiling. Only exact IAM Console pairs are eligible.
 */
export async function writeOriginalDisposableCiEngineerReceipt({
 checkpointStore,snapshot,workBranch,requirement,
 receiptDirectory,privateKeyFile,engineerDid,keyId,publicKeyPem,
 nowMs=Date.now()
}={}){
 if(!(checkpointStore instanceof AuthorityPlanningCheckpointStore)||
    !snapshot||typeof snapshot!=="object"||
    typeof workBranch!=="string"||typeof requirement!=="string"||
    !Number.isSafeInteger(nowMs)||nowMs<0||
    typeof receiptDirectory!=="string"||
    !receiptDirectory.startsWith("/")||
    resolve(receiptDirectory)!==receiptDirectory||
    typeof engineerDid!=="string"||!engineerDid.startsWith("did:")||
    typeof keyId!=="string"||!keyId||
    typeof publicKeyPem!=="string"||!publicKeyPem||
    !isDeepStrictEqual(snapshot.repository,CEILING.repository)||
    workBranch!==CEILING.branch||
    requirement!==CEILING.requirement)deny();
 checkpointStore.assertContext(snapshot,workBranch,requirement);
 protectedMeta(await lstat(receiptDirectory),true);
 const checkpoint=await checkpointStore.load();
 const proposal=checkpoint.proposal;
 if(proposal.session_id!==snapshot.session_id||
    proposal.branch!==workBranch||
    proposal.requirement!==requirement||
    proposal.base_revision!==snapshot.base_revision||
    !isDeepStrictEqual(proposal.repository,CEILING.repository)||
    !Array.isArray(proposal.requested_permissions)||
    !proposal.requested_permissions.length||
    proposal.requested_permissions.some(p=>
     !PERMITTED.has(JSON.stringify([p.resource,p.operation]))))deny();
 // The true original checkpoint, not a synthetic independent proposal,
 // selects the subset. The model cannot add even one extra operation.
 const grant=selectAuthorityOnlyGrant(proposal,proposal.requested_permissions,{
  allowedOperations:OPS
 });
 const pem=await readOwnerKey(privateKeyFile);
 let signer,pinned;
 try{
  signer=createPrivateKey(pem);
  pinned=createPublicKey(publicKeyPem);
  if(signer.asymmetricKeyType!=="ed25519"||
     pinned.asymmetricKeyType!=="ed25519"||
     !createPublicKey(signer).equals(pinned))deny();
 }catch{deny();}
 const issuedAt=new Date(nowMs).toISOString().replace(/\.\d{3}Z$/u,"Z");
 const expiresAt=new Date(nowMs+55*60_000).toISOString()
  .replace(/\.\d{3}Z$/u,"Z");
 const receipt=signAuthorityOnlyGrant({
  authorization:grant,engineerDid,keyId,privateKeyPem:pem,
  issuedAt,expiresAt,allowedOperations:OPS
 });
 const encoded=JSON.stringify(receipt)+"\n";
 if(Buffer.byteLength(encoded,"utf8")>128*1024)deny();
 const file=join(receiptDirectory,proposal.session_id+".json");
 // A stale session cannot overwrite an earlier signed decision.
 const fd=await open(file,constants.O_WRONLY|constants.O_CREAT|
  constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  protectedMeta(await fd.stat(),false);
  await fd.writeFile(encoded);
  await fd.sync();
 }finally{await fd.close();}
 const directory=await open(receiptDirectory,
  constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await directory.sync();}finally{await directory.close();}
 // Verify with the SAME signed file store contract used by Review Host,
 // not with a copied inline signature check or a VP simulator.
 const verified=await new SignedAuthorityOnlyFileStore({
  directory:receiptDirectory,engineerDid,
  trustedKeys:{[keyId]:{engineer_did:engineerDid,public_key_pem:publicKeyPem}},
  nowMs:()=>nowMs
 }).loadAuthenticatedAuthority(proposal.session_id);
 if(!isDeepStrictEqual(verified.authorization,grant)||
    verified.authority_digest!==authorityOnlyDigest(grant,{
     allowedOperations:OPS
    }))deny();
 return Object.freeze({
  review:"SIMULATED_NOT_HUMAN",
  checkpoint_from_original_planning:true,
  original_receipt_written_and_independently_verified:true,
  permission_count:grant.permissions.length,
  delegated_roles:["backend","frontend","test"],
  native_root_issued_here:false,
  gemini_called_here:false
 });
}
