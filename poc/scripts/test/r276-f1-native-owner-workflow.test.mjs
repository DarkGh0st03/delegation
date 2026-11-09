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

test("R278 F1 issuer pins DID publisher and resolver to absolute checked-out paths",()=>{
 const workflow=read(".github/workflows/f1-real-gitea-planning-parity.yml");
 const canonical=read(".github/workflows/engineer-embedded-signed-dag-e2e.yml");
 for(const [key,file] of [
  ["ADAPTER_DID_PUBLISHER_SCRIPT","publish-ed25519.mjs"],
  ["ADAPTER_DID_RESOLVER_SCRIPT","resolve-did-json.mjs"]
 ]){
   const value=key+': ${{ github.workspace }}/blockchain/did-client/'+file;
   assert.ok(workflow.includes(value),"F1 must set absolute "+key);
   assert.ok(canonical.includes(value),"F1 must match canonical DAG "+key);
   assert.ok(workflow.includes('test -f "$'+key+'"'));
   assert.ok(workflow.includes('case "$'+key+'" in /*) ;; *) exit 1 ;; esac'));
 }
 const runner=read("poc/apps/test-runner-controller/scripts/isolated-trusted-security-ci-positive-smoke.mjs");
 assert.match(runner,/cwd:process.cwd\(\),encoding:"utf8"/u);
 const config=read("services/delegation-adapter/src/config.rs");
 assert.match(config,/did_publisher_script: env::var\("ADAPTER_DID_PUBLISHER_SCRIPT"\)/u);
 assert.match(config,/did_resolver_script: env::var\("ADAPTER_DID_RESOLVER_SCRIPT"\)/u);
 const issuer=read("services/delegation-adapter/src/evm_profile.rs");
 assert.match(issuer,/\.arg\(&config.did_publisher_script\)/u);
});

test("R442 F1 live native Gitea planning is manual-only after old checkpoint retirement",()=>{
 const workflow=read(".github/workflows/f1-real-gitea-planning-parity.yml");
 const events=/^on:\s*\n([\s\S]*?)^permissions:/mu.exec(workflow)?.[1];
 assert.ok(events,"F1 event block must exist");
 const names=[...events.matchAll(/^  ([a-z_]+):/gmu)].map(match=>match[1]);
 assert.deepEqual(names,["workflow_dispatch"],
  "F1 Rust/EVM/Gitea/Docker parity must not start on push/PR or a stale request");
 assert.doesNotMatch(workflow,/r3803-native-planning-read-request\.json/u);
 assert.match(workflow,/GEMINI_API_KEY: ""/u);
 assert.match(workflow,/DELEGATION_SIGNED_GEMINI_PILOT: "0"/u);
 assert.match(workflow,/APPROVED_RUNNER_REAL_GITEA_PLANNING_ONLY: "1"/u);
 assert.match(workflow,/^jobs:\s*$/mu,"preserve real native planning job");
});
