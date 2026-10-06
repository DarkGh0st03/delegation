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
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const giteaOwner = process.env.GITEA_OWNER ?? "thesis";
const giteaRepository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const issuerRegistry = process.env.ISSUER_REGISTRY_ADDRESS;
const trustRegistry = process.env.ENTERPRISE_TRUST_REGISTRY_ADDRESS;
const rpcUrl = process.env.RPC_URL;
const orchestratorPrivateKey =
  process.env.ADAPTER_EVM_PRIVATE_KEY_ORCHESTRATOR;
const orchestratorId = process.env.ADAPTER_ID_ORCHESTRATOR;
const frontendId = process.env.ADAPTER_ID_FRONTEND;

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  frontend: process.env.ADAPTER_CALLER_FRONTEND
};

for (const [name, value] of Object.entries({
  gitea,
  giteaToken,
  issuerRegistry,
  trustRegistry,
  rpcUrl,
  orchestratorPrivateKey,
  orchestratorId,
  frontendId,
  ...tokens
})) {
  if (!value) throw new Error("Missing required Phase 11C value: " + name);
}

const rootCredentialId = "urn:phase11c:orchestrator-root";
const frontendCredentialId = "urn:phase11c:frontend-child";
const frontendPath = "apps/frontend/src/api/users-api.ts";
const featureBranch = "feature/account-suspension";
const childStatusList =
  "https://status.example/lists/phase11c-frontend-child";

async function waitForHealth(url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
    throw new Error("Invalid did:ethr identity: " + did);
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

function identityActive(did) {
  return (
    cast([
      "call",
      "--rpc-url",
      rpcUrl,
      trustRegistry,
      "isActive(address)(bool)",
      identityAddress(did)
    ]) === "true"
  );
}

function replaceStatusAnchorWithMismatchedCommitment() {
  const listId = cast(["keccak", childStatusList]);
  const mismatchedHash = cast([
    "keccak",
    "phase11c-intentionally-stale-status-artifact"
  ]);

  cast([
    "send",
    "--rpc-url",
    rpcUrl,
    "--private-key",
    orchestratorPrivateKey,
    issuerRegistry,
    "updateStatusList(address,bytes32,bytes32)",
    identityAddress(orchestratorId),
    listId,
    mismatchedHash
  ]);

  return { listId, mismatchedHash };
}

class StaleStatusFrontendMutationModel {
  turn = 0;

  async respond(requestValue) {
    this.turn += 1;

    if (this.turn === 1) {
      return {
        response_id: "phase11c_frontend_update",
        model_id: "gpt-5.6-sol-phase11c-scripted-frontend",
        output_text: "",
        function_calls: [
          {
            call_id: "phase11c_update_call",
            name: "update_file",
            arguments: JSON.stringify({
              branch: featureBranch,
              path: frontendPath,
              content:
                "This content must never reach Gitea when Status List commitment verification fails.\n"
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
      response_id: "phase11c_frontend_done",
      model_id: "gpt-5.6-sol-phase11c-scripted-frontend",
      output_text:
        "The protected mutation was rejected because the off-chain Status List artifact no longer matched its on-chain commitment.",
      function_calls: []
    };
  }
}

const adapterHealth = await waitForHealth(adapter + "/health", "Delegation Adapter");
assert.equal(adapterHealth.trust_profile, "evm");
const gatewayHealth = await waitForHealth(gateway + "/health", "Gateway");
assert.equal(gatewayHealth.provider, "gitea");
assert.equal(identityActive(orchestratorId), true);
assert.equal(identityActive(frontendId), true);

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
    statusListIndex: "11200",
    statusListCredential:
      "https://status.example/lists/phase11c-root"
  }
});

const authority = new DeterministicOrchestratorAuthorityIssuer({
  adapterBaseUrl: adapter,
  bearerToken: tokens.orchestrator
});

const child = await authority.issueSpecializedChild({
  parent_credential_id: rootCredentialId,
  credential_id: frontendCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 3600,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "11201",
    statusListCredential: childStatusList
  },
  selection: { role: "frontend" }
});

const client = new GatewayControlledToolClient({
  gatewayBaseUrl: gateway,
  agentRole: "frontend",
  taskId: "phase11c-status-commitment-mismatch",
  evidenceHandler: new DelegationEvidenceHandler({
    adapterBaseUrl: adapter,
    adapterToken: tokens.frontend,
    evidence: {
      credential: JSON.stringify(child.credential),
      credential_id: frontendCredentialId,
      presenter_id: frontendId
    }
  }),
  timeoutMs: 30_000
});

const validBeforeMismatch = await client.invoke("read_file", {
  branch: featureBranch,
  path: frontendPath
});
assert.equal(validBeforeMismatch.provider, "gitea");
assert.equal(validBeforeMismatch.tool, "read_file");

const headBefore = await branchHead();
const contentBefore = await giteaFile(frontendPath);
const anchorMutation = replaceStatusAnchorWithMismatchedCommitment();

assert.equal(identityActive(orchestratorId), true);
assert.equal(identityActive(frontendId), true);

const audit = new InMemoryAgentRuntimeAuditSink();
const specialized = createSpecializedAgentController({
  role: "frontend",
  modelClient: new StaleStatusFrontendMutationModel(),
  gatewayClient: client,
  maxIterations: 3,
  audit
});

const result = await specialized.controller.run({
  task_id: "phase11c-stale-status-frontend-mutation",
  role: "frontend",
  subtask: {
    subtask_id: "phase11c-stale-status-frontend-mutation",
    instruction:
      "Attempt the delegated Frontend mutation after the current on-chain Status List commitment no longer matches the Adapter artifact.",
    branch: featureBranch,
    relevant_paths: [frontendPath]
  }
});

assert.equal(result.status, "completed");
assert.equal(result.model_id, "gpt-5.6-sol-phase11c-scripted-frontend");
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
assert.equal(await giteaFile(frontendPath), contentBefore);

process.stdout.write(
  JSON.stringify(
    {
      result: "phase11c-status-commitment-mismatch-pass",
      trust_profile: adapterHealth.trust_profile,
      credential_valid_before_anchor_change: true,
      orchestrator_identity_active: true,
      frontend_identity_active: true,
      status_anchor_updated: true,
      status_list_id: anchorMutation.listId,
      stale_status_artifact_denied: true,
      denial_kind: result.controlled_failures[0]?.kind,
      gitea_branch_unchanged: true,
      gitea_file_unchanged: true,
      runner_invocations: 0,
      effective_model_id: result.model_id
    },
    null,
    2
  ) + "\n"
);
