import assert from "node:assert/strict";
import {cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, appendFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root,
  "poc/experiments/adk-mcp-reproducibility-manifest.json"), "utf8"));
const files = [
  ...Object.keys(manifest.dependency_resolution.lockfiles),
  "poc/experiments/reproducibility-manifest.json",
  "poc/experiments/adk-mcp-reproducibility-manifest.json",
  "poc/scripts/phase12b-check-reproducibility.mjs", "poc/package.json",
  "poc/infra/docker-compose.yml", "blockchain/foundry.toml",
  "poc/scripts/init-local-env.mjs", "poc/apps/test-runner-controller/src/config.ts",
  "poc/scripts/phase12a-build-measurement-evidence.mjs",
  ".github/workflows/poc-baseline.yml", ".github/workflows/phase11-security.yml"
];
function fixture(t) {
  // Stay under the checkout so git records the real tested framework revision.
  const dir = mkdtempSync(join(root, ".repro-test-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  for (const path of files) {
    mkdirSync(dirname(join(dir, path)), {recursive: true});
    cpSync(join(root, path), join(dir, path));
  }
  return dir;
}
function run(dir, extra = {}) {
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith("PHASE12_")) delete env[key];
  return spawnSync(process.execPath, ["scripts/phase12b-check-reproducibility.mjs"], {
    cwd: join(dir, "poc"), env: {...env, ...extra}, encoding: "utf8"
  });
}
test("current contract works from npm's poc directory and reports its own scope", t => {
  const result = run(fixture(t));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.contract_scope, "current-adk-a2a-shared-mcp");
  assert.equal(report.measurement_schema, null);
  assert.equal(Object.keys(report.verified_lockfiles).length, 5);
  assert.match(report.framework_commit_sha, /^[0-9a-f]{40}$/u);
});
for (const path of Object.keys(manifest.dependency_resolution.lockfiles)) {
  test(`rejects drift in ${path} without an optional lock environment variable`, t => {
    const dir = fixture(t);
    appendFileSync(join(dir, path), "\n");
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Committed lockfile hash drifted/);
  });
}
test("rejects accidental rewriting of the historical measured manifest", t => {
  const dir = fixture(t);
  appendFileSync(join(dir, "poc/experiments/reproducibility-manifest.json"), "\n");
  const result = run(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Historical measured manifest changed/);
});
test("historical contract cannot certify the current dependency tree", t => {
  const result = run(fixture(t), {
    PHASE12_MANIFEST: "poc/experiments/reproducibility-manifest.json"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Committed PoC lockfile hash drifted/);
});
