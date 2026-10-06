import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [gatewayLogPath, experimentResultPath, outputPath] = process.argv.slice(2);
for (const [name, value] of Object.entries({
  gatewayLogPath,
  experimentResultPath,
  outputPath
})) {
  if (!value) {
    throw new Error(
      "Usage: node phase12a-build-measurement-evidence.mjs <gateway-log> <experiment-result> <output>"
    );
  }
}

function parseJsonLines(raw) {
  const events = [];
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed.event === "authorization_prepared" ||
          parsed.event === "authorization_executed")
      ) {
        events.push(parsed);
      }
    } catch {
      // Service startup output is intentionally ignored.
    }
  }
  return events;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function nearestRank(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1)
  );
  return rounded(sorted[index]);
}

function summarize(values, unit) {
  const numeric = values.filter(finite);
  if (numeric.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p95: null,
      unit
    };
  }
  const total = numeric.reduce((sum, value) => sum + value, 0);
  return {
    count: numeric.length,
    min: rounded(Math.min(...numeric)),
    max: rounded(Math.max(...numeric)),
    mean: rounded(total / numeric.length),
    p50: nearestRank(numeric, 0.5),
    p95: nearestRank(numeric, 0.95),
    unit
  };
}

function countsBy(values, key) {
  const result = {};
  for (const value of values) {
    const label = String(value[key] ?? "unknown");
    result[label] = (result[label] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right))
  );
}

function optional(value) {
  return value === undefined ? null : value;
}

const gatewayRaw = await readFile(gatewayLogPath, "utf8");
const experiment = JSON.parse(await readFile(experimentResultPath, "utf8"));
assert.equal(experiment.result, "phase10b-positive-e2e-pass");
assert.equal(experiment.project_tests, "pass");
assert.equal(experiment.researcher_acceptance, "pass");
assert.match(experiment.tested_commit_sha, /^[0-9a-f]{40}$/u);

const events = parseJsonLines(gatewayRaw);
const prepared = events.filter((event) => event.event === "authorization_prepared");
const executed = events.filter((event) => event.event === "authorization_executed");
assert.ok(prepared.length > 0, "Gateway log contains no authorization_prepared events");
assert.ok(executed.length > 0, "Gateway log contains no authorization_executed events");

const preparedByRequest = new Map(
  prepared.map((event) => [event.request_id, event])
);

const executions = executed.map((event) => {
  const prepare = preparedByRequest.get(event.request_id);
  return {
    request_id: event.request_id,
    agent_role: event.agent_role,
    tool: event.tool,
    operation: event.operation,
    resource_uri: event.resource_uri,
    decision: event.decision,
    reason: event.reason,
    provider: event.provider,
    provider_result: event.provider_result,
    prepare_ms: finite(prepare?.prepare_ms) ? prepare.prepare_ms : null,
    verification_ms: event.verification_ms,
    opa_ms: event.opa_ms,
    provider_ms: event.provider_ms,
    total_ms: event.total_ms,
    vp_size_bytes: event.vp_size_bytes,
    chain_depth: optional(event.chain_depth),
    disclosed_permission_count: optional(event.disclosed_permission_count),
    provider_revision: optional(event.provider_revision),
    provider_commit_sha: optional(event.provider_commit_sha),
    runner_tested_commit_sha: optional(event.runner_tested_commit_sha),
    runner_profile: optional(event.runner_profile),
    runner_status: optional(event.runner_status),
    runner_project_tests_status: optional(event.runner_project_tests_status),
    runner_researcher_acceptance_status: optional(
      event.runner_researcher_acceptance_status
    )
  };
});

const runnerExecution = executions.find(
  (event) => event.provider === "runner" && event.tool === "run_tests"
);
assert.ok(runnerExecution, "Measurement evidence is missing the Runner execution");
assert.equal(runnerExecution.runner_status, "pass");
assert.equal(runnerExecution.runner_project_tests_status, "pass");
assert.equal(runnerExecution.runner_researcher_acceptance_status, "pass");
assert.equal(
  runnerExecution.runner_tested_commit_sha,
  experiment.tested_commit_sha
);

const evidence = {
  schema_version: "phase12a-measurement-evidence/v1",
  experiment: "phase10b-positive-e2e",
  run: {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    commit_sha: process.env.GITHUB_SHA ?? null,
    workflow_run_id: process.env.GITHUB_RUN_ID ?? null,
    workflow_run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null
  },
  outcome: {
    trust_profile: experiment.trust_profile,
    workflow_state: experiment.workflow_state,
    completed_roles: experiment.completed_roles,
    baseline_revision: experiment.baseline_revision,
    backend_revision: experiment.backend_revision,
    frontend_revision: experiment.frontend_revision,
    tested_commit_sha: experiment.tested_commit_sha,
    project_tests: experiment.project_tests,
    researcher_acceptance: experiment.researcher_acceptance,
    pull_request_number: experiment.pull_request_number,
    main_unchanged: experiment.main_unchanged,
    automatic_merge: experiment.automatic_merge,
    model_ids: experiment.model_ids
  },
  gateway: {
    prepared_count: prepared.length,
    executed_count: executed.length,
    decision_counts: countsBy(executions, "decision"),
    provider_counts: countsBy(executions, "provider"),
    operation_counts: countsBy(executions, "operation"),
    metrics: {
      prepare_ms: summarize(
        executions.map((event) => event.prepare_ms),
        "ms"
      ),
      verification_ms: summarize(
        executions.map((event) => event.verification_ms),
        "ms"
      ),
      opa_ms: summarize(
        executions.map((event) => event.opa_ms),
        "ms"
      ),
      provider_ms: summarize(
        executions.map((event) => event.provider_ms),
        "ms"
      ),
      total_ms: summarize(
        executions.map((event) => event.total_ms),
        "ms"
      ),
      vp_size_bytes: summarize(
        executions.map((event) => event.vp_size_bytes),
        "bytes"
      ),
      chain_depth: summarize(
        executions.map((event) => event.chain_depth),
        "levels"
      ),
      disclosed_permission_count: summarize(
        executions.map((event) => event.disclosed_permission_count),
        "permissions"
      )
    }
  },
  executions
};

const serialized = JSON.stringify(evidence, null, 2) + "\n";
for (const forbidden of [
  "signed_vp",
  "bearer ",
  "private_key",
  "authorization:"
]) {
  assert.equal(
    serialized.toLowerCase().includes(forbidden),
    false,
    "Evidence bundle contains forbidden sensitive material marker: " + forbidden
  );
}

await writeFile(outputPath, serialized, {
  encoding: "utf8",
  mode: 0o600
});

process.stdout.write(serialized);
