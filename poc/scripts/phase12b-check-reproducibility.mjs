import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const manifestPath =
  process.env.PHASE12_MANIFEST ?? "poc/experiments/reproducibility-manifest.json";
const reportPath = process.env.PHASE12_REPORT_FILE;

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(
  manifest.schema_version,
  "phase12b-reproducibility-manifest/v1"
);

const packageJson = JSON.parse(await readFile("poc/package.json", "utf8"));
assert.equal(packageJson.engines.node, manifest.runtime.node);
assert.equal(packageJson.engines.npm, manifest.runtime.npm);
assert.equal(packageJson.packageManager, "npm@" + manifest.runtime.npm);
assert.equal(
  packageJson.dependencies["@a2a-js/sdk"],
  manifest.runtime.a2a_sdk
);

const compose = await readFile("poc/infra/docker-compose.yml", "utf8");
for (const image of [
  manifest.infrastructure.gitea_image,
  manifest.infrastructure.opa_image,
  manifest.infrastructure.foundry_image
]) {
  assert.ok(
    compose.includes(image),
    "Docker Compose no longer contains pinned image " + image
  );
}

const foundry = await readFile("blockchain/foundry.toml", "utf8");
assert.ok(
  foundry.includes('solc_version = "' + manifest.runtime.solidity + '"'),
  "Solidity compiler version drifted"
);

const localEnv = await readFile("poc/scripts/init-local-env.mjs", "utf8");
assert.ok(
  localEnv.includes(
    "GITEA_BASELINE_SHA=" + manifest.protected_application.baseline_sha
  ),
  "Protected application baseline SHA drifted"
);
assert.ok(
  localEnv.includes(
    "GITEA_SOURCE_REPO=https://github.com/" +
      manifest.protected_application.repository +
      ".git"
  ),
  "Protected application source repository drifted"
);

const runnerConfig = await readFile(
  "poc/apps/test-runner-controller/src/config.ts",
  "utf8"
);
assert.ok(
  runnerConfig.includes(
    'process.env.TEST_RUNNER_DOCKER_IMAGE ?? "' +
      manifest.infrastructure.runner_image +
      '"'
  ),
  "Controlled Runner image drifted"
);

const measurementBuilder = await readFile(
  "poc/scripts/phase12a-build-measurement-evidence.mjs",
  "utf8"
);
assert.ok(
  measurementBuilder.includes(
    '"phase12a-measurement-evidence/v1"'
  ),
  "Measurement evidence schema drifted"
);

for (const workflowPath of [
  ".github/workflows/poc-baseline.yml",
  ".github/workflows/phase11-security.yml"
]) {
  const workflow = await readFile(workflowPath, "utf8");
  assert.equal(
    workflow.includes("dtolnay/rust-toolchain@stable"),
    false,
    workflowPath + " still uses moving Rust stable"
  );
  assert.ok(
    workflow.includes(
      "dtolnay/rust-toolchain@" + manifest.runtime.rust
    ),
    workflowPath + " does not pin the validated Rust version"
  );
}
const baselineWorkflow = await readFile(
  ".github/workflows/poc-baseline.yml",
  "utf8"
);
assert.ok(
  baselineWorkflow.includes("workflow_dispatch:"),
  "Baseline validation must support explicit reproducibility reruns"
);

function command(name, args = ["--version"]) {
  return execFileSync(name, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

const observed = {};
if (process.env.PHASE12_VERIFY_RUNTIME === "1") {
  observed.node = process.version.replace(/^v/u, "");
  observed.npm = command("npm");
  observed.rust = command("rustc").match(/^rustc\s+([^\s]+)/u)?.[1] ?? "";
  observed.foundry = command("forge");

  assert.equal(observed.node, manifest.runtime.node);
  assert.equal(observed.npm, manifest.runtime.npm);
  assert.equal(observed.rust, manifest.runtime.rust);
  assert.ok(
    observed.foundry.includes(manifest.runtime.foundry.replace(/^v/u, "")),
    "Foundry version drifted: " + observed.foundry
  );
}

let resolvedLock = null;
const lockPath = process.env.PHASE12_RESOLVED_LOCK;
if (lockPath) {
  const raw = await readFile(lockPath);
  const lock = JSON.parse(raw.toString("utf8"));
  assert.ok(
    Number.isSafeInteger(lock.lockfileVersion) && lock.lockfileVersion >= 3,
    "Resolved PoC lockfile must use npm lockfileVersion >= 3"
  );
  resolvedLock = {
    path: lockPath,
    lockfile_version: lock.lockfileVersion,
    sha256: createHash("sha256").update(raw).digest("hex")
  };
}

const report = {
  schema_version: "phase12b-reproducibility-report/v1",
  manifest: manifestPath,
  manifest_contract_valid: true,
  runtime_verified: process.env.PHASE12_VERIFY_RUNTIME === "1",
  observed_runtime: observed,
  resolved_poc_lock: resolvedLock,
  protected_application_baseline:
    manifest.protected_application.baseline_sha,
  measurement_schema: manifest.validated_evidence.measurement_schema
};

if (reportPath) {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
}

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
