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
