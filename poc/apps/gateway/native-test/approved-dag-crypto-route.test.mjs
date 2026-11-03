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

test("R156 signed DAG starts crypto MCP only and passes no repo MCP endpoint to ADK",()=>{
 assert.match(host,/profile:"crypto"/);
 assert.doesNotMatch(host,/profile:"legacy"/);
 assert.doesNotMatch(host,/mcpSharedUrl/);
 assert.match(host,/\.\.\.\(cryptoMcpEnabled\?\{mcpCryptoUrl\}:\{\}\)/);
 assert.match(host,/direct_gateway_function_tools_enabled:true/);
 assert.match(host,/approved_shared_mcp_enabled:false/);
 assert.match(host,/shared_mcp_http_requests:0/);
 assert.match(outer,/positive\?\.positive_dag\?\.shared_mcp_http_requests,0/);
 assert.match(outer,/positive\?\.positive_dag\?\.approved_crypto_mcp_enabled,true/);
});
test("R156 protected ADK keeps direct FunctionTools and private task-bound crypto bridge",()=>{
 assert.match(adk,/new GatewayControlledToolClient\(/);
 assert.match(adk,/new TrustedCryptoMcpBridge\(/);
 assert.match(adk,/const configured = createAdkSpecializedAgent\(/);
 assert.match(adk,/mcpCryptoUrl/);
 assert.match(adk,/mcpTaskRegistry/);
 assert.match(host,/privateCryptoMcpCalls>=mandatoryOperations/);
});
