/**
 * R303.4b — CI TEST OWNER ONLY. Prepare a disposable, completed Account
 * Suspension reference branch BEFORE any Engineer approval. This fixture
 * deliberately does NOT represent agent-generated source or a delegated
 * provider effect. It allows the *Test Agent/Runner authorization path* to
 * prove genuine project + researcher acceptance PASS.
 */
import assert from "node:assert/strict";
import {ProviderNotFoundError} from "../../gateway/src/errors.ts";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from
 "../fixtures/account-suspension-reference.mjs";
import {
 ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT,
 ACCOUNT_SUSPENSION_BASELINE_GIT_BLOB_HASHES,
 ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES
} from "../fixtures/account-suspension-unsolved-baseline.mjs";

export async function stageDisposableAccountSuspensionReference({
 gitea,branch="feature/account-suspension"
}){
 assert.equal(branch,"feature/account-suspension");
 const baseline=ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT;
 const originalMain=await gitea.getBranchMetadata("main");
 assert.equal(originalMain.commit_sha,baseline,
  "This owner fixture may only run on the exact protected unsolved baseline");
 let observedHead=(await gitea.getBranchMetadata(branch)).commit_sha;
 assert.equal(observedHead,baseline,
  "Reference fixture must start from fresh immutable baseline branch");
 let modifications=0;
 const keys=Object.keys(ACCOUNT_SUSPENSION_REFERENCE_FILES).sort();
 assert.ok(keys.length>=10&&keys.length<=15);
 for(const path of keys){
  const expected=ACCOUNT_SUSPENSION_REFERENCE_FILES[path];
  assert.equal(typeof expected,"string");
  assert.ok(expected.length>0&&expected.length<100000);
  const baselineSource=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[path];
  // The unsolved baseline deliberately has no functional E2E spec. It
  // must be CREATED as a file, not updated with a fabricated old blob.
  if(baselineSource===undefined){
   assert.equal(path,"tests/e2e/account-suspension.spec.ts",
    "Only the exact previously absent researcher E2E fixture is allowed");
   for(const sha of [baseline,observedHead]){
    await assert.rejects(gitea.readTextFile(branch,path,sha),
     error=>error instanceof ProviderNotFoundError,
     "The new acceptance fixture must be absent from both snapshots");
   }
   const added=await gitea.createFile(branch,path,expected,
    "CI owner-only new reference acceptance fixture: "+path);
   assert.ok(added.commit_sha!==observedHead);
   observedHead=added.commit_sha;
   const actual=await gitea.readTextFile(branch,path,observedHead);
   assert.equal(actual.content,expected);
   assert.equal(actual.blob_sha,added.blob_sha);
   modifications++;
   continue;
  }
  const current=await gitea.readTextFile(branch,path,observedHead);
  const original=await gitea.readTextFile(branch,path,baseline);
  assert.equal(current.blob_sha,original.blob_sha,
   "Reference fixture must not overwrite a prior unrelated feature edit");
  assert.equal(original.content,baselineSource,
   "Original file differs from the signed baseline source snapshot");
  assert.equal(original.blob_sha,
   ACCOUNT_SUSPENSION_BASELINE_GIT_BLOB_HASHES[path],
   "Original Gitea blob differs from pinned public baseline");
  if(current.content===expected)continue;
  const updated=await gitea.updateFile(
   branch,path,expected,"CI owner-only completed reference fixture: "+path);
  assert.equal(updated.precondition_blob_sha,current.blob_sha);
  assert.ok(updated.commit_sha!==observedHead);
  observedHead=updated.commit_sha;
  const actual=await gitea.readTextFile(branch,path,observedHead);
  assert.equal(actual.content,expected);
  assert.equal(actual.blob_sha,updated.blob_sha);
  modifications++;
 }
 assert.ok(modifications>=6,
  "Unsolved baseline did not require expected functional reference changes");
 assert.equal((await gitea.getBranchMetadata(branch)).commit_sha,observedHead);
 assert.equal((await gitea.getBranchMetadata("main")).commit_sha,baseline);
 return Object.freeze({
  status:"ci_owner_only_completed_reference_fixture",
  base_revision:observedHead,
  files_changed:modifications,
  engineer_approved:false,
  delegated_agent_writes:0
 });
}
