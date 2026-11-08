import test from "node:test";
import assert from "node:assert/strict";
import {isProjectTestReadGrant,isProjectTestRepairGrant,isProjectTestCreateGrant,isProjectTestSource,
 createTrustedProjectTestSourceProfile,isTrustedProjectTestSourceProfile,IAM_CONSOLE_PROJECT_TEST_PROFILE}
 from "../src/gitea-permission-containment.mjs";

const prefix="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension";
const permission=(operation,path)=>({operation,resource:prefix+"/files/"+path});

test("R383.0 Test agent may investigate a signed, exact application test file only",()=>{
 for(const path of [
  "tests/backend/account.test.ts","tests/frontend/account.test.tsx",
  "tests/backend/auth/login.test.ts","tests/frontend/forms/suspend.test.tsx",
  "tests/backend/user.service.test.ts","tests/backend/user.routes.test.ts",
  "tests/frontend/Account.Status.test.tsx"
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

test("R385.13 dotted project test filenames stay exact and fail closed on aliases",()=>{
 for(const path of ["tests/backend/user.service.test.ts",
  "tests/backend/user.routes.test.ts","tests/frontend/Account.Status.test.tsx"]){
  const read=permission("read_file",path);
  const update=permission("update_file",path);
  assert.equal(isProjectTestSource(path),true,path);
  assert.equal(isProjectTestReadGrant([read]),true,path);
  assert.equal(isProjectTestRepairGrant([read,update]),true,path);
  assert.equal(isProjectTestRepairGrant([read,permission("update_file",
   "tests/backend/another.test.ts")]),false,"same exact file only");
 }
 for(const rejected of ["tests/backend/user..service.test.ts",
  "tests/backend/.hidden.test.ts","tests/backend/user.service.spec.ts",
  "tests/backend/../frontend/user.service.test.ts",
  "tests/backend/user.service.test.ts/../runner.config.ts",
  "tests/backend/user.service.test.ts?query",
  "tests/acceptance/user.service.test.ts",
  "poc/runner/acceptance/user.service.test.ts"]){
  assert.equal(isProjectTestSource(rejected),false,rejected);
  assert.equal(isProjectTestReadGrant([permission("read_file",rejected)]),false,rejected);
  assert.equal(isProjectTestRepairGrant([permission("read_file",rejected),
   permission("update_file",rejected)]),false,rejected);
 }
});

test("R386 Test CREATE requires one exact project test source, no extra grants",()=>{
 for(const path of ["tests/backend/new.test.ts",
  "tests/frontend/pages/SuspensionForm.test.tsx",
  "tests/backend/user.service.test.ts"])
  assert.equal(isProjectTestCreateGrant([permission("create_file",path)]),true,path);
 for(const path of ["apps/backend.ts","tests/acceptance/account.test.ts",
  "tests/backend/setup.ts","tests/frontend/account.spec.ts",
  "tests/backend/../runner.test.ts","tests/backend/user..name.test.ts",
  "tests/backend/account.test.ts/../config.ts",
  "poc/runner/acceptance/user.test.ts"])
  assert.equal(isProjectTestCreateGrant([permission("create_file",path)]),false,path);
 assert.equal(isProjectTestCreateGrant([{operation:"create_file",
  resource:prefix+"/directories/tests/backend"}]),false);
 assert.equal(isProjectTestCreateGrant([permission("update_file","tests/backend/new.test.ts")]),false);
 assert.equal(isProjectTestCreateGrant([permission("create_file","tests/backend/new.test.ts"),
  permission("read_file","tests/backend/new.test.ts")]),false);
 assert.equal(isProjectTestCreateGrant([]),false);
 assert.equal(isProjectTestCreateGrant([null]),false);
});

test("R401 trusted repository test profile supports alternate test layouts without changing IAM Console",()=>{
 const other=createTrustedProjectTestSourceProfile({
  roots:["src/__tests__","test/unit"],suffixes:[".test.ts",".spec.tsx"]
 });
 assert.equal(isTrustedProjectTestSourceProfile(other),true);
 assert.equal(Object.isFrozen(other),true);
 assert.equal(Object.isFrozen(other.roots),true);
 for(const path of ["src/__tests__/api.spec.tsx","test/unit/handler.test.ts"]){
  assert.equal(isProjectTestSource(path),false,"default PoC profile is unchanged");
  assert.equal(isProjectTestSource(path,other),true);
  const read=permission("read_file",path),update=permission("update_file",path);
  assert.equal(isProjectTestReadGrant([read],other),true);
  assert.equal(isProjectTestRepairGrant([read,update],other),true);
  assert.equal(isProjectTestCreateGrant([permission("create_file",path)],other),true);
 }
 for(const path of ["src/__tests__/../../acceptance.test.ts",
  "src/__tests__/.hidden.spec.tsx","src/__tests__/api..name.spec.tsx",
  "src/__tests__/api.spec.ts","test/unit/docs/readme.md",
  "tests/acceptance/account.test.ts","src/__tests__/run%2Fner.test.ts"]){
  assert.equal(isProjectTestSource(path,other),false,path);
 }
 assert.equal(isProjectTestSource("tests/backend/user.test.ts",IAM_CONSOLE_PROJECT_TEST_PROFILE),true);
 assert.equal(isProjectTestSource("src/__tests__/api.spec.tsx",{
  roots:["src/__tests__"],suffixes:[".spec.tsx"]}),false,
  "model-supplied/plain object is not a trusted profile");
});

test("R401 untrusted/broad test-source profile configuration is rejected",()=>{
 for(const invalid of [
  {roots:["tests/acceptance"],suffixes:[".test.ts"]},
  {roots:["runner/acceptance"],suffixes:[".test.ts"]},
  {roots:["../test"],suffixes:[".test.ts"]},
  {roots:["src/__tests__"],suffixes:[".txt"]},
  {roots:["src/__tests__","src/__tests__"],suffixes:[".test.ts"]},
  {roots:["src/__tests__"],suffixes:[".test.ts",".test.ts"]},
  {roots:[],suffixes:[".test.ts"]},
  {roots:["src/__tests__"],suffixes:[]},
  {roots:["src/__tests__"],suffixes:[".test.ts"],extra:"untrusted"}
 ]){
  assert.throws(()=>createTrustedProjectTestSourceProfile(invalid),
   /Invalid trusted project-test/u);
 }
 assert.equal(isProjectTestReadGrant(null),false);
 assert.equal(isProjectTestRepairGrant(null),false);
 assert.equal(isProjectTestCreateGrant([null]),false);
});
