import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,writeFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DisposablePrivateBudgetedAdkModel}
 from "../src/disposable-gemini-live-budgeted-model.mjs";
import {
  createDisposableActionsOwnerGeminiModelsFromPrivateFile,
  claimIssuedDisposableLiveGeminiModelSet
} from "../src/disposable-gemini-live-model-set.mjs";

const DENY=/Disposable live Gemini model admission NO-GO/u;
const SHA=execFileSync("git",["rev-parse","HEAD"],{
 encoding:"utf8"
}).trim();
const ref="refs/heads/experiment/disposable-gemini-live-20261109";
const repo="DarkGh0st03/delegation";
const workflow=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const runId="42783586673";

async function setup(t){
 const parent=await mkdtemp(join(tmpdir(),"actions-live-owner-only-"));
 const secret=join(parent,"gemini.secret");
 await writeFile(secret,"synthetic-no-network-key\n",{mode:0o600,flag:"wx"});
 t.after(()=>rm(parent,{recursive:true,force:true}));
 const input={
  GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:repo,
  GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_REF:ref,GITHUB_WORKFLOW_REF:repo+"/"+workflow+"@"+ref,
  GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:runId,GITHUB_SHA:SHA,
  DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:
   "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES"
 };
 const keys=[...Object.keys(input),"GEMINI_API_KEY","GOOGLE_API_KEY",
  "OPENAI_API_KEY","GH_TOKEN","GITHUB_TOKEN","DELEGATION_LIVE_CI_PREFLIGHT_MODE"];
 const old=new Map(keys.map(key=>[key,process.env[key]]));
 for(const key of keys)delete process.env[key];
 Object.assign(process.env,input);
 const previousFetch=globalThis.fetch;
 let apiCalls=0;
 globalThis.fetch=async (url)=>{
  apiCalls++;
  assert.equal(url,"https://api.github.com/repos/"+repo+
   "/actions/runs/"+runId);
  return {ok:true,async json(){return {
   id:runId,event:"workflow_dispatch",run_attempt:1,
   status:"in_progress",head_sha:SHA,
   head_branch:"experiment/disposable-gemini-live-20261109",
   path:workflow,head_repository:{full_name:repo},
   created_at:new Date().toISOString()
  };}};
 };
 t.after(()=>{
  globalThis.fetch=previousFetch;
  for(const [key,value] of old){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 });
 return {secret,parent,input,getApiCalls:()=>apiCalls};
}

test("manual Actions trusted owner constructs five real ADK wrapper classes without any provider request",async t=>{
 const f=await setup(t);
 const models=await createDisposableActionsOwnerGeminiModelsFromPrivateFile({
  keyFile:f.secret,githubApiToken:"synthetic-github-reader-token"
 });
 assert.equal(f.getApiCalls(),1,"only the GitHub status metadata is checked");
 assert.ok(models.planner.model instanceof DisposablePrivateBudgetedAdkModel);
 assert.ok(models.adaptive.model instanceof DisposablePrivateBudgetedAdkModel);
 assert.deepEqual(Object.keys(models.workers).sort(),
  ["backend","frontend","test"]);
 assert.equal(models.planner.maxModelTurns,24);
 assert.equal(models.workers.backend.maxModelTurns,20);
 assert.equal(models.workers.frontend.maxModelTurns,14);
 assert.equal(models.workers.test.maxModelTurns,10);
 const all=[models.planner.model,models.adaptive.model,
  ...Object.values(models.workers).map(w=>w.model)];
 assert.equal(new Set(all).size,5);
 assert.ok(all.every(m=>m.publicSummary().calls_started===0));
 assert.deepEqual((await readdir(f.parent)).filter(x=>x.endsWith(".claimed")).length,1);
 assert.equal(claimIssuedDisposableLiveGeminiModelSet(models),models);
 assert.throws(()=>claimIssuedDisposableLiveGeminiModelSet(models),DENY);
 await assert.rejects(
  createDisposableActionsOwnerGeminiModelsFromPrivateFile({
   keyFile:f.secret,githubApiToken:"synthetic-github-reader-token"
  }),DENY,"a second owner cannot consume the same manual run");
});

test("preflight-only, inherited secrets and unrelated source deny before any key access",async t=>{
 const f=await setup(t);
 const bad=[
  ["GITHUB_EVENT_NAME","push"],
  ["GITHUB_REF","refs/heads/main"],
  ["GITHUB_WORKFLOW_REF",repo+"/other.yml@"+ref],
  ["GITHUB_SHA","a".repeat(40)],
  ["GITHUB_RUN_ATTEMPT","2"],
  ["DELEGATION_DISPOSABLE_LIVE_MODE","preflight-only"],
  ["DELEGATION_GEMINI_CHARGE_CONFIRMATION","no"],
  ["DELEGATION_BILLING_CAP_ACK","not checked"],
  ["DELEGATION_LIVE_CI_PREFLIGHT_MODE","preflight-only"],
  ["GEMINI_API_KEY","fake"],
  ["GOOGLE_API_KEY","fake"],["OPENAI_API_KEY","fake"],
  ["GH_TOKEN","fake"],["GITHUB_TOKEN","fake"]
 ];
 for(const [key,value] of bad){
  const original=process.env[key];
  process.env[key]=value;
  await assert.rejects(
   createDisposableActionsOwnerGeminiModelsFromPrivateFile({
    keyFile:f.secret,githubApiToken:"synthetic-github-reader-token"
   }),DENY,key);
  if(original===undefined)delete process.env[key];
  else process.env[key]=original;
 }
 assert.equal(f.getApiCalls(),0);
 assert.deepEqual((await readdir(f.parent)).filter(x=>x.endsWith(".claimed")),[]);
});
