import assert from "node:assert/strict";
import {
  DeterministicOrchestratorAuthorityIssuer,
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const giteaOwner = process.env.GITEA_OWNER ?? "thesis";
const giteaRepository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const testId = process.env.ADAPTER_ID_TEST;

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  test: process.env.ADAPTER_CALLER_TEST
};

for (const [name, value] of Object.entries({
  gitea,
  giteaToken,
  testId,
  ...tokens
})) {
  if (!value) throw new Error("Missing required Phase 11D value: " + name);
}

const featureBranch = "feature/account-suspension";
const testPath = "tests/backend/user.service.test.ts";
const rootCredentialId = "urn:phase11d:orchestrator-root";
const testCredentialId = "urn:phase11d:test-child";

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

async function request(url, options = {}, accepted = [200, 201]) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let body = {};
  if (raw.length > 0) {
    body = JSON.parse(raw);
  }
  if (!accepted.includes(response.status)) {
    throw new Error(
      (options.method ?? "GET") +
        " " +
        url +
        " -> " +
        response.status +
        ": " +
        raw
    );
  }
  return { status: response.status, body };
}

async function giteaGet(path) {
  return (
    await request(gitea + path, {
      headers: {
        authorization: "token " + giteaToken,
        accept: "application/json"
      }
    })
  ).body;
}

async function branchHead() {
  const branch = await giteaGet(
    "/api/v1/repos/" +
      encodeURIComponent(giteaOwner) +
      "/" +
      encodeURIComponent(giteaRepository) +
      "/branches/feature%2Faccount-suspension"
  );
  return branch.commit?.id;
}

async function giteaFile(path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const file = await giteaGet(
    "/api/v1/repos/" +
      encodeURIComponent(giteaOwner) +
      "/" +
      encodeURIComponent(giteaRepository) +
      "/contents/" +
      encodedPath +
      "?ref=" +
      encodeURIComponent(featureBranch)
  );
  return Buffer.from(
    String(file.content ?? "").replace(/\s+/gu, ""),
    "base64"
  ).toString("utf8");
}

await waitForHealth(adapter + "/health", "Delegation Adapter");
await waitForHealth(gateway + "/health", "Gateway");

const bootstrap = new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl: adapter,
  bearerToken: tokens.engineer
});

await bootstrap.issueOrchestratorRoot({
  credential_id: rootCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 7200,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "11300",
    statusListCredential:
      "https://status.example/lists/phase11d-root"
  }
});

const authority = new DeterministicOrchestratorAuthorityIssuer({
  adapterBaseUrl: adapter,
  bearerToken: tokens.orchestrator
});

const child = await authority.issueSpecializedChild({
  parent_credential_id: rootCredentialId,
  credential_id: testCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 3600,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "11301",
    statusListCredential:
      "https://status.example/lists/phase11d-test-child"
  },
  selection: { role: "test" }
});

assert.equal(child.role, "test");
assert.equal(child.credential.credentialSubject.sub, testId);

const contentBefore = await giteaFile(testPath);
const headBefore = await branchHead();
const marker = "// Phase 11D exactly-once replay marker.";
const nextContent = contentBefore.includes(marker)
  ? contentBefore
  : contentBefore.trimEnd() + "\n\n" + marker + "\n";

const prepared = (
  await request(gateway + "/v1/authorization/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: "phase11d-test-replay",
      agent_role: "test",
      tool: "update_file",
      arguments: {
        branch: featureBranch,
        path: testPath,
        content: nextContent
      }
    })
  })
).body;

assert.equal(typeof prepared.request_id, "string");
assert.equal(prepared.required_permission?.operation, "update_file");

const presentation = (
  await request(adapter + "/v1/presentations", {
    method: "POST",
    headers: {
      authorization: "Bearer " + tokens.test,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      credential_id: testCredentialId,
      disclosed_permissions: [prepared.required_permission],
      audience: prepared.audience,
      challenge: prepared.challenge
    })
  })
).body;

assert.equal(typeof presentation.signed_vp, "string");

const executionPayload = {
  request_id: prepared.request_id,
  signed_vp: presentation.signed_vp
};

const first = (
  await request(gateway + "/v1/authorization/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(executionPayload)
  })
).body;

assert.equal(first.decision, "allow");
assert.equal(first.execution?.provider, "gitea");
assert.equal(first.execution?.tool, "update_file");
assert.notEqual(first.execution?.commit_sha, headBefore);

const headAfterFirst = await branchHead();
const contentAfterFirst = await giteaFile(testPath);
assert.equal(headAfterFirst, first.execution.commit_sha);
assert.equal(contentAfterFirst, nextContent);

const replay = await request(
  gateway + "/v1/authorization/execute",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(executionPayload)
  },
  [409]
);

assert.equal(replay.body.error, "replay_detected");
assert.equal(await branchHead(), headAfterFirst);
assert.equal(await giteaFile(testPath), contentAfterFirst);

process.stdout.write(
  JSON.stringify(
    {
      result: "phase11d-one-shot-replay-protection-pass",
      first_execution_allowed: true,
      first_commit_sha: headAfterFirst,
      replay_status: replay.status,
      replay_error: replay.body.error,
      second_provider_mutation: false,
      branch_unchanged_after_replay: true,
      file_unchanged_after_replay: true,
      runner_invocations: 0
    },
    null,
    2
  ) + "\n"
);
