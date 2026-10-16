import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const launcher=fileURLToPath(new URL("../../../blockchain/scripts/run-pre-gateway-local.sh",import.meta.url));
const checker=fileURLToPath(new URL("../../../blockchain/scripts/check-pre-gateway.sh",import.meta.url));

test("AUD-017/018: local blockchain scripts are valid Bash",()=>{
  for(const path of [launcher,checker]){
    const result=spawnSync("bash",["-n",path],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
  }
});

test("AUD-017: only local RPC endpoints are accepted before touching Anvil",()=>{
  const result=spawnSync("bash",[launcher],{
    encoding:"utf8",timeout:5000,
    env:{...process.env,RPC_URL:"https://untrusted.example:8545"}
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/RPC_URL must be/);
});

test("AUD-017: both launch paths pass parsed host and port and preserve governance account",async()=>{
  const source=await readFile(launcher,"utf8");
  assert.equal(source.split('--host "$ANVIL_HOST" --port "$ANVIL_PORT"').length-1,2);
  assert.ok(source.indexOf('export GOVERNANCE_ADDRESS="$governance_from_key"') <
    source.indexOf('deploy_output="$(bash "$DEPLOY_SCRIPT"'));
  assert.match(source,/GOVERNANCE_ADDRESS does not match GOVERNANCE_PRIVATE_KEY/);
});

test("AUD-018: DID prereqs are installed from lock, not inferred from node_modules",async()=>{
  const source=await readFile(checker,"utf8");
  assert.match(source,/npm ci --no-audit --no-fund/);
  assert.doesNotMatch(source,/npm install\b/);
  assert.doesNotMatch(source,/\[\[ ! -d blockchain\/did-client\/node_modules/);
});
