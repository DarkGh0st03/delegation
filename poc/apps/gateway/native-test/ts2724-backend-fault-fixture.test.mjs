import test from "node:test";
import assert from "node:assert/strict";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES}
  from "../../test-runner-controller/fixtures/account-suspension-reference.mjs";
import {TS2724_BACKEND_IMPORT_FAULT,injectTs2724BackendImportFault,
  repairTs2724BackendImportFault} from "./ts2724-backend-fault-fixture.mjs";
const source=ACCOUNT_SUSPENSION_REFERENCE_FILES["apps/backend/src/users/user.service.ts"];
test("TS2724 fixture adds exactly one misspelled import to an existing Backend source",()=>{
  assert.match(ACCOUNT_SUSPENSION_REFERENCE_FILES["packages/shared/src/account-status.ts"],
    /ACCOUNT_STATUS\s*=/u);
  assert.ok(!source.includes("ACCOUNT_STATU }"));
  const failed=injectTs2724BackendImportFault(source);
  assert.ok(failed.endsWith(TS2724_BACKEND_IMPORT_FAULT));
  assert.equal(failed.slice(0,-TS2724_BACKEND_IMPORT_FAULT.length),source);
  assert.equal(repairTs2724BackendImportFault(failed),source.endsWith("\n")
    ?source+"\n":source+"\n");
  assert.throws(()=>injectTs2724BackendImportFault(failed),/NO-GO/u);
  assert.throws(()=>repairTs2724BackendImportFault(source),/NO-GO/u);
  assert.throws(()=>repairTs2724BackendImportFault(
    failed+TS2724_BACKEND_IMPORT_FAULT),/NO-GO/u);
});
test("TS2724 fixture is a source-only operation, not a grant or runtime credential",()=>{
  assert.equal(typeof injectTs2724BackendImportFault,"function");
  assert.match(TS2724_BACKEND_IMPORT_FAULT,/ACCOUNT_STATU/u);
  assert.doesNotMatch(TS2724_BACKEND_IMPORT_FAULT,/credential|permission|signed_vp|did:/iu);
});
