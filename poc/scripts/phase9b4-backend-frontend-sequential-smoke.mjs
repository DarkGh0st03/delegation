import assert from "node:assert/strict";
import {
  DeterministicA2AOrchestrator,
  startSpecializedAgentServer
} from "@thesis/agent-runtime";
import {
  AccountSuspensionWorkflow,
  DC_BACKEND,
  DC_FRONTEND,
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
  "urn:phase9b4:orchestrator-root";

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
    statusListIndex: "9400",
    statusListCredential:
      "https://status.example/lists/phase9b4-smoke"
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
  "phase9b4-create-feature-branch"
);

const artifactBuilder = (role, task) => ({
  role,
  summary:
    `${role} deterministic sequential task completed after the previous workflow gate.`,
  files_modified: [],
  files_created: [],
  branch: task.branch,
  revision: branch.revision,
  commit_sha: branch.revision,
  test_outcome: "not_run",
  errors: []
});

const backendServer = await startSpecializedAgentServer({
  role: "backend",
  port: 43331,
  artifactBuilder
});
const frontendServer = await startSpecializedAgentServer({
  role: "frontend",
  port: 43332,
  artifactBuilder
});

try {
  const workflow = new AccountSuspensionWorkflow();
  workflow.markBranchReady(branch.revision);

  const roleRunner = new DelegatedA2ARoleRunner({
    authorityIssuer:
      new DeterministicOrchestratorAuthorityIssuer({
        adapterBaseUrl: adapter,
        bearerToken: orchestratorToken
      }),
    a2a: new DeterministicA2AOrchestrator()
  });

  assert.equal(frontendServer.executor.executionCount, 0);

  const backend = await roleRunner.issueAndRun({
    role: "backend",
    parent_credential_id: rootCredentialId,
    credential_id: "urn:phase9b4:backend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9401",
      statusListCredential:
        "https://status.example/lists/phase9b4-smoke"
    },
    agent_base_url: backendServer.baseUrl,
    subtask: {
      subtask_id: "phase9b4-backend",
      instruction:
        "Complete the Backend orchestration checkpoint before Frontend can start.",
      branch: "feature/account-suspension",
      relevant_paths: [
        "packages/shared/src/account-status.ts",
        "apps/backend/src/users/user.service.ts"
      ]
    },
    expected_revision: workflow.currentRevision
  });

  assert.equal(
    backend.credential.credentialSubject.per.length,
    DC_BACKEND.length
  );
  workflow.recordCompletedTask(backend.artifact);
  assert.equal(workflow.state, "backend_completed");
  assert.equal(frontendServer.executor.executionCount, 0);

  const frontend = await roleRunner.issueAndRun({
    role: "frontend",
    parent_credential_id: rootCredentialId,
    credential_id: "urn:phase9b4:frontend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9402",
      statusListCredential:
        "https://status.example/lists/phase9b4-smoke"
    },
    agent_base_url: frontendServer.baseUrl,
    subtask: {
      subtask_id: "phase9b4-frontend",
      instruction:
        "Start only after the Backend Artifact has passed the workflow gate.",
      branch: "feature/account-suspension",
      relevant_paths: [
        "packages/shared/src/account-status.ts",
        "apps/frontend/src/api/users-api.ts",
        "apps/frontend/src/pages/UserDetailPage.tsx"
      ]
    },
    expected_revision: workflow.currentRevision
  });

  assert.equal(
    frontend.credential.credentialSubject.per.length,
    DC_FRONTEND.length
  );
  workflow.recordCompletedTask(frontend.artifact);

  const snapshot = workflow.snapshot();
  assert.equal(snapshot.state, "frontend_completed");
  assert.deepEqual(snapshot.completed_roles, [
    "backend",
    "frontend"
  ]);
  assert.equal(backendServer.executor.executionCount, 1);
  assert.equal(frontendServer.executor.executionCount, 1);
  assert.equal(snapshot.current_revision, branch.revision);

  process.stdout.write(
    JSON.stringify(
      {
        result:
          "phase9b4-backend-frontend-sequential-smoke-pass",
        state: snapshot.state,
        completed_roles: snapshot.completed_roles,
        branch_revision: snapshot.current_revision,
        frontend_started_only_after_backend_gate: true
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await frontendServer.close().catch(() => undefined);
  await backendServer.close().catch(() => undefined);
}
