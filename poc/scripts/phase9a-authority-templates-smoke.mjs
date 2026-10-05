import assert from "node:assert/strict";
import {
  DC_BACKEND,
  DC_FRONTEND,
  DC_TEST,
  DeterministicOrchestratorAuthorityIssuer,
  resolveDelegationTemplate
} from "@thesis/orchestrator-runtime";

const adapter = process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const orchestratorToken = process.env.ADAPTER_CALLER_ORCHESTRATOR;
const parentCredentialId =
  process.env.ORCHESTRATOR_ROOT_CREDENTIAL_ID ?? "urn:phase9a:orchestrator-root";

if (!orchestratorToken) {
  throw new Error("ADAPTER_CALLER_ORCHESTRATOR is required");
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${adapter}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Delegation Adapter did not become healthy");
}

function keys(values) {
  return values
    .map((value) => `${value.operation}\u0000${value.resource}`)
    .sort();
}

function status(index) {
  return {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: String(index),
    statusListCredential: "https://status.example/lists/phase9a-smoke"
  };
}

await waitForHealth();

const issuer = new DeterministicOrchestratorAuthorityIssuer({
  adapterBaseUrl: adapter,
  bearerToken: orchestratorToken
});

const cases = [
  {
    role: "backend",
    selection: { role: "backend" },
    credentialId: "urn:phase9a:backend",
    template: DC_BACKEND,
    statusIndex: 9101
  },
  {
    role: "frontend",
    selection: { skill: "frontend-account-lifecycle" },
    credentialId: "urn:phase9a:frontend",
    template: DC_FRONTEND,
    statusIndex: 9102
  },
  {
    role: "test",
    selection: { role: "test" },
    credentialId: "urn:phase9a:test",
    template: DC_TEST,
    statusIndex: 9103
  }
];

const issued = [];

for (const entry of cases) {
  const result = await issuer.issueSpecializedChild({
    parent_credential_id: parentCredentialId,
    credential_id: entry.credentialId,
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: status(entry.statusIndex),
    selection: entry.selection
  });

  assert.equal(result.role, entry.role);
  assert.equal(result.credential.id, entry.credentialId);
  assert.deepEqual(keys(result.credential.credentialSubject.per), keys(entry.template));
  assert.equal(result.credential.credentialSubject.hierarchy?.length, 1);

  issued.push({
    role: entry.role,
    credential_id: result.credential.id,
    permission_count: result.credential.credentialSubject.per.length
  });
}

assert.throws(
  () =>
    resolveDelegationTemplate({
      role: "backend",
      permissions: [{ resource: "gitea://invalid", operation: "create_pull_request" }]
    }),
  /unsupported fields/u
);

process.stdout.write(
  JSON.stringify(
    {
      result: "phase9a-authority-templates-smoke-pass",
      root_credential_id: parentCredentialId,
      children: issued,
      arbitrary_template_injection_rejected: true
    },
    null,
    2
  ) + "\n"
);
