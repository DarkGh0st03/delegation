import test from "node:test";
import assert from "node:assert/strict";
import {createDisposableOriginalGithubRunWatch}
 from "../src/disposable-gemini-original-github-run-watch.mjs";

const SHA="a".repeat(40);
const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const DENIED=/Disposable original Gemini GitHub run watch NO-GO/u;

function setup(t,{onCloseThrows=false}={}){
 const old=globalThis.fetch;
 const oldActions=process.env.GITHUB_ACTIONS;
 delete process.env.GITHUB_ACTIONS;
 let status="in_progress",calls=0,closes=0;
 globalThis.fetch=async(url,request)=>{
  calls++;
  assert.equal(url,"https://api.github.com/repos/"+REPO+
   "/actions/runs/987654321");
  assert.equal(request.headers.authorization,
   "Bearer synthetic-owner-read-token");
  return {ok:true,async json(){return {
   id:"987654321",run_attempt:1,event:"workflow_dispatch",
   status,head_sha:SHA,path:WORKFLOW,
   head_branch:"refactor/post-prof-plan-contracts-20261021",
   head_repository:{full_name:REPO},
   created_at:new Date().toISOString()
  }}};
 };
 t.after(()=>{
  globalThis.fetch=old;
  if(oldActions===undefined)delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS=oldActions;
 });
 const pins={repository:REPO,ref:REF,
  sourceSha:SHA,runId:"987654321",sessionId:"original-session"};
 const watcher=createDisposableOriginalGithubRunWatch({
  pins,githubApiToken:"synthetic-owner-read-token",
  onClose:async()=>{
   closes++;
   if(onCloseThrows)throw Error("Original Root revocation unconfirmed");
  }
 });
 t.after(()=>watcher.close().catch(()=>{}));
 return {watcher,pins,setStatus:value=>{status=value;},
  calls:()=>calls,closes:()=>closes};
}

test("original GitHub watch starts with independently corroborated active run and closes once",async t=>{
 const f=setup(t),w=f.watcher;
 await w.start();
 assert.equal(w.status,"active");
 await w.checkNow();
 assert.equal(f.calls(),2);
 await w.close();
 await w.close();
 assert.equal(w.status,"closed");
 assert.equal(f.closes(),1);
 await assert.rejects(w.checkNow(),DENIED);
});

test("a canceled manual GitHub job fences the owner and prevents a second launch",async t=>{
 const f=setup(t);
 await f.watcher.start();
 f.setStatus("completed");
 await assert.rejects(f.watcher.checkNow(),DENIED);
 assert.equal(f.watcher.status,"closed");
 assert.equal(f.closes(),1);
 await assert.rejects(f.watcher.checkNow(),DENIED);
 assert.equal(f.calls(),2);
});

test("REST errors fail closed; no approval, Root or Gemini request is attempted",async t=>{
 const f=setup(t);
 await f.watcher.start();
 globalThis.fetch=async()=>{throw Error("GitHub unavailable");};
 await assert.rejects(f.watcher.checkNow(),DENIED);
 assert.equal(f.watcher.status,"closed");
 assert.equal(f.closes(),1);
});

test("uncertain original Root close is terminal and cannot be reported as revoked",async t=>{
 const f=setup(t,{onCloseThrows:true});
 await f.watcher.start();
 f.setStatus("completed");
 await assert.rejects(f.watcher.checkNow(),DENIED);
 assert.equal(f.watcher.status,"revocation_unconfirmed");
 assert.equal(f.closes(),1);
 await assert.rejects(f.watcher.checkNow(),DENIED);
});

test("concurrent run checks cannot win a race against explicit shutdown",async t=>{
 const f=setup(t);
 await f.watcher.start();
 let unblock;
 globalThis.fetch=async()=>{
  return new Promise(resolve=>{unblock=()=>resolve({
   ok:true,async json(){return {
    id:"987654321",run_attempt:1,event:"workflow_dispatch",
    status:"in_progress",head_sha:SHA,path:WORKFLOW,
    head_branch:"refactor/post-prof-plan-contracts-20261021",
    head_repository:{full_name:REPO},
    created_at:new Date().toISOString()
   }}});
  });
 };
 const check1=f.watcher.checkNow();
 const check2=f.watcher.checkNow();
 await f.watcher.close();
 unblock();
 await assert.rejects(check1,DENIED);
 await assert.rejects(check2,DENIED);
 assert.equal(f.watcher.status,"closed");
 assert.equal(f.closes(),1);
});

test("Actions environment and foreign source/branch cannot create private watch",t=>{
 const f=setup(t);
 process.env.GITHUB_ACTIONS="true";
 assert.throws(()=>createDisposableOriginalGithubRunWatch({
  pins:f.pins,githubApiToken:"synthetic-owner-read-token",
  onClose:()=>{}
 }),DENIED);
 delete process.env.GITHUB_ACTIONS;
 for(const patch of [
  {ref:"refs/heads/main"},
  {sourceSha:"not-a-sha"},
  {runId:"0"},
  {sessionId:""},
  {repository:"attacker/fork"}
 ]){
  assert.throws(()=>createDisposableOriginalGithubRunWatch({
   pins:{...f.pins,...patch},
   githubApiToken:"synthetic-owner-read-token",onClose:()=>{}
  }),DENIED);
 }
});


test("a well-formed foreign SHA is rejected by authoritative GitHub run corroboration",async t=>{
 const f=setup(t);
 let closes=0;
 const foreign=createDisposableOriginalGithubRunWatch({
  pins:{...f.pins,sourceSha:"b".repeat(40)},
  githubApiToken:"synthetic-owner-read-token",
  onClose:async()=>{closes++;}
 });
 t.after(()=>foreign.close());
 await assert.rejects(foreign.start(),DENIED);
 assert.equal(foreign.status,"closed");
 assert.equal(closes,1);
 assert.equal(f.calls(),1);
});
