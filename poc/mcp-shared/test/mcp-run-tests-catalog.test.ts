import test from "node:test";
import assert from "node:assert/strict";
import {MCP_RUN_TESTS,parseRunTestsArgs} from "../src/catalog.ts";
const args={branch:"feature/account-suspension",profile:"poc-default"};
test("MCP run_tests only accepts controlled feature branch and predefined profile",()=>{
  assert.equal(MCP_RUN_TESTS.operation,"run_tests");
  assert.deepEqual(parseRunTestsArgs(args),args);
  for(const rejected of [
    {branch:"main",profile:"poc-default"},
    {branch:"feature/account-suspension",profile:"all"},
    {branch:"feature/account-suspension"},
    {...args,command:"npm test"},
    {...args,role:"test"},
    {...args,task_id:"untrusted"},
    ["run_tests"],null
  ])assert.throws(()=>parseRunTestsArgs(rejected),/invalid_tool_arguments/);
});
