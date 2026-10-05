import assert from "node:assert/strict";
import {
  DeterministicA2AOrchestrator,
  startSpecializedAgentServer
} from "@thesis/agent-runtime";
import {
  DC_BACKEND,
  DelegatedA2ARoleRunner,
  DeterministicOrchestratorAuthorityIssuer,
  OrchestratorProtectedGatewayClient,
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

const gateway =
  process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter =
  process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const engineerToken = process.env.ADAPTER_CALLER_ENGINEER;
const orchestratorToken =
  process.env.ADAPTER_CALLER_ORCHESTRATOR;
const rootCredentialId =
  process.env.ORCHESTRATOR_ROOT_CREDENTIAL_ID ??
  "urn:phase9b3:orchestrator-root";

for (const [name, value] of Object.entries({
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
    statusListIndex: "9300",
    statusListCredential:
      "https://status.example/lists/phase9b3-smoke"
  }
});

const protectedGateway =
  new OrchestratorProtectedGatewayClient({
    gatewayBaseUrl: gateway,
    adapterBaseUrl: adapter,
    adapterToken: orchestratorToken,
    rootCredentialId
  });

const branch = await protectedGateway.createFeatureBranch(
  "phase9b3-create-feature-branch"
);

const backendServer = await startSpecializedAgentServer({
  role: "backend",
  port: 43321,
  artifactBuilder: (role, task) => ({
    role,
    summary:
      "Backend deterministic Phase 9B.3 task completed with delegated A2A evidence.",
    files_modified: [],
    files_created: [],
    branch: task.branch,
    revision: branch.revision,
    commit_sha: branch.revision,
    test_outcome: "not_run",
    errors: []
  })
});

try {
  const authorityIssuer =
    new DeterministicOrchestratorAuthorityIssuer({
      adapterBaseUrl: adapter,
      bearerToken: orchestratorToken
    });

  const roleRunner = new DelegatedA2ARoleRunner({
    authorityIssuer,
    a2a: new DeterministicA2AOrchestrator()
  });

  const result = await roleRunner.issueAndRun({
    role: "backend",
    parent_credential_id: rootCredentialId,
    credential_id: "urn:phase9b3:backend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9301",
      statusListCredential:
        "https://status.example/lists/phase9b3-smoke"
    },
    agent_base_url: backendServer.baseUrl,
    subtask: {
      subtask_id: "phase9b3-backend",
      instruction:
        "Validate just-in-time Backend authority and protected A2A task transport.",
      branch: "feature/account-suspension",
      relevant_paths: [
        "packages/shared/src/account-status.ts",
        "apps/backend/src/users/user.service.ts",
        "apps/backend/src/users/user.controller.ts",
        "apps/backend/src/users/user.routes.ts"
      ]
    },
    expected_revision: branch.revision
  });

  assert.equal(result.role, "backend");
  assert.equal(
    result.credential.credentialSubject.per.length,
    DC_BACKEND.length
  );
  assert.equal(
    result.credential.credentialSubject.hierarchy?.length,
    1
  );
  assert.equal(result.artifact.role, "backend");
  assert.equal(result.artifact.revision, branch.revision);
  assert.equal(backendServer.executor.executionCount, 1);

  const context =
    backendServer.executor.taskContexts.get(result.task_id);
  assert.ok(context);
  assert.equal(
    context.delegation_evidence.credential_id,
    "urn:phase9b3:backend"
  );
  assert.equal(
    context.delegation_evidence.presenter_id,
    "did:thesis:backend-agent"
  );

  process.stdout.write(
    JSON.stringify(
      {
        result:
          "phase9b3-backend-delegated-a2a-smoke-pass",
        branch_revision: branch.revision,
        child_credential_id:
          result.delegation_evidence.credential_id,
        permission_count:
          result.credential.credentialSubject.per.length,
        a2a_task_id: result.task_id,
        remote_agent: result.remote_agent_name
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await backendServer.close();
}
