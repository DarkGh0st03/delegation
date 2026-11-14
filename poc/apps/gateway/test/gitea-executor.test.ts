import assert from "node:assert/strict";
import test from "node:test";
import { ProviderOperationUnavailableError } from "../src/errors.ts";
import type { GiteaClient } from "../src/gitea-client.ts";
import { GiteaExecutor } from "../src/gitea-executor.ts";
import type { NormalizedToolRequest, PreparedRequestRecord } from "../src/types.ts";

function record(request: NormalizedToolRequest): PreparedRequestRecord {
  return {
    request_id: "req-fixed",
    task_id: "task-fixed",
    agent_role: request.tool === "create_branch" || request.tool === "create_pull_request"
      ? "orchestrator" : "backend",
    request,
    required_permission: { resource: "gitea://example", operation: request.tool },
    audience: "gateway",
    challenge: "challenge",
    request_fingerprint: "fp",
    created_at_ms: 1,
    expires_at_ms: 2,
    consumed: true
  };
}

// Every mutation is executed only by its signed authority-only executor
// (after Rust VP + OPA). The generic Gitea executor serves reads only and
// must refuse a mutation before touching the provider.
test("generic Gitea executor refuses every mutation before provider access", async () => {
  let calls = 0;
  const touch = async () => { calls += 1; throw new Error("must not be called"); };
  const client = {
    createBranch: touch, createFile: touch, updateFile: touch,
    createPullRequest: touch, getBranchMetadata: touch
  } as unknown as GiteaClient;
  const executor = new GiteaExecutor(client);
  const requests: NormalizedToolRequest[] = [
    { tool: "create_branch", arguments: { base_branch: "main", branch: "feature/session-work" } },
    { tool: "create_file", arguments: { branch: "feature/session-work", path: "a.ts", content: "x" } },
    { tool: "update_file", arguments: { branch: "feature/session-work", path: "a.ts", content: "x" } },
    { tool: "create_pull_request",
      arguments: { head_branch: "feature/session-work", base_branch: "main", title: "t" } },
    { tool: "run_tests", arguments: { branch: "feature/session-work", profile: "poc-default" } }
  ] as NormalizedToolRequest[];
  for (const request of requests) {
    await assert.rejects(executor.execute(record(request)), ProviderOperationUnavailableError);
  }
  assert.equal(calls, 0);
});
