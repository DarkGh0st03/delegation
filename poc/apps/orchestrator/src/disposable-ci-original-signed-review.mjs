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
import {execFileSync} from "node:child_process";
import {lstat,open} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
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
const REPO="DarkGh0st03/delegation";
const EXPERIMENT="refs/heads/experiment/disposable-gemini-live-20261109";
const ARCHITECTURE="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOWS=new Set([
 "gemini-authority-only-live-ci-pilot.yml",
 "disposable-original-engineer-native-ci.yml",
 "r38513-native-strict-full-recovery.yml"
]);
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");

/**
 * Pure CI admission; actual signing separately checks the exact local git
 * HEAD and tracked cleanliness. This predicate is NOT GitHub authentication:
 * it is a defense-in-depth guard around a CI-only simulated-human signer.
 * The ORIGINAL checkpoint verifier and native Rust authorization remain
 * authoritative. Never permit this code path from the private R5 owner.
 */
export function assertOriginalDisposableCiReviewOrigin(env,checkoutSha){
 if(!env||typeof env!=="object"||Array.isArray(env))deny();
 const ref=env.GITHUB_REF;
 const workflowRef=env.GITHUB_WORKFLOW_REF;
 const prefix=REPO+"/.github/workflows/";
 if(typeof workflowRef!=="string"||
    !workflowRef.startsWith(prefix)||
    !workflowRef.endsWith("@"+ref))deny();
 const filename=workflowRef.slice(prefix.length,-(ref.length+1));
 if(env.GITHUB_ACTIONS!=="true"||
    env.GITHUB_REPOSITORY!==REPO||
    ![EXPERIMENT,ARCHITECTURE].includes(ref)||
    !WORKFLOWS.has(filename)||
    !["workflow_dispatch","push"].includes(env.GITHUB_EVENT_NAME)||
    (env.GITHUB_EVENT_NAME==="push"&&
     (ref!==EXPERIMENT||
      filename!=="disposable-original-engineer-native-ci.yml"))||
    env.GITHUB_RUN_ATTEMPT!=="1"||
    !RUN.test(env.GITHUB_RUN_ID??"")||
    !SHA.test(env.GITHUB_SHA??"")||
    checkoutSha!==env.GITHUB_SHA||
    env.R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING!=="1"||
    env.R38513_NATIVE_STRICT_FULL_RECOVERY!=="1"||
    env.GEMINI_API_KEY!==undefined||
    env.GOOGLE_API_KEY!==undefined||
    env.OPENAI_API_KEY!==undefined||
    env.DELEGATION_GEMINI_CHARGE_CONFIRMATION!==undefined||
    env.DELEGATION_BILLING_CAP_ACK!==undefined||
    env.DELEGATION_DISPOSABLE_LIVE_MODE!==undefined||
    env.DELEGATION_SIGNED_GEMINI_PILOT!==undefined)
  deny();
 return Object.freeze({
  status:"original_disposable_ci_simulated_review_admitted_no_inference",
  source_sha:checkoutSha,workflow:filename,
  provider_calls_authorized:false,
  human_approval_verified:false,
  original_root_issued:false
 });
}

function checkedSourceSha(){
 try{
  const sha=execFileSync("git",["rev-parse","--verify","HEAD"],{
   cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
  const changed=execFileSync("git",["status","--porcelain",
   "--untracked-files=no"],{
   cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
   stdio:["ignore","pipe","ignore"]
  }).trim();
  if(changed||!SHA.test(sha))deny();
  return sha;
 }catch{deny();}
}


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
 // Reject any call from a private Engineer Host, foreign GitHub run,
 // live billing mode or dirty/foreign source before touching the key.
 assertOriginalDisposableCiReviewOrigin(process.env,checkedSourceSha());
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
