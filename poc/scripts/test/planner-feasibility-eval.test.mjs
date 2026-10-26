import test from "node:test";
import assert from "node:assert/strict";
import {evaluatePlannerFeasibility} from "../planner-feasibility-eval.mjs";

const SHA="a".repeat(40);
const root="gitea://gitea.local/thesis/iam-console-poc";
const file=path=>root+"/branches/feature%2Fplanner-feasibility/files/"+path;
const anchors={
  backend:["apps/backend/src/users/user.service.ts",
    "apps/backend/src/users/user.routes.ts"],
  frontend:["apps/frontend/src/api/users-api.ts",
    "apps/frontend/src/pages/UserDetailPage.tsx"],
  test:["tests/backend/user.service.test.ts"]
};
function example(){
  const grants=[
    {agent_id:"orchestrator",operation:"create_branch",resource:root},
    ...Object.entries(anchors).flatMap(([role,paths])=>paths.map(p=>({
      agent_id:role,operation:"update_file",resource:file(p)
    }))),
    {agent_id:"orchestrator",operation:"create_pull_request",resource:root}
  ];
  return {
    proposal:{status:"unapproved_proposal",digest:"b".repeat(64),
      verified_source_reads:2,plan:{
        repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"},
        base_revision:SHA,tasks:[{agent_id:"orchestrator"},{agent_id:"backend"},
          {agent_id:"frontend"},{agent_id:"test"}],requested_permissions:grants
      }},
    observations:[
      {kind:"model_turn",status:"started",turn:1},
      {kind:"read",status:"verified",tool:"read_file",path:anchors.backend[0]},
      {kind:"model_turn",status:"started",turn:2},
      {kind:"read",status:"verified",tool:"read_file",path:anchors.frontend[0]},
      {kind:"model_turn",status:"started",turn:3},
      {kind:"proposal",status:"unapproved",digest:"b".repeat(64),verified_source_reads:2}
    ]
  };
}
const evaluate=(x,scenario="account-suspension")=>evaluatePlannerFeasibility({
  scenario,expectedBaseRevision:SHA,...x
});

test("representative offline trace passes only diagnostic criteria",()=>{
  const report=evaluate(example());
  assert.equal(report.technical_preflight_pass,true);
  assert.equal(report.evidence.model_turn_attempts,3);
  assert.equal(report.limitations.delegated_execution,"not_tested");
});

test("missing source-read trace never passes on model output alone",()=>{
  const x=example();
  x.observations=x.observations.filter(e=>e.kind!=="read");
  const report=evaluate(x);
  assert.equal(report.technical_preflight_pass,false);
  assert.ok(report.criteria.some(c=>
    c.key==="independent_source_discovery"&&!c.pass));
});

test("unexpected write path and incorrect pinned SHA are independently flagged",()=>{
  const x=example();
  x.proposal.plan.requested_permissions.push({
    agent_id:"backend",operation:"update_file",resource:file(".env.production")
  });
  x.proposal.plan.base_revision="c".repeat(40);
  const report=evaluate(x);
  assert.equal(report.technical_preflight_pass,false);
  assert.equal(report.criteria.find(c=>
    c.key==="known_tools_and_baseline_files").pass,false);
  assert.equal(report.criteria.find(c=>c.key==="pinned_identity").pass,false);
});

test("the second software requirement has a distinct reference test anchor",()=>{
  const x=example();
  const grant=x.proposal.plan.requested_permissions.find(p=>p.agent_id==="test");
  grant.resource=file("tests/backend/user.routes.test.ts");
  assert.equal(evaluate(x,"department-directory").technical_preflight_pass,true);
  assert.equal(evaluate(x,"account-suspension").technical_preflight_pass,false);
});

test("missing trace or unrecognized scenario fails explicitly",()=>{
  assert.throws(()=>evaluate({...example(),observations:null}),/invalid/);
  assert.throws(()=>evaluate(example(),"third-case"),/unsupported/);
});

test("denied reads or an inconsistent final digest prevent a positive result",()=>{
  const x=example();
  x.observations.push({kind:"read",status:"denied",
    tool:"read_file",reason:"outside_planning_scope"});
  assert.equal(evaluate(x).technical_preflight_pass,false);
  const y=example();
  y.observations[y.observations.length-1].digest="e".repeat(64);
  assert.equal(evaluate(y).technical_preflight_pass,false);
});

test("actual trusted-owner review packet can be scored without treating it as approval",()=>{
  const x=example();
  x.proposal.status="awaiting_engineer_signature";
  x.proposal.plan_digest=x.proposal.digest;
  delete x.proposal.digest;
  const report=evaluate(x);
  assert.equal(report.technical_preflight_pass,true);
  assert.equal(report.evaluated_artifact,"engineer_review_packet");
  assert.equal(report.limitations.signed_engineer_approval,"not_tested");
});
