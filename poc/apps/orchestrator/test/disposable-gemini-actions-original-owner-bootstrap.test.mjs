import test from "node:test";
import assert from "node:assert/strict";
import {assertDisposableActionsOriginalOwnerContext,
 prepareDisposableActionsOriginalOwnerFromManifest}
 from "../src/disposable-gemini-actions-original-owner-bootstrap.mjs";

const SHA="a".repeat(40);
const REPO="DarkGh0st03/delegation";
const REF="refs/heads/experiment/disposable-gemini-live-20261109";
const WORKFLOW=".github/workflows/gemini-authority-only-live-ci-pilot.yml";
const DENY=/Disposable Actions original owner bootstrap NO-GO/u;
const good=()=>({
 GITHUB_ACTIONS:"true",
 GITHUB_REPOSITORY:REPO,
 GITHUB_EVENT_NAME:"workflow_dispatch",
 GITHUB_REF:REF,
 GITHUB_WORKFLOW_REF:REPO+"/"+WORKFLOW+"@"+REF,
 GITHUB_RUN_ATTEMPT:"1",
 GITHUB_RUN_ID:"42784699654",
 GITHUB_SHA:SHA,
 DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
 DELEGATION_GEMINI_CHARGE_CONFIRMATION:
  "I AUTHORIZE GEMINI API CHARGES",
 DELEGATION_BILLING_CAP_ACK:
  "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
 DELEGATION_GATEWAY_ARCHITECTURE:"authority-only",
 APPROVED_RUNNER_NATIVE_MCP:"1",
 ENGINEER_CORE_NATIVE_MODE:"1"
});

test("Actions original owner pure contract is zero-inference and zero-Root",()=>{
 const result=assertDisposableActionsOriginalOwnerContext(good(),SHA);
 assert.equal(result.source_sha,SHA);
 assert.equal(result.real_gemini_calls_started_here,0);
 assert.equal(result.approval_signed_here,false);
 assert.equal(result.rust_root_issued_here,false);
 assert.equal(result.provider_spend_cap_verified_here,false);
});

test("foreign workflow, relaunch, stale checkout, secret leakage and scripted CI deny",()=>{
 const changes=[
  ["GITHUB_ACTIONS","false"],
  ["GITHUB_REPOSITORY","attacker/repository"],
  ["GITHUB_EVENT_NAME","push"],
  ["GITHUB_REF","refs/heads/main"],
  ["GITHUB_WORKFLOW_REF",REPO+"/"+WORKFLOW+"@refs/heads/main"],
  ["GITHUB_RUN_ATTEMPT","2"],
  ["GITHUB_RUN_ID","0"],
  ["GITHUB_SHA","b".repeat(40)],
  ["DELEGATION_DISPOSABLE_LIVE_MODE","scripted-native"],
  ["DELEGATION_GEMINI_CHARGE_CONFIRMATION","unknown"],
  ["DELEGATION_BILLING_CAP_ACK","unknown"],
  ["DELEGATION_GATEWAY_ARCHITECTURE","legacy"],
  ["APPROVED_RUNNER_NATIVE_MCP","0"],
  ["ENGINEER_CORE_NATIVE_MODE","0"],
  ["DELEGATION_LIVE_CI_PREFLIGHT_MODE","preflight-only"],
  ["DELEGATION_DISPOSABLE_CI_MODE","scripted-offline"],
  ["DELEGATION_SIGNED_GEMINI_PILOT","1"],
  ["GEMINI_API_KEY","unsafe"],
  ["GOOGLE_API_KEY","unsafe"],
  ["OPENAI_API_KEY","unsafe"],
  ["GH_TOKEN","unsafe"],
  ["GITHUB_TOKEN","unsafe"]
 ];
 for(const [name,value] of changes)
  assert.throws(()=>assertDisposableActionsOriginalOwnerContext({
   ...good(),[name]:value
  },SHA),DENY,name);
 assert.throws(()=>assertDisposableActionsOriginalOwnerContext(
  good(),"b".repeat(40)),DENY,"stale HEAD");
 assert.throws(()=>assertDisposableActionsOriginalOwnerContext(
  good(),"invalid"),DENY,"invalid HEAD");
 assert.throws(()=>assertDisposableActionsOriginalOwnerContext(
  null,SHA),DENY,"missing environment");
});

test("Actions protected-manifest composition is permanently NO-GO in free CI and with forged provider model sets",async()=>{
 await assert.rejects(prepareDisposableActionsOriginalOwnerFromManifest(),
  DENY);
 const fake={
  planner:{model:{}},adaptive:{model:{}},
  workers:{backend:{model:{}},frontend:{model:{}},test:{model:{}}}
 };
 const keys=[
  ...Object.keys(good()),
  "GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY","GH_TOKEN",
  "GITHUB_TOKEN","DELEGATION_LIVE_CI_PREFLIGHT_MODE"
 ];
 const previous=new Map(keys.map(k=>[k,process.env[k]]));
 for(const k of keys)delete process.env[k];
 Object.assign(process.env,good());
 try{
  await assert.rejects(prepareDisposableActionsOriginalOwnerFromManifest({
   models:fake,manifestFile:"/tmp/forged-owner.json",
   backendPrivateKeyFile:"/tmp/backend.key",
   geminiKeyFile:"/tmp/gemini.key",
   expectedSourceSha:SHA,githubApiToken:"synthetic-readonly-gh-token"
  }));
 }finally{
  for(const [key,value] of previous){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 }
});
