import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R235 standalone real signed DAG preserves one direct Rust owner and no HTTP Adapter",()=>{
 const file=read(".github/workflows/engineer-embedded-signed-dag-e2e.yml");
 assert.match(file,/ENGINEER_CORE_NATIVE_MODE: "1"/u);
 assert.match(file,/APPROVED_RUNNER_NATIVE_MCP: "1"/u);
 assert.match(file,/APPROVED_RUNNER_NATIVE_EVM: "1"/u);
 assert.match(file,/GATEWAY_VERIFIER_MODE: core-rust/u);
 assert.match(file,/APPROVED_RUNNER_THREE_AGENT_DAG: "1"/u);
 assert.match(file,/GITEA_IMAGE: docker\.gitea\.com\/gitea:28\.0\.0/u);
 assert.match(file,/TEST_RUNNER_DOCKER_IMAGE: node:22\.15\.0-bookworm/u);
 assert.match(file,/direct-engineer-owner-pass-selector\.test\.mjs/u);
 assert.match(file,/services\/delegation-engineer-node\/Cargo\.toml/u);
 assert.match(file,/libdelegation_core_node\.so/u);
 assert.match(file,/same_signed_dag_docker_acceptance/u);
 assert.match(file,/signed_dag_pr_unmerged/u);
 assert.match(file,/'.github\/ci-checkpoints\/engineer-full-dag-request\.json'/u);
 assert.doesNotMatch(file,/cargo run[^\n]*services\/delegation-adapter\/Cargo\.toml/u);
 assert.doesNotMatch(file,/Start Adapter with public-only|\/tmp\/native-evm-adapter\.log/u);
 assert.doesNotMatch(file,/GEMINI_API_KEY:\s*\$\{\{\s*secrets\./u);
 assert.match(file,/test -z "\$\{GEMINI_API_KEY:-\}"/u);
 assert.doesNotMatch(file,/\n      - name: Verify real HTTP A2A preserves signed Test no-Runner metadata\n      - name:/u);
});

test("R235 existing historical signed DAG remains separate and explicitly old Adapter-backed",()=>{
 const old=read(".github/workflows/functional-signed-dag-e2e.yml");
 assert.match(old,/cargo run --manifest-path services\/delegation-adapter\/Cargo\.toml/u);
 const current=read("poc/apps/test-runner-controller/scripts/isolated-trusted-security-ci-positive-smoke.mjs");
 assert.match(current,/selectNativeOwnerPasses\(process\.env\)/u);
 assert.match(current,/if\(ownerPasses\.preliminaryReadOnlyProcess\)/u);
 const planning=read("poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs");
 const agents=read("poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs");
 assert.match(planning,/Direct Engineer signed DAG forbids Adapter HTTP requests/u);
 assert.match(agents,/Canonical signed A2A cannot contact retired Adapter HTTP/u);
});
