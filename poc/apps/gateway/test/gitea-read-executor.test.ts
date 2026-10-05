import assert from "node:assert/strict";
import test from "node:test";
import { ProviderOperationUnavailableError } from "../src/errors.ts";
import type { GiteaClient } from "../src/gitea-client.ts";
import { GiteaReadOnlyExecutor } from "../src/gitea-read-executor.ts";
import type { PreparedRequestRecord } from "../src/types.ts";

function record(tool: "read_file" | "update_file"): PreparedRequestRecord {
  const request =
    tool === "read_file"
      ? {
          tool,
          arguments: {
            branch: "feature/account-suspension",
            path: "apps/backend/src/users/user.service.ts"
          }
        }
      : {
          tool,
          arguments: {
            branch: "feature/account-suspension",
            path: "apps/backend/src/users/user.service.ts",
            content: "new"
          }
        };

  return {
    request_id: "req-1",
    task_id: "task-1",
    agent_role: "backend",
    request,
    required_permission: {
      resource: "gitea://example",
      operation: tool
    },
    audience: "gateway",
    challenge: "challenge",
    request_fingerprint: "fp",
    created_at_ms: 1,
    expires_at_ms: 2,
    consumed: true
  };
}

test("read-only executor returns pinned Gitea file metadata and content", async () => {
  const client = {
    async readTextFile() {
      return {
        path: "apps/backend/src/users/user.service.ts",
        branch: "feature/account-suspension",
        revision: "commit123",
        blob_sha: "blob123",
        last_commit_sha: "commit123",
        size: 12,
        content: "hello world\n",
        encoding: "utf-8" as const
      };
    }
  } as unknown as GiteaClient;

  const executor = new GiteaReadOnlyExecutor(client);
  const result = await executor.execute(record("read_file"));

  assert.equal(result.provider, "gitea");
  assert.equal(result.revision, "commit123");
  assert.equal(result.blob_sha, "blob123");
  assert.equal(result.content, "hello world\n");
});

test("read-only executor refuses every mutation before provider access", async () => {
  let calls = 0;
  const client = {
    async readTextFile() {
      calls += 1;
      throw new Error("should not be called");
    }
  } as unknown as GiteaClient;

  const executor = new GiteaReadOnlyExecutor(client);
  await assert.rejects(
    executor.execute(record("update_file")),
    ProviderOperationUnavailableError
  );
  assert.equal(calls, 0);
});
