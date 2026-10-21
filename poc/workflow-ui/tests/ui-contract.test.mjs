import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import {
  validatePlan, planDigest, makeApproval, assertApprovedExecution
} from "../../packages/plan-contracts/src/plan.mjs";

const base = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, base), "utf8");
const sandbox = { TextEncoder, crypto:webcrypto };
runInNewContext(read("mock-plan.js"), sandbox);
runInNewContext(read("review-model.js"), sandbox);
const sourcePlan = sandbox.DELEGATION_MOCK_PLAN;
const operations = sandbox.DELEGATION_MOCK_OPERATION_CHOICES;
const model = sandbox.DELEGATION_REVIEW_MODEL;
const rust = readFileSync(new URL("../../../src/delegation/authorization/operation.rs",
  import.meta.url),"utf8");
const rustOperations = new Set([...rust.matchAll(/Self::[A-Za-z]+\s*=>\s*"([a-z_]+)"/gu)].map((m)=>m[1]));
function draft() { return model.createState(sourcePlan); }

test("mock fixture conforms to trusted v1 plan validator and canonical URI model", () => {
  assert.equal(sourcePlan.schema_version,"1.0.0");
  assert.match(sourcePlan.base_revision,/^[0-9a-f]{40}$/u);
  assert.equal(sourcePlan.candidate_agents.length,3);
  assert.ok(sourcePlan.tasks.length >= 3);
  assert.ok(sourcePlan.requested_permissions.length >= 6);
  assert.equal(model.validateDemoPlan(sourcePlan,operations),true);
  assert.equal(validatePlan(sourcePlan,{allowedOperations:rustOperations}),sourcePlan);
  for(const op of operations) {
    assert.ok(rustOperations.has(op),"mock choice missing from Rust catalog: "+op);
  }
});

test("browser and backend compute exactly the same canonical plan digest", async () => {
  assert.equal(await model.digest(sourcePlan,webcrypto),planDigest(sourcePlan));
  assert.match(await model.digest(sourcePlan,webcrypto),/^[a-f0-9]{64}$/u);
});

test("local mock approval binds the versioned plan and only selected permission IDs", async () => {
  const s = draft(), originalVersion = s.plan.version;
  model.togglePermission(s,"p3",false);
  assert.equal(s.plan.version,originalVersion);
  const review = await model.makeMockReview(s,operations,webcrypto);
  assert.equal(review.kind,"mock_authorization_review");
  assert.equal(review.simulated,true);
  assert.equal(review.plan.schema_version,"1.0.0");
  assert.equal(review.plan_digest,planDigest(s.plan));
  assert.ok(review.excluded_permission_ids.includes("p3"));
  assert.ok(!review.approved_permission_ids.includes("p3"));
  assert.match(review.notice,/nessuna approvazione autenticata/i);
  assert.ok(!Object.hasOwn(review,"approved_by"));
});

test("task reassignment changes version and binds every affected permission", async () => {
  const s=draft(), initialDigest=planDigest(s.plan);
  model.setTaskAgent(s,"backend-1","frontend");
  assert.ok(s.plan.version > sourcePlan.version);
  assert.notEqual(planDigest(s.plan),initialDigest);
  const moved=s.plan.requested_permissions.filter((p)=>p.task_id==="backend-1");
  assert.ok(moved.length>=2);
  assert.ok(moved.every((p)=>p.agent_id==="frontend"));
  assert.equal(validatePlan(s.plan,{allowedOperations:rustOperations}),s.plan);
  assert.match(model.differences(s).join(" " ),/Riassegnazione backend-1/);
  const review=await model.makeMockReview(s,operations,webcrypto);
  assert.equal(review.plan_digest,planDigest(s.plan));
});

test("changing a permission's task updates agent and resource consistently", () => {
  const s=draft();
  model.editPermission(s,"p2","task_id","frontend-1");
  const changed=s.plan.requested_permissions.find((p)=>p.id==="p2");
  assert.equal(changed.agent_id,"frontend");
  assert.equal(changed.task_id,"frontend-1");
  const task=s.plan.tasks.find((t)=>t.id==="frontend-1");
  assert.ok(task.resources.includes(changed.resource));
  validatePlan(s.plan,{allowedOperations:rustOperations});
});

test("manual addition/removal and edited resources remain plan-versioned", () => {
  const s=draft(), original=s.plan.version;
  const id=model.addPermission(s);
  assert.ok(s.plan.version>original);
  model.editPermission(s,id,"operation","update_file");
  const uri="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/new.ts";
  model.editPermission(s,id,"resource",uri);
  validatePlan(s.plan,{allowedOperations:rustOperations});
  const p=s.plan.requested_permissions.find((item)=>item.id===id);
  const task=s.plan.tasks.find((task)=>task.id===p.task_id);
  assert.ok(task.resources.includes(uri));
  model.removePermission(s,id);
  assert.ok(!s.plan.requested_permissions.some((item)=>item.id===id));
  assert.ok(model.differences(s).length>0);
});

test("invalid URI and missing approvable permissions fail closed locally", async () => {
  const s=draft();
  model.editPermission(s,"p2","resource","relative/unsafe/path");
  await assert.rejects(model.makeMockReview(s,operations,webcrypto),/non coerente|non validi/i);
  const none=draft();
  for (const p of none.plan.requested_permissions) model.togglePermission(none,p.id,false);
  await assert.rejects(model.makeMockReview(none,operations,webcrypto),/almeno una permission/i);
});

test("an edited plan cannot reuse a previous trusted decision", () => {
  const s=draft();
  const approval=makeApproval(s.plan,{
    allowedOperations:rustOperations,
    decision_id:"decision-fixture",
    approved_by:"did:thesis:software-engineer",
    approved_at:"2026-10-21T08:00:00Z",
    approved_permission_ids:["p2"]
  });
  model.setTaskAgent(s,"backend-1","frontend");
  assert.throws(
    ()=>assertApprovedExecution(s.plan,approval,{
      task_id:"backend-1",agent_id:"frontend",resource:s.plan.requested_permissions[1].resource,
      operation:"update_file"
    },{allowedOperations:rustOperations,completedTaskIds:["branch-1"]}),
    /version or digest/
  );
});

test("editing mid-hash prevents exporting a mixed-version mock review", async () => {
  const s=draft();
  let finish;
  const slowCrypto={subtle:{digest:()=>new Promise((resolve)=>{finish=resolve;})}};
  const pending=model.makeMockReview(s,operations,slowCrypto);
  model.setRequirement(s,"Requisito modificato prima della conferma");
  finish(new Uint8Array(32).buffer);
  await assert.rejects(pending,/modificati durante la conferma/i);
  assert.equal(s.review,null);
});

test("standalone UI makes no network calls, distinguishes mock authority, and packages assets", () => {
  const html=read("index.html"),script=read("app.js"),readme=read("README.md");
  const workflow=readFileSync(new URL("../../../.github/workflows/workflow-ui-mock.yml",
    import.meta.url),"utf8");
  assert.match(html,/DATI SIMULATI/);
  assert.match(html,/Nessuna credenziale viene emessa/);
  assert.match(html,/id="plan-digest"/);
  assert.match(html,/id="plan-version"/);
  assert.match(html,/review-model\.js/);
  assert.match(html,/id="approve"/);
  assert.match(script,/makeMockReview/);
  assert.match(script,/changes_from_initial_proposal|renderDifferences/);
  assert.doesNotMatch(script,/\bfetch\s*\(/u);
  assert.doesNotMatch(script,/innerHTML/u);
  assert.match(workflow,/Test versioned plan and approval bindings/);
  assert.match(workflow,/review-model\.js/);
  assert.match(readme,/GitHub Actions/);
  assert.match(read("styles.css"),/\.permission/);
});
