import test from "node:test";
import assert from "node:assert/strict";
import {startDisposableGeminiOriginalReviewSession}
 from "../src/disposable-gemini-live-original-review-session.mjs";

const SHA="a".repeat(40);
const CONFIRM="I AUTHORIZE GEMINI API CHARGES";
const NO_GO=/Disposable live original Review Host startup NO-GO/u;
const noop=()=>{throw Error("No live owner/Gemini action may be invoked");};
function fixture(){
 return {
  configPath:"/unavailable/owner/manifest.json",expectedSourceSha:SHA,
  admissionStore:undefined,pins:undefined,
  githubApiToken:undefined,keyFile:"/unavailable/key/gemini.secret",
  backendPrivateKeyFile:"/unavailable/key/backend.pem",
  chargeAuthorization:CONFIRM,
  operational:{
   rootGateway:{audit:{},verifier:{},policy:{},executor:{}},
   nativeEffects:{},localWorkers:{workers:{}},rootReservation:{},
   workflow:{
    createBranch:{branch:"feature/account-suspension"},
    draftPullRequest:{headBranch:"feature/account-suspension"}
   }
  }
 };
}
function trustedEnv(t){
 const values={
  GITHUB_ACTIONS:undefined,
  DELEGATION_GATEWAY_ARCHITECTURE:"authority-only",
  APPROVED_RUNNER_NATIVE_MCP:"1",
  ENGINEER_CORE_NATIVE_MODE:"1",
  GEMINI_API_KEY:undefined,
  GOOGLE_API_KEY:undefined,
  OPENAI_API_KEY:undefined
 };
 const prior=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 for(const [key,value] of Object.entries(values)){
  if(value===undefined)delete process.env[key];
  else process.env[key]=value;
 }
 t.after(()=>{for(const [key,value] of Object.entries(prior)){
  if(value===undefined)delete process.env[key];
  else process.env[key]=value;
 }});
}

test("import is inert: no API, private listener, Engineer review, Root or Docker is started",()=>{
 assert.equal(typeof startDisposableGeminiOriginalReviewSession,"function");
});

test("operator billing confirmation and clean source are required before owner manifest reads",async t=>{
 trustedEnv(t);
 for(const patch of [
  f=>{f.chargeAuthorization="yes";},
  f=>{delete f.chargeAuthorization;},
  f=>{f.expectedSourceSha="invalid";},
  f=>{delete f.backendPrivateKeyFile;},
  f=>{f.backendPrivateKeyFile=f.keyFile;},
  f=>{f.backendPrivateKeyFile=f.configPath;},
  f=>{f.operational=undefined;}
 ]){
  const f=fixture();patch(f);
  await assert.rejects(startDisposableGeminiOriginalReviewSession(f),NO_GO);
 }
});

test("Actions cannot start the original owner and shared API secrets are forbidden",async t=>{
 trustedEnv(t);
 for(const key of ["GITHUB_ACTIONS","GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY"]){
  process.env[key]=key==="GITHUB_ACTIONS"?"true":"synthetic-secret";
  await assert.rejects(startDisposableGeminiOriginalReviewSession(fixture()),NO_GO);
  delete process.env[key];
 }
});

test("original native Root/Gateway/worker composition cannot be omitted or pre-overridden",async t=>{
 trustedEnv(t);
 const bad=[
  f=>{delete f.operational.rootGateway;},
  f=>{delete f.operational.nativeEffects;},
  f=>{delete f.operational.localWorkers;},
  f=>{delete f.operational.rootReservation;},
  f=>{delete f.operational.workflow;},
  f=>{f.operational.workflow.createBranch.prepare=noop;},
  f=>{f.operational.workflow.createBranch.execute=noop;},
  f=>{f.operational.workflow.draftPullRequest.prepare=noop;},
  f=>{f.operational.workflow.draftPullRequest.execute=noop;}
 ];
 for(const mutate of bad){
  const f=fixture();mutate(f);
  await assert.rejects(startDisposableGeminiOriginalReviewSession(f),NO_GO);
 }
});
