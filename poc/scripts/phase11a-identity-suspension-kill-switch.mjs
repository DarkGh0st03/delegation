import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  DelegationEvidenceHandler,
  GatewayControlledToolClient,
  InMemoryAgentRuntimeAuditSink,
  createSpecializedAgentController
} from "@thesis/agent-runtime";
import {
  DeterministicOrchestratorAuthorityIssuer,
  OrchestratorProtectedGatewayClient,
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const giteaOwner = process.env.GITEA_OWNER ?? "thesis";
const giteaRepository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const trustRegistry = process.env.ENTERPRISE_TRUST_REGISTRY_ADDRESS;
const governanceKey = process.env.GOVERNANCE_PRIVATE_KEY;
const rpcUrl = process.env.RPC_URL;
const backendId = process.env.ADAPTER_ID_BACKEND;

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend: process.env.ADAPTER_CALLER_BACKEND
};

for (const [name, value] of Object.entries({
  gitea,
  giteaToken,
  trustRegistry,
  governanceKey,
  rpcUrl,
  backendId,
  ...tokens
})) {
  if (!value) throw new Error("Missing required Phase 11A value: " + name);
}

const rootCredentialId =
  process.env.ORCHESTRATOR_ROOT_CREDENTIAL_ID ??
  "urn:phase11a:orchestrator-root";
const backendCredentialId = "urn:phase11a:backend-child";
const backendPath = "apps/backend/src/users/user.service.ts";
const featureBranch = "feature/account-suspension";

async function waitForHealth(url, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(label + " did not become healthy");
}

async function giteaGet(path) {
  const response = await fetch(gitea + path, {
    headers: {
      authorization: "token " + giteaToken,
      accept: "application/json"
    }
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error("Gitea GET " + path + " -> " + response.status + ": " + raw);
  }
  return raw ? JSON.parse(raw) : {};
}

async function branchHead() {
  const branch = await giteaGet(
    "/api/v1/repos/" +
      encodeURIComponent(giteaOwner) +
      "/" +
      encodeURIComponent(giteaRepository) +
      "/branches/feature%2Faccount-suspension"
  );
  return branch.commit?.id;
}

async function giteaFile(path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const file = await giteaGet(
    "/api/v1/repos/" +
      encodeURIComponent(giteaOwner) +
      "/" +
      encodeURIComponent(giteaRepository) +
      "/contents/" +
      encodedPath +
      "?ref=" +
      encodeURIComponent(featureBranch)
  );
  return Buffer.from(
    String(file.content ?? "").replace(/\s+/gu, ""),
    "base64"
  ).toString("utf8");
}

function identityAddress(did) {
  const address = did.split(":").at(-1);
  if (!address || !/^0x[0-9a-fA-F]{40}$/u.test(address)) {
    throw new Error("Invalid Backend did:ethr identity: " + did);
  }
  return address;
}

function cast(args) {
  return execFileSync("cast", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function setBackendLifecycle(signature) {
  cast([
    "send",
    "--rpc-url",
    rpcUrl,
    "--private-key",
    governanceKey,
    trustRegistry,
    signature,
    identityAddress(backendId)
  ]);
}

function backendActive() {
  const raw = cast([
    "call",
    "--rpc-url",
    rpcUrl,
    trustRegistry,
    "isActive(address)(bool)",
    identityAddress(backendId)
  ]);
  return raw === "true";
}

class SuspendedBackendMutationModel {
  turn = 0;

  async respond(requestValue) {
    this.turn += 1;

    if (this.turn === 1) {
      return {
        response_id: "phase11a_backend_update",
        model_id: "gpt-5.6-sol-phase11a-scripted-backend",
        output_text: "",
        function_calls: [
          {
            call_id: "phase11a_update_call",
            name: "update_file",
            arguments: JSON.stringify({
              branch: featureBranch,
              path: backendPath,
              content:
                "This content must never reach Gitea while the Backend identity is suspended.\n"
            })
          }
        ]
      };
    }

    const output = requestValue.input?.[0]?.output;
    if (typeof output === "string") {
      const parsed = JSON.parse(output);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error?.kind, "authorization_denied");
    }

    return {
      response_id: "phase11a_backend_done",
      model_id: "gpt-5.6-sol-phase11a-scripted-backend",
      output_text:
        "The protected mutation was rejected after the enterprise identity suspension.",
      function_calls: []
    };
  }
}

const adapterHealth = await waitForHealth(adapter + "/health", "Delegation Adapter");
assert.equal(adapterHealth.trust_profile, "evm");
const gatewayHealth = await waitForHealth(gateway + "/health", "Gateway");
assert.equal(gatewayHealth.provider, "gitea");

const bootstrap = new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl: adapter,
  bearerToken: tokens.engineer
});

await bootstrap.issueOrchestratorRoot({
  credential_id: rootCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 7200,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "11000",
    statusListCredential:
      "https://status.example/lists/phase11a-identity-kill-switch"
  }
});

const protectedGateway = new OrchestratorProtectedGatewayClient({
  gatewayBaseUrl: gateway,
  adapterBaseUrl: adapter,
  adapterToken: tokens.orchestrator,
  rootCredentialId
});

const branch = await protectedGateway.createFeatureBranch(
  "phase11a-create-feature-branch"
);

const authority = new DeterministicOrchestratorAuthorityIssuer({
  adapterBaseUrl: adapter,
  bearerToken: tokens.orchestrator
});

const child = await authority.issueSpecializedChild({
  parent_credential_id: rootCredentialId,
  credential_id: backendCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 3600,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "11001",
    statusListCredential:
      "https://status.example/lists/phase11a-identity-kill-switch"
  },
  selection: { role: "backend" }
});

assert.equal(child.role, "backend");
assert.equal(child.credential.id, backendCredentialId);

const evidenceHandler = new DelegationEvidenceHandler({
  adapterBaseUrl: adapter,
  adapterToken: tokens.backend,
  evidence: {
    credential: JSON.stringify(child.credential),
    credential_id: backendCredentialId,
    presenter_id: backendId
  }
});

const client = new GatewayControlledToolClient({
  gatewayBaseUrl: gateway,
  agentRole: "backend",
  taskId: "phase11a-backend-kill-switch",
  evidenceHandler,
  timeoutMs: 30_000
});

const validBeforeSuspension = await client.invoke("read_file", {
  branch: featureBranch,
  path: backendPath
});
assert.equal(validBeforeSuspension.provider, "gitea");
assert.equal(validBeforeSuspension.tool, "read_file");
assert.equal(typeof validBeforeSuspension.content, "string");

const headBefore = await branchHead();
const contentBefore = await giteaFile(backendPath);
assert.equal(headBefore, branch.revision);
assert.equal(backendActive(), true);

setBackendLifecycle("suspendIdentity(address)");
assert.equal(backendActive(), false);

const audit = new InMemoryAgentRuntimeAuditSink();
const specialized = createSpecializedAgentController({
  role: "backend",
  modelClient: new SuspendedBackendMutationModel(),
  gatewayClient: client,
  maxIterations: 3,
  audit
});

const result = await specialized.controller.run({
  task_id: "phase11a-suspended-backend-mutation",
  role: "backend",
  subtask: {
    subtask_id: "phase11a-suspended-backend-mutation",
    instruction:
      "Attempt the delegated Backend mutation while the enterprise identity is suspended.",
    branch: featureBranch,
    relevant_paths: [backendPath]
  }
});

assert.equal(result.status, "completed");
assert.equal(result.model_id, "gpt-5.6-sol-phase11a-scripted-backend");
assert.equal(result.controlled_failures.length, 1);
assert.equal(result.controlled_failures[0]?.kind, "authorization_denied");
assert.equal(
  audit.events.some(
    (event) =>
      event.event === "tool_result" &&
      event.outcome === "controlled_failure" &&
      event.failure_kind === "authorization_denied"
  ),
  true
);

assert.equal(await branchHead(), headBefore);
assert.equal(await giteaFile(backendPath), contentBefore);

setBackendLifecycle("reactivateIdentity(address)");
assert.equal(backendActive(), true);

const validAfterReactivation = await client.invoke("read_file", {
  branch: featureBranch,
  path: backendPath
});
assert.equal(validAfterReactivation.provider, "gitea");
assert.equal(validAfterReactivation.tool, "read_file");
assert.equal(await branchHead(), headBefore);
assert.equal(await giteaFile(backendPath), contentBefore);

process.stdout.write(
  JSON.stringify(
    {
      result: "phase11a-identity-suspension-kill-switch-pass",
      trust_profile: adapterHealth.trust_profile,
      credential_valid_before_suspension: true,
      backend_identity_suspended: true,
      suspended_mutation_denied: true,
      denial_kind: result.controlled_failures[0]?.kind,
      gitea_branch_unchanged: true,
      gitea_file_unchanged: true,
      backend_identity_reactivated: true,
      credential_valid_after_reactivation: true,
      runner_invocations: 0,
      effective_model_id: result.model_id
    },
    null,
    2
  ) + "\n"
);
