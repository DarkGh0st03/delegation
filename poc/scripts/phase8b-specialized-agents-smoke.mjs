import assert from "node:assert/strict";
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

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  backend: process.env.ADAPTER_CALLER_BACKEND,
  frontend: process.env.ADAPTER_CALLER_FRONTEND,
  test: process.env.ADAPTER_CALLER_TEST
};

for (const [name, value] of Object.entries({
  gitea,
  giteaToken,
  ...tokens
})) {
  if (!value) throw new Error(`Missing Phase 8B smoke value: ${name}`);
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
      task_id: `phase8b-permission-${role}-${suffix}`,
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

async function issueRoleCredential(role, permissions, statusIndex) {
  const credentialId = `urn:phase8b:${role}`;
  const { body } = await request(`${adapter}/v1/credentials/root`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.engineer}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      credential_id: credentialId,
      delegatee: role,
      valid_from: new Date().toISOString(),
      validity_seconds: 1800,
      credential_status: {
        type: "BitstringStatusListEntry",
        statusPurpose: "revocation",
        statusListIndex: String(statusIndex),
        statusListCredential: "https://status.example/lists/phase8b-smoke"
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
    maxIterations: 5,
    audit
  });
  return { ...specialized, audit };
}

class ReadThenUpdateModel {
  requests = [];
  step = 0;

  constructor(path, marker) {
    this.path = path;
    this.marker = marker;
  }

  async respond(requestValue) {
    this.requests.push(structuredClone(requestValue));
    this.step += 1;

    if (this.step === 1) {
      return {
        response_id: `resp_read_${this.marker}`,
        model_id: "gpt-5.6-sol-phase8b-scripted",
        output_text: "",
        function_calls: [
          {
            call_id: `call_read_${this.marker}`,
            name: "read_file",
            arguments: JSON.stringify({
              branch: "feature/account-suspension",
              path: this.path
            })
          }
        ]
      };
    }

    if (this.step === 2) {
      const output = JSON.parse(requestValue.input[0].output);
      assert.equal(output.ok, true);
      const current = output.result.content;
      const line = `// phase8b ${this.marker} specialized-agent smoke`;
      const next = current.includes(line)
        ? current
        : `${current.trimEnd()}\n\n${line}\n`;

      return {
        response_id: `resp_update_${this.marker}`,
        model_id: "gpt-5.6-sol-phase8b-scripted",
        output_text: "",
        function_calls: [
          {
            call_id: `call_update_${this.marker}`,
            name: "update_file",
            arguments: JSON.stringify({
              branch: "feature/account-suspension",
              path: this.path,
              content: next
            })
          }
        ]
      };
    }

    return {
      response_id: `resp_done_${this.marker}`,
      model_id: "gpt-5.6-sol-phase8b-scripted",
      output_text: `${this.marker} sandbox task completed through controlled tools.`,
      function_calls: []
    };
  }
}

class CreateTestModel {
  requests = [];
  step = 0;

  async respond(requestValue) {
    this.requests.push(structuredClone(requestValue));
    this.step += 1;
    if (this.step === 1) {
      return {
        response_id: "resp_test_create",
        model_id: "gpt-5.6-sol-phase8b-scripted",
        output_text: "",
        function_calls: [
          {
            call_id: "call_test_create",
            name: "create_file",
            arguments: JSON.stringify({
              branch: "feature/account-suspension",
              path: "tests/e2e/account-suspension.spec.ts",
              content:
                'import { test, expect } from "@playwright/test";\n\ntest("phase8b specialized Test Agent smoke", async () => {\n  expect(true).toBe(true);\n});\n'
            })
          }
        ]
      };
    }
    return {
      response_id: "resp_test_done",
      model_id: "gpt-5.6-sol-phase8b-scripted",
      output_text: "Created the delegated Account Suspension E2E test file.",
      function_calls: []
    };
  }
}

class DeniedUpdateModel {
  requests = [];
  step = 0;

  constructor(path) {
    this.path = path;
  }

  async respond() {
    this.step += 1;
    if (this.step === 1) {
      return {
        response_id: "resp_denied_1",
        model_id: "gpt-5.6-sol-phase8b-scripted",
        output_text: "",
        function_calls: [
          {
            call_id: "call_denied",
            name: "update_file",
            arguments: JSON.stringify({
              branch: "feature/account-suspension",
              path: this.path,
              content: "out-of-scope mutation must not be committed\n"
            })
          }
        ]
      };
    }
    return {
      response_id: "resp_denied_done",
      model_id: "gpt-5.6-sol-phase8b-scripted",
      output_text: "The out-of-scope update was denied by delegated authorization.",
      function_calls: []
    };
  }
}

await waitForHealth(`${gateway}/health`, "Gateway");
await waitForHealth(`${adapter}/health`, "Delegation Adapter");

const backendPath = "apps/backend/src/users/user.service.ts";
const frontendPath = "apps/frontend/src/api/users-api.ts";
const testPath = "tests/e2e/account-suspension.spec.ts";

const backendPermissions = uniquePermissions([
  await prepare("backend", "read_file", {
    branch: "feature/account-suspension",
    path: backendPath
  }, "read"),
  await prepare("backend", "update_file", {
    branch: "feature/account-suspension",
    path: backendPath,
    content: "derive-only"
  }, "update")
]);

const frontendPermissions = uniquePermissions([
  await prepare("frontend", "read_file", {
    branch: "feature/account-suspension",
    path: frontendPath
  }, "read"),
  await prepare("frontend", "update_file", {
    branch: "feature/account-suspension",
    path: frontendPath,
    content: "derive-only"
  }, "update")
]);

const testPermissions = uniquePermissions([
  await prepare("test", "create_file", {
    branch: "feature/account-suspension",
    path: testPath,
    content: "derive-only"
  }, "create")
]);

const credentials = {
  backend: await issueRoleCredential("backend", backendPermissions, 820),
  frontend: await issueRoleCredential("frontend", frontendPermissions, 821),
  test: await issueRoleCredential("test", testPermissions, 822)
};

const positiveCases = [
  {
    role: "backend",
    path: backendPath,
    model: new ReadThenUpdateModel(backendPath, "backend")
  },
  {
    role: "frontend",
    path: frontendPath,
    model: new ReadThenUpdateModel(frontendPath, "frontend")
  },
  {
    role: "test",
    path: testPath,
    model: new CreateTestModel()
  }
];

for (const entry of positiveCases) {
  const specialized = runtime(
    entry.role,
    credentials[entry.role],
    entry.model,
    `phase8b-positive-${entry.role}`
  );

  const result = await specialized.controller.run({
    task_id: `phase8b-positive-${entry.role}`,
    role: entry.role,
    subtask: {
      subtask_id: `phase8b-positive-${entry.role}`,
      instruction: "Complete one small role-specific sandbox task.",
      branch: "feature/account-suspension",
      relevant_paths: [entry.path]
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.controlled_failures.length, 0);
  assert.equal(result.model_id, "gpt-5.6-sol-phase8b-scripted");
  assert.equal(
    JSON.stringify(entry.model.requests).includes(credentials[entry.role].credential),
    false
  );
}

assert.match(await giteaFile(backendPath), /phase8b backend specialized-agent smoke/u);
assert.match(await giteaFile(frontendPath), /phase8b frontend specialized-agent smoke/u);
assert.match(await giteaFile(testPath), /phase8b specialized Test Agent smoke/u);

const boundaryCases = [
  { role: "backend", target: frontendPath },
  { role: "frontend", target: backendPath },
  { role: "test", target: backendPath }
];

for (const boundary of boundaryCases) {
  const before = await giteaFile(boundary.target);
  const model = new DeniedUpdateModel(boundary.target);
  const specialized = runtime(
    boundary.role,
    credentials[boundary.role],
    model,
    `phase8b-boundary-${boundary.role}`
  );

  const result = await specialized.controller.run({
    task_id: `phase8b-boundary-${boundary.role}`,
    role: boundary.role,
    subtask: {
      subtask_id: `phase8b-boundary-${boundary.role}`,
      instruction: "Attempt an out-of-scope update to validate infrastructure enforcement.",
      branch: "feature/account-suspension",
      relevant_paths: [boundary.target]
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.controlled_failures.length, 1);
  assert.equal(result.controlled_failures[0]?.kind, "authorization_denied");
  assert.equal(await giteaFile(boundary.target), before);
}

process.stdout.write(
  JSON.stringify(
    {
      result: "phase8b-specialized-agents-smoke-pass",
      roles: positiveCases.map((entry) => entry.role),
      backend_frontend_cross_role_denied: true,
      test_application_source_write_denied: true,
      effective_model_id: "gpt-5.6-sol-phase8b-scripted"
    },
    null,
    2
  ) + "\n"
);
