import test from "node:test";
import assert from "node:assert/strict";
import {assessF1DepartmentDirectoryPlan}
  from "../f1-department-directory-functional-review.mjs";
const SHA="a".repeat(40);
const ROOT="gitea://gitea.local/thesis/iam-console-poc";
const BRANCH=ROOT+"/branches/feature%2Fdepartment-directory";
function example({testsWritten=true}={}){
  const tasks=[
    {id:"branch",agent_id:"orchestrator",depends_on:[]},
    {id:"backend",agent_id:"backend",depends_on:["branch"]},
    {id:"frontend",agent_id:"frontend",depends_on:["backend"]},
    {id:"tests",agent_id:"test",depends_on:["frontend"]},
    {id:"pr",agent_id:"orchestrator",depends_on:["tests"]}
  ];
  const grant=(task_id,agent_id,operation,path)=>({
    task_id,agent_id,operation,
    resource:path?BRANCH+"/files/"+path:
      operation==="run_tests"?BRANCH:ROOT
  });
  const requested_permissions=[
    grant("branch","orchestrator","create_branch"),
    grant("backend","backend","update_file","apps/backend/src/users/user.service.ts"),
    grant("backend","backend","update_file","apps/backend/src/users/user.routes.ts"),
    grant("frontend","frontend","update_file","apps/frontend/src/api/users-api.ts"),
    grant("frontend","frontend","update_file","apps/frontend/src/pages/UserDetailPage.tsx"),
    ...(testsWritten?[grant("tests","test","update_file",
      "tests/backend/user.routes.test.ts")]:[]),
    grant("tests","test","run_tests"),
    grant("pr","orchestrator","create_pull_request")
  ];
  return {status:"unapproved_proposal",plan:{
    base_revision:SHA,
    repository:{authority:"gitea.local",owner:"thesis",
      repository:"iam-console-poc"},
    tasks,requested_permissions
  }};
}
test("F1 functional rubric finds a plausible complete department directory plan without approving it",()=>{
  const r=assessF1DepartmentDirectoryPlan({
    proposal:example(),expectedBaseRevision:SHA
  });
  assert.equal(r.functional_design_plausible,true);
  assert.equal(r.checked_count,11);
  assert.equal(r.failed_checks.length,0);
  assert.equal(r.human_review_completed,false);
  assert.equal(r.implementation_correctness_proven,false);
  assert.equal(r.execution_permitted,false);
  assert.equal(r.external_r5_go,false);
});
test("F1 signed-DAG-style fixture with only run_tests is NOT functionally complete",()=>{
  const r=assessF1DepartmentDirectoryPlan({
    proposal:example({testsWritten:false}),expectedBaseRevision:SHA
  });
  assert.equal(r.functional_design_plausible,false);
  assert.ok(r.failed_checks.includes("explicit_test_implementation"));
  assert.equal(r.human_review_completed,false);
});
test("F1 rubric detects wrong SHA, missing backend HTTP, UI, delayed tests and PR dependencies",()=>{
  const edits=[
    x=>{x.plan.base_revision="b".repeat(40);},
    x=>{x.plan.requested_permissions=x.plan.requested_permissions.filter(g=>
      !g.resource.endsWith("user.routes.ts"));},
    x=>{x.plan.requested_permissions=x.plan.requested_permissions.filter(g=>
      !g.resource.endsWith("UserDetailPage.tsx"));},
    x=>{x.plan.tasks.find(t=>t.id==="tests").depends_on=["branch"];},
    x=>{x.plan.tasks.find(t=>t.id==="pr").depends_on=["backend"];}
  ];
  for(const change of edits){
    const x=example();change(x);
    const r=assessF1DepartmentDirectoryPlan({
      proposal:x,expectedBaseRevision:SHA
    });
    assert.equal(r.functional_design_plausible,false);
    assert.ok(r.failed_checks.length>0);
  }
});
test("F1 quality report never infers autonomy from an unsigned proposal",()=>{
  const q=assessF1DepartmentDirectoryPlan({proposal:example(),
    expectedBaseRevision:SHA});
  const serialized=JSON.stringify(q);
  assert.ok(!serialized.includes("api_key"));
  assert.equal(q.real_gemini_inference_proven,false);
  assert.throws(()=>assessF1DepartmentDirectoryPlan({
    proposal:{status:"approved_plan",plan:example().plan},
    expectedBaseRevision:SHA
  }),/unavailable/);
});
