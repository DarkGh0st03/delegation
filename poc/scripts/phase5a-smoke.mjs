const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.ADAPTER_SMOKE_URL ?? "http://127.0.0.1:8090";
const expectedRevision =
  process.env.EXPECTED_GITEA_REVISION ??
  "ea9984fa15098771fc451f9ae51c82824b6a40fd";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend: process.env.ADAPTER_CALLER_BACKEND
};

for (const [name, value] of Object.entries(tokens)) {
  if (!value) throw new Error(`Missing smoke token for ${name}`);
}

async function request(url, options = {}, accepted = [200, 201]) {
  const response = await fetch(url, options);
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : {};
  if (!accepted.includes(response.status)) {
    throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}: ${raw}`);
  }
  return body;
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

async function prepare(tool, args, taskId) {
  return request(`${gateway}/v1/authorization/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      agent_role: "backend",
      tool,
      arguments: args
    })
  });
}

const readPrepare = await prepare(
  "read_file",
  {
    branch: "feature/account-suspension",
    path: "apps/backend/src/users/user.service.ts"
  },
  "phase5a-read"
);

const updatePrepare = await prepare(
  "update_file",
  {
    branch: "feature/account-suspension",
    path: "apps/backend/src/users/user.service.ts",
    content: "THIS MUST NEVER REACH GITEA IN PHASE 5A"
  },
  "phase5a-update-blocked"
);

const statusBase = "https://status.example/lists/phase5a-smoke";
const allPermissions = [
  readPrepare.required_permission,
  updatePrepare.required_permission
];

await request(`${adapter}/v1/credentials/root`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.engineer}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase5a:root",
    delegatee: "orchestrator",
    valid_from: new Date().toISOString(),
    validity_seconds: 3600,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "200",
      statusListCredential: statusBase
    },
    permissions: allPermissions
  })
});

await request(`${adapter}/v1/credentials/child`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.orchestrator}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    parent_credential_id: "urn:phase5a:root",
    credential_id: "urn:phase5a:backend",
    delegatee: "backend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "201",
      statusListCredential: statusBase
    },
    permissions: allPermissions
  })
});

async function presentationFor(prepared, permission) {
  const body = await request(`${adapter}/v1/presentations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.backend}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      credential_id: "urn:phase5a:backend",
      disclosed_permissions: [permission],
      audience: prepared.audience,
      challenge: prepared.challenge
    })
  });
  return body.signed_vp;
}

const readVp = await presentationFor(readPrepare, readPrepare.required_permission);
const readExecute = await request(`${gateway}/v1/authorization/execute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    request_id: readPrepare.request_id,
    signed_vp: readVp
  })
});

if (
  readExecute.decision !== "allow" ||
  readExecute.policy?.allow !== true ||
  readExecute.execution?.provider !== "gitea" ||
  readExecute.execution?.performed !== true ||
  readExecute.execution?.tool !== "read_file"
) {
  throw new Error(`Unexpected read result: ${JSON.stringify(readExecute)}`);
}

if (readExecute.execution.revision !== expectedRevision) {
  throw new Error(
    `Expected revision ${expectedRevision}, got ${readExecute.execution.revision}`
  );
}

if (!readExecute.execution.blob_sha || !readExecute.execution.last_commit_sha) {
  throw new Error("Gitea read result is missing immutable file metadata");
}

if (!readExecute.execution.content.includes("export class UserService")) {
  throw new Error("Gitea read did not return the expected protected baseline file");
}

const originalContent = readExecute.execution.content;

const updateVp = await presentationFor(
  updatePrepare,
  updatePrepare.required_permission
);

const blocked = await request(
  `${gateway}/v1/authorization/execute`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: updatePrepare.request_id,
      signed_vp: updateVp
    })
  },
  [501]
);

if (blocked.error !== "provider_operation_unavailable") {
  throw new Error(`Unexpected blocked mutation result: ${JSON.stringify(blocked)}`);
}

const verifyPrepare = await prepare(
  "read_file",
  {
    branch: "feature/account-suspension",
    path: "apps/backend/src/users/user.service.ts"
  },
  "phase5a-read-after-blocked-write"
);

const verifyVp = await presentationFor(
  verifyPrepare,
  verifyPrepare.required_permission
);

const verifyRead = await request(`${gateway}/v1/authorization/execute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    request_id: verifyPrepare.request_id,
    signed_vp: verifyVp
  })
});

if (verifyRead.execution?.content !== originalContent) {
  throw new Error("Protected file changed even though Phase 5A mutation was blocked");
}

if (verifyRead.execution?.revision !== expectedRevision) {
  throw new Error("Protected branch revision changed during read-only Phase 5A smoke");
}

console.log("PHASE5A_SMOKE=PASS");
console.log(`revision=${readExecute.execution.revision}`);
console.log(`blobSha=${readExecute.execution.blob_sha}`);
console.log(`provider=${readExecute.execution.provider}`);
console.log("mutation=BLOCKED");
