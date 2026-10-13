import assert from "node:assert/strict";
import test from "node:test";
import {checkAccountSuspensionPreflight} from "../src/account-suspension-preflight.ts";

const conforming={
  backendRoutes:[
    'const router=Router();',
    'router.post("/:id/suspend", controller.suspendUser);',
    'router.post("/:id/reactivate", controller.reactivateUser);'
  ].join("\n"),
  frontendApi:[
    'fetch(`/api/users/${encodeURIComponent(id)}/suspend`, {method:"POST"});',
    'fetch(`/api/users/${encodeURIComponent(id)}/reactivate`, {method:"POST"});'
  ].join("\n"),
  frontendPage:[
    '<button aria-label="Suspend account">Suspend account</button>',
    '<button aria-label="Reactivate account">Reactivate account</button>'
  ].join("\n")
};

test("preflight allows the agreed delegated IAM lifecycle interface",()=>{
  assert.deepEqual(checkAccountSuspensionPreflight(conforming),{
    ok:true,failures:[]
  });
});

test("preflight catches real Gemini run-2 Backend vs Frontend drift",()=>{
  const oldBackend={
    ...conforming,
    backendRoutes:conforming.backendRoutes.replace(
      '/:id/reactivate','/:id/unsuspend')
  };
  const result=checkAccountSuspensionPreflight(oldBackend);
  assert.equal(result.ok,false);
  assert.ok(result.failures.includes("backend_missing_post_/:id/reactivate"));
});

test("preflight catches the generated user-vs-account accessible labels",()=>{
  const mismatch={
    ...conforming,
    frontendPage:conforming.frontendPage.replaceAll(
      "Suspend account","Suspend user").replaceAll(
      "Reactivate account","Reactivate user")
  };
  const result=checkAccountSuspensionPreflight(mismatch);
  assert.equal(result.ok,false);
  assert.deepEqual(result.failures,[
    "frontend_missing_accessible_suspend_account_action",
    "frontend_missing_accessible_reactivate_account_action"
  ]);
});

test("preflight rejects missing frontend API routes, not only backend routes",()=>{
  const mismatch={
    ...conforming,
    frontendApi:conforming.frontendApi.replace(
      '/reactivate','/unsuspend')
  };
  const result=checkAccountSuspensionPreflight(mismatch);
  assert.equal(result.ok,false);
  assert.ok(result.failures.includes("frontend_missing_/reactivate_api_call"));
});
