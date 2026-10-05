import assert from "node:assert/strict";
import {
  OrchestratorProtectedGatewayClient,
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

const gateway =
  process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter =
  process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const engineerToken = process.env.ADAPTER_CALLER_ENGINEER;
const orchestratorToken =
  process.env.ADAPTER_CALLER_ORCHESTRATOR;
const rootCredentialId =
  process.env.ORCHESTRATOR_ROOT_CREDENTIAL_ID ??
  "urn:phase9b2:orchestrator-root";
const expectedRevision =
  process.env.EXPECTED_GITEA_REVISION ??
  "ea9984fa15098771fc451f9ae51c82824b6a40fd";

for (const [name, value] of Object.entries({
  GITEA_SMOKE_BASE_URL: gitea,
  GITEA_GATEWAY_TOKEN: giteaToken,
  ADAPTER_CALLER_ENGINEER: engineerToken,
  ADAPTER_CALLER_ORCHESTRATOR: orchestratorToken
})) {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}`
    );
  }
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

async function request(
  url,
  options = {},
  accepted = [200, 201]
) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let body = {};
  if (raw.length > 0) body = JSON.parse(raw);

  if (!accepted.includes(response.status)) {
    throw new Error(
      `${options.method ?? "GET"} ${url} -> ${response.status}: ${raw}`
    );
  }
  return body;
}

await waitForHealth(
  `${adapter}/health`,
  "Delegation Adapter"
);
const gatewayHealth = await waitForHealth(
  `${gateway}/health`,
  "Gateway"
);
assert.equal(gatewayHealth.provider, "gitea");

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
    statusListIndex: "9200",
    statusListCredential:
      "https://status.example/lists/phase9b2-smoke"
  }
});

const protectedClient =
  new OrchestratorProtectedGatewayClient({
    gatewayBaseUrl: gateway,
    adapterBaseUrl: adapter,
    adapterToken: orchestratorToken,
    rootCredentialId
  });

const created = await protectedClient.createFeatureBranch(
  "phase9b2-create-feature-branch"
);

assert.equal(
  created.branch,
  "feature/account-suspension"
);
assert.equal(created.base_branch, "main");
assert.equal(created.revision, expectedRevision);
assert.equal(created.commit_sha, expectedRevision);

const deniedPrepare = await request(
  `${gateway}/v1/authorization/prepare`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: "phase9b2-wrong-branch",
      agent_role: "orchestrator",
      tool: "create_branch",
      arguments: {
        base_branch: "main",
        branch: "feature/not-allowed"
      }
    })
  }
);

const deniedPresentation = await request(
  `${adapter}/v1/presentations`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${orchestratorToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      credential_id: rootCredentialId,
      disclosed_permissions: [
        deniedPrepare.required_permission
      ],
      audience: deniedPrepare.audience,
      challenge: deniedPrepare.challenge
    })
  }
);

const denied = await request(
  `${gateway}/v1/authorization/execute`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: deniedPrepare.request_id,
      signed_vp: deniedPresentation.signed_vp
    })
  },
  [403]
);

assert.equal(denied.error, "policy_denied");

await request(
  `${gitea}/api/v1/repos/thesis/iam-console-poc/branches/feature%2Fnot-allowed`,
  {
    headers: {
      authorization: `token ${giteaToken}`,
      accept: "application/json"
    }
  },
  [404]
);

process.stdout.write(
  JSON.stringify(
    {
      result:
        "phase9b2-orchestrator-gateway-smoke-pass",
      branch: created.branch,
      revision: created.revision,
      wrong_branch_policy_denied: true
    },
    null,
    2
  ) + "\n"
);
