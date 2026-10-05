const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.ADAPTER_SMOKE_URL ?? "http://127.0.0.1:8090";
const opa = process.env.OPA_SMOKE_URL ?? "http://127.0.0.1:8181";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend: process.env.ADAPTER_CALLER_BACKEND
};
for (const [name, value] of Object.entries(tokens)) {
  if (!value) throw new Error(`Missing smoke token for ${name}`);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}: ${raw}`);
  }
  return { response, body };
}

async function waitForHealth(url, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become healthy`);
}

await waitForHealth(`${opa}/health`, "OPA");
await waitForHealth(`${adapter}/health`, "Delegation Adapter");
await waitForHealth(`${gateway}/health`, "Gateway");

const prepare = await request(`${gateway}/v1/authorization/prepare`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    task_id: "phase4-smoke-backend",
    agent_role: "backend",
    tool: "read_file",
    arguments: {
      branch: "feature/account-suspension",
      path: "apps/backend/src/users/user.service.ts"
    }
  })
});

const permission = prepare.body.required_permission;
const statusBase = "https://status.example/lists/phase4-smoke";

await request(`${adapter}/v1/credentials/root`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.engineer}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase4:root",
    delegatee: "orchestrator",
    valid_from: new Date().toISOString(),
    validity_seconds: 3600,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "100",
      statusListCredential: statusBase
    },
    permissions: [permission]
  })
});

await request(`${adapter}/v1/credentials/child`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.orchestrator}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    parent_credential_id: "urn:phase4:root",
    credential_id: "urn:phase4:backend",
    delegatee: "backend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "101",
      statusListCredential: statusBase
    },
    permissions: [permission]
  })
});

const presentation = await request(`${adapter}/v1/presentations`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.backend}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase4:backend",
    disclosed_permissions: [permission],
    audience: prepare.body.audience,
    challenge: prepare.body.challenge
  })
});

const execute = await request(`${gateway}/v1/authorization/execute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    request_id: prepare.body.request_id,
    signed_vp: presentation.body.signed_vp
  })
});

if (
  execute.body.decision !== "allow" ||
  execute.body.policy?.allow !== true ||
  execute.body.policy?.policy_version !== "phase4a-v1" ||
  execute.body.execution?.provider !== "mock" ||
  execute.body.execution?.performed !== false
) {
  throw new Error(`Unexpected Gateway result: ${JSON.stringify(execute.body)}`);
}

const replay = await fetch(`${gateway}/v1/authorization/execute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    request_id: prepare.body.request_id,
    signed_vp: presentation.body.signed_vp
  })
});
if (replay.status !== 409) {
  throw new Error(`Expected replay HTTP 409, got ${replay.status}`);
}

console.log("PHASE4_SMOKE=PASS");
console.log(`requestId=${prepare.body.request_id}`);
console.log(`resource=${permission.resource}`);
console.log(`operation=${permission.operation}`);
console.log(`chainDepth=${execute.body.verified_delegation.hierarchy_depth}`);
console.log(`policyVersion=${execute.body.policy.policy_version}`);
console.log("provider=mock");
