import test from "node:test";
import assert from "node:assert/strict";
import {buildPolicyInput} from "../src/policy-input.ts";
import type {PreparedRequestRecord} from "../src/types.ts";

const repository = {authority: "gitea.local", owner: "thesis", repository: "shop"} as never;
const verified = {presenter_id: "did:x", credential_id: "urn:c", issuer_id: "did:o",
  permissions: [], hierarchy_depth: 1, expiration: 0} as never;

function record(extra: Partial<PreparedRequestRecord>): PreparedRequestRecord {
  return {
    request_id: "req-1", task_id: "task-1", agent_role: "backend",
    request: {tool: "update_file", arguments: {branch: "agent/attacker", path: "src/a.js", content: "x"}},
    required_permission: {resource: "gitea://gitea.local/thesis/shop/branches/agent%2Fattacker/files/src/a.js",
      operation: "update_file"},
    audience: "cloud-access-gateway", challenge: "c", request_fingerprint: "f",
    created_at_ms: 0, expires_at_ms: 1, consumed: false, ...extra
  } as PreparedRequestRecord;
}

test("OPA receives the Engineer-signed session branch, not a branch from tool arguments", () => {
  const input = buildPolicyInput(record({authority_only_work_branch: "agent/session-7"}),
    repository, verified);
  assert.equal(input.session_work_branch, "agent/session-7");
  // The caller-supplied branch only appears in the arguments OPA compares against.
  assert.equal(input.arguments.branch, "agent/attacker");
});

test("no session branch is sent when the request is not bound to a signed session", () => {
  const input = buildPolicyInput(record({}), repository, verified);
  assert.equal("session_work_branch" in input, false);
});
