import assert from "node:assert/strict";
import test from "node:test";
import { RunnerClient } from "../src/runner-client.ts";

const request = {
  request_id: "req-runner-client",
  repository: "gitea://gitea.local/thesis/iam-console-poc",
  branch: "feature/account-suspension",
  commit_sha: "a".repeat(40),
  profile: "poc-default" as const
};

test("RunnerClient sends the exact authorized SHA and validates the response binding", async () => {
  let observedBody: unknown;
  let observedAuthorization = "";

  const client = new RunnerClient({
    baseUrl: "http://runner.internal:8095/",
    gatewayToken: "gateway-runner-secret",
    fetchFn: async (_url, init) => {
      observedAuthorization = String((init?.headers as Record<string, string>)?.authorization);
      observedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          request_id: request.request_id,
          repository: request.repository,
          branch: request.branch,
          tested_commit_sha: request.commit_sha,
          runner_profile: "poc-default",
          status: "pass",
          phases: [
            { phase: "dependency_install", status: "pass" },
            { phase: "researcher_acceptance", status: "pass", passed: 1, failed: 0 }
          ],
          project_tests: {
            status: "pass",
            phases: [{ phase: "dependency_install", status: "pass" }]
          },
          researcher_acceptance: {
            phase: "researcher_acceptance",
            status: "pass",
            passed: 1,
            failed: 0
          },
          log_reference: "runner-log://abc"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const result = await client.run(request);

  assert.equal(observedAuthorization, "Bearer gateway-runner-secret");
  assert.deepEqual(observedBody, request);
  assert.equal(result.tested_commit_sha, request.commit_sha);
  assert.equal(result.status, "pass");
  assert.equal(result.project_tests?.status, "pass");
  assert.equal(result.researcher_acceptance?.status, "pass");
});

test("RunnerClient fails closed on a mismatched tested SHA", async () => {
  const client = new RunnerClient({
    baseUrl: "http://runner.internal:8095",
    gatewayToken: "gateway-runner-secret",
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          request_id: request.request_id,
          repository: request.repository,
          branch: request.branch,
          tested_commit_sha: "b".repeat(40),
          runner_profile: "poc-default",
          status: "pass",
          phases: []
        }),
        { status: 200 }
      )
  });

  await assert.rejects(
    () => client.run(request),
    /does not match the authorized request/u
  );
});

test("RunnerClient maps Runner failures to provider unavailability", async () => {
  const client = new RunnerClient({
    baseUrl: "http://runner.internal:8095",
    gatewayToken: "gateway-runner-secret",
    fetchFn: async () =>
      new Response(JSON.stringify({ error: "runner_execution_failed" }), {
        status: 503
      })
  });

  await assert.rejects(
    () => client.run(request),
    /Controlled Test Runner returned HTTP 503/u
  );
});
