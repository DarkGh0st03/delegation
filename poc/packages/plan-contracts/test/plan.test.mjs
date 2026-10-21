import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLAN_SCHEMA_VERSION, validatePlan, planDigest, makeApproval,
  assertApprovedExecution, assertApprovedPlanScope
} from "../src/plan.mjs";

const file = "gitea://gitea.local/thesis/iam-console-poc/branches/main/files/apps/backend/src/user.service.ts";
const repository = "gitea://gitea.local/thesis/iam-console-poc";
const operations = new Set(["read_file", "update_file", "create_branch"]);
const clone = (v) => structuredClone(v);

function fixture() {
  return {
    schema_version: PLAN_SCHEMA_VERSION,
    plan_id: "plan-20261021",
    session_id: "session-1",
    version: 1,
    repository: {authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"},
    base_revision: "a".repeat(40),
    requirement: "Update the account lifecycle",
    candidate_agents: [{agent_id:"backend",did:"did:thesis:backend-agent",card_ref:"trusted-registry:backend"}],
    tasks: [
      {
        id:"bootstrap", agent_id:"orchestrator", title:"Prepare branch",
        description:"Create an isolated work branch", depends_on:[], resources:[repository]
      },
      {
        id:"backend-task", agent_id:"backend", title:"Modify backend",
        description:"Update the account status service", depends_on:["bootstrap"], resources:[file]
      }
    ],
    requested_permissions: [
      {
        id:"branch-p", task_id:"bootstrap", agent_id:"orchestrator",
        resource:repository,operation:"create_branch",reason:"Work on isolated branch"
      },
      {
        id:"backend-p", task_id:"backend-task", agent_id:"backend",
        resource:file,operation:"update_file",reason:"Implement the requirement"
      }
    ],
    assumptions:[], uncertainties:[]
  };
}
function approval(p, approved_permission_ids = ["branch-p","backend-p"]) {
  return makeApproval(p, {
    allowedOperations: operations,
    decision_id: "decision-1",
    approved_by: "did:thesis:software-engineer",
    approved_at: "2026-10-21T08:00:00Z",
    approved_permission_ids
  });
}
const authorized = {
  task_id:"backend-task", agent_id:"backend",
  resource:file, operation:"update_file"
};
const assertAction = (plan, decision, action) =>
  assertApprovedExecution(plan, decision, action, {
    allowedOperations: operations,
    completedTaskIds: ["bootstrap"]
  });

test("versioned proposal binds agent, task and exact permission", () => {
  const p=fixture();
  assert.equal(validatePlan(p,{allowedOperations:operations}),p);
  assert.equal(assertAction(p,approval(p),authorized,{allowedOperations:operations}),true);
  assert.match(planDigest(p),/^[a-f0-9]{64}$/);
});
test("canonical hash is insensitive to object-key insertion order", () => {
  const p=fixture();
  const keys=Object.keys(p).reverse();
  const reversed=Object.fromEntries(keys.map((k)=>[k,p[k]]));
  assert.equal(planDigest(p),planDigest(reversed));
});
test("unknown or missing Rust operation catalog fails closed", () => {
  const p=fixture();
  assert.throws(()=>validatePlan(p),/catalog/);
  assert.throws(()=>validatePlan(p,{allowedOperations:new Set(["read_file"])}),/catalog/);
});
test("unregistered agent and cross-task permissions are rejected", () => {
  const p=fixture();
  p.tasks[1].agent_id="unknown";
  assert.throws(()=>validatePlan(p,{allowedOperations:operations}),/unregistered/);
  const q=fixture();
  q.requested_permissions[1].agent_id="orchestrator";
  assert.throws(()=>validatePlan(q,{allowedOperations:operations}),/not bound/);
});
test("missing dependencies, cycles and duplicate identifiers are rejected", () => {
  const a=fixture(); a.tasks[1].depends_on=["not-found"];
  assert.throws(()=>validatePlan(a,{allowedOperations:operations}),/unknown task dependency/);
  const b=fixture(); b.tasks[0].depends_on=["backend-task"];
  assert.throws(()=>validatePlan(b,{allowedOperations:operations}),/cyclic/);
  const c=fixture(); c.requested_permissions[1].id="branch-p";
  assert.throws(()=>validatePlan(c,{allowedOperations:operations}),/duplicate permission/);
});
test("file and operation must be scoped to the Task", () => {
  const p=fixture(); p.requested_permissions[1].resource=repository;
  assert.throws(()=>validatePlan(p,{allowedOperations:operations}),/outside task/);
  const q=fixture(); q.tasks[1].resources=["relative/path"];
  assert.throws(()=>validatePlan(q,{allowedOperations:operations}),/absolute URI/);
});
test("approval never silently adds or invents permissions", () => {
  const p=fixture();
  assert.throws(()=>approval(p,["backend-p","new-permission"]),/outside plan/);
  const a=approval(p,["branch-p"]);
  assert.throws(
    ()=>assertAction(p,a,authorized,{allowedOperations:operations}),
    /not approved/
  );
});
test("an authorized operation cannot be reassigned to another agent or task", () => {
  const p=fixture(),a=approval(p);
  assert.throws(
    ()=>assertAction(p,a,{...authorized,agent_id:"orchestrator"},
      {allowedOperations:operations}),/not assigned/
  );
  assert.throws(
    ()=>assertAction(p,a,{...authorized,task_id:"bootstrap"},
      {allowedOperations:operations}),/not assigned/
  );
});
test("an approved plan may not silently expand scope or operations", () => {
  const p=fixture(),a=approval(p);
  assert.throws(
    ()=>assertAction(p,a,{...authorized,operation:"read_file"},
      {allowedOperations:operations}),/not approved/
  );
  assert.throws(
    ()=>assertAction(p,a,{...authorized,resource:repository},
      {allowedOperations:operations}),/not approved/
  );
});
test("any changed plan/version/revision is rejected until reapproval", () => {
  for(const update of [
    (p)=>{p.tasks[1].title="Another title";},
    (p)=>{p.version=2;},
    (p)=>{p.base_revision="b".repeat(40);},
    (p)=>{p.requested_permissions[1].reason="Changed purpose";}
  ]) {
    const p=fixture(),a=approval(p);
    update(p);
    assert.throws(
      ()=>assertAction(p,a,authorized,{allowedOperations:operations}),
      /version or digest/
    );
  }
});
test("JSON Schema exists and retains key contract requirements", () => {
  const schema=JSON.parse(readFileSync(new URL("../schema/workflow-plan.schema.json",
    import.meta.url),"utf8"));
  assert.equal(schema.properties.schema_version.const,PLAN_SCHEMA_VERSION);
  assert.equal(schema.additionalProperties,false);
  for(const name of ["base_revision","candidate_agents","tasks","requested_permissions"]) {
    assert.ok(schema.required.includes(name));
  }
  assert.ok(schema.$defs.permission.required.includes("task_id"));
  assert.ok(schema.$defs.permission.required.includes("agent_id"));
});

test("dependent task cannot execute until predecessor has completed", () => {
  const p=fixture(),a=approval(p);
  assert.throws(
    ()=>assertApprovedExecution(p,a,authorized,{
      allowedOperations:operations,completedTaskIds:[]
    }),
    /dependency not completed/
  );
  assert.equal(assertAction(p,a,authorized),true);
});

test("Engineer root issuance uses approved scope without pretending any tasks are complete",()=>{
  const p=fixture();
  const receipt=approval(p,["backend-p"]);
  const selected=assertApprovedPlanScope(p,receipt,{
    allowedOperations:operations,
    expectedEngineerDid:"did:thesis:software-engineer"
  });
  assert.deepEqual(selected.map(x=>x.id),["backend-p"]);
  // Runtime execution still requires the 'bootstrap' dependency to complete.
  assert.throws(()=>assertApprovedExecution(p,receipt,authorized,{
    allowedOperations:operations,completedTaskIds:[]
  }),/task dependency not completed/);
  for(const forged of [
    {...receipt,approved_by:"did:thesis:attacker"},
    {...receipt,approved_permission_ids:["missing-id"]},
    {...receipt,plan_version:receipt.plan_version+1},
    {...receipt,plan_digest:"0".repeat(64)},
    {...receipt,approved_permission_ids:[]},
    {...receipt,untrusted_permission:true}
  ])assert.throws(()=>assertApprovedPlanScope(p,forged,{
    allowedOperations:operations,expectedEngineerDid:"did:thesis:software-engineer"
  }));
});
