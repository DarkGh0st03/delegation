import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {requireProductionDirectGatewayTools,requireProductionNativeCrypto} from "../src/mcp-tool-flags.ts";

test("R187 production has no executable legacy MCP repository/Runner flag selector",()=>{
 const source=readFileSync(new URL("../src/mcp-tool-flags.ts",import.meta.url),"utf8");
 assert.doesNotMatch(source,/export (?:function|interface) (?:resolveMcpToolFlags|McpToolFlags)/u);
 assert.doesNotMatch(source,/Only Test Agent can enable MCP/u);
 assert.match(source,/requireProductionDirectGatewayTools/u);
});

test("R187 production disables old repository MCP flags even for a Test Agent",()=>{
 for(const env of [
   {ADK_MCP_SHARED_URL:"http://127.0.0.1:8131/mcp"},
   {ADK_MCP_SHARED_URL:""},
   {ADK_MCP_UPDATE_FILE:"true"},
   {ADK_MCP_CREATE_FILE:"true"},
   {ADK_MCP_RUN_TESTS:"true"}
 ])
  assert.throws(()=>requireProductionDirectGatewayTools(env),
   /production_agent_requires_direct_gateway_tools/);
});

test("R187 invalid legacy flags cannot silently allow repository MCP tools",()=>{
 for(const value of ["1","TRUE","yes","on"," false ","0"]){
  assert.throws(()=>requireProductionDirectGatewayTools({ADK_MCP_RUN_TESTS:value}),
   /must be exactly true or false/);
 }
});

test("R187 crypto-only MCP and direct Gateway have no legacy flag requirement",()=>{
 assert.doesNotThrow(()=>requireProductionDirectGatewayTools({
  ADK_MCP_CRYPTO_URL:"http://127.0.0.1:8097/mcp",
  ADK_MCP_UPDATE_FILE:"false",
  ADK_MCP_CREATE_FILE:"false",
  ADK_MCP_RUN_TESTS:"false"
 }));
 assert.doesNotThrow(()=>requireProductionDirectGatewayTools({}));
});

test("R220 production ADK requires a native Rust signer and task-local MCP",()=>{
 const socket="/tmp/delegation-issuer.sock";
 assert.doesNotThrow(()=>requireProductionNativeCrypto({
  ADAPTER_ENGINEER_NATIVE_SOCKET:socket,APPROVED_RUNNER_NATIVE_MCP:"1"
 },"adk"));
 for(const env of [{},{ADAPTER_ENGINEER_NATIVE_SOCKET:""},
   {ADAPTER_ENGINEER_NATIVE_SOCKET:"relative.sock"},
   {ADAPTER_ENGINEER_NATIVE_SOCKET:" /tmp/issuer.sock "},
   {ADAPTER_ENGINEER_NATIVE_SOCKET:"/"+"x".repeat(101)},
   {ADAPTER_ENGINEER_NATIVE_SOCKET:socket,APPROVED_RUNNER_NATIVE_MCP:"0"}]){
  assert.throws(()=>requireProductionNativeCrypto(env,"adk"),
   /production_adk_requires_native_rust_crypto/u);
 }
 for(const engine of ["adk","deterministic"] as const){
  assert.throws(()=>requireProductionNativeCrypto({
   ADAPTER_ENGINEER_NATIVE_SOCKET:socket,
   ADK_MCP_CRYPTO_URL:"http://127.0.0.1:8097/mcp"
  },engine),/production_adk_requires_task_local_crypto_mcp/u);
  assert.throws(()=>requireProductionNativeCrypto({
   ADK_MCP_CRYPTO_URL:""
  },engine),/production_adk_requires_task_local_crypto_mcp/u);
 }
 assert.doesNotThrow(()=>requireProductionNativeCrypto({},"deterministic"));
});
