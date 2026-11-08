import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R385.0 owner selector has no eager HTTP Adapter bootstrap or owner-private MCP import",()=>{
 const selector=read("poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts");
 const legacy=read("poc/packages/orchestrator-runtime/src/trusted-engineer-legacy-mcp-http-port.ts");
 assert.doesNotMatch(selector,/from ["']\.\/authority-client\.ts["']/u);
 assert.doesNotMatch(selector,/from ["']\.\/trusted-engineer-legacy-mcp-http-port\.ts["']/u);
 assert.doesNotMatch(selector,/from ["']\.\.\/\.\.\/\.\.\/mcp-shared\/src\/owner-private-child-mcp\.ts["']/u);
 assert.doesNotMatch(selector,/createOwnerPrivateCryptographicMcpSession\(/u);
 assert.doesNotMatch(selector,/trusted-engineer-legacy-mcp-http-port|createOwnerPrivateMcpEngineerCredentialPort|assertLegacyEngineerHttpFixtureAllowed/u);
 assert.match(legacy,/createLegacyOwnerPrivateMcpEngineerCredentialPort/u);
 assert.doesNotMatch(legacy,/import \{SoftwareEngineerAuthorityBootstrap\}/u);
 assert.match(legacy,/loaded\?\?=import\("\.\/authority-client\.ts"\)/u);
 assert.match(legacy,/new m\.SoftwareEngineerAuthorityBootstrap\(config\)/u);
 assert.match(legacy,/createOwnerPrivateCryptographicMcpSession\(/u);
});

test("R417 historical HTTP opt-in gate belongs only to the legacy credential module",()=>{
 const selector=read("poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts");
 const legacy=read("poc/packages/orchestrator-runtime/src/trusted-engineer-legacy-mcp-http-port.ts");
 const gate=read("poc/packages/orchestrator-runtime/src/trusted-engineer-legacy-fixture-gate.ts");
 assert.doesNotMatch(selector,/assertLegacyEngineerHttpFixtureAllowed\(\)/u);
 assert.match(legacy,/assertLegacyEngineerHttpFixtureAllowed\(\)/u);
 assert.match(gate,/DELEGATION_GATEWAY_ARCHITECTURE==="authority-only"/u);
 assert.match(gate,/APPROVED_RUNNER_NATIVE_MCP==="1"/u);
 assert.match(gate,/ENGINEER_CORE_NATIVE_MODE==="1"/u);
 assert.match(gate,/ADAPTER_ENGINEER_NATIVE_SOCKET!==undefined/u);
});

test("R415 canonical selector is native-only and has no legacy HTTP fallback",()=>{
 const selector=read("poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts");
 const first=selector.indexOf('if(direct==="1"){');
 const socket=selector.indexOf("if(path!==undefined){",first);
 const fail=selector.indexOf('throw Error("Canonical Engineer root requires native Rust issuer socket");',socket);
 assert.ok(first>=0&&socket>first&&fail>socket,
  "Native direct and local-socket routes must precede mandatory fail-closed");
 const canonical=selector.slice(selector.indexOf("export function createTrustedEngineerCredentialPort("));
 assert.doesNotMatch(canonical,/createOwnerPrivateMcpEngineerCredentialPort|adapterBaseUrl|fetchFn/u,
  "Canonical selector cannot be configured to use or return historical HTTP");
 assert.match(selector,/return createDirectRustEngineerCredentialPort\(config\)/u);
 assert.match(selector,/return createNativeRustEngineerCredentialPort\(/u);
 assert.match(selector,/Canonical Engineer root requires native Rust issuer socket/u);
 const direct=read("poc/packages/orchestrator-runtime/src/trusted-engineer-direct-core-port.ts");
 assert.doesNotMatch(direct,/createOwnerPrivateMcpEngineerCredentialPort|postCredential\(/u);
 assert.match(direct,/loadDirectRustEngineerCore\(/u);
});

test("R415.1 cold recovery chooses HTTP only as separately gated historical fixture",()=>{
 const host=read("poc/apps/orchestrator/src/trusted-engineer-host.mjs");
 const start=host.indexOf("const historicalFixture=");
 const end=host.indexOf("const credentials=historicalFixture",start);
 assert.ok(start>0&&end>start,"missing explicit fixture-only choice");
 const guard=host.slice(start,end);
 for(const condition of [
  'DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE==="1"',
  'ENGINEER_CORE_NATIVE_MODE===undefined',
  'ADAPTER_ENGINEER_NATIVE_SOCKET===undefined',
  'APPROVED_RUNNER_NATIVE_MCP===undefined',
  'DELEGATION_GATEWAY_ARCHITECTURE===undefined'
 ])assert.ok(guard.includes(condition),"historical recovery guard missing "+condition);
 const select=host.slice(end,end+650);
 assert.match(select,/\?\(await import\(".*trusted-engineer-legacy-mcp-http-port\.ts"\)\)/u);
 assert.match(select,/\.createLegacyOwnerPrivateMcpEngineerCredentialPort\(/u);
 assert.match(select,/:createTrustedEngineerCredentialPort\(\{bearerToken:recovery\.adapterToken\}\)/u);
 assert.doesNotMatch(host,/from "\.\.\/\.\.\/\.\.\/packages\/orchestrator-runtime\/src\/authority-client\.ts"/u);
});

test("R416 native cold recovery does not require historical HTTP Adapter URL",()=>{
 const host=read("poc/apps/orchestrator/src/trusted-engineer-host.mjs");
 const service=read("poc/apps/orchestrator/src/trusted-engineer-service.mjs");
 assert.match(host,/\(historicalFixture&&typeof recovery\.adapterBaseUrl!=="string"\)/u);
 assert.match(host,/if\(historicalFixture\)\{[\s\S]*?new URL\(recovery\.adapterBaseUrl\)/u);
 assert.match(service,/\(recovery\.adapterBaseUrl!==undefined&&\s*typeof recovery\.adapterBaseUrl!=="string"\)/u);
 const start=host.indexOf("const historicalFixture=");
 const check=host.indexOf("if(historicalFixture){",start);
 const credentials=host.indexOf("const credentials=historicalFixture",check);
 assert.ok(start>=0&&check>start&&credentials>check,
  "fixture scope must be decided before HTTP validation and root issuer construction");
 const native=host.slice(credentials,credentials+650);
 assert.match(native,/:createTrustedEngineerCredentialPort\(\{bearerToken:recovery\.adapterToken\}\)/u);
});
