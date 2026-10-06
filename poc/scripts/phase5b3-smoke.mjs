const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.ADAPTER_SMOKE_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const giteaOwner = process.env.GITEA_OWNER ?? "thesis";
const giteaRepository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const expectedMainRevision =
  process.env.EXPECTED_GITEA_REVISION ??
  "405748b1e77992b6bd8630a3ab6f990658d32f6b";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend: process.env.ADAPTER_CALLER_BACKEND
};

for (const [name, value] of Object.entries(tokens)) {
  if (!value) throw new Error(`Missing smoke token for ${name}`);
}
if (!gitea) throw new Error("Missing GITEA_SMOKE_BASE_URL");
if (!giteaToken) throw new Error("Missing GITEA_GATEWAY_TOKEN");

async function request(url, options = {}, accepted = [200, 201]) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }
  }
  if (!accepted.includes(response.status)) {
    throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}: ${raw}`);
  }
  return { status: response.status, body };
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

const health = await waitForHealth(`${gateway}/health`, "Gateway");
await waitForHealth(`${adapter}/health`, "Delegation Adapter");
if (health.provider !== "gitea") {
  throw new Error(`Expected Gateway provider gitea, got ${health.provider}`);
}

function prepare(role, tool, args, taskId) {
  return request(`${gateway}/v1/authorization/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      agent_role: role,
      tool,
      arguments: args
    })
  }).then(({ body }) => body);
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

const backendPath = "apps/backend/src/users/user.service.ts";
const updatedSource =
  'export const phase5b3Smoke = "authorized-before-pr";\n';

const branchPrepare = await prepare(
  "orchestrator",
  "create_branch",
  {
    base_branch: "main",
    branch: "feature/account-suspension"
  },
  "phase5b3-create-branch"
);
const updatePrepare = await prepare(
  "backend",
  "update_file",
  {
    branch: "feature/account-suspension",
    path: backendPath,
    content: updatedSource
  },
  "phase5b3-update"
);
const deniedPrPrepare = await prepare(
  "orchestrator",
  "create_pull_request",
  {
    head_branch: "main",
    base_branch: "feature/account-suspension",
    title: "Denied reverse-direction PR",
    body: "This request must be denied by OPA before Gitea."
  },
  "phase5b3-policy-deny-pr"
);
const allowedPrPrepare = await prepare(
  "orchestrator",
  "create_pull_request",
  {
    head_branch: "feature/account-suspension",
    base_branch: "main",
    title: "Account Suspension Feature",
    body: "PoC pull request created only after DelegationVerifier and OPA allow."
  },
  "phase5b3-create-pr"
);
const duplicatePrPrepare = await prepare(
  "orchestrator",
  "create_pull_request",
  {
    head_branch: "feature/account-suspension",
    base_branch: "main",
    title: "Duplicate Account Suspension Feature",
    body: "This duplicate must fail at the provider boundary."
  },
  "phase5b3-duplicate-pr"
);

const rootPermissions = uniquePermissions([
  branchPrepare.required_permission,
  updatePrepare.required_permission,
  allowedPrPrepare.required_permission
]);
const statusBase = "https://status.example/lists/phase5b3-smoke";

await request(`${adapter}/v1/credentials/root`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.engineer}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase5b3:orchestrator",
    delegatee: "orchestrator",
    valid_from: new Date().toISOString(),
    validity_seconds: 3600,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "260",
      statusListCredential: statusBase
    },
    permissions: rootPermissions
  })
});

await request(`${adapter}/v1/credentials/child`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.orchestrator}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    parent_credential_id: "urn:phase5b3:orchestrator",
    credential_id: "urn:phase5b3:backend",
    delegatee: "backend",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "261",
      statusListCredential: statusBase
    },
    permissions: [updatePrepare.required_permission]
  })
});

async function presentationFor(prepared, token, credentialId) {
  const { body } = await request(`${adapter}/v1/presentations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      credential_id: credentialId,
      disclosed_permissions: [prepared.required_permission],
      audience: prepared.audience,
      challenge: prepared.challenge
    })
  });
  return body.signed_vp;
}

async function executePrepared(prepared, token, credentialId, accepted = [200, 201]) {
  const signedVp = await presentationFor(prepared, token, credentialId);
  return request(
    `${gateway}/v1/authorization/execute`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: prepared.request_id,
        signed_vp: signedVp
      })
    },
    accepted
  );
}

const branch = await executePrepared(
  branchPrepare,
  tokens.orchestrator,
  "urn:phase5b3:orchestrator"
);
if (
  branch.body.execution?.tool !== "create_branch" ||
  branch.body.execution?.revision !== expectedMainRevision
) {
  throw new Error(`Unexpected create_branch result: ${JSON.stringify(branch.body)}`);
}

const update = await executePrepared(
  updatePrepare,
  tokens.backend,
  "urn:phase5b3:backend"
);
if (
  update.body.execution?.tool !== "update_file" ||
  !update.body.execution?.commit_sha ||
  update.body.execution?.commit_sha === expectedMainRevision
) {
  throw new Error(`Unexpected update_file result: ${JSON.stringify(update.body)}`);
}
const featureRevision = update.body.execution.commit_sha;

const denied = await executePrepared(
  deniedPrPrepare,
  tokens.orchestrator,
  "urn:phase5b3:orchestrator",
  [403]
);
if (denied.body.error !== "policy_denied") {
  throw new Error(`Unexpected policy denial result: ${JSON.stringify(denied.body)}`);
}

async function giteaGet(path) {
  return request(`${gitea}${path}`, {
    headers: {
      authorization: `token ${giteaToken}`,
      accept: "application/json"
    }
  });
}

const pullsBefore = await giteaGet(
  `/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/pulls?state=open`
);
if (!Array.isArray(pullsBefore.body) || pullsBefore.body.length !== 0) {
  throw new Error(
    `Policy-denied PR unexpectedly reached Gitea: ${JSON.stringify(pullsBefore.body)}`
  );
}

const createdPr = await executePrepared(
  allowedPrPrepare,
  tokens.orchestrator,
  "urn:phase5b3:orchestrator"
);
if (
  createdPr.body.execution?.tool !== "create_pull_request" ||
  createdPr.body.execution?.provider !== "gitea" ||
  createdPr.body.execution?.performed !== true ||
  createdPr.body.execution?.head_branch !== "feature/account-suspension" ||
  createdPr.body.execution?.base_branch !== "main" ||
  createdPr.body.execution?.revision !== featureRevision ||
  !Number.isSafeInteger(createdPr.body.execution?.pull_request_number)
) {
  throw new Error(
    `Unexpected create_pull_request result: ${JSON.stringify(createdPr.body)}`
  );
}

const prNumber = createdPr.body.execution.pull_request_number;
const providerPr = await giteaGet(
  `/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/pulls/${prNumber}`
);
if (
  providerPr.body.number !== prNumber ||
  providerPr.body.head?.ref !== "feature/account-suspension" ||
  providerPr.body.base?.ref !== "main"
) {
  throw new Error(`Gitea PR does not match the authorized direction: ${JSON.stringify(providerPr.body)}`);
}

const duplicate = await executePrepared(
  duplicatePrPrepare,
  tokens.orchestrator,
  "urn:phase5b3:orchestrator",
  [409]
);
if (duplicate.body.error !== "provider_conflict") {
  throw new Error(`Expected duplicate PR provider_conflict: ${JSON.stringify(duplicate.body)}`);
}

const mainBranch = await giteaGet(
  `/api/v1/repos/${encodeURIComponent(giteaOwner)}/${encodeURIComponent(giteaRepository)}/branches/main`
);
if (mainBranch.body.commit?.id !== expectedMainRevision) {
  throw new Error(
    `main changed during Phase 5B.3: expected ${expectedMainRevision}, got ${mainBranch.body.commit?.id}`
  );
}

console.log("PHASE5B3_SMOKE=PASS");
console.log(`featureRevision=${featureRevision}`);
console.log(`pullRequestNumber=${prNumber}`);
console.log("policyDeny=PASS");
console.log("duplicatePullRequest=BLOCKED");
console.log(`mainRevision=${mainBranch.body.commit.id}`);
