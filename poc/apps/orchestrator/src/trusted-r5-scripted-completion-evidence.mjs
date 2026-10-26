/**
 * R5 OWNER-ONLY post-run witness. This is a restricted local observation,
 * not an independent third-party attestation, and NEVER a grant of authority.
 * The caller MUST be the same original Engineer Host after it has awaited
 * the signed DAG, real live GitHub job checks and native root retirement.
 *
 * No artifact bodies, credentials, bearer, VP, Engineer private key,
 * model input, or GitHub OIDC token are serialized.
 */
import {constants} from "node:fs";
import {open,lstat} from "node:fs/promises";
import {join,resolve} from "node:path";
const RUN=/^[1-9][0-9]{0,19}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_TASKS=128;
function deny(reason){
  throw Error("R5 verified completion evidence NO-GO: "+reason);
}
function sameTaskSet(expected,completed){
  return Array.isArray(expected)&&Array.isArray(completed)&&
    expected.length>0&&expected.length<=MAX_TASKS&&
    expected.length===completed.length&&
    expected.every(x=>typeof x==="string"&&ID.test(x))&&
    completed.every(x=>typeof x==="string"&&ID.test(x))&&
    new Set(expected).size===expected.length&&
    new Set(completed).size===completed.length&&
    expected.every(id=>completed.includes(id));
}
function safeDirectory(dir){
  return typeof dir==="string"&&dir.startsWith("/")&&
    dir.length<512&&resolve(dir)===dir;
}
/**
 * Pure fail-closed verifier. A closure *claim* passed by a caller is NOT
 * evidence: only original owner process code may invoke this on the actual
 * Coordinator after awaiting host.runReviewedScriptedApprovedDagWithGateway.
 */
export function verifyR5PostRunEvidence({
  runId,sourceSha,sessionId,review,
  approvedTaskIds,dagResult,coordinator
}={}){
  if(!RUN.test(runId??"")||!SHA.test(sourceSha??"")||
     !ID.test(sessionId??"")||
     review?.session_id!==sessionId||
     !DIGEST.test(review.plan_digest??"")||
     !review.authenticated_engineer_did?.startsWith("did:")||
     dagResult?.plan_digest!==review.plan_digest||
     !sameTaskSet(approvedTaskIds,dagResult?.completed_task_ids)||
     !coordinator||coordinator.phase!=="closed")
    deny("original Engineer review, DAG Tasks and retired Coordinator do not agree");
  // Specialized artifacts remain inside the host; they must not be copied
  // into the evidence receipt (which is deliberately small and inspectable).
  return Object.freeze({
    schema:"r5-scripted-owner-completion-v1",
    status:"verified_complete_local_owner_observation",
    source_sha:sourceSha,
    github_run_id:runId,
    session_id:sessionId,
    approved_plan_digest:review.plan_digest,
    approved_task_ids:Object.freeze([...approvedTaskIds]),
    completed_task_ids:Object.freeze([...dagResult.completed_task_ids]),
    authenticated_engineer_did:review.authenticated_engineer_did,
    coordinator_terminal_phase:"closed",
    // These are the original runtime's completed checks, NOT newly
    // validated by the evidence file or a remote attestation service.
    original_runtime_returned_success:true,
    independently_attested:false,
    provider_model_calls_verified_here:false,
    external_r5_go:false
  });
}
/** Validate an owner-only 0700 directory BEFORE consuming GitHub admission. */
export async function assertR5EvidenceDirectory(directory){
  if(!safeDirectory(directory))deny("owner-protected evidence directory required");
  try{
    const s=await lstat(directory);
    if(!s.isDirectory()||s.isSymbolicLink()||
       (s.mode&0o077)!==0||
       (typeof process.getuid==="function"&&s.uid!==process.getuid()))
      deny("evidence directory must be owned and mode 0700");
  }catch{deny("evidence directory unavailable or unsafe");}
}
/**
 * Atomic one-run, one-file witness, never overwrite a prior trial.
 * A failed or uncertain trial writes NO verified-complete marker.
 */
export async function persistR5PostRunEvidence(directory,evidence){
  await assertR5EvidenceDirectory(directory);
  if(evidence?.schema!=="r5-scripted-owner-completion-v1"||
     evidence?.status!=="verified_complete_local_owner_observation"||
     evidence?.external_r5_go!==false||
     !RUN.test(evidence.github_run_id??""))
    deny("unverified completion cannot be persisted");
  const filename=join(directory,"r5-scripted-run-"+evidence.github_run_id+".json");
  let file;
  try{
    file=await open(filename,constants.O_WRONLY|constants.O_CREAT|
      constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await file.writeFile(JSON.stringify(evidence,null,2)+"\n","utf8");
    await file.sync();
  }catch{
    deny("receipt write not confirmed, no overwrite or retry permitted");
  }finally{
    if(file)await file.close();
  }
  return Object.freeze({status:"verified_local_receipt_written",
    filename,github_run_id:evidence.github_run_id});
}
