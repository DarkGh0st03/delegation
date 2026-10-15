import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

/**
 * The E2E scripts own their own volume-free Gitea instance.
 * Do not start or bootstrap an unused Compose Gitea in the same job.
 * Other local/independent workflows may still use the Compose Gitea.
 */
const isolatedWorkflows = [
  "gemini-paid-shared-mcp-final.yml",
  "shared-mcp-real-positive-e2e.yml",
  "shared-mcp-production-coordinator.yml",
  "disposable-simulated-approval-merge.yml"
];

for (const name of isolatedWorkflows) {
  test(`${name} starts only one disposable Gitea`, async () => {
    const workflow = await readFile(
      new URL(`../../../.github/workflows/${name}`, import.meta.url),
      "utf8"
    );
    assert.match(workflow, /docker compose[^\n]+up -d opa anvil/);
    assert.match(workflow, /docker pull docker\.gitea\.com\/gitea:/);
    assert.match(workflow, /127\.0\.0\.1:8181\/health/);
    assert.match(workflow, /cast chain-id --rpc-url http:\/\/127\.0\.0\.1:8545/);
    assert.doesNotMatch(workflow, /docker compose[^\n]+up -d[^\n]*gitea/);
    assert.doesNotMatch(workflow, /bootstrap-gitea\.sh/);
    assert.doesNotMatch(workflow, /127\.0\.0\.1:3000\/api\/healthz/);
  });
}
