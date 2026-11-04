import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {auditLegacyCryptoEntrypoints}
 from "../r226-legacy-crypto-import-audit.mjs";

test("R226 canonical source no longer statically imports private Shared MCP HTTP",()=>{
 const result=auditLegacyCryptoEntrypoints();
 assert.deepEqual(result.forbidden,[],
  "No production app/package may import a retired Shared MCP/worker module");
 assert.ok(result.scanned_files>100);
});

test("R226 canonical crypto port contract is independent of old remote MCP",()=>{
 const root=new URL("../../../",import.meta.url);
 const read=p=>readFileSync(new URL(p,root),"utf8");
 for(const path of [
  "poc/packages/agent-runtime/src/index.ts",
  "poc/packages/agent-runtime/src/local-crypto-mcp-bridge.ts",
  "poc/packages/agent-runtime/src/gateway-tool-client.ts"
 ]){
  const s=read(path);
  assert.doesNotMatch(s,/from ["']\.\/trusted-crypto-mcp-bridge\.ts/u);
 }
 assert.match(read("poc/packages/agent-runtime/src/index.ts"),
  /crypto-presentation-port/u);
 const pkg=JSON.parse(read("poc/mcp-shared/package.json"));
 assert.equal(Object.hasOwn(pkg.scripts,"start"),false);
});
