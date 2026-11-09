import test from "node:test";
import assert from "node:assert/strict";
import {Gemini} from "@google/adk";
import {createDisposableLiveGeminiModelSet}
 from "../src/disposable-gemini-live-model-set.mjs";
import {bindDisposableLiveGeminiCanonicalInputs}
 from "../src/disposable-gemini-live-canonical-binding.mjs";

const SHA="a".repeat(40);
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const roles=["backend","frontend","test"];
function models(){
 const env={
  GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:REF,
  GITHUB_WORKFLOW_REF:"DarkGh0st03/delegation/.github/workflows/gemini-authority-only-live-ci-pilot.yml@"+REF,
  GITHUB_RUN_ATTEMPT:"1",GITHUB_RUN_ID:"12345",GITHUB_SHA:SHA,
  DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:
   "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  GEMINI_API_KEY:"synthetic-no-network-key"
 };
 return createDisposableLiveGeminiModelSet({env,checkoutSha:SHA});
}
const noop=()=>{};
function fixture(){
 const store={preserved:true};
 const observer=()=>{};
 const authority={
  planner:{planId:"original-plan",onObservation:observer},
  workBranch:"feature/account-suspension",
  trustedAgentRegistry:{
   orchestrator:{did:"did:original:orchestrator"},
   backend:{did:"did:original:backend"},
   frontend:{did:"did:original:frontend"},
   test:{did:"did:original:test"}
  },
  checkpoint:{store},approval:{signed:true}
 };
 const branch={
  branch:"feature/account-suspension",baseBranch:"main",
  permission:{operation:"create_branch",resource:"gitea://original"},
  prepare:noop,execute:noop
 };
 const pr={
  headBranch:"feature/account-suspension",baseBranch:"main",
  title:"Original native PR",body:"Proof",
  permission:{operation:"create_pull_request",resource:"gitea://original"},
  prepare:noop,execute:noop
 };
 const operational={
  nativeEffects:{original:true},
  rootReservation:{original:true},
  workflow:{
   adaptive:{nextChildParameters:noop,requireVerifiedRepairDiagnostic:true},
   createBranch:branch,draftPullRequest:pr
  },
  localWorkers:{
   directory:"/private/native-workers",
   workers:{
    backend:{port:9111,adk:{
     gatewayBaseUrl:"http://127.0.0.1:8081",adapterToken:"original-backend"}},
    frontend:{port:9112,adk:{
     gatewayBaseUrl:"http://127.0.0.1:8081",adapterToken:"original-frontend"}},
    test:{port:9113,adk:{
     gatewayBaseUrl:"http://127.0.0.1:8081",adapterToken:"original-test"}}
   }
  }
 };
 return {authority,operational};
}

test("original Review Host, native transports and exactly three workers receive the consented Gemini models without inference",()=>{
 const f=fixture(), set=models();
 const bound=bindDisposableLiveGeminiCanonicalInputs({...f,models:set});
 assert.equal(bound.authority.checkpoint,f.authority.checkpoint);
 assert.equal(bound.authority.approval,f.authority.approval);
 assert.equal(bound.authority.planner.planId,"original-plan");
 assert.equal(bound.authority.planner.onObservation,
  f.authority.planner.onObservation);
 assert.equal(bound.operational.nativeEffects,f.operational.nativeEffects);
 assert.equal(bound.operational.rootReservation,f.operational.rootReservation);
 assert.equal(bound.operational.workflow.createBranch.permission,
  f.operational.workflow.createBranch.permission);
 assert.equal(bound.operational.workflow.createBranch.prepare,noop);
 assert.equal(bound.operational.workflow.draftPullRequest.execute,noop);
 assert.equal(bound.authority.planner.model,set.planner.model);
 assert.equal(bound.operational.workflow.adaptive.model,set.adaptive.model);
 assert.equal(bound.operational.workflow.createBranch.model,set.adaptive.model);
 assert.equal(bound.operational.workflow.draftPullRequest.model,set.adaptive.model);
 assert.equal(bound.operational.workflow.adaptive.maxSteps,25);
 assert.deepEqual(Object.keys(bound.operational.localWorkers.workers).sort(),
  [...roles].sort());
 for(const role of roles){
  const current=bound.operational.localWorkers.workers[role];
  assert.ok(current.adk.model instanceof Gemini);
  assert.equal(current.adk.model,set.workers[role].model);
  assert.equal(current.adk.adapterToken,
   f.operational.localWorkers.workers[role].adk.adapterToken);
 }
 assert.equal("reviewer" in bound.operational.localWorkers.workers,false);
 assert.equal(Object.isFrozen(bound.operational.workflow),true);
 assert.equal(Object.isFrozen(bound.operational.localWorkers.workers),true);
});

test("a forged or hand-written model set cannot inject a provider into canonical authority",()=>{
 const f=fixture(),set=models();
 for(const fake of [
  null,{},{
   planner:set.planner,adaptive:set.adaptive,workers:set.workers
  }
 ])assert.throws(()=>bindDisposableLiveGeminiCanonicalInputs({
  ...f,models:fake
 }),/NO-GO/u);
});

test("fail closed on model override, extra role, legacy bypass and source mismatch",()=>{
 const set=models();
 const mutations=[
  f=>{f.authority.planner.model=set.planner.model;},
  f=>{f.authority.trustedAgentRegistry.reviewer={did:"did:reviewer"};},
  f=>{f.operational.localWorkers.workers.reviewer={
   port:9114,adk:{gatewayBaseUrl:"http://127.0.0.1:8081",adapterToken:"reviewer-priv"}
  };},
  f=>{f.operational.workflow.adaptive.model=set.adaptive.model;},
  f=>{f.operational.workflow.adaptive.maxSteps=99;},
  f=>{f.operational.workflow.createBranch.model=set.adaptive.model;},
  f=>{f.operational.workflow.draftPullRequest.headBranch="main";},
  f=>{f.operational.workflow.sdk={bypass:true};},
  f=>{delete f.operational.localWorkers;},
  f=>{f.operational.localWorkers.workers.frontend.adk.model=set.workers.frontend.model;},
  f=>{f.operational.localWorkers.workers.test.port=9111;},
  f=>{f.operational.localWorkers.workers.test.adk.adapterToken="";},
  f=>{f.authority.workBranch="main";}
 ];
 for(const patch of mutations){
  const f=fixture();patch(f);
  assert.throws(
   ()=>bindDisposableLiveGeminiCanonicalInputs({...f,models:set}),
   /NO-GO/u
  );
 }
});
