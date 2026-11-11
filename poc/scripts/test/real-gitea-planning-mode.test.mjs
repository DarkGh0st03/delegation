import test from "node:test";
import assert from "node:assert/strict";
import {verifyRealGiteaPlanningMode,REAL_GITEA_PLANNER_WORKFLOW,
  REGISTERED_SIGNED_PILOT_WORKFLOW,DEFAULT_REGISTERED_WORKFLOW}
  from "../real-gitea-planning-mode.mjs";
const sha="a".repeat(40);
const paid=()=>({
  APPROVED_RUNNER_REAL_GITEA_PLANNING_ONLY:"1",
  PLANNING_REAL_GITEA_ONLY:"1",
  DELEGATION_F1_PAID_PLANNING_ONLY:"1",
  DELEGATION_SIGNED_GEMINI_PILOT:"1",
  APPROVED_RUNNER_SCENARIO:"account-suspension",
  GITHUB_WORKFLOW:REAL_GITEA_PLANNER_WORKFLOW,
  GITHUB_ACTIONS:"true",
  GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",
  GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_REF:"refs/heads/refactor/post-prof-plan-contracts-20261021",
  GITHUB_SHA:sha,
  GITHUB_RUN_ID:"41499900000",
  DELEGATION_PINNED_COMMIT_SHA:sha,
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:
    "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  DELEGATION_GEMINI_MODEL:"gemini-3.8-flash",
  DELEGATION_GEMINI_REPAIR_CHARGE_CONFIRMATION:
    "NO ADDITIONAL REPAIR AUTHORIZED",
  DELEGATION_SIGNED_GEMINI_REPAIR_D1:"0",
  GEMINI_API_KEY:"SYNTHETIC_TEST_ONLY_NO_PROVIDER_CONNECTION"
});
test("only a separately authorized manual paid run reaches real-Gitea Gemini mode",()=>{
 const env=paid();
 assert.equal(verifyRealGiteaPlanningMode(env),"gemini");
 assert.equal(verifyRealGiteaPlanningMode(env,{parent:true}),"gemini");
 assert.deepEqual(verifyRealGiteaPlanningMode({...env,
   DELEGATION_F1_PAID_PLANNING_ONLY:"0",
   DELEGATION_SIGNED_GEMINI_PILOT:"0",GEMINI_API_KEY:""}),"scripted");
});
test("default-registered paid pilot can host F1 ONLY with explicit planning selector",()=>{
 const env={...paid(),GITHUB_WORKFLOW:REGISTERED_SIGNED_PILOT_WORKFLOW,
   DELEGATION_F1_EXECUTION_MODE:"planning-only"};
 assert.equal(verifyRealGiteaPlanningMode(env),"gemini");
 assert.equal(verifyRealGiteaPlanningMode(env,{parent:true}),"gemini");
 assert.equal(verifyRealGiteaPlanningMode({
   ...env,GITHUB_WORKFLOW:DEFAULT_REGISTERED_WORKFLOW
 }),"gemini");
 assert.equal(verifyRealGiteaPlanningMode({
   ...env,GITHUB_WORKFLOW:DEFAULT_REGISTERED_WORKFLOW
 },{parent:true}),"gemini");
 for(const selector of [undefined,"full-d0","", "planning_only"]){
   const bad={...env,DELEGATION_F1_EXECUTION_MODE:selector};
   assert.throws(()=>verifyRealGiteaPlanningMode(bad),/NO-GO/);
   assert.throws(()=>verifyRealGiteaPlanningMode(bad,{parent:true}),/NO-GO/);
 }
});
test("dry-run Planning-only never accepts an inherited Gemini key or paid flag",()=>{
 const env={PLANNING_REAL_GITEA_ONLY:"1",
   APPROVED_RUNNER_REAL_GITEA_PLANNING_ONLY:"1",
   DELEGATION_SIGNED_GEMINI_PILOT:"0",GEMINI_API_KEY:""};
 assert.equal(verifyRealGiteaPlanningMode(env),"scripted");
 assert.equal(verifyRealGiteaPlanningMode(env,{parent:true}),"scripted");
 assert.throws(()=>verifyRealGiteaPlanningMode({...env,GEMINI_API_KEY:"inherited-secret"}),/NO-GO/);
 assert.throws(()=>verifyRealGiteaPlanningMode({...env,
   DELEGATION_F1_PAID_PLANNING_ONLY:"1"}),/NO-GO/);
 assert.throws(()=>verifyRealGiteaPlanningMode({...env,
   DELEGATION_SIGNED_GEMINI_PILOT:"1"}),/NO-GO/);
});
test("wrong workflow, SHA, event, re-run, cap, consent, agent repair and missing key deny",()=>{
 const choices=[
  x=>{x.GITHUB_WORKFLOW="Gemini Real - Refactor Signed DAG Account Suspension Pilot (Manual Only)";},
  x=>{x.GITHUB_EVENT_NAME="push";},
  x=>{x.GITHUB_RUN_ATTEMPT="2";},
  x=>{x.DELEGATION_PINNED_COMMIT_SHA="b".repeat(40);},
  x=>{x.DELEGATION_GEMINI_CHARGE_CONFIRMATION="";},
  x=>{x.DELEGATION_BILLING_CAP_ACK="";},
  x=>{x.GEMINI_API_KEY="";},
  x=>{x.DELEGATION_GEMINI_MODEL="other-model";},
  x=>{x.APPROVED_RUNNER_SCENARIO="department-directory";},
  x=>{x.DELEGATION_SIGNED_GEMINI_REPAIR_D1="1";},
  x=>{x.APPROVED_RUNNER_NATIVE_OWNER_REPAIR_D1="1";}
 ];
 for(const mutate of choices){
   const env=paid();mutate(env);
   assert.throws(()=>verifyRealGiteaPlanningMode(env),/NO-GO/);
   assert.throws(()=>verifyRealGiteaPlanningMode(env,{parent:true}),/NO-GO/);
 }
});
test("parent and child cannot enable paid mode without their own opt-in",()=>{
 const env=paid();env.PLANNING_REAL_GITEA_ONLY="0";
 assert.throws(()=>verifyRealGiteaPlanningMode(env),/NO-GO/);
 const other=paid();other.APPROVED_RUNNER_REAL_GITEA_PLANNING_ONLY="0";
 assert.throws(()=>verifyRealGiteaPlanningMode(other,{parent:true}),/NO-GO/);
});
test("no planning-only flag leaves other test paths unchanged",()=>{
 assert.equal(verifyRealGiteaPlanningMode({
   DELEGATION_SIGNED_GEMINI_PILOT:"0",GEMINI_API_KEY:""
 }),"other");
 assert.throws(()=>verifyRealGiteaPlanningMode({
   DELEGATION_F1_PAID_PLANNING_ONLY:"1"
 }),/NO-GO/);
});
