import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const [inputRoot, summaryPath, csvPath] = process.argv.slice(2);
if (!inputRoot || !summaryPath || !csvPath) {
  throw new Error(
    "Usage: node phase12c-aggregate-measurements.mjs <input-root> <summary-json> <executions-csv>"
  );
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function percentile(values, p) {
  const numeric = values.filter(finite).sort((a, b) => a - b);
  if (numeric.length === 0) return null;
  const index = Math.max(
    0,
    Math.min(numeric.length - 1, Math.ceil(p * numeric.length) - 1)
  );
  return round(numeric[index]);
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
      stdev_population: null,
      unit
    };
  }
  const mean = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const variance =
    numeric.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    numeric.length;
  return {
    count: numeric.length,
    min: round(Math.min(...numeric)),
    max: round(Math.max(...numeric)),
    mean: round(mean),
    p50: percentile(numeric, 0.5),
    p95: percentile(numeric, 0.95),
    stdev_population: round(Math.sqrt(variance)),
    unit
  };
}

function metrics(rows) {
  return {
    prepare_ms: summarize(rows.map((row) => row.prepare_ms), "ms"),
    verification_ms: summarize(rows.map((row) => row.verification_ms), "ms"),
    opa_ms: summarize(rows.map((row) => row.opa_ms), "ms"),
    provider_ms: summarize(rows.map((row) => row.provider_ms), "ms"),
    total_ms: summarize(rows.map((row) => row.total_ms), "ms"),
    vp_size_bytes: summarize(rows.map((row) => row.vp_size_bytes), "bytes")
  };
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, { count: values.length, metrics: metrics(values) }])
  );
}

function csv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

const files = (await walk(inputRoot)).filter((path) =>
  path.endsWith("phase12a-measurement-evidence.json")
);
assert.equal(files.length, 5, "Expected exactly five measurement evidence files");

const replicas = [];
const rows = [];
for (const file of files.sort()) {
  const evidence = JSON.parse(await readFile(file, "utf8"));
  assert.equal(evidence.schema_version, "phase12a-measurement-evidence/v1");
  assert.equal(evidence.outcome.project_tests, "pass");
  assert.equal(evidence.outcome.researcher_acceptance, "pass");
  assert.equal(evidence.outcome.main_unchanged, true);
  assert.equal(evidence.outcome.automatic_merge, false);
  assert.equal(evidence.gateway.executed_count, 28);
  const replica = relative(inputRoot, file).split(/[\\/]/u)[0];
  replicas.push({
    replica,
    run: evidence.run,
    tested_commit_sha: evidence.outcome.tested_commit_sha,
    execution_count: evidence.gateway.executed_count
  });
  for (const execution of evidence.executions) {
    rows.push({
      replica,
      ...execution
    });
  }
}

assert.equal(rows.length, 140, "Five replicas must yield 140 executed authorizations");

const giteaRows = rows.filter((row) => row.provider === "gitea");
const runnerRows = rows.filter((row) => row.provider === "runner");
assert.equal(giteaRows.length, 135);
assert.equal(runnerRows.length, 5);

const summary = {
  schema_version: "phase12c-measurement-campaign/v1",
  campaign: {
    replica_count: replicas.length,
    authorization_count: rows.length,
    gitea_authorization_count: giteaRows.length,
    runner_authorization_count: runnerRows.length,
    expected_operations_per_replica: 28
  },
  replicas,
  all_authorizations: metrics(rows),
  gitea_only: metrics(giteaRows),
  runner_only: metrics(runnerRows),
  by_provider: groupBy(rows, (row) => row.provider),
  by_operation: groupBy(rows, (row) => row.operation),
  by_role: groupBy(rows, (row) => row.agent_role)
};

await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n");

const columns = [
  "replica",
  "request_id",
  "agent_role",
  "tool",
  "operation",
  "provider",
  "decision",
  "prepare_ms",
  "verification_ms",
  "opa_ms",
  "provider_ms",
  "total_ms",
  "vp_size_bytes",
  "chain_depth",
  "disclosed_permission_count",
  "runner_tested_commit_sha"
];
const csvLines = [
  columns.map(csv).join(","),
  ...rows.map((row) => columns.map((column) => csv(row[column])).join(","))
];
await writeFile(csvPath, csvLines.join("\n") + "\n");

process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
