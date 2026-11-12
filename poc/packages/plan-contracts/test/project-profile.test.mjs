import test from "node:test";
import assert from "node:assert/strict";
import {validateProjectProfile, projectProfileDigest, canonicalProjectProfileJson,
  testSourceProfileOf, IAM_CONSOLE_PROJECT_PROFILE, MAX_PROJECT_PHASES}
  from "../src/project-profile.mjs";
import {isProjectTestSource, IAM_CONSOLE_PROJECT_TEST_PROFILE}
  from "../src/gitea-permission-containment.mjs";

const python = () => ({version: 1, image: "python:3.12.7-slim",
  phases: [{name: "install", command: "pip install -r requirements.txt"},
    {name: "unit_tests", command: "pytest -q tests"}],
  test_sources: {roots: ["tests"], suffixes: [".test.js"]}});

test("a valid profile is canonical, frozen and has a stable digest", () => {
  const p = validateProjectProfile(python());
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.phases) && Object.isFrozen(p.phases[0]));
  assert.match(projectProfileDigest(p), /^[a-f0-9]{64}$/u);
  // Key order of the input does not change the digest; content does.
  const reordered = {test_sources: python().test_sources, phases: python().phases,
    image: "python:3.12.7-slim", version: 1};
  assert.equal(projectProfileDigest(reordered), projectProfileDigest(p));
  const changed = python(); changed.phases[1].command = "true";
  assert.notEqual(projectProfileDigest(changed), projectProfileDigest(p),
    "weakening a test command changes what the Engineer signed");
  assert.equal(JSON.parse(canonicalProjectProfileJson(p)).phases.length, 2);
});

test("test sources of a profile drive the Test agent write scope", () => {
  const rule = testSourceProfileOf(python());
  assert.equal(isProjectTestSource("tests/api.test.js", rule), true);
  assert.equal(isProjectTestSource("src/api.test.js", rule), false);
  assert.equal(isProjectTestSource("tests/backend/a.test.ts",
    testSourceProfileOf(IAM_CONSOLE_PROJECT_PROFILE)), true);
  assert.deepEqual([...IAM_CONSOLE_PROJECT_PROFILE.test_sources.roots],
    [...IAM_CONSOLE_PROJECT_TEST_PROFILE.roots]);
});

test("the example profile keeps the historical phases of iam-console-poc", () => {
  assert.deepEqual(IAM_CONSOLE_PROJECT_PROFILE.phases.map(p => p.name), ["dependency_install",
    "typecheck", "backend_tests", "frontend_tests", "build", "playwright_e2e"]);
  assert.deepEqual(IAM_CONSOLE_PROJECT_PROFILE.phases.filter(p => p.failure_report).map(p => p.name),
    ["backend_tests", "frontend_tests"]);
  assert.equal(IAM_CONSOLE_PROJECT_PROFILE.image, "node:22.15.0-bookworm");
});

test("invalid profiles are refused", () => {
  const cases = [
    p => { p.extra = 1; },
    p => { p.version = 2; },
    p => { p.image = "python"; },
    p => { p.image = "python:latest"; },
    p => { p.image = "Python:3"; },
    p => { p.phases = []; },
    p => { p.phases = Array.from({length: MAX_PROJECT_PHASES + 1}, (_, i) => ({name: "p" + i + "x", command: "true"})); },
    p => { p.phases[1].name = "install"; },
    p => { p.phases[1].name = "researcher_acceptance"; },
    p => { p.phases[1].name = "Unit Tests"; },
    p => { p.phases[1].command = " "; },
    p => { p.phases[1].command = "x".repeat(4001); },
    p => { p.phases[1].failure_report = "junit"; },
    p => { p.phases[1].shell = "sh"; },
    p => { p.test_sources = {roots: ["../x"], suffixes: [".test.js"]}; },
    p => { p.test_sources = {roots: ["runner/acceptance"], suffixes: [".test.js"]}; },
    p => { p.test_sources = {roots: ["tests"], suffixes: [".py"]}; },
    p => { delete p.test_sources; }
  ];
  for (const mutate of cases) {
    const p = python(); mutate(p);
    assert.throws(() => validateProjectProfile(p), /Invalid project profile/u, mutate.toString());
  }
  assert.ok(validateProjectProfile({...python(),
    image: "node@sha256:" + "a".repeat(64)}));
});
