import test from "node:test";
import assert from "node:assert/strict";
import {auditTrustedTypecheckPermissionScope as audit,
  safeTypecheckPermissionScopeAudit as safe}
  from "../scripts/typecheck-permission-scope-audit.mjs";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/native-planning-read";
const prefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
  encodeURIComponent(branch)+"/files/";
const backend="apps/backend/src/users/user.service.ts";
const frontend="apps/frontend/src/pages/UserDetailPage.tsx";
const testFile="tests/frontend/Example.test.tsx";
const extra="other/not-discovered.ts";
const row=(role,op,path)=>({agent_id:role,task_id:role+"-task",
  operation:op,resource:prefix+path});
const rows=[row("backend","update_file",backend),
  row("frontend","update_file",frontend),row("test","update_file",testFile)];
const root=rows.map(r=>({operation:r.operation,resource:r.resource}));
const loc=(path,line=1)=>({path,line,column:1,code:"TS2820"});
const input=(diagnostics,selected=rows,permissions=root)=>({
  diagnostics,planningFiles:[backend,frontend,testFile],
  approvedRows:selected,operationalPermissions:permissions,repo,branch
});
test("R81 distinguish root coverage and the missing signed Test Task grant",()=>{
  const r=audit(input([loc(backend),loc(frontend)]));
  assert.deepEqual(r,{
    schema:"typecheck-permission-scope-v1",status:"observed",
    location_count:2,distinct_file_count:2,outside_planning_snapshot:0,
    outside_signed_plan_write:0,outside_operational_root_write:0,
    within_operational_root_write:2,within_test_task_write:0,
    root_write_but_test_write_missing:2,
    covered_by_backend_write:1,covered_by_frontend_write:1
  });
  assert.doesNotMatch(JSON.stringify(r),/UserDetailPage|user.service|gitea:\/\//u);
});
test("R81 distinguish discovery omission from Planner permission omission",()=>{
  const selected=[rows[0]],credential=root.slice(0,1);
  const r=audit(input([loc(backend),loc(testFile),loc(extra)],
    selected,credential));
  assert.equal(r.outside_planning_snapshot,1);
  assert.equal(r.outside_signed_plan_write,2);
  assert.equal(r.outside_operational_root_write,2);
  assert.equal(r.root_write_but_test_write_missing,1);
});
test("R81 deduplicate repeated compiler locations and recognize authorized Test edits",()=>{
  const repeated=audit(input([loc(backend),loc(backend,4)]));
  assert.equal(repeated.location_count,2);
  assert.equal(repeated.distinct_file_count,1);
  const authorized=audit(input([loc(testFile)]));
  assert.equal(authorized.within_test_task_write,1);
  assert.equal(authorized.root_write_but_test_write_missing,0);
});
test("R81 refuse unknown paths, forged source fields and mismatched parent DC",()=>{
  assert.equal(audit(input([])),null);
  assert.equal(audit(input([{...loc(backend),source:"SECRET"}])),null);
  assert.equal(audit(input([loc("../.env")])),null);
  assert.equal(audit(input(Array(9).fill(loc(backend)))),null);
  assert.throws(()=>audit(input([loc(backend)],rows,root.slice(1))),
    /invalid authoritative inputs/u);
  assert.throws(()=>audit(input([loc(backend)],rows,[...root,root[0]])),
    /invalid authoritative inputs/u);
});
test("R81 external log cannot inject private fields or contradictory audit counters",()=>{
  const r=audit(input([loc(backend)]));
  assert.deepEqual(safe(r),r);
  assert.equal(safe({...r,source_path:"PRIVATE"}),null);
  assert.equal(safe({...r,outside_operational_root_write:5}),null);
  assert.equal(safe({...r,root_write_but_test_write_missing:0}),null);
});
