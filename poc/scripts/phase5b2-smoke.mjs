const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.ADAPTER_SMOKE_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const giteaOwner = process.env.GITEA_OWNER ?? "thesis";
const giteaRepository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const expectedRevision =
  process.env.EXPECTED_GITEA_REVISION ??
  "ea9984fa15098771fc451f9ae51c82824b6a40fd";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend: process.env.ADAPTER_CALLER_BACKEND,
  test: process.env.ADAPTER_CALLER_TEST
};

for (const [name, value] of Object.entries(tokens)) {
  if (!value) throw new Error(`Missing smoke token for ${name}`);
}
if (!gitea) throw new Error("Missing GITEA_SMOKE_BASE_URL");
if (!giteaToken) throw new Error("Missing GITEA_GATEWAY_TOKEN");

async function request(url, options = {}, accepted = [200, 201]) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }
  }
  if (!accepted.includes(response.status)) {
    throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}: ${raw}`);
  }
  return { status: response.status, body };
}

async function waitForHealth(url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become healthy`);
}

const health = await waitForHealth(`${gateway}/health`, "Gateway");
await waitForHealth(`${adapter}/health`, "Delegation Adapter");
if (health.provider !== "gitea") {
  throw new Error(`Expected Gateway provider gitea, got ${health.provider}`);
}

function prepare(role, tool, args, taskId) {
  return request(`${gateway}/v1/authorization/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      agent_role: role,
      tool,
      arguments: args
    })
  }).then(({ body }) => body);
}

function uniquePermissions(permissions) {
  const seen = new Set();
  return permissions.filter((permission) => {
    const key = JSON.stringify(permission);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const backendPath = "apps/backend/src/users/user.service.ts";
const e2ePath = "tests/e2e/account-suspension.spec.ts";
const updatedSource =
  'export const phase5b2Smoke = "authorized-update";\n';
const createdE2e =
  'import { test, expect } from "@playwright/test";\n' +
  'test("phase5b2 placeholder", async () => { expect(true).toBe(true); });\n';

const branchPrepare = await prepare(
  "orchestrator",
  "create_branch",
  {
    base_branch: "main",
    branch: "feature/account-suspension"
  },
  "phase5b2-create-branch"
);
const readBeforePrepare = await prepare(
  "backend",
  "read_file",
  {
    branch: "feature/account-suspension",
    path: backendPath
  },
  "phase5b2-read-before"
);
const updatePrepare = await prepare(
  "backend",
  "update_file",
  {
    branch: "feature/account-suspension",
    path: backendPath,
    content: updatedSource
  },
  "phase5b2-update"
);
const readAfterPrepare = await prepare(
  "backend",
  "read_file",
  {
    branch: "feature/account-suspension",
    path: backendPath
  },
  "phase5b2-read-after"
);
const createPrepare = await prepare(
  "test",
  "create_file",
  {
    branch: "feature/account-suspension",
    path: e2ePath,
    content: createdE2e
  },
  "phase5b2-create-e2e"
);
const duplicateCreatePrepare = await prepare(
  "test",
  "create_file",
  {
    branch: "feature/account-suspension",
    path: e2ePath,
    content: "must not overwrite\n"
  },
  "phase5b2-create-e2e-duplicate"
);

const rootPermissions = uniquePermissions([
  branchPrepare.required_permission,
  readBeforePrepare.required_permission,
  updatePrepare.required_permission,
  readAfterPrepare.required_permission,
  createPrepare.required_permission,
  duplicateCreatePrepare.required_permission
]);
const backendPermissions = uniquePermissions([
  readBeforePrepare.required_permission,
  updatePrepare.required_permission,
  readAfterPrepare.required_permission
]);
const testPermissions = uniquePermissions([
  createPrepare.required_permission,
  duplicateCreatePrepare.required_permission
]);

const statusBase = "https://status.example/lists/phase5b2-smoke";
await request(`${adapter}/v1/credentials/root`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.engineer}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase5b2:orchestrator",
    delegatee: "orchestrator",
    valid_from: new Date().toISOString(),
    validity_seconds: 3600,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "240",
      statusListCredential: statusBase
    },
    permissions: rootPermissions
  })
});

await request(`${adapter}/v1/credentials/child`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.orchestrator}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    parent_credential_id: "urn:phase5b2:orchestrator",
    credential_id: "urn:phase5b2:backend",
    delegatee: "backend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "241",
      statusListCredential: statusBase
    },
    permissions: backendPermissions
  })
});

await request(`${adapter}/v1/credentials/child`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.orchestrator}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    parent_credential_id: "urn:phase5b2:orchestrator",
    credential_id: "urn:phase5b2:test",
    delegatee: "test",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "242",
      statusListCredential: statusBase
    },
    permissions: testPermissions
  })
});

async function presentationFor(prepared, token, credentialId) {
  const { body } = await request(`${adapter}/v1/presentations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      credential_id: credentialId,
      disclosed_permissions: [prepared.required_permission],
      audience: prepared.audience,
      challenge: prepared.challenge
    })
  });
  return body.signed_vp;
}

async function executePrepared(prepared, token, credentialId, accepted = [200, 201]) {
  const signedVp = await presentationFor(prepared, token, credentialId);
  return request(
    `${gateway}/v1/authorization/execute`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: prepared.request_id,
        signed_vp: signedVp
      })
    },
    accepted
  );
}

const branch = await executePrepared(
  branchPrepare,
  tokens.orchestrator,
  "urn:phase5b2:orchestrator"
);
if (
  branch.body.execution?.tool !== "create_branch" ||
  branch.body.execution?.revision !== expectedRevision
) {
  throw new Error(`Unexpected create_branch result: ${JSON.stringify(branch.body)}`);
}

const before = await executePrepared(
  readBeforePrepare,
  tokens.backend,
  "urn:phase5b2:backend"
);
if (
  before.body.execution?.tool !== "read_file" ||
  before.body.execution?.revision !== expectedRevision ||
  !before.body.execution?.blob_sha
) {
  throw new Error(`Unexpected pre-update read: ${JSON.stringify(before.body)}`);
}

const update = await executePrepared(
  updatePrepare,
  tokens.backend,
  "urn:phase5b2:backend"
);
if (
  update.body.execution?.tool !== "update_file" ||
  update.body.execution?.provider !== "gitea" ||
  update.body.execution?.performed !== true ||
  !update.body.execution?.commit_sha ||
  !update.body.execution?.blob_sha
) {
  throw new Error(`Unexpected update_file result: ${JSON.stringify(update.body)}`);
}
if (update.body.execution.precondition_blob_sha !== before.body.execution.blob_sha) {
  throw new Error("update_file did not bind the Gitea write to the file blob read before mutation");
}
if (update.body.execution.commit_sha === expectedRevision) {
  throw new Error("update_file did not advance the feature branch revision");
}

const after = await executePrepared(
  readAfterPrepare,
  tokens.backend,
  "urn:phase5b2:backend"
);
if (
  after.body.execution?.content !== updatedSource ||
  after.body.execution?.blob_sha !== update.body.execution.blob_sha ||
  after.body.execution?.revision !== update.body.execution.commit_sha
) {
  throw new Error(`Post-update read does not match mutation result: ${JSON.stringify(after.body)}`);
}

const created = await executePrepared(
  createPrepare,
  tokens.test,
  "urn:phase5b2:test"
);
if (
  created.body.execution?.tool !== "create_file" ||
  created.body.execution?.path !== e2ePath ||
  !created.body.execution?.commit_sha ||
  !created.body.execution?.blob_sha
) {
  throw new Error(`Unexpected create_file result: ${JSON.stringify(created.body)}`);
}

const duplicate = await executePrepared(
  duplicateCreatePrepare,
  tokens.test,
  "urn:phase5b2:test",
  [409]
);
if (duplicate.body.error !== "provider_conflict") {
  throw new Error(`Expected duplicate create provider_conflict: ${JSON.stringify(duplicate.body)}`);
}

const encodedBackendPath = backendPath.split("/").map(encodeURIComponent).join("/");
const staleResponse = await fetch(
  `${gitea}/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/contents/${encodedBackendPath}`,
  {
    method: "PUT",
    headers: {
      authorization: `token ${giteaToken}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      branch: "feature/account-suspension",
      content: Buffer.from("stale overwrite must fail\n", "utf8").toString("base64"),
      message: "phase5b2 stale precondition probe",
      sha: before.body.execution.blob_sha
    })
  }
);
if (![409, 422].includes(staleResponse.status)) {
  const staleRaw = await staleResponse.text();
  throw new Error(
    `Expected stale Gitea SHA rejection, got HTTP ${staleResponse.status}: ${staleRaw}`
  );
}

const mainBranch = await request(
  `${gitea}/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/branches/main`,
  {
    headers: {
      authorization: `token ${giteaToken}`,
      accept: "application/json"
    }
  }
);
if (mainBranch.body.commit?.id !== expectedRevision) {
  throw new Error(
    `main changed during Phase 5B.2: expected ${expectedRevision}, got ${mainBranch.body.commit?.id}`
  );
}

const encodedE2ePath = e2ePath.split("/").map(encodeURIComponent).join("/");
const createdFile = await request(
  `${gitea}/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/contents/${encodedE2ePath}?ref=feature%2Faccount-suspension`,
  {
    headers: {
      authorization: `token ${giteaToken}`,
      accept: "application/json"
    }
  }
);
const createdContent = Buffer.from(
  String(createdFile.body.content ?? "").replace(/\s+/gu, ""),
  "base64"
).toString("utf8");
if (createdContent !== createdE2e) {
  throw new Error("Created E2E file content does not match the authorized create_file request");
}

console.log("PHASE5B2_SMOKE=PASS");
console.log(`updateCommit=${update.body.execution.commit_sha}`);
console.log(`createCommit=${created.body.execution.commit_sha}`);
console.log("duplicateCreate=BLOCKED");
console.log("stalePrecondition=BLOCKED");
console.log(`mainRevision=${mainBranch.body.commit.id}`);
