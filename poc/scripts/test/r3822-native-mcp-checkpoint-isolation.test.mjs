/** R382.2 — prevent regression of the offline/native test boundary. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const workflow=readFileSync(resolve(
 dirname(fileURLToPath(import.meta.url)),
 "../../../.github/workflows/r3818-canonical-private-native-mcp-e2e.yml"
),"utf8");
function section(start,end){
 const begin=workflow.indexOf(start);
 const finish=workflow.indexOf(end,begin+start.length);
 assert.ok(begin>=0&&finish>begin,"required original workflow phases");
 return workflow.slice(begin,finish);
}

test("R382.2 simulated Review Host preflight cannot claim to have a native signer",()=>{
 assert.match(workflow,/APPROVED_RUNNER_NATIVE_MCP: "1"/u);
 const offline=section(
  "- name: R3818 free native MCP Task and Review Host preflight",
  "- name: Boot only disposable Anvil and OPA"
 );
 assert.ok(offline.includes(
  "env -u ADAPTER_ENGINEER_NATIVE_SOCKET APPROVED_RUNNER_NATIVE_MCP=0"
 ));
 assert.ok(offline.includes("R3818_CANONICAL_NATIVE_MCP=0"));
 // The offline fixture filters BOTH the original MCP binding tests and
 // the later canonical-only launcher denial. This remains one mocked
 // subprocess, never the native full-stack signer.
 assert.ok(offline.includes(
  'node --experimental-strip-types --test --test-name-pattern="R381.7|R382.4"'
 ));
 assert.ok(offline.includes("owner-private-native-crypto-stdio.test.ts"));
 assert.ok(offline.includes("native-crypto-ipc.test.ts"));
});

test("R382.2 actual full-stack E2E cannot inherit mocked Review Host signing",()=>{
 const live=section(
  "- name: R3818 canonical Review Host native private MCP Child/VP",
  "- name: Validate native Gateway root read"
 );
 // A process-local env statement in the earlier shell step cannot
 // mutate the job's selected native signer or actual Rust socket config.
 assert.ok(live.includes("DELEGATION_GATEWAY_ARCHITECTURE: authority-only"));
 assert.ok(live.includes('test "$R3818_CANONICAL_NATIVE_MCP" = "1"'));
 assert.ok(live.includes('test "${APPROVED_RUNNER_NATIVE_MCP:-}" = "1"'));
 assert.ok(live.includes('test -z "${GEMINI_API_KEY:-}"'));
 assert.ok(live.includes('test -z "${OPENAI_API_KEY:-}"'));
 assert.ok(live.includes("set -euo pipefail"));
 assert.ok(live.includes(
  "node poc/scripts/verify-r3818-native-mcp-proof.mjs"
 ));
});
