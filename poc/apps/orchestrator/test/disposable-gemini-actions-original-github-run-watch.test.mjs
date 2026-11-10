import test from "node:test";
import assert from "node:assert/strict";
import {createDisposableActionsOriginalGithubRunWatch}
 from "../src/disposable-gemini-actions-original-github-run-watch.mjs";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/experiment/disposable-gemini-live-20261109";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const SHA="a".repeat(40);
const RUN_ID="42884699654";
const DENIED=/Disposable Actions original Github run watch NO-GO/u;

function setup(t,{revocationFails=false}={}){
 const env={
  GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:REPO,
  GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:REF,
  GITHUB_WORKFLOW_REF:REPO+"/"+WORKFLOW+"@"+REF,
  GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:RUN_ID,GITHUB_SHA:SHA,
  DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:
   "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  DELEGATION_GATEWAY_ARCHITECTURE:"authority-only",
  APPROVED_RUNNER_NATIVE_MCP:"1",ENGINEER_CORE_NATIVE_MODE:"1"
 };
 const forbidden=[
  "GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY","GH_TOKEN",
  "GITHUB_TOKEN","DELEGATION_LIVE_CI_PREFLIGHT_MODE",
  "DELEGATION_DISPOSABLE_CI_MODE","DELEGATION_SIGNED_GEMINI_PILOT"
 ];
 const previousEnv=new Map([...Object.keys(env),...forbidden]
  .map(k=>[k,process.env[k]]));
 const previousFetch=globalThis.fetch;
 for(const name of forbidden)delete process.env[name];
 Object.assign(process.env,env);
 let runStatus="in_progress",calls=0,closes=0;
 const current=()=>({
  id:RUN_ID,run_attempt:1,event:"workflow_dispatch",
  status:runStatus,head_sha:SHA,
  head_branch:"experiment/disposable-gemini-live-20261109",
  path:WORKFLOW,head_repository:{full_name:REPO},
  created_at:new Date().toISOString()
 });
 globalThis.fetch=async(url,request)=>{
  calls++;
  assert.equal(url,"https://api.github.com/repos/"+REPO+
   "/actions/runs/"+RUN_ID);
  assert.equal(request.headers.authorization,
   "Bearer synthetic-actions-owner-read-token");
  return {ok:true,async json(){return current();}};
 };
 const create=(patch={})=>createDisposableActionsOriginalGithubRunWatch({
  runId:RUN_ID,sourceSha:SHA,
  githubApiToken:"synthetic-actions-owner-read-token",
  onClose:async()=>{
   closes++;
   if(revocationFails)throw Error("Original native Root revocation unconfirmed");
  },
  ...patch
 });
 const watcher=create();
 t.after(async()=>{
  await watcher.close().catch(()=>{});
  globalThis.fetch=previousFetch;
  for(const [key,value] of previousEnv){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 });
 return {watcher,create,setStatus:v=>{runStatus=v;},
  calls:()=>calls,closes:()=>closes,current};
}

test("Actions watch is an inert imported factory, real active GitHub run first",async t=>{
 const f=setup(t);
 assert.equal(f.calls(),0);
 await f.watcher.start();
 assert.equal(f.watcher.status,"active");
 await f.watcher.checkNow();
 assert.equal(f.calls(),2);
 await f.watcher.close();
 await f.watcher.close();
 assert.equal(f.watcher.status,"closed");
 assert.equal(f.closes(),1);
 await assert.rejects(f.watcher.checkNow(),DENIED);
 await assert.rejects(f.watcher.start(),DENIED);
});

test("canceled/completed original Actions run closes the one owner once",async t=>{
 const f=setup(t);
 await f.watcher.start();
 f.setStatus("completed");
 await assert.rejects(f.watcher.checkNow(),DENIED);
 assert.equal(f.watcher.status,"closed");
 assert.equal(f.closes(),1);
 await assert.rejects(f.watcher.checkNow(),DENIED);
 assert.equal(f.calls(),2);
});

test("unavailable GitHub REST fails closed before any source effect",async t=>{
 const f=setup(t);
 globalThis.fetch=async()=>{throw Error("GitHub API unavailable");};
 await assert.rejects(f.watcher.start(),DENIED);
 assert.equal(f.watcher.status,"closed");
 assert.equal(f.closes(),1);
});

test("unconfirmed original revocation can never be reported as success",async t=>{
 const f=setup(t,{revocationFails:true});
 await f.watcher.start();
 f.setStatus("completed");
 await assert.rejects(f.watcher.checkNow(),DENIED);
 assert.equal(f.watcher.status,"revocation_unconfirmed");
 assert.equal(f.closes(),1);
 await assert.rejects(f.watcher.checkNow(),DENIED);
});

test("in-flight REST check cannot outrun a synchronous owner shutdown fence",async t=>{
 const f=setup(t);
 await f.watcher.start();
 let release;
 globalThis.fetch=async()=>new Promise(resolve=>{
  release=()=>resolve({ok:true,async json(){return f.current();}});
 });
 const one=f.watcher.checkNow();
 const two=f.watcher.checkNow();
 await f.watcher.close();
 release();
 await assert.rejects(one,DENIED);
 await assert.rejects(two,DENIED);
 assert.equal(f.watcher.status,"closed");
 assert.equal(f.closes(),1);
});

test("source/attempt/environment pins reject private, scripted, foreign or paid leakage",t=>{
 const f=setup(t);
 for(const patch of [
  {sourceSha:"b".repeat(40)},
  {sourceSha:"invalid"},
  {runId:"0"},
  {runId:"42884699655"},
  {githubApiToken:"short"},
  {githubApiToken:"synthetic owner whitespace"},
  {onClose:undefined}
 ])assert.throws(()=>f.create(patch),DENIED);
 for(const [key,value] of [
  ["GITHUB_REF","refs/heads/main"],
  ["GITHUB_WORKFLOW_REF","other/workflow.yml@"+REF],
  ["GITHUB_RUN_ATTEMPT","2"],
  ["GITHUB_EVENT_NAME","push"],
  ["DELEGATION_LIVE_CI_PREFLIGHT_MODE","scripted-native"],
  ["GEMINI_API_KEY","leaked"],
  ["GH_TOKEN","leaked"]
 ]){
  const before=process.env[key];
  process.env[key]=value;
  assert.throws(()=>f.create(),DENIED,key);
  if(before===undefined)delete process.env[key];
  else process.env[key]=before;
 }
});
