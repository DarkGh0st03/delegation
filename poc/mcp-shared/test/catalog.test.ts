import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {MCP_READ_FILE,parseReadFileArgs} from "../src/catalog.ts";
test("catalog operation is serialized by actual Rust enum",()=>{
  const rust=readFileSync(fileURLToPath(new URL("../../../src/delegation/authorization/operation.rs",import.meta.url)),"utf8");
  assert.match(rust,/pub enum Operation/);
  assert.match(rust,/Self::ReadFile\s*=>\s*"read_file"/);
  assert.equal(MCP_READ_FILE.operation,"read_file");
});
test("model cannot inject role/task or request directory traversal",()=>{
  assert.deepEqual(parseReadFileArgs({branch:"feature/account-suspension",path:"apps/backend/src/users/user.model.ts"}),
    {branch:"feature/account-suspension",path:"apps/backend/src/users/user.model.ts"});
  for (const x of [
    {branch:"main",path:"a.ts"},
    {branch:"feature/account-suspension",path:"../secret"},
    {branch:"feature/account-suspension",path:"a.ts",agent_role:"frontend"},
    {branch:"feature/account-suspension",path:"/etc/shadow"},
    {branch:"feature/account-suspension",path:"a/./b"}
  ]) assert.throws(()=>parseReadFileArgs(x));
});
