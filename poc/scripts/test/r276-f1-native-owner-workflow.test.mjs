import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R276 F1 zero-billing Gitea planning uses the same direct Rust Engineer owner",()=>{
 const workflow=read(".github/workflows/f1-real-gitea-planning-parity.yml");
 for(const flag of [
   "ENGINEER_CORE_NATIVE_MODE",
   "APPROVED_RUNNER_NATIVE_MCP",
   "APPROVED_RUNNER_NATIVE_EVM"
 ])assert.match(workflow,new RegExp(flag+': "1"'));
 assert.match(workflow,/services\/delegation-engineer-node\/Cargo\.toml/u);
 assert.match(workflow,/libdelegation_engineer_node\.so/u);
 assert.match(workflow,/ADAPTER_ENGINEER_NATIVE_SOCKET=\$RUNNER_TEMP\//u);
 assert.match(workflow,/assert_verification_ready\(\)/u);
 assert.match(workflow,/GATEWAY_VERIFIER_MODE: core-rust/u);
 assert.match(workflow,/test ! -e "\$ADAPTER_ENGINEER_NATIVE_SOCKET"/u);
 assert.match(workflow,/APPROVED_RUNNER_REAL_GITEA_PLANNING_ONLY: "1"/u);
 assert.match(workflow,/DELEGATION_SIGNED_GEMINI_PILOT: "0"/u);
 assert.match(workflow,/GEMINI_API_KEY: ""/u);
 assert.doesNotMatch(workflow,/cargo (?:run|build)\b[^\n]*services\/delegation-adapter\/Cargo\.toml/u);
 assert.doesNotMatch(workflow,/kill "\$\(cat \/tmp\/native-evm-adapter\.pid\)"/u);
 const child=read("poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs");
 assert.match(child,/loadDirectRustEngineerCore\(\)/u);
 assert.match(child,/Direct Engineer signed DAG forbids Adapter HTTP requests/u);
 const parent=read("poc/apps/test-runner-controller/scripts/isolated-trusted-security-ci-positive-smoke.mjs");
 assert.match(parent,/PLANNING_REAL_GITEA_ONLY:"1"/u);
 assert.match(parent,/APPROVED_RUNNER_NATIVE_MCP:"1"/u);
});
