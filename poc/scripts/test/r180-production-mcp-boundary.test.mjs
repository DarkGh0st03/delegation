
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R229 obsolete Shared MCP executable is physically deleted",()=>{
 assert.equal(existsSync(new URL("poc/mcp-shared/src/main.ts",root)),false);
 const packageJson=JSON.parse(read("poc/mcp-shared/package.json"));
 assert.equal(Object.hasOwn(packageJson.scripts,"start"),false);
});
test("R180 production A2A cannot register model-facing repository MCP tools",()=>{
 const app=read("poc/apps/a2a-agent/src/main.ts");
 const flags=read("poc/apps/a2a-agent/src/mcp-tool-flags.ts");
 assert.match(app,/requireProductionDirectGatewayTools\(process\.env\)/u);
 assert.match(flags,/env\.ADK_MCP_SHARED_URL!==undefined/u);
 assert.doesNotMatch(flags,/export function resolveMcpToolFlags\(/u);
 assert.doesNotMatch(app,/mcpSharedUrl\s*:/u);
 assert.doesNotMatch(app,/mcpReadFile\s*:/u);
 assert.doesNotMatch(app,/mcpCryptoUrl\s*:/u);
 assert.match(app,/requireProductionNativeCrypto\(process\.env,engine\)/u);
 assert.match(app,/process\.env\.APPROVED_RUNNER_NATIVE_MCP="1"/u);
 assert.match(flags,/production_adk_requires_native_rust_crypto/u);
 assert.match(flags,/production_adk_requires_task_local_crypto_mcp/u);
});
test("R221 isolated legacy crypto HTTP compatibility modules remain testable but not deployable",()=>{
 assert.equal(existsSync(new URL("poc/mcp-shared/src/main.ts",root)),false);
 const listener=read("poc/mcp-shared/src/http-server.ts");
 const worker=read("poc/packages/agent-runtime/src/private-mcp-worker-http.ts");
 const bridge=read("poc/packages/agent-runtime/src/trusted-crypto-mcp-bridge.ts");

 assert.doesNotMatch(listener,/^import \{registerLegacyRepositoryTools\}/mu);
 assert.match(listener,/router\.createPresentation\(claims,token,args\)/u);
 assert.match(worker,/\/internal\/mcp-crypto-call/u);
 assert.doesNotMatch(worker,/\/internal\/mcp-tool-call/u);
 assert.doesNotMatch(worker,/registry\.invoke\(/u);
 const registry=read("poc/packages/agent-runtime/src/private-mcp-task-registry.ts");
 assert.doesNotMatch(registry,/async invoke\(/u);
 assert.match(registry,/async invokeCrypto\(/u);
 assert.match(bridge,/stageGatewayChallenge\(this\.#taskId,prepared\)/u);
 assert.match(bridge,/takeSignedPresentation/u);
});

test("R222 canonical A2A library excludes every Shared MCP and HTTP worker route",()=>{
 const server=read("poc/packages/agent-runtime/src/server.ts");
 const handler=read("poc/packages/agent-runtime/src/adk-a2a-handler.ts");
 assert.match(server,/legacy_repository_mcp_retired/u);
 assert.match(server,/Object\.prototype\.hasOwnProperty\.call\(options\.adk,key\)/u);
 assert.match(server,/legacy_crypto_http_mcp_retired/u);
 assert.doesNotMatch(server,/attachPrivateMcpWorker\(/u);
 assert.doesNotMatch(server,/import \{ attachPrivateMcpWorker \}/u);
 assert.match(handler,/new LocalCryptoMcpBridge\(/u);
 assert.match(handler,/legacy_crypto_http_mcp_retired/u);
 assert.doesNotMatch(handler,/new TrustedCryptoMcpBridge\(/u);
});

test("R196 orphaned repository MCP transports and normalizers remain absent",()=>{
 const names=["poc/packages/agent-runtime/src/mcp-create-result.ts","poc/packages/agent-runtime/test/mcp-create-result.test.ts","poc/packages/agent-runtime/src/mcp-read-result.ts","poc/packages/agent-runtime/test/mcp-read-result.test.ts","poc/packages/agent-runtime/src/mcp-run-tests-result.ts","poc/packages/agent-runtime/test/mcp-run-tests-result.test.ts","poc/packages/agent-runtime/src/mcp-write-result.ts","poc/packages/agent-runtime/test/mcp-write-result.test.ts","poc/packages/agent-runtime/src/mcp-task-fetch.ts","poc/packages/agent-runtime/test/mcp-task-fetch.test.ts","poc/packages/agent-runtime/src/timed-mcp-run-tests.ts","poc/packages/agent-runtime/test/timed-mcp-run-tests.test.ts"];
 for(const path of names)
  assert.equal(existsSync(new URL(path,root)),false,"Unexpected retired MCP module "+path);
});
