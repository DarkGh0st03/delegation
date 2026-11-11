/**
 * R5 OWNER-ONLY post-run witness. This is a restricted local observation,
 * not an independent third-party attestation, and NEVER a grant of authority.
 * The caller MUST be the same original Engineer Host after it has awaited
 * the signed DAG, real live GitHub job checks and native root retirement.
 *
 * No artifact bodies, credentials, bearer, VP, Engineer private key,
 * model input, or GitHub OIDC token are serialized.
 */
import {TrustedExecutionCoordinator}
  from "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {constants} from "node:fs";
import {randomBytes} from "node:crypto";
import {open,lstat,link,unlink} from "node:fs/promises";
import {join,resolve} from "node:path";
const RUN=/^[1-9][0-9]{0,19}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_TASKS=128;
/** Module-local provenance: a matching JSON shape is NOT a real witness. */
const issuedEvidence=new WeakSet();
const reservedEvidence=new WeakSet();
const MAX_RECEIPT_BYTES=65536;
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
export async function verifyR5PostRunEvidence({
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
     !(coordinator instanceof TrustedExecutionCoordinator)||
     coordinator.phase!=="closed")
    deny("original Engineer review, DAG Tasks and retired Coordinator do not agree");
  // A CLOSED phase is set synchronously before Gateway/Rust retirement.
  // Only the real Coordinator's original shutdown promise can prove that
  // the revocation AND durable recovery journal have both completed.
  try{
    await coordinator.assertOperationalClosureConfirmed();
  }catch{
    deny("native operational root or Gateway retirement unconfirmed");
  }
  if(coordinator.phase!=="closed")
    deny("original Coordinator left its verified terminal phase");
  // Specialized artifacts remain inside the host; they must not be copied
  // into the evidence receipt (which is deliberately small and inspectable).
  const evidence=Object.freeze({
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
  // Only the SAME object returned by this verifier is authorized to be
  // persisted. A cloned/hand-authored object cannot spoof the verified
  // closed Coordinator and original awaited native retirement.
  issuedEvidence.add(evidence);
  return evidence;
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
 * Durable atomic one-run evidence publication. A proper final path appears
 * ONLY after the full verified JSON has been fsynced to a temporary inode.
 * Hard-link publication uses EEXIST/NO-REPLACE and is atomic on one FS.
 */
export async function persistR5PostRunEvidence(
  directory,evidence,{signal}={}
){
  if(signal?.aborted)
    deny("owner shutdown requested before evidence publication");
  if(!evidence||typeof evidence!=="object"||
     !issuedEvidence.has(evidence)||reservedEvidence.has(evidence))
    deny("only one genuine, unused Coordinator-verified witness may be published");
  // Reserve BEFORE the first await, so concurrent callers cannot both
  // publish the same observation under a reused admission or run identity.
  reservedEvidence.add(evidence);
  await assertR5EvidenceDirectory(directory);
  if(evidence.schema!=="r5-scripted-owner-completion-v1"||
     evidence.status!=="verified_complete_local_owner_observation"||
     evidence.external_r5_go!==false||
     !RUN.test(evidence.github_run_id??""))
    deny("unverified completion cannot be persisted");
  const filename=join(directory,"r5-scripted-run-"+evidence.github_run_id+".json");
  const temporary=join(directory,".r5-"+evidence.github_run_id+"-"+
    randomBytes(16).toString("hex")+".tmp");
  const json=JSON.stringify(evidence,null,2)+"\n";
  if(Buffer.byteLength(json,"utf8")>MAX_RECEIPT_BYTES)
    deny("verified receipt exceeds owner storage limit");
  let file;
  let linked=false;
  try{
    file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|
      constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await file.writeFile(json,"utf8");
    await file.sync();
    await file.close();
    file=undefined;
    if(signal?.aborted)
      deny("owner shutdown requested before receipt publication");
    // POSIX hard-link creation rejects existing destination names. This
    // avoids exposing a partial JSON receipt and prevents overwrites.
    await link(temporary,filename);
    linked=true;
    await unlink(temporary);
    // Make the completed name durable after inode fsync and unlink.
    const dirfd=await open(directory,constants.O_RDONLY|
      constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await dirfd.sync();}finally{await dirfd.close();}
    if(signal?.aborted)
      deny("owner shutdown raced the final receipt durability check");
  }catch{
    // A shutdown may race a successful atomic link. Do not leave an
    // authoritative-looking positive marker when the writer rejected.
    // Never remove a preexisting run's file: linked is true ONLY when
    // this call created the final hard-link itself.
    if(linked){
      try{
        await unlink(filename);
        const dirfd=await open(directory,constants.O_RDONLY|
          constants.O_DIRECTORY|constants.O_NOFOLLOW);
        try{await dirfd.sync();}finally{await dirfd.close();}
      }catch{/* manual reconciliation required; never claim success */}
    }
    deny("atomic receipt publication unconfirmed; no retry or overwrite");
  }finally{
    if(file)await file.close();
    try{await unlink(temporary);}catch{/* absent after clean publish */}
  }
  if(!linked)
    deny("verified receipt was not published");
  return Object.freeze({status:"verified_local_receipt_written",
    filename,github_run_id:evidence.github_run_id});
}
