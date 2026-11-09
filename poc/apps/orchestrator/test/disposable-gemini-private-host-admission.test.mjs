import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Gemini} from "@google/adk";
import {TrustedGithubAdmissionReceiptStore}
 from "../../../packages/orchestrator-runtime/src/trusted-github-admission-store.ts";
import {createDisposableLiveGeminiModelSetFromPrivateHostAdmission}
 from "../src/disposable-gemini-live-model-set.mjs";

const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
const SHA=execFileSync("git",["rev-parse","HEAD"],{
 cwd:SOURCE_ROOT,encoding:"utf8"
}).trim();
const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const CONSENT="I AUTHORIZE GEMINI API CHARGES";
const deny=/NO-GO|Trusted Github admitted handoff|Trusted Github admission receipt|Trusted Github manual dispatch/u;

function privateHost(t){
 const previous={};
 const values={
  GITHUB_ACTIONS:undefined,
  GEMINI_API_KEY:undefined,
  GOOGLE_API_KEY:undefined,
  OPENAI_API_KEY:undefined,
  DELEGATION_GATEWAY_ARCHITECTURE:"authority-only",
  APPROVED_RUNNER_NATIVE_MCP:"1",
  ENGINEER_CORE_NATIVE_MODE:"1"
 };
 for(const key of Object.keys(values)){
  previous[key]=process.env[key];
  if(values[key]===undefined)delete process.env[key];
  else process.env[key]=values[key];
 }
 t.after(()=>{for(const [key,value] of Object.entries(previous)){
  if(value===undefined)delete process.env[key];
  else process.env[key]=value;
 }});
}
async function fixture(t,{runId="987654321",model="gemini-3.8-flash"}={}){
 const directory=await mkdtemp(join(tmpdir(),"disposable-host-oidc-"));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=join(directory,"secret.key");
 await writeFile(file,"synthetic-protected-no-provider-key\n",{
  mode:0o600,flag:"wx"
 });
 const store=new TrustedGithubAdmissionReceiptStore({
  directory,hmacSecret:randomBytes(32),expectedSessionId:"test-session"
 });
 const pins={
  repository:REPO,ref:REF,sourceSha:SHA,
  runId,sessionId:"test-session"
 };
 const dispatch={
  status:"manual_workflow_input_only_not_authorized",
  source_repository:REPO,source_ref:REF,source_sha:SHA,
  run_id:runId,model_name:model,
  max_model_turns:20,max_output_tokens:12000,max_model_call_ms:60000,
  authorization_input:CONSENT
 };
 // Synthetic OFFLINE receipt: no live OIDC JWT is received in this test.
 // Production writes through verified GitHub OIDC intake, not this fixture.
 await store.record({dispatch,job:{
  kind:"github_actions_oidc_verified",
  run_id:runId,workflow_sha:SHA
 }});
 const observed={calls:0};
 const githubApiFetchFn=async(url,opts)=>{
  observed.calls++;
  assert.equal(url,"https://api.github.com/repos/"+REPO+
   "/actions/runs/"+runId);
  assert.equal(opts.headers.authorization,"Bearer synthetic-host-read-token");
  return {
   ok:true,
   async json(){return {
    id:runId,event:"workflow_dispatch",run_attempt:1,
    status:"in_progress",head_sha:SHA,
    head_branch:"refactor/post-prof-plan-contracts-20261021",
    path:WORKFLOW,head_repository:{full_name:REPO},
    created_at:new Date().toISOString()
   };}
  };
 };
 return {admissionStore:store,pins,checkoutSha:SHA,keyFile:file,
  githubApiToken:"synthetic-host-read-token",githubApiFetchFn,observed};
}

test("independently admitted private Engineer Host constructs all five Gemini models but never infers",async t=>{
 privateHost(t);
 const f=await fixture(t);
 const set=await createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f);
 assert.equal(Object.keys(set).length,0);
 assert.ok(set.planner.model instanceof Gemini);
 assert.ok(set.adaptive.model instanceof Gemini);
 assert.deepEqual(Object.keys(set.workers).sort(),
  ["backend","frontend","test"]);
 for(const role of ["backend","frontend","test"]){
  assert.ok(set.workers[role].model instanceof Gemini);
 }
 assert.equal(f.observed.calls,1);
 assert.throws(()=>JSON.stringify(set),/must not be serialized/u);
 await assert.rejects(
  createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f),
  deny
 );
 assert.equal(f.observed.calls,1,
  "A consumed admission must not make another GitHub REST request");
});

test("GitHub Actions cannot impersonate the private owner even with a real receipt",async t=>{
 privateHost(t);
 const f=await fixture(t);
 process.env.GITHUB_ACTIONS="true";
 await assert.rejects(
  createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f),deny
 );
 assert.equal(f.observed.calls,0);
 delete process.env.GITHUB_ACTIONS;
 const set=await createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f);
 assert.ok(set.workers.backend.model instanceof Gemini);
});

test("wrong source SHA and untrusted admission store fail before secret access",async t=>{
 privateHost(t);
 const f=await fixture(t);
 await assert.rejects(
  createDisposableLiveGeminiModelSetFromPrivateHostAdmission({
   ...f,checkoutSha:"b".repeat(40)
  }),deny
 );
 await assert.rejects(
  createDisposableLiveGeminiModelSetFromPrivateHostAdmission({
   ...f,admissionStore:{consume:async()=>({})}
  }),deny
 );
 assert.equal(f.observed.calls,0);
 const set=await createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f);
 assert.ok(set.planner.model instanceof Gemini);
});

test("stale or canceled run is rejected after one-use HMAC consumption, never retried",async t=>{
 privateHost(t);
 const f=await fixture(t);
 const original=f.githubApiFetchFn;
 f.githubApiFetchFn=async(...args)=>{
  const response=await original(...args);
  return {...response,async json(){
   return {...await response.json(),status:"completed"};
  }};
 };
 await assert.rejects(
  createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f),deny
 );
 assert.equal(f.observed.calls,1);
 f.githubApiFetchFn=original;
 await assert.rejects(
  createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f),deny
 );
 assert.equal(f.observed.calls,1);
});

test("foreign model in authenticated record cannot be reused after rejection",async t=>{
 privateHost(t);
 const f=await fixture(t,{model:"gemini-3.7-flash"});
 await assert.rejects(
  createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f),deny
 );
 assert.equal(f.observed.calls,0);
 await assert.rejects(
  createDisposableLiveGeminiModelSetFromPrivateHostAdmission(f),deny
 );
});
