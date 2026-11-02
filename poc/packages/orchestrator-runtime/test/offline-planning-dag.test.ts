import test from "node:test";
import assert from "node:assert/strict";
import {compilePlanningProposal} from "../src/trusted-adk-planner.ts";
import {makeOfflineReviewableDag} from "./fixtures/offline-planning-dag.mjs";

const snapshot={
  session_id:"alt-project-session",
  repository:{authority:"gitea.local",owner:"demo",repository:"inventory-ui"},
  base_revision:"a".repeat(40),
  directories:["","lib","lib/api","ui","ui/components","tests","tests/e2e"],
  files:["lib/api/inventory.ts","ui/components/inventory.tsx"]
};
const edits={backend:["lib/api/inventory.ts"],
  frontend:["ui/components/inventory.tsx"]};
const agents={
  backend:{did:"did:example:backend",card_ref:"trusted:backend"},
  frontend:{did:"did:example:frontend",card_ref:"trusted:frontend"},
  test:{did:"did:example:test",card_ref:"trusted:test"}
};
const config={
  snapshot,requirement:"Show inventory status from the API",
  planId:"inventory-demo",workBranch:"feature/inventory-status",agents
};
test("offline draft is project-independent and compiles to an unapproved plan",()=>{
  const sketch=makeOfflineReviewableDag({
    snapshot,edits,newTestFile:"tests/e2e/inventory.spec.ts"});
  const output=compilePlanningProposal(sketch,config);
  assert.equal(output.status,"unapproved_proposal");
  assert.equal(output.plan.repository.repository,"inventory-ui");
  assert.deepEqual(output.plan.tasks.map(t=>t.id),
    ["branch","backend","frontend","test","pr"]);
  assert.deepEqual(output.plan.tasks[2].depends_on,["branch"]);
  assert.deepEqual(output.plan.tasks[3].depends_on,["backend","frontend"]);
  assert.deepEqual(output.plan.tasks[4].depends_on,["test"]);
  assert.equal(output.plan.requested_permissions.length,8);
  assert.equal(output.plan.base_revision,snapshot.base_revision);
  assert.equal("approval" in output,false);
  assert.equal("signed_vp" in output,false);
});
test("offline draft refuses missing files, overlaps and path traversal",()=>{
  const opts={snapshot,edits,newTestFile:"tests/e2e/inventory.spec.ts"};
  for(const intent of [
    {backend:["private/secrets.env"],frontend:edits.frontend},
    {backend:["lib/api/inventory.ts"],frontend:["lib/api/inventory.ts"]},
    {backend:["../outside.ts"],frontend:edits.frontend},
    {backend:[],frontend:edits.frontend}
  ]){
    assert.throws(()=>makeOfflineReviewableDag({...opts,edits:intent}),
      /Offline Planning intent/);
  }
  for(const path of [
    "../../config/secrets.env","other/new.spec.ts",
    "lib/api/inventory.ts","tests/e2e/../bypass.ts"
  ]){
    assert.throws(()=>makeOfflineReviewableDag({...opts,newTestFile:path}),
      /Offline Planning intent/);
  }
});
test("offline draft does not gain permission from untrusted fixture payload",()=>{
  const restricted={...snapshot,files:["lib/api/inventory.ts"]};
  assert.throws(()=>makeOfflineReviewableDag({
    snapshot:restricted,edits,newTestFile:"tests/e2e/inventory.spec.ts"
  }),/file absent from trusted inventory/);
});

test("opt-in generated Backend failure has separate signed create, read, update and test Tasks",()=>{
  const scoped={...snapshot,directories:[...snapshot.directories,"tests/backend"]};
  const scenario={
    snapshot:scoped,edits,newTestFile:"tests/e2e/inventory.spec.ts",
    generatedBackendTestFile:"tests/backend/generated-status.test.ts",
    splitTestTasks:true
  };
  const sketch=makeOfflineReviewableDag(scenario);
  assert.deepEqual(sketch.tasks.map(task=>task.id),
    ["branch","backend","frontend","test-preparation","test","pr"]);
  const prep=sketch.tasks.find(task=>task.id==="test-preparation");
  const validation=sketch.tasks.find(task=>task.id==="test");
  assert.deepEqual(prep.permissions.filter(p=>
    p.path==="tests/backend/generated-status.test.ts").map(p=>p.operation),["create_file"]);
  assert.deepEqual(validation.permissions.filter(p=>
    p.path==="tests/backend/generated-status.test.ts").map(p=>p.operation),
    ["read_file","update_file"]);
  assert.deepEqual(validation.permissions.filter(p=>
    p.operation==="run_tests").map(p=>p.operation),["run_tests"]);
  assert.deepEqual(validation.depends_on,["test-preparation"]);
  const compiled=compilePlanningProposal(sketch,{...config,snapshot:scoped});
  assert.equal(compiled.status,"unapproved_proposal");
  assert.equal(compiled.plan.tasks.filter(t=>t.agent_id==="test").length,2);
  assert.equal("approval" in compiled,false);
});
test("generated project-Test authority is never inferred from Test creation alone",()=>{
  const scoped={...snapshot,directories:[...snapshot.directories,"tests/backend"]};
  const base={snapshot:scoped,edits,newTestFile:"tests/e2e/inventory.spec.ts",splitTestTasks:true};
  for(const invalid of [
    "../secret.test.ts","tests/backend/../../secret.test.ts",
    "tests/backend/../secret.test.ts","tests/e2e/inventory.spec.ts",
    "tests/backend/untracked.ts","tests/frontend/other.test.ts"
  ]){
    assert.throws(()=>makeOfflineReviewableDag({...base,generatedBackendTestFile:invalid}),
      /Offline Planning intent/);
  }
  assert.throws(()=>makeOfflineReviewableDag({
    ...base,splitTestTasks:false,
    generatedBackendTestFile:"tests/backend/generated-status.test.ts"
  }),/Offline Planning intent/);
  assert.throws(()=>makeOfflineReviewableDag({
    ...base,snapshot,
    generatedBackendTestFile:"tests/backend/generated-status.test.ts"
  }),/Offline Planning intent/);
});

test("newly-created Test file may be edited only after its signed creator Task",()=>{
 const scoped={...snapshot,directories:[...snapshot.directories,"tests/backend"]};
 const base={
  snapshot:scoped,edits,newTestFile:"tests/e2e/inventory.spec.ts",
  generatedBackendTestFile:"tests/backend/generated-status.test.ts",
  splitTestTasks:true
 };
 const permitted=makeOfflineReviewableDag(base);
 assert.equal(compilePlanningProposal(permitted,{...config,snapshot:scoped})
  .status,"unapproved_proposal");
 const invalidCases=[
  // No original create permission for the same file: a future path alone
  // is NEVER permission to read or write a speculative repository resource.
  sketch=>{
   sketch.tasks.find(t=>t.id==="test-preparation").permissions=
    sketch.tasks.find(t=>t.id==="test-preparation").permissions.filter(p=>
     p.path!=="tests/backend/generated-status.test.ts");
  },
  // A Test validator that runs without the create Task as an ancestor must
  // fail, even though both Task descriptions refer to the same path.
  sketch=>{
   sketch.tasks.find(t=>t.id==="test").depends_on=["backend","frontend"];
  },
  // A later Test may not claim read/write of a DIFFERENT uncreated file.
  sketch=>{
   for(const permission of sketch.tasks.find(t=>t.id==="test").permissions){
    if(permission.path==="tests/backend/generated-status.test.ts")
     permission.path="tests/backend/uncreated.test.ts";
   }
  }
 ];
 for(const mutate of invalidCases){
  const draft=structuredClone(permitted);
  mutate(draft);
  assert.throws(()=>compilePlanningProposal(draft,{...config,snapshot:scoped}),
    /file absent from trusted Planning snapshot/);
 }
});

test("demo lifecycle contract survives plan approval and initial/D1 task instructions",async()=>{
 const {getApprovedOfflineScenario}=await import("../../../apps/test-runner-controller/fixtures/approved-scenarios.mjs");
 const {makeApproval,assertApprovedPlanScope}=await import("../../plan-contracts/src/plan.mjs");
 const {RUST_OPERATIONS}=await import("../../../apps/gateway/src/operation-catalog.ts");
 const {approvedTaskInstruction}=await import("../src/approved-task-instruction.ts");
 const requirement=getApprovedOfflineScenario("account-suspension").requirement;
 assert.ok(requirement.length<4000,"fits both Planner and D1 requirement budgets");
 for(const invariant of ["HTTP 409","disable","delayed","profile","x-demo-role: admin","/reactivate"])
  assert.ok(requirement.includes(invariant),invariant);
 const sketch=makeOfflineReviewableDag({snapshot,edits,newTestFile:"tests/e2e/inventory.spec.ts"});
 const proposal=compilePlanningProposal(sketch,{...config,requirement});
 const allowedOperations=new Set(RUST_OPERATIONS);
 const approval=makeApproval(proposal.plan,{allowedOperations,
  decision_id:"lifecycle-review",approved_by:"did:example:engineer",
  approved_at:"2026-11-02T00:00:00Z",
  approved_permission_ids:proposal.plan.requested_permissions.map(p=>p.id)});
 assertApprovedPlanScope(proposal.plan,approval,{allowedOperations,expectedEngineerDid:"did:example:engineer"});
 for(const task of proposal.plan.tasks.filter(t=>t.agent_id!=="orchestrator")){
  for(const repairEditor of [false,true]){
   const instruction=approvedTaskInstruction(proposal.plan.requirement,task.description,{repairEditor});
   const data=JSON.parse(instruction.split("\n")[1]);
   assert.equal(data.approved_requirement,requirement);
   assert.equal(data.task_brief,task.description);
  }
 }
 const altered=structuredClone(proposal.plan);
 altered.requirement="Accept repeated transitions silently";
 assert.throws(()=>assertApprovedPlanScope(altered,approval,{allowedOperations,expectedEngineerDid:"did:example:engineer"}));
});
