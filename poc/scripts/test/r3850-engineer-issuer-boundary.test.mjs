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
 assert.match(selector,/loaded\?\?=import\("\.\/trusted-engineer-legacy-mcp-http-port\.ts"\)/u);
 assert.match(legacy,/createLegacyOwnerPrivateMcpEngineerCredentialPort/u);
 assert.match(legacy,/import \{SoftwareEngineerAuthorityBootstrap\}/u);
 assert.match(legacy,/createOwnerPrivateCryptographicMcpSession\(/u);
});

test("R385.0 canonical selector still gives direct Rust priority and denies implicit HTTP fallback",()=>{
 const selector=read("poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts");
 const first=selector.indexOf('if(direct==="1"){');
 const socket=selector.indexOf("if(path!==undefined){",first);
 const fail=selector.indexOf('if(process.env.APPROVED_RUNNER_NATIVE_MCP==="1")',socket);
 const legacy=selector.indexOf("return createOwnerPrivateMcpEngineerCredentialPort",fail);
 assert.ok(first>=0&&socket>first&&fail>socket&&legacy>fail,
  "Engineer's owner-only direct Rust path must precede any fixture fallback");
 assert.match(selector,/return createDirectRustEngineerCredentialPort\(config\)/u);
 assert.match(selector,/Canonical Engineer root requires native Rust issuer socket/u);
 assert.match(selector,/Legacy HTTP Engineer fixture requires explicit Adapter URL/u);
 const direct=read("poc/packages/orchestrator-runtime/src/trusted-engineer-direct-core-port.ts");
 assert.doesNotMatch(direct,/createOwnerPrivateMcpEngineerCredentialPort|postCredential\(/u);
 assert.match(direct,/loadDirectRustEngineerCore\(/u);
});
