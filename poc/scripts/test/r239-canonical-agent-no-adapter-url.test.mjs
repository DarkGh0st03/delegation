import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R239 canonical ADK A2A production launcher uses native Core without Adapter HTTP address",()=>{
 const launcher=read("poc/apps/a2a-agent/src/main.ts");
 assert.match(launcher,/requireProductionNativeCrypto\(process\.env,engine\)/u);
 assert.match(launcher,/APPROVED_RUNNER_NATIVE_MCP="1"/u);
 assert.match(launcher,/mcpTaskSigning/u);
 assert.doesNotMatch(launcher,/required\("DELEGATION_ADAPTER_URL"\)/u);
 assert.doesNotMatch(launcher,/adapterBaseUrl\s*:/u);
 assert.doesNotMatch(launcher,/mcpCryptoUrl\s*:/u);
});

test("R239 native Task VP requires role token and signed Rust socket, not HTTP URL",()=>{
 const evidence=read("poc/packages/agent-runtime/src/delegation-evidence-handler.ts");
 const handler=read("poc/packages/agent-runtime/src/adk-a2a-handler.ts");
 assert.match(evidence,/adapterBaseUrl\?: string/u);
 assert.match(evidence,/!config\.nativeSocketPath && !config\.adapterBaseUrl\?\.trim\(\)/u);
 assert.match(evidence,/if\(this\.#nativeSocketPath\)/u);
 assert.match(evidence,/invokeNativeCrypto\(/u);
 assert.match(evidence,/Canonical signed Task VP requires native Rust signer socket/u);
 assert.match(handler,/adapterBaseUrl\?: string/u);
 assert.match(handler,/process\.env\.APPROVED_RUNNER_NATIVE_MCP!=="1"&&!config\.adapterBaseUrl\?\.trim\(\)/u);
 assert.match(handler,/!config\.mcpTaskRegistry/u);
 assert.doesNotMatch(handler,/new TrustedCryptoMcpBridge/u);
});

test("R239 historical Backend discovery cannot silently restore Adapter HTTP",()=>{
 const server=read("poc/packages/agent-runtime/src/server.ts");
 assert.match(server,/Legacy Backend discovery host requires explicit historical Adapter URL/u);
 assert.match(server,/options\.backendDiscovery&&!options\.adk\?\.adapterBaseUrl\?\.trim\(\)/u);
 assert.match(server,/legacy_crypto_http_mcp_retired/u);
});
