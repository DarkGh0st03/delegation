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

test("new signed Task parser admits safe feature branches, legacy default does not",()=>{
  for(const branch of ["feature/invoice-sort","feature/ticket-42"]){
    assert.equal(parseReadFileArgs({branch,path:"src/billing/invoice.ts"},"approved").branch,branch);
    assert.throws(()=>parseReadFileArgs({branch,path:"src/billing/invoice.ts"}),/invalid_tool_arguments/);
  }
  for(const branch of ["main","feature/a..b","feature/x.lock",
    "feature/x//y","feature/X","feature/x@{1}"]){
    assert.throws(()=>parseReadFileArgs({branch,path:"src/billing/invoice.ts"},"approved"));
  }
  assert.throws(()=>parseReadFileArgs({branch:"feature/invoice-sort",
    path:"src/billing/invoice.ts",session_id:"other"},"approved"));
});
