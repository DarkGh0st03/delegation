import test from "node:test";
import assert from "node:assert/strict";
import {compilePlanningProposal}
  from "../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {makeIsolatedPlanningFixture}
  from "../run-gemini-planner-fixture.mjs";
import {compareSavedF1PlannerRuns}
  from "../f1-planner-offline-comparison.mjs";

const fixture=makeIsolatedPlanningFixture("department-directory");
const SHA=fixture.snapshot.base_revision;
const SERVICE="apps/backend/src/users/user.service.ts";
const ROUTES="apps/backend/src/users/user.routes.ts";
const API="apps/frontend/src/api/users-api.ts";
const UI="apps/frontend/src/pages/UserDetailPage.tsx";
const TEST="tests/backend/user.routes.test.ts";
function proposal(withRegressionTests){
  const p=(operation,path,reason)=>({operation,path,reason});
  const raw={tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Isolate work",
      description:"Create branch",depends_on:[],permissions:[
        p("create_branch",null,"Separate main")]},
    {id:"backend",agent_id:"backend",title:"Implement backend",
      description:"Filter directory by department",depends_on:["branch"],
      permissions:[
        p("read_file",SERVICE,"Read service"),
        p("update_file",SERVICE,"Filter department"),
        p("update_file",ROUTES,"Authenticated route")]},
    {id:"frontend",agent_id:"frontend",title:"Implement UI",
      description:"Accessible search",depends_on:["backend"],
      permissions:[
        p("update_file",API,"API query"),
        p("update_file",UI,"Accessible filters")]},
    {id:"tests",agent_id:"test",title:"Regression and acceptance",
      description:"Verify authenticated and rejected searches",
      depends_on:["frontend"],
      permissions:[
        ...(withRegressionTests?[p("update_file",TEST,"Implement regression tests")]:[]),
        p("run_tests",null,"Run acceptance")]},
    {id:"pr",agent_id:"orchestrator",title:"Request review",
      description:"Open PR without merge",
      depends_on:["tests"],permissions:[
        p("create_pull_request",null,"Engineer review")]}
  ],assumptions:[],uncertainties:[]};
  return {
    ...compilePlanningProposal(raw,{
      snapshot:fixture.snapshot,requirement:fixture.spec.requirement,
      planId:withRegressionTests?"research-complete":"research-incomplete",
      workBranch:fixture.spec.workBranch,agents:fixture.agents
    }),verified_source_reads:2
  };
}
function observations(plan){
  return [
    {kind:"model_turn",turn:1,status:"started"},
    {kind:"read",turn:1,status:"verified",tool:"read_file",path:SERVICE},
    {kind:"read",turn:1,status:"verified",tool:"read_file",path:ROUTES},
    {kind:"proposal",status:"unapproved",digest:plan.digest,
      verified_source_reads:2}
  ];
}
test("F1 offline comparison distinguishes technical validity from regression-test completeness",()=>{
  const good=proposal(true),incomplete=proposal(false);
  const report=compareSavedF1PlannerRuns({
    expectedBaseRevision:SHA,
    runs:[
      {label:"test_only",proposal:incomplete,
        observations:observations(incomplete)},
      {label:"test_implementation",proposal:good,
        observations:observations(good)}
    ]
  });
  assert.equal(report.compared_runs,2);
  assert.equal(report.model_call_count_during_comparison,0);
  assert.equal(report.provider_charge_incurred_by_comparison,false);
  assert.equal(report.rows[0].label,"test_implementation");
  assert.equal(report.rows[0].technical_preflight_pass,true);
  assert.equal(report.rows[0].functional_design_plausible,true);
  assert.equal(report.rows[1].technical_preflight_pass,true);
  assert.equal(report.rows[1].functional_design_plausible,false);
  assert.ok(report.rows[1].missing_functional_checks.includes(
    "explicit_test_implementation"));
  assert.equal(report.rows[0].real_gemini_inference_authenticated,false);
  assert.equal(report.rows[0].engineer_approved,false);
  assert.equal(report.external_r5_go,false);
  assert.equal(JSON.stringify(report).includes("Filter department"),false);
});
test("F1 offline comparison denies unverified/tampered proposal digest and mismatched source",()=>{
  const p=proposal(true);
  for(const bad of [
    {...p,digest:"f".repeat(64)},
    {...p,plan:{...p.plan,base_revision:"f".repeat(40)}},
    {...p,status:"approved_plan"},
    {...p,approval:{approved:true}}
  ]){
    assert.throws(()=>compareSavedF1PlannerRuns({
      expectedBaseRevision:SHA,
      runs:[{label:"one",proposal:bad,observations:observations(p)}]
    }),/NO-GO/);
  }
});
test("F1 offline comparison refuses duplicate labels, empty reports and oversized model traces",()=>{
  const p=proposal(false);
  const one={label:"one",proposal:p,observations:observations(p)};
  for(const runs of [
    [],[one,one],
    [{...one,label:"../secrets"}],
    [{...one,observations:Array.from({length:513},()=>({}))}]
  ])assert.throws(()=>compareSavedF1PlannerRuns({
    expectedBaseRevision:SHA,runs
  }),/NO-GO/);
});
