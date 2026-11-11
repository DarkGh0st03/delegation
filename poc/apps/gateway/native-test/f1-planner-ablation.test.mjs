/** F1 frozen 2x2 structural ablation. NO model inference, approval or Gitea.
 * The old prompt/requirement are archived INPUT CONDITIONS, not simulated
 * Gemini outputs. A structural PASS is NOT a model success-rate claim. */
import test from "node:test";
import assert from "node:assert/strict";
import {getApprovedOfflineScenario} from
  "../../test-runner-controller/fixtures/approved-scenarios.mjs";
import {makeOfflineReviewableDag} from
  "../../../packages/orchestrator-runtime/test/fixtures/offline-planning-dag.mjs";
import {compilePlanningProposal,TRUSTED_PLANNER_FUNCTIONAL_GUIDANCE,
  safeExecutionPreflightRejection} from
  "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {preflightApprovedPilotDag} from "./approved-dag-preflight.mjs";

const legacyGuidance=Object.freeze([
  "Make each Task description a self-contained brief: objective, relevant observed interfaces, required behavior, error cases and concrete verification criteria, within the description size limit.",
  "Derive briefs from the original requirement and inspected contracts; keep Backend, Frontend and Test expectations consistent. Do not invent status codes or business rules; report unresolved contradictions as uncertainties.",
  "Plan the requested implementation AND concrete regression tests when behavior changes; merely calling run_tests is not a regression-test implementation.",
  "Use a Test Agent task to read and update an existing discovered test file, or create a new test only inside a discovered directory, then run tests on the resulting feature branch.",
  "Inspect relevant existing test conventions before proposing new test-file paths; if the test directory is unavailable, report uncertainty rather than invent a resource.",
  "Specify test cases derived from the requirement, including positive, negative and authorization cases where relevant; never copy a prewritten solution.",
  "Make the Test Agent task depend on every implementation Task whose changes it validates; make Pull Request creation depend on the completed Test Agent task.",
  "Verify the proposed Task dependency graph includes implementation, tests and review; keep all permissions minimal and within discovered source."
]);
const oldRequirement="Implement account suspension and reactivation";
const scenario=getApprovedOfflineScenario("account-suspension");
const newRequirement=scenario.requirement;
const paths=Object.keys(scenario.files).sort();
const directories=new Set([""]);
for(const file of paths){const parts=file.split("/");
 for(let n=1;n<parts.length;n++)directories.add(parts.slice(0,n).join("/"));
}
const snapshot={session_id:"f1_frozen_plan",
 repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"},
 base_revision:"a".repeat(40),files:paths,directories:[...directories].sort()};
const agents={backend:{did:"did:example:backend",card_ref:"trusted:backend"},
 frontend:{did:"did:example:frontend",card_ref:"trusted:frontend"},
 test:{did:"did:example:test",card_ref:"trusted:test"}};
const base=makeOfflineReviewableDag({snapshot,edits:scenario.planning_intent.edits,
 newTestFile:"tests/e2e/f1-isolated-regression.spec.ts"});
const planOf=(raw,requirement)=>compilePlanningProposal(raw,{snapshot,
 requirement,planId:"f1_ablation_plan",workBranch:scenario.workBranch,agents}).plan;
const gate=plan=>preflightApprovedPilotDag({plan,
 grants:plan.requested_permissions,repo:snapshot.repository,branch:scenario.workBranch});
const footprint=plan=>JSON.stringify({tasks:plan.tasks,
 grants:plan.requested_permissions,repository:plan.repository,
 base_revision:plan.base_revision});

test("F1 old/new requirement and prompt: same frozen valid DAG is allowed in all four cells",()=>{
 assert.notEqual(oldRequirement,newRequirement);
 assert.ok(newRequirement.length>oldRequirement.length);
 assert.ok(TRUSTED_PLANNER_FUNCTIONAL_GUIDANCE.length>legacyGuidance.length);
 const results=[];
 for(const [requirementLabel,requirement] of
  [["old",oldRequirement],["new",newRequirement]]){
  for(const [guidanceLabel,guidance] of
   [["old",legacyGuidance],["new",TRUSTED_PLANNER_FUNCTIONAL_GUIDANCE]]){
   assert.ok(guidance.length>0);
   const plan=planOf(structuredClone(base),requirement);
   const preflight=gate(plan);
   assert.equal(preflight.approvedTaskCount,5);
   results.push({requirementLabel,guidanceLabel,plan});
  }
 }
 assert.equal(new Set(results.map(r=>footprint(r.plan))).size,1,
  "Input wording must not silently change the structural validator or approved grants");
 assert.equal(new Set(results.map(r=>r.plan.requirement)).size,2);
 assert.ok(results.every(r=>r.plan.requested_permissions.every(p=>p.operation!=="merge_pull_request")));
});

test("F1 both requirement versions reject invalid PR ordering and keep exact Task grants unchanged",()=>{
 for(const requirement of [oldRequirement,newRequirement]){
  const invalid=structuredClone(base);
  invalid.tasks.find(t=>t.id==="pr").depends_on=["branch"];
  const plan=planOf(invalid,requirement);
  assert.throws(()=>gate(plan),e=> {
   assert.equal(safeExecutionPreflightRejection(e),"execution_pr_before_runner");
   return true;
  });
  assert.equal(plan.requested_permissions.length,planOf(base,requirement).requested_permissions.length);
 }
});

test("F1 both requirement versions reject missing per-file source reads; no automatic grant repair",()=>{
 for(const requirement of [oldRequirement,newRequirement]){
  const invalid=structuredClone(base);
  const backend=invalid.tasks.find(t=>t.id==="backend");
  const edited=backend.permissions.find(p=>p.operation==="update_file").path;
  backend.permissions=backend.permissions.filter(p=>!(p.operation==="read_file"&&p.path===edited));
  const plan=planOf(invalid,requirement);
  assert.throws(()=>gate(plan),e=>{
   assert.equal(safeExecutionPreflightRejection(e),"execution_update_without_read");
   return true;
  });
  assert.equal(plan.requested_permissions.some(p=>p.operation==="read_file"&&
   p.task_id==="backend"&&p.resource.endsWith("/"+edited)),false);
 }
});
