import test from "node:test";
import assert from "node:assert/strict";
import {APPLICATION_ROLES, SPECIALIST_ROLES, REQUIRED_SPECIALISTS, OPTIONAL_SPECIALISTS, TEST_ROLE,
  ROLE_LABELS, ROLE_SKILLS, isValidSpecialistRoster, provisionedSpecialists, isApplicationRole,
  isSpecialistRole} from "../src/agent-roles.mjs";

test("one registry: application roles, the Test role, required and optional specialists", () => {
  assert.deepEqual([...APPLICATION_ROLES], ["backend", "frontend", "docs", "data", "devops"]);
  assert.deepEqual([...SPECIALIST_ROLES], [...APPLICATION_ROLES, TEST_ROLE]);
  assert.deepEqual([...REQUIRED_SPECIALISTS].sort(), ["backend", "frontend", "test"]);
  assert.deepEqual([...REQUIRED_SPECIALISTS, ...OPTIONAL_SPECIALISTS].sort(), [...SPECIALIST_ROLES].sort());
  for (const role of SPECIALIST_ROLES) {
    assert.ok(ROLE_LABELS[role] && ROLE_SKILLS[role], role);
    assert.ok(isSpecialistRole(role));
  }
  assert.ok(!isApplicationRole("test") && isApplicationRole("docs"));
  assert.ok(!isSpecialistRole("orchestrator") && !isSpecialistRole("__proto__"));
  assert.ok(Object.isFrozen(SPECIALIST_ROLES) && Object.isFrozen(ROLE_SKILLS));
});

test("a provisioned roster needs the required roles; optional ones join when present", () => {
  assert.ok(isValidSpecialistRoster(["backend", "frontend", "test"]));
  assert.ok(isValidSpecialistRoster([...SPECIALIST_ROLES]));
  assert.ok(!isValidSpecialistRoster(["backend", "test"]));
  assert.ok(!isValidSpecialistRoster(["backend", "frontend", "test", "test"]));
  assert.ok(!isValidSpecialistRoster(["backend", "frontend", "test", "reviewer"]));
  assert.deepEqual(provisionedSpecialists({backend: 1, frontend: 1, test: 1}), ["backend", "frontend", "test"]);
  assert.deepEqual(provisionedSpecialists({docs: 1, test: 1, devops: 1}),
    ["backend", "frontend", "docs", "devops", "test"]);
  assert.deepEqual(provisionedSpecialists(Object.create({data: 1})), ["backend", "frontend", "test"],
    "inherited keys are not provisioned");
});
