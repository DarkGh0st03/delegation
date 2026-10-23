import test from "node:test";
import assert from "node:assert/strict";
import {getApprovedOfflineScenario} from "../fixtures/approved-scenarios.mjs";
test("second requirement changes actual backend, Frontend and tests while keeping pinned project paths",()=>{
  const old=getApprovedOfflineScenario("account-suspension");
  const second=getApprovedOfflineScenario("department-directory");
  assert.notEqual(old.workBranch,second.workBranch);
  assert.deepEqual(Object.keys(old.files).sort(),Object.keys(second.files).sort());
  const changed=Object.keys(old.files).filter(path=>old.files[path]!==second.files[path]);
  assert.ok(changed.length>=7);
  for(const part of ["apps/backend/","apps/frontend/","tests/backend/","tests/e2e/"]){
    assert.ok(changed.some(path=>path.startsWith(part)),part);
  }
  assert.match(second.files["apps/backend/src/users/user.service.ts"],
    /listUsersByDepartment/);
  assert.match(second.files["apps/frontend/src/pages/UserDetailPage.tsx"],
    /Department directory/);
  assert.match(second.files["tests/e2e/account-suspension.spec.ts"],
    /department directory search/);
  assert.doesNotMatch(old.files["apps/backend/src/users/user.service.ts"],
    /listUsersByDepartment/);
});
test("scenario selector never accepts an untrusted path or unregistered variant",()=>{
  assert.throws(()=>getApprovedOfflineScenario("../../secrets"),/Unsupported/);
  assert.throws(()=>getApprovedOfflineScenario("toString"),/Unsupported/);
});
