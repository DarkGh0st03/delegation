import assert from "node:assert/strict";
import test from "node:test";
import { ProviderOperationUnavailableError } from "../src/errors.ts";
import type { GiteaClient } from "../src/gitea-client.ts";
import { GiteaExecutor } from "../src/gitea-executor.ts";
import type { PreparedRequestRecord } from "../src/types.ts";

function branchRecord(
  baseBranch = "main",
  branch = "feature/account-suspension"
): PreparedRequestRecord {
  return {
    request_id: "req-branch",
    task_id: "task-branch",
    agent_role: "orchestrator",
    request: {
      tool: "create_branch",
      arguments: {
        base_branch: baseBranch,
        branch
      }
    },
    required_permission: {
      resource: "gitea://gitea.local/thesis/iam-console-poc",
      operation: "create_branch"
    },
    audience: "gateway",
    challenge: "challenge",
    request_fingerprint: "fp",
    created_at_ms: 1,
    expires_at_ms: 2,
    consumed: true
  };
}

test("Gitea executor creates only the frozen feature branch and returns its revision", async () => {
  const calls: Array<[string, string]> = [];
  const client = {
    async createBranch(baseBranch: string, branch: string) {
      calls.push([baseBranch, branch]);
      return {
        name: branch,
        base_branch: baseBranch,
        base_revision: "baseline123",
        commit_sha: "baseline123"
      };
    }
  } as unknown as GiteaClient;

  const executor = new GiteaExecutor(client);
  const result = await executor.execute(branchRecord());

  assert.deepEqual(calls, [["main", "feature/account-suspension"]]);
  assert.equal(result.tool, "create_branch");
  if (result.tool === "create_branch") {
    assert.equal(result.branch, "feature/account-suspension");
    assert.equal(result.base_branch, "main");
    assert.equal(result.revision, "baseline123");
    assert.equal(result.commit_sha, "baseline123");
  }
});

test("Gitea executor rejects an out-of-profile branch before provider access", async () => {
  let calls = 0;
  const client = {
    async createBranch() {
      calls += 1;
      throw new Error("should not be called");
    }
  } as unknown as GiteaClient;

  const executor = new GiteaExecutor(client);
  await assert.rejects(
    executor.execute(branchRecord("main", "feature/not-allowed")),
    ProviderOperationUnavailableError
  );
  assert.equal(calls, 0);
});

test("Gitea executor keeps later Phase 5B mutations disabled", async () => {
  const executor = new GiteaExecutor({} as GiteaClient);
  const record: PreparedRequestRecord = {
    ...branchRecord(),
    request: {
      tool: "update_file",
      arguments: {
        branch: "feature/account-suspension",
        path: "apps/backend/src/users/user.service.ts",
        content: "new"
      }
    },
    required_permission: {
      resource: "gitea://example",
      operation: "update_file"
    }
  };

  await assert.rejects(executor.execute(record), ProviderOperationUnavailableError);
});
