import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

const workflows=[
  "gemini-paid-shared-mcp-final.yml",
  "shared-mcp-real-positive-e2e.yml",
  "shared-mcp-production-coordinator.yml",
  "disposable-simulated-approval-merge.yml"
];
const scripts=[
  "a2a-production-coordinator-mcp-gemini-live.mjs",
  "a2a-production-coordinator-mcp-isolated-real-positive.mjs",
  "a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs",
  "a2a-production-coordinator-mcp-isolated-smoke.mjs"
];

for(const name of workflows){
  test(name+" uses a single fresh Compose-managed Gitea",async()=>{
    const workflow=await readFile(
      new URL("../../../.github/workflows/"+name,import.meta.url),"utf8");
    assert.match(workflow,/bash poc\/scripts\/ci-compose-lifecycle\.sh start/);
    assert.match(workflow,/GITEA_E2E_COMPOSE_READY: "1"/);
    assert.match(workflow,/127\.0\.0\.1:3000\/api\/healthz/);
    assert.match(workflow,/127\.0\.0\.1:8181\/health/);
    assert.match(workflow,/cast chain-id --rpc-url http:\/\/127\.0\.0\.1:8545/);
    assert.match(workflow,/bash poc\/scripts\/ci-compose-lifecycle\.sh cleanup/);
    assert.doesNotMatch(workflow,/docker pull docker\.gitea\.com\/gitea:/);
    assert.doesNotMatch(workflow,/bootstrap-gitea\.sh/);
  });
}

for(const name of scripts){
  test(name+" initializes, but never starts, a Gitea container",async()=>{
    const script=await readFile(new URL(
      "../../packages/agent-runtime/scripts/"+name,import.meta.url),"utf8");
    assert.match(script,/assertPreparedComposeGitea\(\)/);
    assert.match(script,/await waitGitea\(giteaUrl\)/);
    assert.match(script,/bootstrapGitea\(giteaUrl\)/);
    assert.doesNotMatch(script,/docker\(\["run"/);
    assert.doesNotMatch(script,/docker\(\["port"/);
    assert.doesNotMatch(script,/stopDocker\(\)/);
  });
}

test("Compose Gitea is a loopback-only service with an explicit data volume",async()=>{
  const compose=await readFile(
    new URL("../../infra/docker-compose.yml",import.meta.url),"utf8");
  assert.match(compose,/container_name: delegation-poc-gitea/);
  assert.match(compose,/127\.0\.0\.1:\$\{GITEA_HOST_PORT:-3000\}:3000/);
  assert.match(compose,/gitea-data:\/data/);
});
