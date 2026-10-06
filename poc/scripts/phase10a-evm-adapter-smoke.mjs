import assert from "node:assert/strict";
import {
  DC_BACKEND,
  DeterministicOrchestratorAuthorityIssuer,
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

const adapter =
  process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const engineerToken = process.env.ADAPTER_CALLER_ENGINEER;
const orchestratorToken = process.env.ADAPTER_CALLER_ORCHESTRATOR;
const backendToken = process.env.ADAPTER_CALLER_BACKEND;
const gatewayToken = process.env.ADAPTER_CALLER_GATEWAY;
const backendId = process.env.ADAPTER_ID_BACKEND;

for (const [name, value] of Object.entries({
  ADAPTER_CALLER_ENGINEER: engineerToken,
  ADAPTER_CALLER_ORCHESTRATOR: orchestratorToken,
  ADAPTER_CALLER_BACKEND: backendToken,
  ADAPTER_CALLER_GATEWAY: gatewayToken,
  ADAPTER_ID_BACKEND: backendId
})) {
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${adapter}/health`);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("EVM Delegation Adapter did not become healthy");
}

async function post(path, token, body) {
  const response = await fetch(`${adapter}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  const parsed = raw.length > 0 ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(
      `POST ${path} -> ${response.status}: ${raw}`
    );
  }
  return parsed;
}

const health = await waitForHealth();
assert.equal(health.status, "ok");
assert.equal(health.trust_profile, "evm");

const rootCredentialId = "urn:phase10a:orchestrator-root";
const childCredentialId = "urn:phase10a:backend-child";

const bootstrap = new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl: adapter,
  bearerToken: engineerToken
});

await bootstrap.issueOrchestratorRoot({
  credential_id: rootCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 3600,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "10000",
    statusListCredential:
      "https://status.example/lists/phase10a-engineer-root"
  }
});

const authority = new DeterministicOrchestratorAuthorityIssuer({
  adapterBaseUrl: adapter,
  bearerToken: orchestratorToken
});

const child = await authority.issueSpecializedChild({
  parent_credential_id: rootCredentialId,
  credential_id: childCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 1800,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "10001",
    statusListCredential:
      "https://status.example/lists/phase10a-orchestrator-children"
  },
  selection: { role: "backend" }
});

assert.equal(child.role, "backend");
assert.equal(child.credential.id, childCredentialId);

const requiredPermission = DC_BACKEND[0];
assert.ok(requiredPermission);

const presentation = await post(
  "/v1/presentations",
  backendToken,
  {
    credential_id: childCredentialId,
    disclosed_permissions: [requiredPermission],
    audience: "cloud-access-gateway",
    challenge: "phase10a-evm-verification"
  }
);

assert.equal(typeof presentation.signed_vp, "string");
assert.ok(presentation.signed_vp.length > 0);

const verified = await post(
  "/v1/verify",
  gatewayToken,
  {
    presenter: "backend",
    audience: "cloud-access-gateway",
    challenge: "phase10a-evm-verification",
    required_permission: requiredPermission,
    signed_vp: presentation.signed_vp
  }
);

assert.equal(verified.presenter_id, backendId);
assert.equal(verified.credential_id, childCredentialId);
assert.equal(verified.hierarchy_depth, 1);
assert.deepEqual(verified.permissions, [requiredPermission]);

process.stdout.write(
  JSON.stringify(
    {
      result: "phase10a-evm-adapter-smoke-pass",
      trust_profile: health.trust_profile,
      presenter_id: verified.presenter_id,
      credential_id: verified.credential_id,
      hierarchy_depth: verified.hierarchy_depth,
      evm_backed_verification: true
    },
    null,
    2
  ) + "\n"
);
