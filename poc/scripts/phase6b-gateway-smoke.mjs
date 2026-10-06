const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.ADAPTER_SMOKE_URL ?? "http://127.0.0.1:8090";
const expectedRevision =
  process.env.EXPECTED_GITEA_REVISION ??
  "405748b1e77992b6bd8630a3ab6f990658d32f6b";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  test: process.env.ADAPTER_CALLER_TEST
};
for (const [name, value] of Object.entries(tokens)) {
  if (!value) throw new Error(`Missing smoke token for ${name}`);
}

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

await waitForHealth(`${adapter}/health`, "Delegation Adapter");
const health = await waitForHealth(`${gateway}/health`, "Gateway");
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

const branchPrepare = await prepare(
  "orchestrator",
  "create_branch",
  {
    base_branch: "main",
    branch: "feature/account-suspension"
  },
  "phase6b-create-branch"
);
const runPrepare = await prepare(
  "test",
  "run_tests",
  {
    branch: "feature/account-suspension",
    profile: "poc-default"
  },
  "phase6b-run-tests"
);
const rejectedRunPrepare = await prepare(
  "test",
  "run_tests",
  {
    branch: "feature/account-suspension",
    profile: "poc-default"
  },
  "phase6b-rejected-before-runner"
);

const statusBase = "https://status.example/lists/phase6b-smoke";
await request(`${adapter}/v1/credentials/root`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.engineer}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    credential_id: "urn:phase6b:orchestrator",
    delegatee: "orchestrator",
    valid_from: new Date().toISOString(),
    validity_seconds: 3600,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "300",
      statusListCredential: statusBase
    },
    permissions: [
      branchPrepare.required_permission,
      runPrepare.required_permission
    ]
  })
});

await request(`${adapter}/v1/credentials/child`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${tokens.orchestrator}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    parent_credential_id: "urn:phase6b:orchestrator",
    credential_id: "urn:phase6b:test",
    delegatee: "test",
    valid_from: new Date().toISOString(),
    validity_seconds: 1800,
    credential_status: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "301",
      statusListCredential: statusBase
    },
    permissions: [runPrepare.required_permission]
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

async function executePrepared(prepared, token, credentialId, accepted = [200]) {
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
  "urn:phase6b:orchestrator"
);
if (
  branch.body.execution?.tool !== "create_branch" ||
  branch.body.execution?.revision !== expectedRevision
) {
  throw new Error(`Unexpected branch result: ${JSON.stringify(branch.body)}`);
}

const rejected = await request(
  `${gateway}/v1/authorization/execute`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: rejectedRunPrepare.request_id,
      signed_vp: "not-a-valid-presentation"
    })
  },
  [403]
);
if (rejected.body.error !== "verification_rejected") {
  throw new Error(
    `Expected verification rejection before Runner invocation: ${JSON.stringify(rejected.body)}`
  );
}

const run = await executePrepared(
  runPrepare,
  tokens.test,
  "urn:phase6b:test"
);
const execution = run.body.execution;
if (
  execution?.provider !== "runner" ||
  execution?.tool !== "run_tests" ||
  execution?.performed !== true ||
  execution?.tested_commit_sha !== expectedRevision ||
  execution?.revision !== expectedRevision ||
  execution?.runner_profile !== "poc-default" ||
  execution?.status !== "pass"
) {
  throw new Error(`Unexpected RunTests result: ${JSON.stringify(run.body)}`);
}

const phaseStatus = new Map(
  (execution.phases ?? []).map((phase) => [phase.phase, phase.status])
);
for (const phase of [
  "dependency_install",
  "typecheck",
  "backend_tests",
  "frontend_tests",
  "build",
  "playwright_e2e"
]) {
  if (phaseStatus.get(phase) !== "pass") {
    throw new Error(
      `Expected Runner phase ${phase} to pass: ${JSON.stringify(execution.phases)}`
    );
  }
}
if (phaseStatus.get("researcher_acceptance") !== "skipped") {
  throw new Error("Researcher acceptance must remain skipped until Phase 6C");
}

console.log("PHASE6B_GATEWAY_SMOKE=PASS");
console.log(`testedCommit=${execution.tested_commit_sha}`);
console.log(`runnerStatus=${execution.status}`);
console.log(`logReference=${execution.log_reference ?? ""}`);
console.log("invalidPresentation=BLOCKED_BEFORE_RUNNER");
