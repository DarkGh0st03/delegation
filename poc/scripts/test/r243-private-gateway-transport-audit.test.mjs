import test from "node:test";
import assert from "node:assert/strict";
import {
 R6_ALLOWED_PRIVATE_GATEWAY_TRANSPORT_CALLERS,
 unexpectedPrivateGatewayTransportCallers
} from "../r6-legacy-references.mjs";

const target="poc/packages/orchestrator-runtime/src/orchestrator-gateway-transport.ts";
const allowed=[
 "poc/packages/orchestrator-runtime/src/orchestrator-gateway-client.ts",
 "poc/packages/orchestrator-runtime/src/trusted-approved-branch-gateway.ts",
 "poc/packages/orchestrator-runtime/test/orchestrator-gateway-client.test.ts"
];

const inventory=(staticImporters,extra={})=>({
 candidates:[{
  target,
  staticImporters,
  runtimeIndirectionHints:extra.runtimeIndirectionHints??[],
  configuredCallers:extra.configuredCallers??[]
 }]
});

test("R243 audit allows only two production trusted ports and exact offline loopback test",()=>{
 assert.deepEqual([...R6_ALLOWED_PRIVATE_GATEWAY_TRANSPORT_CALLERS].sort(),
  [...allowed].sort());
 const trusted=allowed.map(source=>({source,
  specifier:"../src/orchestrator-gateway-transport.ts"}));
 assert.deepEqual(unexpectedPrivateGatewayTransportCallers(inventory(trusted)),[]);
});

test("R243 any ADK/A2A/MCP or other runtime access remains blocked",()=>{
 const bad="poc/packages/agent-runtime/src/adk-specialized-agents.ts";
 const rogue={source:bad,specifier:"../orchestrator-gateway-transport.ts"};
 const edges=unexpectedPrivateGatewayTransportCallers(inventory([rogue]));
 assert.equal(edges.length,1);
 assert.equal(edges[0].source,bad);
 assert.equal(edges[0].edgeType,"static-import-or-reexport");
 const badRuntime=unexpectedPrivateGatewayTransportCallers(inventory([],{
  runtimeIndirectionHints:[{source:bad,kind:"dynamic-import",
   specifier:"../orchestrator-gateway-transport.ts"}]
 }));
 assert.equal(badRuntime.length,1);
 assert.equal(badRuntime[0].source,bad);
 const badConfigured=unexpectedPrivateGatewayTransportCallers(inventory([],{
  configuredCallers:[{source:".github/workflows/unsafe.yml",
   kind:"configured-command"}]
 }));
 assert.equal(badConfigured.length,1);
});
