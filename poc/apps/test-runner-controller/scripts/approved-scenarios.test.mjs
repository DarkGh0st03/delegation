import test from "node:test";
import assert from "node:assert/strict";
import {getApprovedOfflineScenario} from "../fixtures/approved-scenarios.mjs";
test("second requirement changes actual backend, Frontend and tests while keeping pinned project paths",()=>{
  const old=getApprovedOfflineScenario("account-suspension");
  const second=getApprovedOfflineScenario("department-directory");
  assert.notEqual(old.workBranch,second.workBranch);
  assert.equal(old.statusIndexBase,18071);
  assert.equal(second.statusIndexBase,18171);
  assert.ok(second.statusIndexBase-old.statusIndexBase>=5);
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

test("both pinned functional source edits work on the distinct Department Directory requirement",async()=>{
 const {approvedFunctionalEdit}=await import("./approved-functional-reference.mjs");
 for(const id of ["account-suspension","department-directory"]){
   const scenario=getApprovedOfflineScenario(id);
   for(const [role,path] of [
     ["backend","apps/backend/src/users/user.service.ts"],
     ["frontend","apps/frontend/src/pages/UserDetailPage.tsx"]
   ]){
     const edited=approvedFunctionalEdit(role,scenario.files[path],id);
     assert.notEqual(edited,scenario.files[path]);
   }
 }
 assert.throws(()=>approvedFunctionalEdit("backend",
   getApprovedOfflineScenario("account-suspension").files[
    "apps/backend/src/users/user.service.ts"],"department-directory"),
   /pinned source differs/);
});
