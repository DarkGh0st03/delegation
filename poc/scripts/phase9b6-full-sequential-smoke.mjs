import assert from "node:assert/strict";
import {
  DelegationEvidenceHandler,
  DeterministicA2AOrchestrator,
  GatewayControlledToolClient,
  startSpecializedAgentServer
} from "@thesis/agent-runtime";
import {
  AccountSuspensionSequentialCoordinator,
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
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const giteaOwner = process.env.GITEA_OWNER ?? "thesis";
const giteaRepository =
  process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const expectedMainRevision =
  process.env.EXPECTED_GITEA_REVISION ??
  "ea9984fa15098771fc451f9ae51c82824b6a40fd";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend: process.env.ADAPTER_CALLER_BACKEND,
  frontend: process.env.ADAPTER_CALLER_FRONTEND,
  test: process.env.ADAPTER_CALLER_TEST
};

for (const [name, value] of Object.entries(tokens)) {
  if (!value) throw new Error(`Missing required Adapter token for ${name}`);
}
if (!gitea) throw new Error("Missing GITEA_SMOKE_BASE_URL");
if (!giteaToken) throw new Error("Missing GITEA_GATEWAY_TOKEN");

const rootCredentialId =
  process.env.ORCHESTRATOR_ROOT_CREDENTIAL_ID ??
  "urn:phase9b6:orchestrator-root";

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

async function giteaGet(path) {
  const response = await fetch(`${gitea}${path}`, {
    headers: {
      authorization: `token ${giteaToken}`,
      accept: "application/json"
    }
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gitea GET ${path} -> ${response.status}: ${raw}`);
  }
  return raw ? JSON.parse(raw) : {};
}

function controlledClient(context, role, adapterToken) {
  return new GatewayControlledToolClient({
    gatewayBaseUrl: gateway,
    agentRole: role,
    taskId: context.task_id,
    evidenceHandler: new DelegationEvidenceHandler({
      adapterBaseUrl: adapter,
      adapterToken,
      evidence: context.delegation_evidence
    })
  });
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
    statusListIndex: "9600",
    statusListCredential:
      "https://status.example/lists/phase9b6-smoke"
  }
});

const protectedGateway = new OrchestratorProtectedGatewayClient({
  gatewayBaseUrl: gateway,
  adapterBaseUrl: adapter,
  adapterToken: tokens.orchestrator,
  rootCredentialId
});

const backendPath = "apps/backend/src/users/user.service.ts";
const frontendPath =
  "apps/frontend/src/pages/UserDetailPage.tsx";

const backendServer = await startSpecializedAgentServer({
  role: "backend",
  port: 43351,
  taskHandler: async (context) => {
    const client = controlledClient(
      context,
      "backend",
      tokens.backend
    );
    const before = await client.invoke("read_file", {
      branch: context.subtask.branch,
      path: backendPath
    });
    assert.equal(before.provider, "gitea");
    assert.equal(before.tool, "read_file");
    assert.equal(typeof before.content, "string");

    const updated = await client.invoke("update_file", {
      branch: context.subtask.branch,
      path: backendPath,
      content:
        before.content +
        "\n// Phase 9B.6 controlled Backend orchestration marker.\n"
    });

    assert.equal(updated.provider, "gitea");
    assert.equal(updated.tool, "update_file");
    return {
      role: "backend",
      summary:
        "Backend protected mutation completed through delegated authorization.",
      files_modified: [backendPath],
      files_created: [],
      branch: context.subtask.branch,
      revision: updated.commit_sha,
      commit_sha: updated.commit_sha,
      test_outcome: "not_run",
      errors: []
    };
  }
});

const frontendServer = await startSpecializedAgentServer({
  role: "frontend",
  port: 43352,
  taskHandler: async (context) => {
    const client = controlledClient(
      context,
      "frontend",
      tokens.frontend
    );
    const before = await client.invoke("read_file", {
      branch: context.subtask.branch,
      path: frontendPath
    });
    assert.equal(before.provider, "gitea");
    assert.equal(before.tool, "read_file");
    assert.equal(typeof before.content, "string");

    const updated = await client.invoke("update_file", {
      branch: context.subtask.branch,
      path: frontendPath,
      content:
        before.content +
        "\n{/* Phase 9B.6 controlled Frontend orchestration marker. */}\n"
    });

    assert.equal(updated.provider, "gitea");
    assert.equal(updated.tool, "update_file");
    return {
      role: "frontend",
      summary:
        "Frontend protected mutation completed after the Backend Artifact gate.",
      files_modified: [frontendPath],
      files_created: [],
      branch: context.subtask.branch,
      revision: updated.commit_sha,
      commit_sha: updated.commit_sha,
      test_outcome: "not_run",
      errors: []
    };
  }
});

const testServer = await startSpecializedAgentServer({
  role: "test",
  port: 43353,
  taskHandler: async (context) => {
    const client = controlledClient(
      context,
      "test",
      tokens.test
    );
    const execution = await client.invoke("run_tests", {
      branch: context.subtask.branch,
      profile: "poc-default"
    });

    assert.equal(execution.provider, "runner");
    assert.equal(execution.tool, "run_tests");
    assert.equal(execution.status, "pass");
    assert.equal(execution.project_tests?.status, "pass");
    assert.equal(
      execution.researcher_acceptance?.status,
      "pass"
    );

    return {
      role: "test",
      summary:
        "Controlled Runner accepted the exact final sequential workflow revision.",
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
  const coordinator = new AccountSuspensionSequentialCoordinator({
    gateway: protectedGateway,
    roleRunner: new DelegatedA2ARoleRunner({
      authorityIssuer:
        new DeterministicOrchestratorAuthorityIssuer({
          adapterBaseUrl: adapter,
          bearerToken: tokens.orchestrator
        }),
      a2a: new DeterministicA2AOrchestrator()
    }),
    rootCredentialId,
    agentBaseUrls: {
      backend: backendServer.baseUrl,
      frontend: frontendServer.baseUrl,
      test: testServer.baseUrl
    },
    statusListCredential:
      "https://status.example/lists/phase9b6-smoke"
  });

  const result = await coordinator.run();

  assert.equal(result.workflow.state, "pr_created");
  assert.deepEqual(result.workflow.completed_roles, [
    "backend",
    "frontend",
    "test"
  ]);

  const backendRevision =
    result.delegated_tasks.backend.artifact.revision;
  const frontendRevision =
    result.delegated_tasks.frontend.artifact.revision;
  const testedRevision =
    result.delegated_tasks.test.artifact.tested_commit_sha;

  assert.notEqual(backendRevision, result.branch.revision);
  assert.notEqual(frontendRevision, backendRevision);
  assert.equal(testedRevision, frontendRevision);
  assert.equal(result.pull_request.revision, testedRevision);
  assert.equal(
    result.workflow.pull_request?.head_revision,
    testedRevision
  );

  assert.equal(backendServer.executor.executionCount, 1);
  assert.equal(frontendServer.executor.executionCount, 1);
  assert.equal(testServer.executor.executionCount, 1);

  const runnerHealth = await waitForHealth(
    `${runner}/health`,
    "Controlled Runner stub"
  );
  assert.equal(runnerHealth.run_requests, 1);

  const providerPr = await giteaGet(
    `/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/pulls/${result.pull_request.pull_request_number}`
  );
  assert.equal(
    providerPr.head?.ref,
    "feature/account-suspension"
  );
  assert.equal(providerPr.base?.ref, "main");
  assert.equal(providerPr.head?.sha, testedRevision);

  const mainBranch = await giteaGet(
    `/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/branches/main`
  );
  assert.equal(mainBranch.commit?.id, expectedMainRevision);

  const featureBranch = await giteaGet(
    `/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/branches/feature%2Faccount-suspension`
  );
  assert.equal(featureBranch.commit?.id, testedRevision);

  process.stdout.write(
    JSON.stringify(
      {
        result: "phase9b6-full-sequential-smoke-pass",
        workflow_state: result.workflow.state,
        completed_roles: result.workflow.completed_roles,
        initial_branch_revision: result.branch.revision,
        backend_revision: backendRevision,
        frontend_revision: frontendRevision,
        tested_commit_sha: testedRevision,
        pull_request_number:
          result.pull_request.pull_request_number,
        runner_requests: runnerHealth.run_requests,
        main_unchanged: true,
        automatic_merge: false
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
