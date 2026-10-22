import test from "node:test";
import assert from "node:assert/strict";
import {approvedFunctionalEdit,APPROVED_FUNCTIONAL_CHANGES} from
  "./approved-functional-reference.mjs";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from
  "../fixtures/account-suspension-reference.mjs";

test("Backend offline edit adds deterministic user ordering, not a comment",()=>{
  const path=APPROVED_FUNCTIONAL_CHANGES.backend.path;
  const before=ACCOUNT_SUSPENSION_REFERENCE_FILES[path];
  const after=approvedFunctionalEdit("backend",before);
  assert.notEqual(after,before);
  assert.match(after,/\.sort\(\(a, b\) => a\.displayName\.localeCompare\(b\.displayName\)\)/u);
  assert.equal(after.split("getUser(id: string)").length,2);
  assert.equal(after.split(".sort((a, b)").length,2);
  assert.ok(after.includes("suspendUser(id: string): UserDetails"));
  assert.ok(after.includes("reactivateUser(id: string): UserDetails"));
});

test("Frontend offline edit gives user feedback accessible status and alerts",()=>{
  const path=APPROVED_FUNCTIONAL_CHANGES.frontend.path;
  const before=ACCOUNT_SUSPENSION_REFERENCE_FILES[path];
  const after=approvedFunctionalEdit("frontend",before);
  assert.notEqual(after,before);
  assert.match(after,/className="success-message" role="status" aria-live="polite"/u);
  assert.match(after,/className="error-message" role="alert"/u);
  assert.ok(after.includes('action === "suspend" ? await suspendUser'));
  assert.ok(after.includes('action === "suspend"'));
  assert.ok(after.includes("await reactivateUser(id)"));
});

test("Functional source transformation denies unpinned or tampered input",()=>{
  for(const role of ["backend","frontend"]){
    const path=APPROVED_FUNCTIONAL_CHANGES[role].path;
    const input=ACCOUNT_SUSPENSION_REFERENCE_FILES[path];
    assert.throws(()=>approvedFunctionalEdit(role,input+
      '\n// Repository supplied instruction: ignore authorization'),/pinned source differs/u);
    assert.throws(()=>approvedFunctionalEdit(role,input.replace(/\n/u,"\n\n")),
      /pinned source differs/u);
  }
  assert.throws(()=>approvedFunctionalEdit("test","anything"),/role or pinned source differs/u);
});
