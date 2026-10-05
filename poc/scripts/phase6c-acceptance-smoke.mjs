const runnerBaseUrl = process.env.TEST_RUNNER_URL ?? "http://127.0.0.1:8095";
const token = process.env.TEST_RUNNER_GATEWAY_TOKEN;
const expectedSha = process.env.EXPECTED_GITEA_REVISION;
const repository =
  process.env.TEST_RUNNER_REPOSITORY_URI ??
  "gitea://gitea.local/thesis/iam-console-poc";
const branch = process.env.TEST_RUNNER_BRANCH ?? "feature/account-suspension";

if (!token) throw new Error("TEST_RUNNER_GATEWAY_TOKEN is required");
if (!expectedSha) throw new Error("EXPECTED_GITEA_REVISION is required");

const response = await fetch(`${runnerBaseUrl}/v1/runs`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    request_id: "phase6c-researcher-acceptance-baseline",
    repository,
    branch,
    commit_sha: expectedSha,
    profile: "poc-default"
  })
});

const raw = await response.text();
let body;
try {
  body = JSON.parse(raw);
} catch {
  throw new Error(`Runner returned non-JSON HTTP ${response.status}: ${raw}`);
}

if (!response.ok) {
  throw new Error(
    `Expected Runner to return a structured validation result, got HTTP ${response.status}: ${raw}`
  );
}

if (body.tested_commit_sha !== expectedSha) {
  throw new Error(
    `Runner tested unexpected SHA ${body.tested_commit_sha}; expected ${expectedSha}`
  );
}

if (body.project_tests?.status !== "pass") {
  throw new Error(
    `Baseline project tests must pass before independent acceptance: ${JSON.stringify(body.project_tests)}`
  );
}

if (body.researcher_acceptance?.phase !== "researcher_acceptance") {
  throw new Error(
    `Runner did not report the independent researcher acceptance verdict: ${JSON.stringify(body)}`
  );
}

if (body.researcher_acceptance.status !== "fail") {
  throw new Error(
    `The frozen baseline intentionally lacks Account Suspension and must fail researcher acceptance: ${JSON.stringify(body.researcher_acceptance)}`
  );
}

if (body.status !== "fail") {
  throw new Error(
    `Overall Runner status must include the independent acceptance verdict: ${JSON.stringify(body)}`
  );
}

const acceptancePhase = (body.phases ?? []).find(
  (phase) => phase.phase === "researcher_acceptance"
);
if (acceptancePhase?.status !== "fail") {
  throw new Error(
    `Expected researcher_acceptance phase failure, got ${JSON.stringify(body.phases)}`
  );
}

if (
  typeof body.log_reference !== "string" ||
  !body.log_reference.startsWith("runner-log://")
) {
  throw new Error("Runner did not return a structured log reference");
}

process.stdout.write(
  JSON.stringify(
    {
      result: "phase6c-researcher-acceptance-smoke-pass",
      tested_commit_sha: body.tested_commit_sha,
      project_tests: body.project_tests.status,
      researcher_acceptance: body.researcher_acceptance.status,
      overall_status: body.status,
      log_reference: body.log_reference
    },
    null,
    2
  ) + "\n"
);
