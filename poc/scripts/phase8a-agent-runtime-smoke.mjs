import assert from "node:assert/strict";
import {
  AgentController,
  ControlledToolRegistry,
  DelegationEvidenceHandler,
  GatewayControlledToolClient,
  InMemoryAgentRuntimeAuditSink,
  buildLlmArtifactPayload
} from "@thesis/agent-runtime";

const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.ADAPTER_SMOKE_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const owner = process.env.GITEA_OWNER ?? "thesis";
const repository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const expectedMain =
  process.env.EXPECTED_GITEA_REVISION ??
  "405748b1e77992b6bd8630a3ab6f990658d32f6b";

const engineerToken = process.env.ADAPTER_CALLER_ENGINEER;
const orchestratorToken = process.env.ADAPTER_CALLER_ORCHESTRATOR;
const backendToken = process.env.ADAPTER_CALLER_BACKEND;

for (const [name, value] of Object.entries({
  engineerToken,
  orchestratorToken,
  backendToken,
  gitea,
  giteaToken
})) {
  if (!value) throw new Error(`Missing Phase 8A smoke value: ${name}`);
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

async function prepare(tool, args, taskId) {
  const { body } = await request(`${gateway}/v1/authorization/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      agent_role: "backend",
      tool,
      arguments: args
    })
  });
  return body;
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

function encodedPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function giteaFile(path, branch = "feature/account-suspension") {
  const { body } = await request(
    `${gitea}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath(path)}?ref=${encodeURIComponent(branch)}`,
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

class PositiveScriptedModel {
  requests = [];
  step = 0;

  async respond(requestValue) {
    this.requests.push(structuredClone(requestValue));
    this.step += 1;

    if (this.step === 1) {
      return {
        response_id: "resp_phase8a_read",
        model_id: "gpt-5.6-sol-phase8a-scripted",
        output_text: "",
        function_calls: [
          {
            call_id: "call_phase8a_read",
            name: "read_file",
            arguments: JSON.stringify({
              branch: "feature/account-suspension",
              path: backendPath
            })
          }
        ]
      };
    }

    if (this.step === 2) {
      const output = JSON.parse(requestValue.input[0].output);
      assert.equal(output.ok, true);
      const current = output.result.content;
      const marker = "// phase8a controlled runtime smoke";
      const nextContent = current.includes(marker)
        ? current
        : `${current.trimEnd()}\n\n${marker}\n`;

      return {
        response_id: "resp_phase8a_update",
        model_id: "gpt-5.6-sol-phase8a-scripted",
        output_text: "",
        function_calls: [
          {
            call_id: "call_phase8a_update",
            name: "update_file",
            arguments: JSON.stringify({
              branch: "feature/account-suspension",
              path: backendPath,
              content: nextContent
            })
          }
        ]
      };
    }

    return {
      response_id: "resp_phase8a_done",
      model_id: "gpt-5.6-sol-phase8a-scripted",
      output_text: "Read and updated the delegated backend file through controlled Gateway tools.",
      function_calls: []
    };
  }
}

class DeniedScriptedModel {
  requests = [];
  step = 0;

  async respond(requestValue) {
    this.requests.push(structuredClone(requestValue));
    this.step += 1;

    if (this.step === 1) {
      return {
        response_id: "resp_phase8a_denied",
        model_id: "gpt-5.6-sol-phase8a-scripted",
        output_text: "",
        function_calls: [
          {
            call_id: "call_phase8a_denied",
            name: "update_file",
            arguments: JSON.stringify({
              branch: "feature/account-suspension",
              path: securityPath,
              content: "out-of-scope write must never reach Gitea\n"
            })
          }
        ]
      };
    }

    return {
      response_id: "resp_phase8a_denied_done",
      model_id: "gpt-5.6-sol-phase8a-scripted",
      output_text: "The out-of-scope write was denied by delegated authorization.",
      function_calls: []
    };
  }
}

await waitForHealth(`${gateway}/health`, "Gateway");
await waitForHealth(`${adapter}/health`, "Delegation Adapter");

const backendPath = "apps/backend/src/users/user.service.ts";
const securityPath = "security/src/security-config.ts";

const readPermission = (
  await prepare(
    "read_file",
    {
      branch: "feature/account-suspension",
      path: backendPath
    },
    "phase8a-permission-read"
  )
).required_permission;

const updatePermission = (
  await prepare(
    "update_file",
    {
      branch: "feature/account-suspension",
      path: backendPath,
      content: "permission-derivation-only"
    },
    "phase8a-permission-update"
  )
).required_permission;

const permissions = uniquePermissions([readPermission, updatePermission]);
const statusBase = "https://status.example/lists/phase8a-smoke";

await request(`${adapter}/v1/credentials/root`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${engineerToken}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase8a:orchestrator",
    delegatee: "orchestrator",
    valid_from: new Date().toISOString(),
    validity_seconds: 3600,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "800",
      statusListCredential: statusBase
    },
    permissions
  })
});

const { body: childCredential } = await request(
  `${adapter}/v1/credentials/child`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${orchestratorToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      parent_credential_id: "urn:phase8a:orchestrator",
      credential_id: "urn:phase8a:backend",
      delegatee: "backend",
      valid_from: new Date().toISOString(),
      validity_seconds: 1800,
      credential_status: {
        type: "BitstringStatusListEntry",
        statusPurpose: "revocation",
        statusListIndex: "801",
        statusListCredential: statusBase
      },
      permissions
    })
  }
);

const credentialPayload = JSON.stringify(childCredential);
const evidence = {
  credential: credentialPayload,
  credential_id: "urn:phase8a:backend",
  presenter_id: "did:thesis:backend-agent"
};

function runtime(taskId) {
  const evidenceHandler = new DelegationEvidenceHandler({
    adapterBaseUrl: adapter,
    adapterToken: backendToken,
    evidence
  });
  const gatewayClient = new GatewayControlledToolClient({
    gatewayBaseUrl: gateway,
    agentRole: "backend",
    taskId,
    evidenceHandler
  });
  const registry = new ControlledToolRegistry(gatewayClient, [
    "read_file",
    "update_file"
  ]);
  const audit = new InMemoryAgentRuntimeAuditSink();
  return { registry, audit };
}

const beforeSecurity = await giteaFile(securityPath);

const positiveModel = new PositiveScriptedModel();
const positiveRuntime = runtime("phase8a-positive");
const positiveController = new AgentController({
  modelClient: positiveModel,
  toolRegistry: positiveRuntime.registry,
  audit: positiveRuntime.audit,
  maxIterations: 5
});
const subtask = {
  subtask_id: "phase8a-positive",
  instruction: "Read and make one controlled backend edit.",
  branch: "feature/account-suspension",
  relevant_paths: [backendPath]
};
const positive = await positiveController.run({
  task_id: "phase8a-positive",
  role: "backend",
  subtask
});

assert.equal(positive.status, "completed");
assert.equal(positive.model_id, "gpt-5.6-sol-phase8a-scripted");
assert.equal(positive.tool_calls, 2);
assert.equal(positive.controlled_failures.length, 0);

const updatedBackend = await giteaFile(backendPath);
assert.match(updatedBackend, /phase8a controlled runtime smoke/u);

const modelVisible = JSON.stringify({
  requests: positiveModel.requests,
  audit: positiveRuntime.audit.events,
  artifact: buildLlmArtifactPayload("backend", subtask, positive)
});
for (const forbidden of [
  credentialPayload,
  "urn:phase8a:backend",
  backendToken,
  "signed_vp"
]) {
  assert.equal(
    modelVisible.includes(forbidden),
    false,
    `model-visible data leaked protected authorization material: ${forbidden}`
  );
}

const deniedModel = new DeniedScriptedModel();
const deniedRuntime = runtime("phase8a-negative");
const deniedController = new AgentController({
  modelClient: deniedModel,
  toolRegistry: deniedRuntime.registry,
  audit: deniedRuntime.audit,
  maxIterations: 3
});
const denied = await deniedController.run({
  task_id: "phase8a-negative",
  role: "backend",
  subtask: {
    subtask_id: "phase8a-negative",
    instruction:
      "Attempt an out-of-scope security write so infrastructure enforcement can be observed.",
    branch: "feature/account-suspension",
    relevant_paths: [securityPath]
  }
});

assert.equal(denied.status, "completed");
assert.equal(denied.controlled_failures.length, 1);
assert.equal(denied.controlled_failures[0]?.kind, "authorization_denied");
assert.equal(
  deniedRuntime.audit.events.some(
    (event) =>
      event.event === "tool_result" &&
      event.outcome === "controlled_failure" &&
      event.failure_kind === "authorization_denied"
  ),
  true
);

const afterSecurity = await giteaFile(securityPath);
assert.equal(afterSecurity, beforeSecurity);

const mainBranch = await request(
  `${gitea}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/main`,
  {
    headers: {
      authorization: `token ${giteaToken}`,
      accept: "application/json"
    }
  }
);
assert.equal(mainBranch.body.commit?.id, expectedMain);

process.stdout.write(
  JSON.stringify(
    {
      result: "phase8a-agent-runtime-smoke-pass",
      effective_model_id: positive.model_id,
      positive_tool_calls: positive.tool_calls,
      out_of_scope_denied_by_infrastructure: true,
      protected_material_absent_from_model_visible_data: true,
      main_revision: mainBranch.body.commit?.id
    },
    null,
    2
  ) + "\n"
);
