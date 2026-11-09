import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

/**
 * R178: the historical single shared Compose-Gitea coordinator was removed.
 * The canonical signed DAG now uses Gitea scoped to each Runner fixture
 * alongside loopback Anvil/OPA. Keep the security/reproducibility assertions,
 * never silently reinstate historical Workflow entrypoints.
 */
for(const name of [
 "functional-signed-dag-e2e.yml",
 "ts2724-signed-d1-targeted.yml"
]){
 test("R178 "+name+" launches disposable Gitea through signed test Runner",async()=>{
  const workflow=await readFile(new URL(
   "../../../.github/workflows/"+name,import.meta.url),"utf8");
  assert.match(workflow,/security-ci:isolated-positive-smoke/u);
  assert.match(workflow,/GITEA_IMAGE: docker\.gitea\.com\/gitea:28\.0\.0/u);
  assert.match(workflow,/APPROVED_RUNNER_NATIVE_EVM: "1"/u);
  assert.match(workflow,/ADAPTER_ENGINEER_NATIVE_SOCKET/u);
  assert.match(workflow,/test -S "\$ADAPTER_ENGINEER_NATIVE_SOCKET"/u);

  assert.match(workflow,/docker compose --env-file poc\/infra\/\.env -f poc\/infra\/docker-compose\.yml up -d anvil opa/u);
  assert.doesNotMatch(workflow,/a2a-production-coordinator-mcp-isolated|a2a-production-coordinator-mcp-gemini-live/u);

 });
}
test("R178 old sequential MCP workflow and scripts stay physically removed",async()=>{
 const {existsSync}=await import("node:fs");
 const {R6_RETIRED_TARGETS}=await import("../r6-legacy-references.mjs");
 const root=new URL("../../../",import.meta.url);
 const removed=[
  ".github/workflows/gemini-paid-shared-mcp-final.yml",
  ".github/workflows/shared-mcp-real-positive-e2e.yml",
  ".github/workflows/shared-mcp-production-coordinator.yml",
  ".github/workflows/disposable-simulated-approval-merge.yml",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-real-positive.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-smoke.mjs"
 ];
 for(const path of removed){
  assert.ok(R6_RETIRED_TARGETS.includes(path),"Retired inventory lost "+path);
  assert.equal(existsSync(new URL(path,root)),false);
 }
});
test("Compose Gitea is a loopback-only service with an explicit data volume",async()=>{
 const compose=await readFile(
  new URL("../../infra/docker-compose.yml",import.meta.url),"utf8");
 assert.match(compose,/container_name: delegation-poc-gitea/u);
 assert.match(compose,/127\.0\.0\.1:\$\{GITEA_HOST_PORT:-3000\}:3000/u);
 assert.match(compose,/gitea-data:\/data/u);
});
