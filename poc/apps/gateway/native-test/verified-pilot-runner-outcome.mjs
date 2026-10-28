/**
 * Real Docker runner execution can fail functionally without authorization
 * denial. Check evidence structure and exact SHA, then return success/failure.
 * Signed Test completion and PR gates remain strictly PASS-only.
 */
import assert from "node:assert/strict";
export const PILOT_PHASES=Object.freeze([
  "dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"
]);
const STATES=new Set(["pass","fail","skipped"]);
export function verifyPilotRunnerOutcome(effect,pinnedSha){
  assert.ok(effect&&typeof effect==="object"&&!Array.isArray(effect));
  assert.equal(effect.provider,"runner");
  assert.equal(effect.performed,true);
  assert.equal(effect.tool,"run_tests");
  assert.match(pinnedSha,/^[a-f0-9]{40}$/u);
  assert.equal(effect.tested_commit_sha,pinnedSha,
    "Runner must test exact pinned branch revision");
  assert.ok(effect.status==="pass"||effect.status==="fail");
  assert.ok(effect.project_tests?.status==="pass"||
    effect.project_tests?.status==="fail");
  assert.ok(["pass","fail","skipped"].includes(
    effect.researcher_acceptance?.status));
  assert.ok(Array.isArray(effect.phases));
  assert.deepEqual(effect.phases.map(p=>p?.phase),PILOT_PHASES);
  assert.ok(effect.phases.every(p=>STATES.has(p?.status)));
  const allPass=effect.phases.every(p=>p.status==="pass")&&
    effect.project_tests.status==="pass"&&
    effect.researcher_acceptance.status==="pass";
  if(effect.status==="pass")
    assert.ok(allPass,"Provider PASS cannot conceal failed phases");
  else assert.ok(!allPass&&effect.phases.some(p=>p.status==="fail"),
    "Provider FAIL must include a concrete failed phase");
  return Object.freeze({passed:effect.status==="pass"});
}
