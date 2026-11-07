import test from "node:test";
import assert from "node:assert/strict";
import {auditAccountSuspensionFunctionalCoverage as audit}
 from "../scripts/r3844-functional-recovery-coverage.mjs";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES}
 from "../fixtures/account-suspension-reference.mjs";
import {ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES}
 from "../fixtures/account-suspension-unsolved-baseline.mjs";

const repo="gitea://gitea.local/thesis/iam-console-poc";
const branch="feature/account-suspension";
const base=repo+"/branches/"+encodeURIComponent(branch);
const file=(path,operation)=>({
 resource:base+"/files/"+path,operation
});
const scoped=(path,operation)=>({
 resource:base+"/directories/"+path,operation
});
const sourcePaths=Object.keys(ACCOUNT_SUSPENSION_REFERENCE_FILES)
 .filter(p=>p!=="tests/e2e/account-suspension.spec.ts"&&
  ACCOUNT_SUSPENSION_REFERENCE_FILES[p]!==
   ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[p]).sort();
assert.equal(sourcePaths.length,10);
const fullRoot=sourcePaths.flatMap(p=>[
 file(p,"read_file"),file(p,"update_file")
]);
const partialRoot=[
 file("apps/backend/src/users/user.service.ts","read_file"),
 file("apps/backend/src/users/user.service.ts","update_file"),
 file("apps/frontend/src/api/users-api.ts","read_file"),
 file("apps/frontend/src/api/users-api.ts","update_file"),
 scoped("apps/backend/src/users","create_file"),
 {resource:base,operation:"run_tests"}
];

test("R384.4 reviewed R384.3 Root cannot reach known reference PASS without new Engineer grant",()=>{
 const result=audit({rootPermissions:partialRoot});
 assert.equal(result.status,"signed_root_insufficient_for_known_functional_reference");
 assert.equal(result.required_operation_pairs,20);
 assert.equal(result.covered_operation_pairs,4);
 assert.equal(result.missing_operation_pairs,16);
 assert.equal(result.reviewed_source_paths,10);
 assert.equal(result.missing.some(x=>x.operation==="create_file"),false,
  "unrelated CREATE grant cannot substitute for signed source UPDATE");
 assert.equal(result.missing.some(x=>x.resource.includes("packages/shared")),true);
 assert.equal(result.researcher_owned_paths_excluded.length,1);
 assert.deepEqual(result.researcher_owned_paths_excluded,[
  "tests/e2e/account-suspension.spec.ts"
 ]);
 assert.equal(result.root_expanded,false);
 assert.equal(result.functional_pass_attested,false);
 assert.equal(result.gateway_write_authorized,false);
 assert.equal(result.original_root_signature_verified,false);
 assert.equal(result.rust_vp_verified,false);
 assert.equal(result.source_material_disclosed,false);
 const publicResult=JSON.stringify(result);
 assert.equal(publicResult.includes("export const ACCOUNT_STATUS"),false);
 assert.equal(publicResult.includes("UserService"),false);
 assert.equal(publicResult.includes("UserDetailPage"),false);
 assert.equal(publicResult.includes("accountSuspended = true"),false);
 assert.match(result.exact_required_grants_sha256,/^[a-f0-9]{64}$/u);
});

test("R384.4 a separately Engineer-reviewed full reference Root covers exactly required operations, not permission to write",()=>{
 const result=audit({rootPermissions:fullRoot});
 assert.equal(result.status,"known_reference_operations_covered_preflight_only");
 assert.equal(result.required_operation_pairs,20);
 assert.equal(result.covered_operation_pairs,20);
 assert.equal(result.missing_operation_pairs,0);
 assert.deepEqual(result.missing,[]);
 assert.equal(result.gateway_write_authorized,false);
 assert.equal(result.rust_vp_verified,false);
 assert.equal(result.functional_pass_attested,false);
 assert.equal(result.root_expanded,false);
 assert.equal(Object.isFrozen(result),true);
 assert.equal(Object.isFrozen(result.missing),true);
});

test("R384.4 a signed update grant does not imply its required read permission",()=>{
 const updates=sourcePaths.map(p=>file(p,"update_file"));
 const result=audit({rootPermissions:updates});
 assert.equal(result.missing_operation_pairs,10);
 assert.equal(result.missing.every(x=>x.operation==="read_file"),true);
});

test("R384.4 coverage containment is exact on branch, operation, directory segment and repository",()=>{
 const root=[
  scoped("apps/backend","read_file"),
  scoped("apps/backend","update_file"),
  scoped("apps/frontend","read_file"),
  scoped("apps/frontend","update_file"),
  scoped("packages/shared","read_file"),
  scoped("packages/shared","update_file"),
  scoped("tests/backend","read_file"),
  scoped("tests/backend","update_file"),
  scoped("tests/frontend","read_file"),
  scoped("tests/frontend","update_file")
 ];
 assert.equal(audit({rootPermissions:root}).missing_operation_pairs,0);
 const foreign=root.map(x=>({...x,resource:x.resource.replace(
  "feature%2Faccount-suspension","feature%2Fforeign")}));
 assert.equal(audit({rootPermissions:foreign}).covered_operation_pairs,0);
 const foreignRepo=root.map(x=>({...x,resource:x.resource.replace(
  "thesis/iam-console-poc","foreign/iam-console-poc")}));
 assert.equal(audit({rootPermissions:foreignRepo}).covered_operation_pairs,0);
 const wrongOps=root.map(x=>({...x,operation:"create_file"}));
 assert.equal(audit({rootPermissions:wrongOps}).covered_operation_pairs,0);
});

test("R384.4 owner-only audit never converts a test fixture into approval or accepts foreign scenario",()=>{
 for(const args of [
  {rootPermissions:[]},
  {rootPermissions:fullRoot,repository:"gitea://other/thesis/iam-console-poc"},
  {rootPermissions:fullRoot,branch:"main"},
  {rootPermissions:fullRoot,branch:"feature/another"},
  {rootPermissions:[{resource:base,operation:42}]},
  {rootPermissions:Array.from({length:257},()=>file(sourcePaths[0],"update_file"))}
 ]){
  assert.throws(()=>audit(args),/preflight NO-GO/u);
 }
});
