import test from "node:test";
import assert from "node:assert/strict";
import {stageDisposableAccountSuspensionReference}
 from "../scripts/stage-disposable-account-suspension-reference.mjs";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES}
 from "../fixtures/account-suspension-reference.mjs";
import {ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT as MAIN,
 ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES as UNSOLVED,
 ACCOUNT_SUSPENSION_BASELINE_GIT_BLOB_HASHES as BLOBS}
 from "../fixtures/account-suspension-unsolved-baseline.mjs";
const branch="feature/account-suspension";
const paths=Object.keys(ACCOUNT_SUSPENSION_REFERENCE_FILES);
function fixture(){
 let head=MAIN,writes=0,main=MAIN;
 const original=new Map(paths.map(p=>[p,
  UNSOLVED[p]??ACCOUNT_SUSPENSION_REFERENCE_FILES[p]]));
 const current=new Map(original);
 const blobs=new Map(paths.map(p=>[p,BLOBS[p]??"f".repeat(40)]));
 const gitea={
  async getBranchMetadata(name){
   if(name==="main")return {commit_sha:main};
   assert.equal(name,branch);
   return {commit_sha:head};
  },
  async readTextFile(name,path,revision){
   assert.equal(name,branch);
   assert.ok(paths.includes(path));
   assert.ok(revision===MAIN||revision===head);
   const frozen=revision===MAIN;
   return {branch:name,path,revision,
    blob_sha:frozen?(BLOBS[path]??"f".repeat(40)):blobs.get(path),
    content:(frozen?original:current).get(path)};
  },
  async updateFile(name,path,content){
   assert.equal(name,branch);
   assert.equal(content,ACCOUNT_SUSPENSION_REFERENCE_FILES[path]);
   const before=blobs.get(path);
   writes++;
   head=writes.toString(16).padStart(40,"0");
   const blob_sha=(writes+100).toString(16).padStart(40,"0");
   blobs.set(path,blob_sha);
   current.set(path,content);
   return {commit_sha:head,blob_sha,precondition_blob_sha:before};
  }
 };
 return {gitea,current,stats:()=>({head,writes,main}),move:()=>{head="e".repeat(40)}};
}
test("R303 owner-only fixture applies verified unsolved baseline before signature without main write",async()=>{
 const x=fixture();
 const result=await stageDisposableAccountSuspensionReference({
  gitea:x.gitea,branch
 });
 assert.equal(result.base_revision,x.stats().head);
 assert.ok(result.files_changed>=6);
 assert.equal(result.files_changed,x.stats().writes);
 assert.equal(result.engineer_approved,false);
 assert.equal(result.delegated_agent_writes,0);
 assert.equal(x.stats().main,MAIN);
 for(const [path,expected] of Object.entries(ACCOUNT_SUSPENSION_REFERENCE_FILES))
  assert.equal(x.current.get(path),expected);
});
test("R303 owner reference seeding rejects stale HEAD before modifying repo",async()=>{
 const x=fixture();
 x.move();
 await assert.rejects(stageDisposableAccountSuspensionReference({
  gitea:x.gitea,branch
 }),/fresh immutable baseline branch/);
 assert.equal(x.stats().writes,0);
});
test("R303 owner reference seeding refuses main target",async()=>{
 const x=fixture();
 await assert.rejects(stageDisposableAccountSuspensionReference({
  gitea:x.gitea,branch:"main"
 }),/Expected values to be strictly equal/);
 assert.equal(x.stats().writes,0);
});
