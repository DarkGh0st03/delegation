import test from "node:test";
import assert from "node:assert/strict";
import {isProjectTestReadGrant,isProjectTestRepairGrant,isProjectTestSource}
 from "../src/gitea-permission-containment.mjs";

const prefix="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension";
const permission=(operation,path)=>({operation,resource:prefix+"/files/"+path});

test("R383.0 Test agent may investigate a signed, exact application test file only",()=>{
 for(const path of [
  "tests/backend/account.test.ts","tests/frontend/account.test.tsx",
  "tests/backend/auth/login.test.ts","tests/frontend/forms/suspend.test.tsx"
 ]){
  const read=permission("read_file",path);
  assert.equal(isProjectTestSource(path),true);
  assert.equal(isProjectTestReadGrant([read]),true);
  assert.equal(isProjectTestRepairGrant([read]),false,
   "read-only investigation cannot acquire update permission");
 }
});

test("R383.0 project test read denies source files, acceptance tests, directory scopes, writes and extras",()=>{
 const source=permission("read_file","apps/backend.ts");
 const acceptance=permission("read_file","tests/acceptance/account.test.ts");
 const wrong=permission("read_file","tests/frontend/account.spec.ts");
 const escaped=permission("read_file","tests/backend/../frontend/account.test.ts");
 const foreign={operation:"read_file",
  resource:"gitea://gitea.local/thesis/iam-console-poc/branches/main/files/tests/backend/account.test.ts"};
 const dir={operation:"read_file",
  resource:prefix+"/directories/tests/backend"};
 for(const read of [source,acceptance,wrong,escaped,dir]){
  assert.equal(isProjectTestReadGrant([read]),false);
 }
 // A different branch may be separately authorized by a different
 // owner Root, but it is NOT authorized by this feature-specific Root.
 assert.equal(isProjectTestReadGrant([foreign]),true);
 assert.equal(isProjectTestReadGrant([permission("update_file","tests/backend/account.test.ts")]),false);
 assert.equal(isProjectTestReadGrant([permission("run_tests","tests/backend/account.test.ts")]),false);
 assert.equal(isProjectTestReadGrant([
  permission("read_file","tests/backend/account.test.ts"),
  permission("update_file","tests/backend/account.test.ts")
 ]),false);
 assert.equal(isProjectTestReadGrant([]),false);
 assert.equal(isProjectTestReadGrant([{resource:prefix+"/files/tests/backend/account.test.ts"}]),false);
});
