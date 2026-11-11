import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const host=readFileSync(new URL("./native-approved-planner-dag-positive.mjs",
 import.meta.url),"utf8");
const outer=readFileSync(new URL(
 "../../test-runner-controller/scripts/isolated-trusted-security-ci-positive-smoke.mjs",
 import.meta.url),"utf8");
const adk=readFileSync(new URL(
 "../../../packages/agent-runtime/src/adk-a2a-handler.ts",
 import.meta.url),"utf8");

test("R210 signed DAG uses only private in-process crypto MCP and direct Gateway",()=>{
 assert.doesNotMatch(host,/profile:"legacy"|profile:"crypto"/);
 assert.doesNotMatch(host,/createSharedMcpHttpServer|CryptoWorkerRouter|mcpCryptoUrl|mcpSharedUrl/);
 assert.match(host,/cryptoProofCount\?\.\(\)/);
 assert.match(host,/direct_gateway_function_tools_enabled:true/);
 assert.match(host,/approved_shared_mcp_enabled:false/);
 assert.match(host,/shared_mcp_http_requests:0/);
 assert.match(host,/private_crypto_mcp_http_requests:0/);
 assert.match(host,/private_crypto_mcp_local_proofs:privateCryptoMcpCalls/);
 assert.match(outer,/positive\?\.positive_dag\?\.shared_mcp_http_requests,0/);
 assert.match(outer,/positive\?\.positive_dag\?\.approved_crypto_mcp_enabled,true/);
});
test("R244 approved ADK keeps direct FunctionTools and task-local crypto MCP with no HTTP bridge",()=>{
 assert.match(adk,/new GatewayControlledToolClient\(/);
 assert.doesNotMatch(adk,/new TrustedCryptoMcpBridge\(/);
 assert.match(adk,/new LocalCryptoMcpBridge\(/);
 assert.match(adk,/const configured = createAdkSpecializedAgent\(/);
 assert.match(adk,/legacy_crypto_http_mcp_retired/);
 assert.match(adk,/mcpTaskRegistry\?\.begin\(/);
 assert.match(adk,/mcpTaskRegistry/);
 assert.match(host,/privateCryptoMcpCalls>=mandatoryOperations/);
});
