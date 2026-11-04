import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

test("R264 Shared MCP executable, HTTP listener and obsolete repository routing are absent",()=>{
 for(const path of [
  "../src/main.ts",
  "../src/http-server.ts",
  "../src/crypto-worker-router.ts",
  "../src/task-router.ts",
  "../src/legacy-repository-tools.ts"
 ])assert.equal(existsSync(new URL(path,import.meta.url)),false,path);
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 assert.equal(Object.hasOwn(pkg.scripts,"start"),false);
 const local=readFileSync(new URL("../../packages/agent-runtime/src/local-crypto-mcp-bridge.ts",import.meta.url),"utf8");
 assert.match(local,/registerTool\("delegation_create_presentation"/u);
 assert.match(local,/InMemoryTransport\.createLinkedPair\(/u);
 assert.doesNotMatch(local,/registerTool\("(read_file|update_file|create_file|run_tests)"/u);
});
