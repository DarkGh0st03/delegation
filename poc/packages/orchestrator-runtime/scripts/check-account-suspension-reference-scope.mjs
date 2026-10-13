/**
 * Offline precondition for the full Account Suspension agentic positive E2E.
 * This is a scope/fixture contract check, not a Runner or Gemini E2E.
 * It intentionally does NOT expand any role delegation template.
 */
import assert from "node:assert/strict";
import {
  DELEGATION_TEMPLATES,ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY,
  POC_REPOSITORY
} from "../src/permission-templates.ts";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES as files}
  from "../../../apps/test-runner-controller/fixtures/account-suspension-reference.mjs";

const planned={
  backend:{
    update_file:[
      "packages/shared/src/account-status.ts",
      "apps/backend/src/users/user.service.ts",
      "apps/backend/src/users/user.controller.ts",
      "apps/backend/src/users/user.routes.ts"
    ]
  },
  frontend:{
    update_file:[
      "apps/frontend/src/api/users-api.ts",
      "apps/frontend/src/pages/UserDetailPage.tsx",
      "apps/frontend/src/styles.css"
    ]
  },
  test:{
    update_file:[
      "tests/backend/user.service.test.ts",
      "tests/backend/user.routes.test.ts",
      "tests/frontend/UserDetailPage.test.tsx"
    ],
    create_file:["tests/e2e/account-suspension.spec.ts"]
  }
};
const branchUri="gitea://"+POC_REPOSITORY.authority+"/"+
  encodeURIComponent(POC_REPOSITORY.owner)+"/"+
  encodeURIComponent(POC_REPOSITORY.repository)+
  "/branches/"+encodeURIComponent(POC_REPOSITORY.branch);
const uri=path=>branchUri+"/files/"+
  path.split("/").map(encodeURIComponent).join("/");
const expectedPaths=Object.values(planned).flatMap(perOp=>
  Object.values(perOp).flat());
assert.equal(expectedPaths.length,11);
assert.equal(new Set(expectedPaths).size,11);
assert.deepEqual(new Set(expectedPaths),new Set(Object.keys(files)),
  "Reference file manifest differs from fixed role responsibility");
const root=new Set(ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY.map(
  x=>x.operation+"\u0000"+x.resource));
let verified=0;
for(const role of ["backend","frontend","test"]){
  const actual=DELEGATION_TEMPLATES[role];
  const granted=new Set(actual.map(x=>x.operation+"\u0000"+x.resource));
  const plannedWrite=Object.entries(planned[role]).flatMap(
    ([operation,paths])=>paths.map(path=>operation+"\u0000"+uri(path)));
  const allowedWrite=actual.filter(x=>
    x.operation==="update_file"||x.operation==="create_file")
    .map(x=>x.operation+"\u0000"+x.resource);
  assert.deepEqual(new Set(allowedWrite),new Set(plannedWrite),
    role+" delegated write scope differs from the pinned 11-file plan");
  for(const [op,paths] of Object.entries(planned[role])){
    for(const path of paths){
      assert.ok(typeof files[path]==="string"&&files[path].length>0);
      assert.ok(!path.startsWith("/")&&!path.includes("..")&&
        !path.includes("\\\\"),"Invalid fixture file path");
      assert.ok(granted.has(op+"\u0000"+uri(path)),
        role+" lacks precise delegated permission for "+path);
      if(op==="update_file"){
        assert.ok(granted.has("read_file\u0000"+uri(path)),
          role+" must be able to read before update "+path);
      }
      assert.ok(root.has(op+"\u0000"+uri(path)),
        "Root authority must contain the exact child permission");
      for(const other of ["backend","frontend","test"].filter(r=>r!==role)){
        assert.ok(!DELEGATION_TEMPLATES[other].some(x=>
          x.operation===op&&x.resource===uri(path)),
          "Cross-role write authority for "+path);
      }
      verified++;
    }
  }
  assert.equal(granted.has("run_tests\u0000"+branchUri),role==="test",
    "Only Test may run the fixed controlled Runner");
}
assert.equal(verified,11);
process.stdout.write(JSON.stringify({
  event:"account_suspension_reference_exact_dc_scope",
  status:"PASS",files:verified,role_file_count:{backend:4,frontend:3,test:4},
  policy_changed:false,external_models:false
})+"\n");
