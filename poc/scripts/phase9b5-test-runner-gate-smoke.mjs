import assert from "node:assert/strict";
import {
  DelegationEvidenceHandler,
  DeterministicA2AOrchestrator,
  GatewayControlledToolClient,
  startSpecializedAgentServer
} from "@thesis/agent-runtime";
import {
  AccountSuspensionWorkflow,
  DC_BACKEND,
  DC_FRONTEND,
  DC_TEST,
  DelegatedA2ARoleRunner,
  DeterministicOrchestratorAuthorityIssuer,
  OrchestratorProtectedGatewayClient,
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

const gateway =
  process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter =
  process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const runner =
  process.env.TEST_RUNNER_URL ?? "http://127.0.0.1:8091";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  test: process.env.ADAPTER_CALLER_TEST
};

for (const [name, value] of Object.entries(tokens)) {
  if (!value) {
    throw new Error(`Missing required Adapter token for ${name}`);
  }
}

const rootCredentialId =
  process.env.ORCHESTRATOR_ROOT_CREDENTIAL_ID ??
  "urn:phase9b5:orchestrator-root";

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

await waitForHealth(`${adapter}/health`, "Delegation Adapter");
const gatewayHealth = await waitForHealth(
  `${gateway}/health`,
  "Gateway"
);
assert.equal(gatewayHealth.provider, "gitea");
await waitForHealth(`${runner}/health`, "Controlled Runner stub");

const bootstrap = new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl: adapter,
  bearerToken: tokens.engineer
});

await bootstrap.issueOrchestratorRoot({
  credential_id: rootCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 3600,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "9500",
    statusListCredential:
      "https://status.example/lists/phase9b5-smoke"
  }
});

const protectedGateway =
  new OrchestratorProtectedGatewayClient({
    gatewayBaseUrl: gateway,
    adapterBaseUrl: adapter,
    adapterToken: tokens.orchestrator,
    rootCredentialId
  });

const branch = await protectedGateway.createFeatureBranch(
  "phase9b5-create-feature-branch"
);

const workflow = new AccountSuspensionWorkflow();
workflow.markBranchReady(branch.revision);

const deterministicArtifactBuilder = (role, task) => ({
  role,
  summary:
    `${role} deterministic Phase 9B orchestration checkpoint completed.`,
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
  port: 43341,
  artifactBuilder: deterministicArtifactBuilder
});

const frontendServer = await startSpecializedAgentServer({
  role: "frontend",
  port: 43342,
  artifactBuilder: deterministicArtifactBuilder
});

const testServer = await startSpecializedAgentServer({
  role: "test",
  port: 43343,
  taskHandler: async (context) => {
    const evidenceHandler = new DelegationEvidenceHandler({
      adapterBaseUrl: adapter,
      adapterToken: tokens.test,
      evidence: context.delegation_evidence
    });

    const gatewayClient = new GatewayControlledToolClient({
      gatewayBaseUrl: gateway,
      agentRole: "test",
      taskId: context.task_id,
      evidenceHandler
    });

    const execution = await gatewayClient.invoke("run_tests", {
      branch: "feature/account-suspension",
      profile: "poc-default"
    });

    assert.equal(execution.provider, "runner");
    assert.equal(execution.tool, "run_tests");
    assert.equal(execution.status, "pass");
    assert.equal(execution.tested_commit_sha, workflow.currentRevision);
    assert.equal(execution.project_tests?.status, "pass");
    assert.equal(execution.researcher_acceptance?.status, "pass");

    return {
      role: "test",
      summary:
        "Controlled Test Runner accepted the exact workflow revision.",
      files_modified: [],
      files_created: [],
      branch: context.subtask.branch,
      revision: execution.tested_commit_sha,
      commit_sha: execution.tested_commit_sha,
      test_outcome: "pass",
      errors: [],
      tested_commit_sha: execution.tested_commit_sha,
      runner_profile: execution.runner_profile,
      project_tests: execution.project_tests.status,
      researcher_acceptance:
        execution.researcher_acceptance.status
    };
  }
});

try {
  const roleRunner = new DelegatedA2ARoleRunner({
    authorityIssuer:
      new DeterministicOrchestratorAuthorityIssuer({
        adapterBaseUrl: adapter,
        bearerToken: tokens.orchestrator
      }),
    a2a: new DeterministicA2AOrchestrator()
  });

  const backend = await roleRunner.issueAndRun({
    role: "backend",
    parent_credential_id: rootCredentialId,
    credential_id: "urn:phase9b5:backend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9501",
      statusListCredential:
        "https://status.example/lists/phase9b5-smoke"
    },
    agent_base_url: backendServer.baseUrl,
    subtask: {
      subtask_id: "phase9b5-backend",
      instruction:
        "Complete the deterministic Backend orchestration gate.",
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
  assert.equal(testServer.executor.executionCount, 0);

  const frontend = await roleRunner.issueAndRun({
    role: "frontend",
    parent_credential_id: rootCredentialId,
    credential_id: "urn:phase9b5:frontend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9502",
      statusListCredential:
        "https://status.example/lists/phase9b5-smoke"
    },
    agent_base_url: frontendServer.baseUrl,
    subtask: {
      subtask_id: "phase9b5-frontend",
      instruction:
        "Start only after the Backend Artifact has passed validation.",
      branch: "feature/account-suspension",
      relevant_paths: [
        "packages/shared/src/account-status.ts",
        "apps/frontend/src/api/users-api.ts"
      ]
    },
    expected_revision: workflow.currentRevision
  });
  assert.equal(
    frontend.credential.credentialSubject.per.length,
    DC_FRONTEND.length
  );
  workflow.recordCompletedTask(frontend.artifact);
  assert.equal(workflow.state, "frontend_completed");
  assert.equal(testServer.executor.executionCount, 0);

  const testResult = await roleRunner.issueAndRun({
    role: "test",
    parent_credential_id: rootCredentialId,
    credential_id: "urn:phase9b5:test",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "9503",
      statusListCredential:
        "https://status.example/lists/phase9b5-smoke"
    },
    agent_base_url: testServer.baseUrl,
    subtask: {
      subtask_id: "phase9b5-test",
      instruction:
        "Invoke the controlled exact-SHA test gate through delegated authorization.",
      branch: "feature/account-suspension",
      relevant_paths: [
        "tests/backend/user.service.test.ts",
        "tests/backend/user.routes.test.ts",
        "tests/frontend/UserDetailPage.test.tsx",
        "tests/e2e/account-suspension.spec.ts"
      ]
    },
    expected_revision: workflow.currentRevision
  });

  assert.equal(
    testResult.credential.credentialSubject.per.length,
    DC_TEST.length
  );
  workflow.recordCompletedTask(testResult.artifact);

  const snapshot = workflow.snapshot();
  assert.equal(snapshot.state, "test_completed");
  assert.deepEqual(snapshot.completed_roles, [
    "backend",
    "frontend",
    "test"
  ]);
  assert.equal(
    snapshot.artifacts.test?.tested_commit_sha,
    branch.revision
  );
  assert.equal(snapshot.artifacts.test?.project_tests, "pass");
  assert.equal(
    snapshot.artifacts.test?.researcher_acceptance,
    "pass"
  );
  assert.equal(testServer.executor.executionCount, 1);

  const runnerHealth = await waitForHealth(
    `${runner}/health`,
    "Controlled Runner stub"
  );
  assert.equal(runnerHealth.run_requests, 1);

  process.stdout.write(
    JSON.stringify(
      {
        result:
          "phase9b5-test-runner-gate-smoke-pass",
        state: snapshot.state,
        completed_roles: snapshot.completed_roles,
        tested_commit_sha:
          snapshot.artifacts.test?.tested_commit_sha,
        project_tests:
          snapshot.artifacts.test?.project_tests,
        researcher_acceptance:
          snapshot.artifacts.test?.researcher_acceptance,
        runner_requests: runnerHealth.run_requests,
        pr_not_created_before_test_gate:
          snapshot.pull_request === null
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await testServer.close().catch(() => undefined);
  await frontendServer.close().catch(() => undefined);
  await backendServer.close().catch(() => undefined);
}
