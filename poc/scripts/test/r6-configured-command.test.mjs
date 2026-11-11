import test from "node:test";
import assert from "node:assert/strict";
import {configuredMatch} from "../r6-legacy-references.mjs";

test("R193 configured command scanner never confuses a suffix with an executable",()=>{
 const target="poc/mcp-shared/test/catalog.test.ts";
 assert.equal(configuredMatch(
  "node --test poc/apps/gateway/test/operation-catalog.test.ts",target),false);
 assert.equal(configuredMatch("npm run gateway:test",target),false);
 assert.equal(configuredMatch("node --test poc/mcp-shared/test/catalog.test.ts",target),true);
 assert.equal(configuredMatch("node --test test/catalog.test.ts",target),true);
 assert.equal(configuredMatch("node catalog.test.ts",target),true);
});
