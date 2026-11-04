import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
test("R188 crypto-only factory cannot register repository MCP or deleted router",()=>{
 const source=readFileSync(new URL("../src/http-server.ts",import.meta.url),"utf8");
 const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
 assert.match(source,/MCP_CREATE_PRESENTATION\.name/u);
 assert.match(source,/config\?\.profile!=="crypto"/u);
 assert.doesNotMatch(source,/TaskRouter|legacy-repository-tools|registerLegacyRepositoryTools/u);
 assert.doesNotMatch(source,/MCP_(READ_FILE|UPDATE_FILE|CREATE_FILE|RUN_TESTS)\.name/u);
 assert.doesNotMatch(source,/config\.router\.(readFile|updateFile|createFile|runTests)/u);
 assert.match(main,/new CryptoWorkerRouter\(workers\)/u);
 for(const f of ["task-router.ts","legacy-repository-tools.ts"])
  assert.equal(existsSync(new URL("../src/"+f,import.meta.url)),false);
});
