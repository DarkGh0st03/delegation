import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,chmod,readdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DurableAuthorityOnlyRunnerIntentJournal}
 from "../src/trusted-authority-only-runner-intent-journal.ts";

const intent={
 schema:"authority-only-runner-intent-v1" as const,
 kind:"runner_test_commit_preflight_only" as const,
 session_id:"r303-session",
 authority_digest:"a".repeat(64),
 root_credential_id:"urn:r303:root",
 task_id:"task-test",
 runtime_task_id:"runtime-test",
 epoch:1,
 agent_did:"did:thesis:test",
 credential_id:"urn:r303:child:test",
 request_id:"request-r303",
 request_fingerprint:"c".repeat(64),
 repository:"thesis/iam-console-poc",
 branch:"feature/account-suspension",
 expected_head_sha:"b".repeat(40),
 runner_profile:"poc-default" as const,
 prepared_at_ms:1762340000000,
 runner_execution_authorized:false as const
};
async function fixture(fn:(v:{
 directory:string;journal:DurableAuthorityOnlyRunnerIntentJournal;
 })=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),"r303-runner-"));
 const directory=join(dir,"owner");
 try{
  await mkdir(directory,{mode:0o700});
  await fn({directory,journal:new DurableAuthorityOnlyRunnerIntentJournal(
   directory)});
 }finally{await rm(dir,{recursive:true,force:true});}
}
test("R303 intent is immutable, single-Task and never launches Docker",async()=>{
 await fixture(async({directory,journal})=>{
  await journal.reserve(intent);
  const files=await readdir(directory);
  assert.equal(files.length,1);
  const raw=await readFile(join(directory,files[0]),"utf8");
  assert.ok(!raw.includes("Bearer"));
  assert.ok(raw.includes('"runner_execution_authorized":false'));
  await journal.assertReserved(intent);
  await assert.rejects(journal.reserve({...intent,request_id:"request-other"}),
   /EEXIST/);
  await assert.rejects(journal.assertReserved({...intent,
   expected_head_sha:"d".repeat(40)}),/differs from original/);
  await journal.reserveAttempt(intent);
  assert.equal((await readdir(directory)).length,2);
  await assert.rejects(journal.reserveAttempt(intent),/EEXIST/);
  const restarted=new DurableAuthorityOnlyRunnerIntentJournal(directory);
  await assert.rejects(restarted.reserveAttempt(intent),/EEXIST/);
 });
});
test("R303 partial reservation after crash cannot relaunch Runner",async()=>{
 await fixture(async({directory,journal})=>{
  await journal.reserve(intent);
  await journal.reserveAttempt(intent);
  const restarted=new DurableAuthorityOnlyRunnerIntentJournal(directory);
  await assert.rejects(restarted.reserveAttempt(intent),/EEXIST/);
  await assert.rejects(restarted.reserve({...intent,
   request_fingerprint:"d".repeat(64)}),/EEXIST/);
 });
});
test("R303 concurrent duplicate launch is admitted at most once",async()=>{
 await fixture(async({directory,journal})=>{
  await journal.reserve(intent);
  const other=new DurableAuthorityOnlyRunnerIntentJournal(directory);
  const results=await Promise.allSettled([
   journal.reserveAttempt(intent),
   other.reserveAttempt(intent)
  ]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(results.filter(x=>x.status==="rejected").length,1);
 });
});
test("R303 refuses missing, malformed or shared trusted owner stores",async()=>{
 await fixture(async({directory,journal})=>{
  await chmod(directory,0o755);
  await assert.rejects(journal.reserve(intent),/unsafe shared/);
  await chmod(directory,0o700);
  for(const bad of [
   {...intent,runner_profile:"other"},
   {...intent,expected_head_sha:"z".repeat(40)},
   {...intent,root_credential_id:intent.credential_id},
   {...intent,branch:"main"},
   {...intent,request_fingerprint:"not-a-digest"},
   {...intent,runner_execution_authorized:true}
  ]){
   await assert.rejects(journal.reserve(bad as never),
    /not a canonical native Task/);
  }
  await journal.reserve(intent);
  const [name]=await readdir(directory);
  await writeFile(join(directory,name),"{}\n","utf8");
  await assert.rejects(journal.assertReserved(intent),
   /unsafe or incomplete|differs/);
  assert.equal((await readdir(directory)).length,1);
 });
});

test("R303.3 verified PASS may finish exactly once after durable POST attempt",async()=>{
 await fixture(async({directory,journal})=>{
  await journal.reserve(intent);
  await assert.rejects(journal.reserveCompletedEvidence(intent,
   "f".repeat(64)),/no such file|ENOENT|no protected original/);
  await journal.reserveAttempt(intent);
  await assert.rejects(journal.reserveCompletedEvidence(intent,
   "invalid-digest"),/invalid independently verified/);
  await journal.reserveCompletedEvidence(intent,"f".repeat(64));
  const files=await readdir(directory);
  assert.equal(files.length,3);
  const record=JSON.parse(await readFile(join(directory,
   files.find(x=>x.endsWith(".completed.json"))!),"utf8"));
  assert.equal(record.verified_evidence_sha256,"f".repeat(64));
  assert.equal(record.request_id,intent.request_id);
  await assert.rejects(journal.reserveCompletedEvidence(intent,
   "d".repeat(64)),/EEXIST/);
  const restarted=new DurableAuthorityOnlyRunnerIntentJournal(directory);
  await assert.rejects(restarted.reserveAttempt(intent),/EEXIST/);
  await assert.rejects(restarted.reserveCompletedEvidence(intent,
   "f".repeat(64)),/EEXIST/);
 });
});

test("R337 exact durable POST attempt is required and PASS excludes FAIL",async()=>{
 await fixture(async({journal})=>{
  await journal.reserve(intent);
  await assert.rejects(journal.assertAttempted(intent),/ENOENT|no such file/);
  await journal.reserveAttempt(intent);
  await journal.assertAttempted(intent);
  await assert.rejects(journal.assertAttempted({
   ...intent,request_fingerprint:"d".repeat(64)
  }),/differs from original/);
  await journal.reserveCompletedEvidence(intent,"f".repeat(64));
  await assert.rejects(journal.assertAttempted(intent),
   /successful Runner completion excludes a conflicting FAIL receipt/);
 });
});
