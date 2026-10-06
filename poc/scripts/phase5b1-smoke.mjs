const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.ADAPTER_SMOKE_URL ?? "http://127.0.0.1:8090";
const expectedRevision =
  process.env.EXPECTED_GITEA_REVISION ??
  "405748b1e77992b6bd8630a3ab6f990658d32f6b";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR
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
      agent_role: "orchestrator",
      tool,
      arguments: args
    })
  });
}

const deniedPrepare = await prepare(
  "create_branch",
  {
    base_branch: "main",
    branch: "feature/not-allowed"
  },
  "phase5b1-policy-deny"
);

const branchPrepare = await prepare(
  "create_branch",
  {
    base_branch: "main",
    branch: "feature/account-suspension"
  },
  "phase5b1-create-branch"
);

const readPrepare = await prepare(
  "read_file",
  {
    branch: "feature/account-suspension",
    path: "apps/backend/src/users/user.service.ts"
  },
  "phase5b1-read-created-branch"
);

const statusBase = "https://status.example/lists/phase5b1-smoke";
const permissions = [
  branchPrepare.required_permission,
  readPrepare.required_permission
];

await request(`${adapter}/v1/credentials/root`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.engineer}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase5b1:orchestrator",
    delegatee: "orchestrator",
    valid_from: new Date().toISOString(),
    validity_seconds: 3600,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "220",
      statusListCredential: statusBase
    },
    permissions
  })
});

async function presentationFor(prepared) {
  const body = await request(`${adapter}/v1/presentations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.orchestrator}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      credential_id: "urn:phase5b1:orchestrator",
      disclosed_permissions: [prepared.required_permission],
      audience: prepared.audience,
      challenge: prepared.challenge
    })
  });
  return body.signed_vp;
}

const deniedVp = await presentationFor(deniedPrepare);
const denied = await request(
  `${gateway}/v1/authorization/execute`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: deniedPrepare.request_id,
      signed_vp: deniedVp
    })
  },
  [403]
);

if (denied.error !== "policy_denied") {
  throw new Error(`Unexpected policy denial result: ${JSON.stringify(denied)}`);
}

const branchVp = await presentationFor(branchPrepare);
const created = await request(`${gateway}/v1/authorization/execute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    request_id: branchPrepare.request_id,
    signed_vp: branchVp
  })
});

if (
  created.decision !== "allow" ||
  created.policy?.allow !== true ||
  created.execution?.provider !== "gitea" ||
  created.execution?.performed !== true ||
  created.execution?.tool !== "create_branch"
) {
  throw new Error(`Unexpected branch creation result: ${JSON.stringify(created)}`);
}

if (
  created.execution.branch !== "feature/account-suspension" ||
  created.execution.base_branch !== "main"
) {
  throw new Error("Gitea branch result does not match the frozen branch contract");
}

if (
  created.execution.revision !== expectedRevision ||
  created.execution.commit_sha !== expectedRevision
) {
  throw new Error(
    `Expected created branch revision ${expectedRevision}, got ${created.execution.revision}`
  );
}

const readVp = await presentationFor(readPrepare);
const read = await request(`${gateway}/v1/authorization/execute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    request_id: readPrepare.request_id,
    signed_vp: readVp
  })
});

if (
  read.execution?.provider !== "gitea" ||
  read.execution?.tool !== "read_file" ||
  read.execution?.revision !== expectedRevision
) {
  throw new Error(`Unexpected post-create read result: ${JSON.stringify(read)}`);
}

if (!read.execution.content.includes("export class UserService")) {
  throw new Error("Created feature branch does not expose the expected baseline file");
}

console.log("PHASE5B1_SMOKE=PASS");
console.log(`branch=${created.execution.branch}`);
console.log(`revision=${created.execution.revision}`);
console.log("policyDeny=PASS");
