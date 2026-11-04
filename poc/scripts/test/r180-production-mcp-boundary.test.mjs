
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R180 production MCP entrypoint can no longer select repository routing",()=>{
 const launcher=read("poc/mcp-shared/src/main.ts");
 const profile=read("poc/mcp-shared/src/profile.ts");
 assert.match(launcher,/requireProductionCryptoMcpProfile\(process\.env\.MCP_TOOL_PROFILE\)/u);
 assert.match(profile,/if\(selected!=="crypto"\)throw Error\("production_mcp_crypto_only"\)/u);
 assert.doesNotMatch(launcher,/selectMcpToolProfile\(process\.env\.MCP_TOOL_PROFILE\)/u);
});
test("R180 production A2A cannot register model-facing repository MCP tools",()=>{
 const app=read("poc/apps/a2a-agent/src/main.ts");
 const flags=read("poc/apps/a2a-agent/src/mcp-tool-flags.ts");
 assert.match(app,/requireProductionDirectGatewayTools\(process\.env\)/u);
 assert.match(flags,/env\.ADK_MCP_SHARED_URL!==undefined/u);
 assert.doesNotMatch(app,/mcpSharedUrl\s*:/u);
 assert.doesNotMatch(app,/mcpReadFile\s*:/u);
 assert.match(app,/mcpCryptoUrl\s*:/u);
});
test("R180 cryptographic MCP worker remains reachable, not deleted as legacy",()=>{
 const main=read("poc/mcp-shared/src/main.ts");
 const listener=read("poc/mcp-shared/src/http-server.ts");
 const worker=read("poc/packages/agent-runtime/src/private-mcp-worker-http.ts");
 const bridge=read("poc/packages/agent-runtime/src/trusted-crypto-mcp-bridge.ts");
 assert.match(main,/new TaskRouter\(workers\)/u);
 assert.match(listener,/router\.createPresentation\(claims,token,args\)/u);
 assert.match(worker,/\/internal\/mcp-crypto-call/u);
 assert.match(bridge,/stageGatewayChallenge\(this\.#taskId,prepared\)/u);
 assert.match(bridge,/takeSignedPresentation/u);
});
