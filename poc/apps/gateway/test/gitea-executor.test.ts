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
    agent_role: request.tool === "create_branch" ? "orchestrator" : "backend",
    request,
    required_permission: {
      resource: "gitea://example",
      operation: request.tool === "create_branch" ? "create_branch" : request.tool
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
  const result = await executor.execute(
    record({
      tool: "create_branch",
      arguments: {
        base_branch: "main",
        branch: "feature/account-suspension"
      }
    })
  );

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
    executor.execute(
      record({
        tool: "create_branch",
        arguments: { base_branch: "main", branch: "feature/not-allowed" }
      })
    ),
    ProviderOperationUnavailableError
  );
  assert.equal(calls, 0);
});

test("Gitea executor creates a file on the feature branch with Gateway-owned commit metadata", async () => {
  const calls: Array<Record<string, string>> = [];
  const client = {
    async createFile(branch: string, path: string, content: string, message: string) {
      calls.push({ branch, path, content, message });
      return {
        branch,
        path,
        revision: "commit-created",
        commit_sha: "commit-created",
        blob_sha: "blob-created"
      };
    }
  } as unknown as GiteaClient;

  const executor = new GiteaExecutor(client);
  const result = await executor.execute(
    record({
      tool: "create_file",
      arguments: {
        branch: "feature/account-suspension",
        path: "tests/e2e/account-suspension.spec.ts",
        content: "new e2e"
      }
    })
  );

  assert.equal(result.tool, "create_file");
  assert.match(calls[0].message, /^thesis-gateway: create_file .+ \[req-fixed\]$/u);
  if (result.tool === "create_file") {
    assert.equal(result.commit_sha, "commit-created");
    assert.equal(result.blob_sha, "blob-created");
  }
});

test("Gitea executor updates a file conditionally and surfaces the blob precondition", async () => {
  const client = {
    async updateFile(branch: string, path: string, content: string, message: string) {
      assert.equal(branch, "feature/account-suspension");
      assert.equal(path, "apps/backend/src/users/user.service.ts");
      assert.equal(content, "new source");
      assert.match(message, /^thesis-gateway: update_file .+ \[req-fixed\]$/u);
      return {
        branch,
        path,
        revision: "commit-after",
        commit_sha: "commit-after",
        blob_sha: "blob-after",
        previous_revision: "commit-before",
        precondition_blob_sha: "blob-before"
      };
    }
  } as unknown as GiteaClient;

  const executor = new GiteaExecutor(client);
  const result = await executor.execute(
    record({
      tool: "update_file",
      arguments: {
        branch: "feature/account-suspension",
        path: "apps/backend/src/users/user.service.ts",
        content: "new source"
      }
    })
  );

  assert.equal(result.tool, "update_file");
  if (result.tool === "update_file") {
    assert.equal(result.revision, "commit-after");
    assert.equal(result.precondition_blob_sha, "blob-before");
  }
});

test("Gitea executor rejects file writes outside the frozen feature branch before provider access", async () => {
  let calls = 0;
  const client = {
    async updateFile() {
      calls += 1;
      throw new Error("should not be called");
    }
  } as unknown as GiteaClient;
  const executor = new GiteaExecutor(client);

  await assert.rejects(
    executor.execute(
      record({
        tool: "update_file",
        arguments: {
          branch: "main",
          path: "apps/backend/src/users/user.service.ts",
          content: "forbidden"
        }
      })
    ),
    ProviderOperationUnavailableError
  );
  assert.equal(calls, 0);
});

test("Gitea executor creates only the frozen feature -> main pull request", async () => {
  const client = {
    async createPullRequest(
      headBranch: string,
      baseBranch: string,
      title: string,
      body?: string
    ) {
      assert.equal(headBranch, "feature/account-suspension");
      assert.equal(baseBranch, "main");
      assert.equal(title, "Account suspension");
      assert.equal(body, "PoC");
      return {
        id: 77,
        number: 5,
        url: "http://gitea/pulls/5",
        head_branch: headBranch,
        base_branch: baseBranch,
        head_revision: "head123"
      };
    }
  } as unknown as GiteaClient;

  const executor = new GiteaExecutor(client);
  const result = await executor.execute(
    record({
      tool: "create_pull_request",
      arguments: {
        head_branch: "feature/account-suspension",
        base_branch: "main",
        title: "Account suspension",
        body: "PoC"
      }
    })
  );

  assert.equal(result.tool, "create_pull_request");
  if (result.tool === "create_pull_request") {
    assert.equal(result.pull_request_id, 77);
    assert.equal(result.pull_request_number, 5);
    assert.equal(result.revision, "head123");
    assert.equal(result.head_branch, "feature/account-suspension");
    assert.equal(result.base_branch, "main");
  }
});

test("Gitea executor rejects a pull request outside the frozen direction before provider access", async () => {
  let calls = 0;
  const client = {
    async createPullRequest() {
      calls += 1;
      throw new Error("should not be called");
    }
  } as unknown as GiteaClient;
  const executor = new GiteaExecutor(client);

  await assert.rejects(
    executor.execute(
      record({
        tool: "create_pull_request",
        arguments: {
          head_branch: "main",
          base_branch: "feature/account-suspension",
          title: "forbidden"
        }
      })
    ),
    ProviderOperationUnavailableError
  );
  assert.equal(calls, 0);
});

test("Gitea executor keeps run_tests unavailable for the future Controlled Runner", async () => {
  const executor = new GiteaExecutor({} as GiteaClient);
  await assert.rejects(
    executor.execute(
      record({
        tool: "run_tests",
        arguments: {
          branch: "feature/account-suspension",
          profile: "poc-default"
        }
      })
    ),
    ProviderOperationUnavailableError
  );
});
