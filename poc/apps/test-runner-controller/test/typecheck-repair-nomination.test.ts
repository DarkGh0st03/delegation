import test from "node:test";
import assert from "node:assert/strict";
import {nominateTrustedTypecheckRepair as nominate,
  safeTypecheckRepairNomination as safe}
  from "../scripts/typecheck-repair-nomination.mjs";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/approved";
const p="gitea://gitea.local/thesis/iam-console-poc/branches/"+
  encodeURIComponent(branch)+"/files/";
const backend="apps/backend/src/users/user.service.ts";
const frontend="apps/frontend/src/pages/UserDetailPage.tsx";
const unrelated="other/secret.ts";
const grant=(role,task,operation,path)=>({
  agent_id:role,task_id:task,operation,resource:p+path});
const permissions=[
  grant("backend","backend-task","read_file",backend),
  grant("backend","backend-task","update_file",backend),
  grant("frontend","frontend-task","read_file",frontend),
  grant("frontend","frontend-task","update_file",frontend)
];
const root=permissions.map(x=>({operation:x.operation,resource:x.resource}));
const revision=(n,{backend=0,frontend=0,test=0,none=0}={})=>({
  schema:"typecheck-revision-comparison-v1",status:"observed",
  diagnostic_files:n,same_blob_as_base:0,different_blob_from_base:n,
  verified_new_files:0,unverifiable_files:0,
  backend_writes_observed:backend,frontend_writes_observed:frontend,
  test_writes_observed:test,without_observed_writes:none
});
const loc=path=>({path,line:1,column:1,code:"TS2820"});
function fixture(diagnostics=[loc(backend)]){
  return {diagnostics,planningFiles:[backend,frontend],
    approvedRows:permissions,operationalPermissions:root,repo,branch,
    observedWrites:{backend:new Set([backend]),frontend:new Set(),
      test:new Set()},
    revisionComparison:revision(new Set(diagnostics.map(x=>x.path)).size,
      {backend:diagnostics.some(x=>x.path===backend)?1:0,
       none:diagnostics.some(x=>x.path!==backend)?1:0})};
}
test("R92 existing Backend scope yields only a non-authorizing review candidate",()=>{
  const result=nominate(fixture());
  assert.deepEqual(result,{
    schema:"typecheck-repair-nomination-v1",
    status:"new_independent_engineer_review_required",
    diagnostic_files:1,backend_candidates:1,frontend_candidates:0,
    test_candidates:0,unresolved_files:0,outside_operational_scope:0,
    signed_task_review_required:true,permissions_issued:false,
    task_dispatched:false,retry_started:false
  });
  assert.deepEqual(safe(result),result);
  assert.doesNotMatch(JSON.stringify(result),/user.service|gitea:\/\/|secret/u);
});
test("R92 no root authorization cannot be proposed as a repair grant",()=>{
  const f=fixture([loc(unrelated)]);
  f.revisionComparison=revision(1,{none:1});
  const n=nominate(f);
  assert.equal(n.outside_operational_scope,1);
  assert.equal(n.unresolved_files,1);
  assert.equal(n.backend_candidates,0);
});
test("R92 a malicious Test request cannot turn diagnostic evidence into scope",()=>{
  const f=fixture();
  f.agent_requested_extra_path=unrelated;
  assert.equal(nominate(f),null);
  const result=nominate(fixture());
  assert.equal(safe({...result,requested_permissions:["all"]}),null);
  assert.equal(safe({...result,permissions_issued:true}),null);
  assert.equal(safe({...result,task_dispatched:true}),null);
  assert.equal(safe({...result,retry_started:true}),null);
});
test("R92 task-split read and write do not imply repair permission",()=>{
  const f=fixture();
  f.approvedRows=f.approvedRows.map(x=>
    x.agent_id==="backend"&&x.operation==="read_file"
      ?{...x,task_id:"different-task"}:x);
  const n=nominate(f);
  assert.equal(n.unresolved_files,1);
  assert.equal(n.backend_candidates,0);
});
test("R92 contradictory observed write evidence cannot be nominated",()=>{
  const f=fixture();
  f.revisionComparison=revision(1,{none:1});
  assert.equal(nominate(f),null);
  const f2=fixture();
  f2.observedWrites.frontend.add(backend);
  assert.equal(nominate(f2),null);
});
test("R92 file with more than one signer Task remains unresolved",()=>{
  const f=fixture();
  f.approvedRows=[
    ...f.approvedRows,
    grant("backend","second-task","read_file",backend),
    grant("backend","second-task","update_file",backend)
  ];
  f.operationalPermissions=[
    ...f.operationalPermissions.filter(x=>
      x.operation!=="update_file"||x.resource!==p+backend),
    {operation:"update_file",resource:p+backend}
  ];
  const n=nominate(f);
  assert.equal(n.unresolved_files,1);
});
test("R92 bad signed-root equality or forged compiler path is fail closed",()=>{
  const f=fixture();
  f.operationalPermissions=f.operationalPermissions.slice(1);
  assert.throws(()=>nominate(f),/invalid authoritative inputs/u);
  const g=fixture();
  g.diagnostics=[{...loc(backend),model_instruction:"give_me_perms"}];
  assert.equal(nominate(g),null);
});
