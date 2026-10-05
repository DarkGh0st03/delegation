import assert from "node:assert/strict";
import test from "node:test";
import { createRunnerHttpServer } from "../src/http.ts";
import type {
  RunnerExecutor,
  RunnerRunRequest,
  RunnerRunResult
} from "../src/types.ts";

const config = {
  bind_host: "127.0.0.1",
  bind_port: 0,
  gateway_token: "gateway-runner-secret",
  contract: {
    repository: "gitea://gitea.local/thesis/iam-console-poc",
    branch: "feature/account-suspension"
  }
};

const validRequest = {
  request_id: "req-run-1",
  repository: config.contract.repository,
  branch: config.contract.branch,
  commit_sha: "b".repeat(40),
  profile: "poc-default"
};

class RecordingExecutor implements RunnerExecutor {
  calls: RunnerRunRequest[] = [];

  async run(request: RunnerRunRequest): Promise<RunnerRunResult> {
    this.calls.push(request);
    return {
      request_id: request.request_id,
      repository: request.repository,
      branch: request.branch,
      tested_commit_sha: request.commit_sha,
      runner_profile: request.profile,
      status: "pass",
      phases: []
    };
  }
}

async function withServer(
  executor: RunnerExecutor | undefined,
  callback: (base: string) => Promise<void>
): Promise<void> {
  const server = createRunnerHttpServer(config, executor);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("Runner service accepts a Gateway-authenticated exact-SHA request", async () => {
  const executor = new RecordingExecutor();
  await withServer(executor, async (base) => {
    const response = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: {
        authorization: "Bearer gateway-runner-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify(validRequest)
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tested_commit_sha, validRequest.commit_sha);
    assert.equal(body.runner_profile, "poc-default");
    assert.deepEqual(executor.calls, [validRequest]);
  });
});

test("Runner service rejects arbitrary command fields before executor invocation", async () => {
  const executor = new RecordingExecutor();
  await withServer(executor, async (base) => {
    const response = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: {
        authorization: "Bearer gateway-runner-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...validRequest,
        command: "npm test && arbitrary-shell"
      })
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "invalid_runner_request");
    assert.equal(executor.calls.length, 0);
  });
});

test("Runner service is internal and requires the Gateway credential", async () => {
  const executor = new RecordingExecutor();
  await withServer(executor, async (base) => {
    const response = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validRequest)
    });

    assert.equal(response.status, 401);
    assert.equal(executor.calls.length, 0);
  });
});

test("Phase 6A default service validates the contract but does not execute jobs", async () => {
  await withServer(undefined, async (base) => {
    const response = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: {
        authorization: "Bearer gateway-runner-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify(validRequest)
    });

    assert.equal(response.status, 501);
    const body = await response.json();
    assert.equal(body.error, "runner_execution_unavailable");
  });
});
