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
test("R151.22.1 signed repository owner and name use Gateway-compatible URI encoding",()=>{
 const branch="feature/engineer-approved-42";
 for(const [owner,repository,authority] of [
  ["sample+east","invoice-service","gitea.local"],
  ["sample","invoice+service","GITEA.LOCAL"],
  ["team/east","invoice-service","gitea.local"]
 ]){
  const repositoryRoot="gitea://gitea.local/"+
    encodeURIComponent(owner)+"/"+encodeURIComponent(repository);
  const scoped=repositoryRoot+"/branches/"+encodeURIComponent(branch);
  const signed={
   repository:{authority,owner,repository},
   requested_permissions:[
    {id:"create-branch",resource:repositoryRoot},
    {id:"read-source",resource:scoped+"/files/src/invoice.ts"}
   ]
  };
  assert.equal(approvedWorkBranch(signed),branch);
  assert.throws(()=>approvedWorkBranch({
   ...signed,requested_permissions:[{id:"forged",resource:
    "gitea://gitea.local/"+owner+"/"+repository+
    "/branches/"+encodeURIComponent(branch)+"/files/src/invoice.ts"}]
  }),/Approved branch: external repository/);
 }
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
