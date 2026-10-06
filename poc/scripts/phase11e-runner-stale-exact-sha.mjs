import assert from "node:assert/strict";

const runner = process.env.TEST_RUNNER_URL ?? "http://127.0.0.1:8091";
const runnerToken = process.env.TEST_RUNNER_GATEWAY_TOKEN;
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const owner = process.env.GITEA_OWNER ?? "thesis";
const repository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const featureBranch = "feature/account-suspension";

for (const [name, value] of Object.entries({
  runnerToken,
  gitea,
  giteaToken
})) {
  if (!value) throw new Error("Missing required Phase 11E value: " + name);
}

async function waitForHealth(url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(label + " did not become healthy");
}

async function giteaBranch(branch) {
  const response = await fetch(
    gitea +
      "/api/v1/repos/" +
      encodeURIComponent(owner) +
      "/" +
      encodeURIComponent(repository) +
      "/branches/" +
      encodeURIComponent(branch),
    {
      headers: {
        authorization: "token " + giteaToken,
        accept: "application/json"
      }
    }
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      "Could not resolve Gitea branch " +
        branch +
        " (" +
        response.status +
        "): " +
        raw
    );
  }
  return JSON.parse(raw);
}

const health = await waitForHealth(runner + "/health", "Controlled Test Runner");
assert.equal(health.execution, "configured");

const featureBefore = await giteaBranch(featureBranch);
const main = await giteaBranch("main");
const featureHead = featureBefore.commit?.id;
const staleSha = main.commit?.id;

assert.match(featureHead ?? "", /^[0-9a-f]{40}$/u);
assert.match(staleSha ?? "", /^[0-9a-f]{40}$/u);
assert.notEqual(
  staleSha,
  featureHead,
  "Phase 11E requires a stale but valid commit SHA"
);

const response = await fetch(runner + "/v1/runs", {
  method: "POST",
  headers: {
    authorization: "Bearer " + runnerToken,
    "content-type": "application/json",
    accept: "application/json"
  },
  body: JSON.stringify({
    request_id: "phase11e-stale-exact-sha",
    repository: "gitea://gitea.local/thesis/iam-console-poc",
    branch: featureBranch,
    commit_sha: staleSha,
    profile: "poc-default"
  })
});

const raw = await response.text();
const body = raw.length > 0 ? JSON.parse(raw) : {};

assert.equal(response.status, 503);
assert.equal(body.error, "runner_execution_failed");

const featureAfter = await giteaBranch(featureBranch);
assert.equal(featureAfter.commit?.id, featureHead);

process.stdout.write(
  JSON.stringify(
    {
      result: "phase11e-runner-stale-exact-sha-pass",
      feature_head: featureHead,
      stale_requested_sha: staleSha,
      stale_sha_rejected: true,
      runner_status: response.status,
      runner_error: body.error,
      feature_branch_unchanged: true
    },
    null,
    2
  ) + "\n"
);
