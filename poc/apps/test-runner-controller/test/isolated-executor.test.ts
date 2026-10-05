import assert from "node:assert/strict";
import test from "node:test";
import {
  IsolatedDockerRunnerExecutor,
  runnerFixedPhaseCommands
} from "../src/isolated-executor.ts";

const request = {
  request_id: "req-run-6b",
  repository: "gitea://gitea.local/thesis/iam-console-poc",
  branch: "feature/account-suspension",
  commit_sha: "a".repeat(40),
  profile: "poc-default" as const
};

const config = {
  gitea_base_url: "http://127.0.0.1:3000",
  gitea_owner: "thesis",
  gitea_repository: "iam-console-poc",
  gitea_token: "runner-read-only-secret",
  docker_image: "node:22.15.0-bookworm",
  phase_timeout_ms: 10_000,
  log_dir: "/tmp/delegation-runner-test-logs"
};

test("Phase 6B fixed pipeline contains no caller-controlled command", () => {
  assert.deepEqual(
    runnerFixedPhaseCommands.map((entry) => entry.phase),
    [
      "dependency_install",
      "typecheck",
      "backend_tests",
      "frontend_tests",
      "build",
      "playwright_e2e"
    ]
  );
  assert.equal(
    runnerFixedPhaseCommands.some((entry) => entry.command.includes(request.request_id)),
    false
  );
});

test("Phase 6B Playwright phase boots the controlled app services before E2E", () => {
  const command = runnerFixedPhaseCommands.find(
    (entry) => entry.phase === "playwright_e2e"
  )?.command;
  assert.ok(command);
  assert.match(command, /npm run start -w @iam\/backend/u);
  assert.match(command, /npm run dev -w @iam\/frontend/u);
  assert.match(command, /wait_port 3000/u);
  assert.match(command, /wait_port 5173/u);
  assert.match(command, /npm run test:e2e/u);
});

test("isolated executor pins branch head to the exact requested SHA and destroys its container", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  let fetchCount = 0;

  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(
          JSON.stringify({ commit: { id: request.commit_sha } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(Buffer.from("fake-tar-gz"), {
        status: 200,
        headers: { "content-type": "application/gzip" }
      });
    },
    command_runner: async (command, args) => {
      calls.push({ command, args });
      return {
        exit_code: 0,
        stdout: "",
        stderr: "",
        timed_out: false
      };
    }
  });

  const result = await executor.run(request);

  assert.equal(result.status, "pass");
  assert.equal(result.tested_commit_sha, request.commit_sha);
  assert.equal(result.phases.at(-1)?.phase, "researcher_acceptance");
  assert.equal(result.phases.at(-1)?.status, "skipped");

  const dockerExecCalls = calls.filter(
    (call) => call.command === "docker" && call.args[0] === "exec"
  );
  assert.deepEqual(
    dockerExecCalls.map((call) => call.args.at(-1)),
    runnerFixedPhaseCommands.map((entry) => entry.command)
  );

  const cleanup = calls.find(
    (call) =>
      call.command === "docker" &&
      call.args[0] === "rm" &&
      call.args[1] === "-f"
  );
  assert.ok(cleanup, "expected ephemeral container cleanup");
});

test("isolated executor fails closed before materialization when branch head changed", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: async () =>
      new Response(
        JSON.stringify({ commit: { id: "b".repeat(40) } }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    command_runner: async (command, args) => {
      calls.push({ command, args });
      return {
        exit_code: 0,
        stdout: "",
        stderr: "",
        timed_out: false
      };
    }
  });

  await assert.rejects(
    () => executor.run(request),
    /exact-SHA precondition failed/u
  );
  assert.deepEqual(calls, []);
});

test("fixed pipeline stops after a failing phase and marks later phases skipped", async () => {
  let fetchCount = 0;
  let execCount = 0;

  const executor = new IsolatedDockerRunnerExecutor(config, {
    fetch_fn: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ commit: { id: request.commit_sha } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(Buffer.from("fake-tar-gz"), { status: 200 });
    },
    command_runner: async (command, args) => {
      if (command === "docker" && args[0] === "exec") {
        execCount += 1;
        if (execCount === 2) {
          return {
            exit_code: 2,
            stdout: "",
            stderr: "typecheck failed",
            timed_out: false
          };
        }
      }
      return {
        exit_code: 0,
        stdout: "",
        stderr: "",
        timed_out: false
      };
    }
  });

  const result = await executor.run(request);

  assert.equal(result.status, "fail");
  assert.equal(result.phases[0].status, "pass");
  assert.equal(result.phases[1].status, "fail");
  assert.equal(result.phases[2].status, "skipped");
  assert.equal(execCount, 2);
});
