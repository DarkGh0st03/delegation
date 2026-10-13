import test from "node:test";
import assert from "node:assert/strict";
import {MCP_CREATE_FILE,MCP_CREATABLE_E2E_PATH,MAX_MCP_CREATE_BYTES,
  parseCreateFileArgs} from "../src/catalog.ts";

const baseline={
  branch:"feature/account-suspension",
  path:MCP_CREATABLE_E2E_PATH,
  content:"import { test } from '@playwright/test';"
};
test("MCP create_file catalog is limited to the Test Agent E2E fixture",()=>{
  assert.equal(MCP_CREATE_FILE.operation,"create_file");
  assert.deepEqual(parseCreateFileArgs(baseline),baseline);
  for(const invalid of [
    {...baseline,branch:"main"},
    {...baseline,path:"tests/backend/user.service.test.ts"},
    {...baseline,path:"apps/backend/src/users/user.service.ts"},
    {...baseline,path:"tests/e2e/../e2e/account-suspension.spec.ts"},
    {...baseline,content:"😀".repeat(MAX_MCP_CREATE_BYTES/4+1)},
    {...baseline,agent_role:"test"},
    {...baseline,task_id:"fake"}
  ])assert.throws(()=>parseCreateFileArgs(invalid),/invalid_tool_arguments/);
});
