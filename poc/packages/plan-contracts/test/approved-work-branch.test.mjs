import test from "node:test";
import assert from "node:assert/strict";
import {approvedWorkBranch,LEGACY_APPROVED_BRANCH} from
  "../src/approved-work-branch.mjs";
const root="gitea://gitea.local/thesis/iam-console-poc";
function plan(resources){
  return {repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"},
    requested_permissions:resources.map((resource,i)=>({id:"p"+i,resource}))};
}
test("all signed permission rows agree on a single canonical feature branch",()=>{
  const branch="feature/engineer-approved-42";
  const uri=root+"/branches/"+encodeURIComponent(branch);
  assert.equal(approvedWorkBranch(plan([
    root,uri+"/files/apps/backend/user.ts",uri
  ])),branch);
});
test("root-only historical plans remain restricted to the legacy branch",()=>{
  assert.equal(approvedWorkBranch(plan([root])),LEGACY_APPROVED_BRANCH);
});
test("no unapproved or ambiguous branch can slip through signed scope",()=>{
  const valid=root+"/branches/feature%2Fsafe/files/a.ts";
  for(const evil of [
    root+"/branches/main/files/a.ts",
    root+"/branches/feature%2F..%2Fevil/files/a.ts",
    root+"/branches/feature%2Fdouble%2F%2Fslash/files/a.ts",
    root+"/branches/feature%2Fbad.lock/files/a.ts",
    root+"/branches/feature%2fbad/files/a.ts",
    "gitea://external/attacker/repo/branches/feature%2Fsafe/files/a.ts"
  ])assert.throws(()=>approvedWorkBranch(plan([valid,evil])),/Approved branch:/);
  assert.throws(()=>approvedWorkBranch(plan([
    valid,root+"/branches/feature%2Fother/files/a.ts"
  ])),/multiple working branches/);
});
