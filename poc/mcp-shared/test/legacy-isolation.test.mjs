import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
test("R188 crypto-only factory cannot register repository MCP or deleted router",()=>{
 const source=readFileSync(new URL("../src/http-server.ts",import.meta.url),"utf8");
 const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(source,/MCP_CREATE_PRESENTATION\.name/u);
 assert.match(source,/config\?\.profile!=="crypto"/u);
 assert.doesNotMatch(source,/TaskRouter|legacy-repository-tools|registerLegacyRepositoryTools/u);
 assert.doesNotMatch(source,/MCP_(READ_FILE|UPDATE_FILE|CREATE_FILE|RUN_TESTS)\.name/u);
 assert.doesNotMatch(source,/config\.router\.(readFile|updateFile|createFile|runTests)/u);
 assert.doesNotMatch(main,/new CryptoWorkerRouter\\(workers\\)/u);
 assert.match(main,/standalone_shared_mcp_launcher_retired/u);
 for(const f of ["task-router.ts","legacy-repository-tools.ts"])
  assert.equal(existsSync(new URL("../src/"+f,import.meta.url)),false);
});

test("R221 stale shared MCP npm launcher fails closed before starting any service",()=>{
 const path=fileURLToPath(new URL("../src/main.ts",import.meta.url));
 const child=spawnSync(process.execPath,["--experimental-strip-types",path],{
  encoding:"utf8",timeout:4000,
  env:{...process.env,MCP_BIND_PORT:"8097",MCP_TOOL_PROFILE:"crypto"}
 });
 assert.notEqual(child.status,0,"Retired launcher must never remain runnable");
 assert.match(child.stderr,/standalone_shared_mcp_launcher_retired/u);
 assert.doesNotMatch(child.stdout,/mcp_shared_started/u);
});
