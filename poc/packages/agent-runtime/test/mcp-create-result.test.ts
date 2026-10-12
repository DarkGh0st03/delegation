import test from "node:test";
import assert from "node:assert/strict";
import {normalizeMcpCreateFileOutcome} from "../src/mcp-create-result.ts";

const args={branch:"feature/account-suspension",
  path:"tests/e2e/account-suspension.spec.ts",content:"test('x',()=>{});"};
const result={provider:"gitea",performed:true,tool:"create_file",
  branch:args.branch,path:args.path,revision:"a".repeat(40),
  commit_sha:"a".repeat(40),blob_sha:"b".repeat(40)};
test("MCP create_file accepts only Gitea-confirmed exact commit and blob hashes",()=>{
  const valid=normalizeMcpCreateFileOutcome({
    structuredContent:{ok:true,result}
  },args);
  assert.deepEqual(valid,{ok:true,result});
  const invalid=[
    {...result,provider:"mock"},
    {...result,tool:"update_file"},
    {...result,path:"other.ts"},
    {...result,branch:"main"},
    {...result,commit_sha:"fake"},
    {...result,revision:"c".repeat(40)},
    {...result,blob_sha:undefined}
  ];
  for(const r of invalid)assert.equal(normalizeMcpCreateFileOutcome({
    structuredContent:{ok:true,result:r}
  },args).ok,false);
  assert.equal(normalizeMcpCreateFileOutcome({ok:true,result},args).ok,false,
    "Unstructured model-success claims must fail closed");
});
test("MCP create_file preserves only controlled denial categories",()=>{
  const denied=normalizeMcpCreateFileOutcome({
    isError:true,structuredContent:{ok:false,error:{kind:"authorization_denied"}}
  },args);
  assert.equal(denied.ok,false);
  if(!denied.ok)assert.equal(denied.error.kind,"authorization_denied");
  const unknown=normalizeMcpCreateFileOutcome({
    isError:true,structuredContent:{ok:false,error:{kind:"some_raw_secret"}}
  },args);
  assert.equal(unknown.ok,false);
  if(!unknown.ok)assert.equal(unknown.error.kind,"tool_unavailable");
});
