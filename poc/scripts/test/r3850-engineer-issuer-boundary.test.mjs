import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

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
 assert.match(legacy,/new m\.SoftwareEngineerAuthorityBootstrap\(pinnedConfig\)/u);
 assert.match(legacy,/const pinnedConfig:AdapterClientConfig=Object.freeze\(\{\.\.\.config\}\)/u,
  "HTTP endpoint, token and transport must be immutable before async import");
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

test("R428 cold recovery calls only canonical native Rust Engineer, no historical HTTP opt-in",()=>{
 const host=read("poc/apps/orchestrator/src/trusted-engineer-host.mjs");
 const start=host.indexOf("async function strictRecoveringHost(config){");
 const end=host.indexOf("export async function startTrustedEngineerRecoveringHost(config){",start);
 assert.ok(start>=0&&end>start,"strict recovering boundary missing");
 const recovery=host.slice(start,end);
 assert.match(recovery,/const credentials=createTrustedEngineerCredentialPort\(\{/u);
 assert.match(recovery,/bearerToken:recovery\.adapterToken/u);
 assert.doesNotMatch(recovery,/historicalFixture|DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE|createLegacyOwnerPrivateMcpEngineerCredentialPort|authority-client\.ts|trusted-engineer-legacy-mcp-http-port\.ts/u);
 assert.doesNotMatch(recovery,/new URL\(recovery\.adapterBaseUrl\)/u);
});

test("R428 native cold recovery ignores historical HTTP URL and rejects fallback",()=>{
 const host=read("poc/apps/orchestrator/src/trusted-engineer-host.mjs");
 const service=read("poc/apps/orchestrator/src/trusted-engineer-service.mjs");
 const start=host.indexOf("async function strictRecoveringHost(config){");
 const end=host.indexOf("export async function startTrustedEngineerRecoveringHost(config){",start);
 const recovering=host.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(recovering,/createTrustedEngineerCredentialPort\(\{/u);
 assert.doesNotMatch(recovering,/adapterBaseUrl|historicalFixture/u,
  "operator recovery cannot select a second HTTP issuer");
 // Historical config loading may accept an optional URL for old files,
 // but it must never select the actual operational credential authority.
 assert.match(service,/\(recovery\.adapterBaseUrl!==undefined&&\s*typeof recovery\.adapterBaseUrl!=="string"\)/u);
});

test("R418 historical EVM scripts do not eagerly load the old HTTP root issuer",()=>{
 for(const file of [
  "poc/apps/gateway/native-test/native-approved-three-adk-evm-e2e.mjs",
  "poc/apps/gateway/native-test/native-r110-repair-discovery-evm-e2e.mjs"
 ]){
  const src=read(file);
  assert.doesNotMatch(src,
   /import\s*\{\s*SoftwareEngineerAuthorityBootstrap\s*\}\s*from\s*["'][^"']*\/authority-client\.ts["']/u,
   file+" must not contain a static HTTP issuer import");
  const guard=src.indexOf('process.env.ADAPTER_TRUST_PROFILE');
  const bearer=src.indexOf("ADAPTER_CALLER_");
  const dynamic=src.indexOf("const {SoftwareEngineerAuthorityBootstrap}=await import(");
  const constructor=src.indexOf("new SoftwareEngineerAuthorityBootstrap({",dynamic);
  assert.ok(guard>=0&&bearer>=0&&dynamic>guard&&dynamic>bearer&&
   constructor>dynamic,
   file+" must guard EVM identity and bearer before the historical HTTP issuer loads");
  const imports=[...src.matchAll(/await import\(\s*["'][^"']*\/authority-client\.ts["']\s*\)/gu)];
  assert.equal(imports.length,1,file+" must have exactly one test-only lazy importer");
 }
});

test("R419 legacy Adapter transport is physically retired into the tested HTTP issuer",()=>{
 const deleted="poc/packages/orchestrator-runtime/src/authority-adapter-transport.ts";
 assert.equal(existsSync(new URL("../../../"+deleted,import.meta.url)),false,
  "the old transport split must stay absent");
 const issuer=read("poc/packages/orchestrator-runtime/src/authority-client.ts");
 const legacy=read("poc/packages/orchestrator-runtime/src/trusted-engineer-legacy-mcp-http-port.ts");
 assert.match(issuer,/export interface AdapterClientConfig/u);
 assert.match(issuer,/function validateCommon\(/u);
 assert.match(issuer,/async function postCredential\(/u);
 assert.match(issuer,/Adapter root issuance response differs from exact trusted permissions/u);
 assert.match(issuer,/Adapter root DC revocation not confirmed/u);
 assert.doesNotMatch(issuer,/from "\.\/authority-adapter-transport\.ts"/u);
 assert.match(legacy,/import type \{AdapterClientConfig\}\s+from "\.\/authority-client\.ts"/u);
 assert.doesNotMatch(legacy,/from "\.\/authority-adapter-transport\.ts"/u);
});
