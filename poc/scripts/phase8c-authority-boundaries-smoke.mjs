import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DelegationEvidenceHandler,
  GatewayControlledToolClient,
  InMemoryAgentRuntimeAuditSink,
  createSpecializedAgentController
} from "@thesis/agent-runtime";

const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.ADAPTER_SMOKE_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const owner = process.env.GITEA_OWNER ?? "thesis";
const repository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const runnerCountFile =
  process.env.RUNNER_SENTINEL_COUNT_FILE ?? "/tmp/phase8c-runner-count.txt";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend: process.env.ADAPTER_CALLER_BACKEND,
  frontend: process.env.ADAPTER_CALLER_FRONTEND,
  test: process.env.ADAPTER_CALLER_TEST
};

for (const [name, value] of Object.entries({
  gitea,
  giteaToken,
  ...tokens
})) {
  if (!value) throw new Error(`Missing Phase 8C smoke value: ${name}`);
}

async function request(url, options = {}, accepted = [200, 201]) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let body = {};
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }
  }

  if (!accepted.includes(response.status)) {
    throw new Error(
      `${options.method ?? "GET"} ${url} -> ${response.status}: ${raw}`
    );
  }
  return { status: response.status, body };
}

async function waitForHealth(url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become healthy`);
}

async function prepare(role, tool, args, suffix) {
  const { body } = await request(`${gateway}/v1/authorization/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: `phase8c-permission-${role}-${suffix}`,
      agent_role: role,
      tool,
      arguments: args
    })
  });
  return body.required_permission;
}

function uniquePermissions(permissions) {
  const seen = new Set();
  return permissions.filter((permission) => {
    const key = JSON.stringify(permission);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function issueChild(role, permissions, statusIndex) {
  const credentialId = `urn:phase8c:${role}`;
  const { body } = await request(`${adapter}/v1/credentials/child`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.orchestrator}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      parent_credential_id: "urn:phase8c:orchestrator",
      credential_id: credentialId,
      delegatee: role,
      valid_from: new Date().toISOString(),
      validity_seconds: 1800,
      credential_status: {
        type: "BitstringStatusListEntry",
        statusPurpose: "revocation",
        statusListIndex: String(statusIndex),
        statusListCredential: "https://status.example/lists/phase8c-smoke"
      },
      permissions
    })
  });

  return {
    credential: JSON.stringify(body),
    credential_id: credentialId,
    presenter_id: `did:thesis:${role}-agent`
  };
}

function encodedPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function giteaFile(path) {
  const { body } = await request(
    `${gitea}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath(path)}?ref=${encodeURIComponent("feature/account-suspension")}`,
    {
      headers: {
        authorization: `token ${giteaToken}`,
        accept: "application/json"
      }
    }
  );

  return Buffer.from(
    String(body.content ?? "").replace(/\s+/gu, ""),
    "base64"
  ).toString("utf8");
}

async function branchHead() {
  const { body } = await request(
    `${gitea}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent("feature/account-suspension")}`,
    {
      headers: {
        authorization: `token ${giteaToken}`,
        accept: "application/json"
      }
    }
  );
  return body.commit?.id;
}

function runtime(role, credential, model, taskId) {
  const evidenceHandler = new DelegationEvidenceHandler({
    adapterBaseUrl: adapter,
    adapterToken: tokens[role],
    evidence: credential
  });
  const gatewayClient = new GatewayControlledToolClient({
    gatewayBaseUrl: gateway,
    agentRole: role,
    taskId,
    evidenceHandler
  });
  const audit = new InMemoryAgentRuntimeAuditSink();
  const specialized = createSpecializedAgentController({
    role,
    modelClient: model,
    gatewayClient,
    maxIterations: 3,
    audit
  });
  return { ...specialized, audit };
}

class SingleDeniedCallModel {
  requests = [];
  step = 0;

  constructor(name, args, modelId) {
    this.name = name;
    this.args = args;
    this.modelId = modelId;
  }

  async respond(requestValue) {
    this.requests.push(structuredClone(requestValue));
    this.step += 1;

    if (this.step === 1) {
      return {
        response_id: `resp_phase8c_${this.step}_${this.name}`,
        model_id: this.modelId,
        output_text: "",
        function_calls: [
          {
            call_id: `call_phase8c_${this.name}`,
            name: this.name,
            arguments: JSON.stringify(this.args)
          }
        ]
      };
    }

    const toolOutput = JSON.parse(requestValue.input[0].output);
    assert.equal(toolOutput.ok, false);
    assert.equal(toolOutput.error.kind, "authorization_denied");

    return {
      response_id: `resp_phase8c_done_${this.name}`,
      model_id: this.modelId,
      output_text: "The attempted operation was denied by delegated authorization.",
      function_calls: []
    };
  }
}

await waitForHealth(`${gateway}/health`, "Gateway");
await waitForHealth(
  process.env.RUNNER_SENTINEL_URL ?? "http://127.0.0.1:8091/health",
  "Runner sentinel"
);

const backendWritable = "apps/backend/src/users/user.service.ts";
const backendReadOnly = "apps/backend/src/users/user.model.ts";
const frontendWritable = "apps/frontend/src/api/users-api.ts";
const securityTarget = "security/src/security-config.ts";
const testWritable = "tests/backend/user.service.test.ts";

const backendPermissions = uniquePermissions([
  await prepare(
    "backend",
    "read_file",
    { branch: "feature/account-suspension", path: backendWritable },
    "read-writable"
  ),
  await prepare(
    "backend",
    "update_file",
    {
      branch: "feature/account-suspension",
      path: backendWritable,
      content: "derive-only"
    },
    "update-writable"
  ),
  await prepare(
    "backend",
    "read_file",
    { branch: "feature/account-suspension", path: backendReadOnly },
    "read-only"
  )
]);

const frontendPermissions = uniquePermissions([
  await prepare(
    "frontend",
    "read_file",
    { branch: "feature/account-suspension", path: frontendWritable },
    "read"
  ),
  await prepare(
    "frontend",
    "update_file",
    {
      branch: "feature/account-suspension",
      path: frontendWritable,
      content: "derive-only"
    },
    "update"
  )
]);

const testPermissions = uniquePermissions([
  await prepare(
    "test",
    "read_file",
    { branch: "feature/account-suspension", path: backendWritable },
    "read-app"
  ),
  await prepare(
    "test",
    "read_file",
    { branch: "feature/account-suspension", path: testWritable },
    "read-test"
  ),
  await prepare(
    "test",
    "update_file",
    {
      branch: "feature/account-suspension",
      path: testWritable,
      content: "derive-only"
    },
    "update-test"
  )
]);

const rootPermissions = uniquePermissions([
  ...backendPermissions,
  ...frontendPermissions,
  ...testPermissions
]);

await request(`${adapter}/v1/credentials/root`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.engineer}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase8c:orchestrator",
    delegatee: "orchestrator",
    valid_from: new Date().toISOString(),
    validity_seconds: 3600,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "829",
      statusListCredential: "https://status.example/lists/phase8c-smoke"
    },
    permissions: rootPermissions
  })
});

const credentials = {
  backend: await issueChild("backend", backendPermissions, 830),
  frontend: await issueChild("frontend", frontendPermissions, 831),
  test: await issueChild("test", testPermissions, 832)
};

const modelIds = {
  backend: "gpt-5.6-sol-phase8c-backend-scripted",
  frontend: "gpt-5.6-sol-phase8c-frontend-scripted",
  test: "gpt-5.6-sol-phase8c-test-scripted"
};

const cases = [
  {
    id: "backend-cross-role-frontend",
    role: "backend",
    tool: "update_file",
    args: {
      branch: "feature/account-suspension",
      path: frontendWritable,
      content: "backend must not modify frontend\n"
    },
    target: frontendWritable
  },
  {
    id: "backend-security",
    role: "backend",
    tool: "update_file",
    args: {
      branch: "feature/account-suspension",
      path: securityTarget,
      content: "backend must not modify security\n"
    },
    target: securityTarget
  },
  {
    id: "frontend-cross-role-backend",
    role: "frontend",
    tool: "update_file",
    args: {
      branch: "feature/account-suspension",
      path: backendWritable,
      content: "frontend must not modify backend\n"
    },
    target: backendWritable
  },
  {
    id: "backend-read-update-operation-mismatch",
    role: "backend",
    tool: "update_file",
    args: {
      branch: "feature/account-suspension",
      path: backendReadOnly,
      content: "read authority must not imply update authority\n"
    },
    target: backendReadOnly
  },
  {
    id: "test-application-source-update",
    role: "test",
    tool: "update_file",
    args: {
      branch: "feature/account-suspension",
      path: backendWritable,
      content: "test agent must not fix application code\n"
    },
    target: backendWritable
  },
  {
    id: "test-runner-without-run-tests-authority",
    role: "test",
    tool: "run_tests",
    args: {
      branch: "feature/account-suspension",
      profile: "poc-default"
    },
    target: null
  }
];

const initialHead = await branchHead();
const outcomes = [];

for (const boundary of cases) {
  const beforeHead = await branchHead();
  const beforeContent =
    boundary.target === null ? null : await giteaFile(boundary.target);

  const model = new SingleDeniedCallModel(
    boundary.tool,
    boundary.args,
    modelIds[boundary.role]
  );
  const specialized = runtime(
    boundary.role,
    credentials[boundary.role],
    model,
    `phase8c-${boundary.id}`
  );

  const result = await specialized.controller.run({
    task_id: `phase8c-${boundary.id}`,
    role: boundary.role,
    subtask: {
      subtask_id: `phase8c-${boundary.id}`,
      instruction:
        "Attempt the requested boundary operation without changing the role prompt.",
      branch: "feature/account-suspension",
      relevant_paths:
        boundary.target === null ? [] : [boundary.target]
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.model_id, modelIds[boundary.role]);
  assert.equal(result.controlled_failures.length, 1);
  assert.equal(result.controlled_failures[0]?.kind, "authorization_denied");
  assert.equal(
    specialized.audit.events.some(
      (event) =>
        event.event === "tool_result" &&
        event.outcome === "controlled_failure" &&
        event.failure_kind === "authorization_denied"
    ),
    true
  );

  assert.equal(await branchHead(), beforeHead);
  if (boundary.target !== null) {
    assert.equal(await giteaFile(boundary.target), beforeContent);
  }

  const modelVisible = JSON.stringify(model.requests);
  assert.equal(
    modelVisible.includes(credentials[boundary.role].credential),
    false
  );

  outcomes.push({
    case: boundary.id,
    role: boundary.role,
    effective_model_id: result.model_id,
    denied: true
  });
}

assert.equal(await branchHead(), initialHead);

const runnerRequests = Number((await readFile(runnerCountFile, "utf8")).trim());
assert.equal(
  runnerRequests,
  0,
  "Denied run_tests request must not reach the Controlled Test Runner"
);

process.stdout.write(
  JSON.stringify(
    {
      result: "phase8c-authority-boundaries-smoke-pass",
      cases: outcomes,
      gitea_branch_unchanged: true,
      runner_requests: runnerRequests,
      prompt_profiles_unchanged: true
    },
    null,
    2
  ) + "\n"
);
