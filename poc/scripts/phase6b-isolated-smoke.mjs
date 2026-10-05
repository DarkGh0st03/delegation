const runnerBaseUrl = process.env.TEST_RUNNER_URL ?? "http://127.0.0.1:8095";
const token = process.env.TEST_RUNNER_GATEWAY_TOKEN;
const expectedSha = process.env.EXPECTED_GITEA_REVISION;
const repository =
  process.env.TEST_RUNNER_REPOSITORY_URI ??
  "gitea://gitea.local/thesis/iam-console-poc";
const branch = process.env.TEST_RUNNER_BRANCH ?? "feature/account-suspension";

if (!token) throw new Error("TEST_RUNNER_GATEWAY_TOKEN is required");
if (!expectedSha) throw new Error("EXPECTED_GITEA_REVISION is required");

async function run(payload, authorization = `Bearer ${token}`) {
  const response = await fetch(`${runnerBaseUrl}/v1/runs`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Runner returned non-JSON HTTP ${response.status}: ${text}`);
  }
  return { response, body };
}

const request = {
  request_id: "phase6b-isolated-baseline",
  repository,
  branch,
  commit_sha: expectedSha,
  profile: "poc-default"
};

const unauthorized = await run(request, "Bearer wrong-runner-token");
if (unauthorized.response.status !== 401) {
  throw new Error(
    `Expected unauthorized Runner request to return 401, got ${unauthorized.response.status}`
  );
}

const exact = await run(request);
if (!exact.response.ok) {
  throw new Error(
    `Expected isolated Runner execution to succeed, got HTTP ${exact.response.status}: ${JSON.stringify(exact.body)}`
  );
}
if (exact.body.status !== "pass") {
  throw new Error(`Expected Runner PASS, got ${JSON.stringify(exact.body)}`);
}
if (exact.body.tested_commit_sha !== expectedSha) {
  throw new Error(
    `Runner tested unexpected SHA ${exact.body.tested_commit_sha}; expected ${expectedSha}`
  );
}

const phaseStatus = new Map(
  (exact.body.phases ?? []).map((phase) => [phase.phase, phase.status])
);
for (const phase of [
  "dependency_install",
  "typecheck",
  "backend_tests",
  "frontend_tests",
  "build",
  "playwright_e2e"
]) {
  if (phaseStatus.get(phase) !== "pass") {
    throw new Error(`Expected phase ${phase} to pass: ${JSON.stringify(exact.body.phases)}`);
  }
}
if (phaseStatus.get("researcher_acceptance") !== "skipped") {
  throw new Error("Phase 6B must leave researcher acceptance skipped until Phase 6C");
}
if (
  typeof exact.body.log_reference !== "string" ||
  !exact.body.log_reference.startsWith("runner-log://")
) {
  throw new Error("Runner did not return a structured log reference");
}

const stale = await run({
  ...request,
  request_id: "phase6b-stale-sha",
  commit_sha: "0".repeat(40)
});
if (stale.response.status !== 503 || stale.body.error !== "runner_execution_failed") {
  throw new Error(
    `Expected stale exact-SHA request to fail closed, got HTTP ${stale.response.status}: ${JSON.stringify(stale.body)}`
  );
}

process.stdout.write(
  JSON.stringify(
    {
      result: "phase6b-isolated-smoke-pass",
      tested_commit_sha: exact.body.tested_commit_sha,
      phases: exact.body.phases,
      log_reference: exact.body.log_reference
    },
    null,
    2
  ) + "\n"
);
