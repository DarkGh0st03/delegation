import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

/** Static entrypoint boundary; runtime catalog tests are in mcp-crypto-http,
 * mcp-http, mcp-create-http, mcp-write-http and mcp-run-tests-http.
 * No model/provider calls. */
test("R166 crypto listener registers only a VP tool; legacy tool wiring is isolated",()=>{
 const http=readFileSync(new URL("../src/http-server.ts",import.meta.url),"utf8");
 const historic=readFileSync(new URL("../src/legacy-repository-tools.ts",import.meta.url),"utf8");
 assert.match(http,/if\(config\.profile==="legacy"\)/u);
 assert.match(http,/registerLegacyRepositoryTools\(mcp,config\.router,claims,token\)/u);
 assert.match(http,/MCP_CREATE_PRESENTATION\.name/u);
 assert.doesNotMatch(http,/MCP_(READ_FILE|UPDATE_FILE|CREATE_FILE|RUN_TESTS)\.name/u);
 assert.doesNotMatch(http,/config\.router\.(readFile|updateFile|createFile|runTests)/u);
 for(const entry of ["MCP_READ_FILE","MCP_UPDATE_FILE","MCP_CREATE_FILE","MCP_RUN_TESTS"])
  assert.match(historic,new RegExp(entry+"\\.name","u"));
 assert.doesNotMatch(historic,/delegation_create_presentation|MCP_CREATE_PRESENTATION/u);
});
