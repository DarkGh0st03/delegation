import test from "node:test";
import assert from "node:assert/strict";
import {compilePlanningProposal}
  from "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {makeApproval,assertApprovedPlanScope}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {buildOfflineAdkScriptsFromApprovedPlan}
  from "./approved-plan-offline-adk-call-scripts.mjs";

const repo={authority:"gitea.local",owner:"thesis",repository:"proof"};
const sha="a".repeat(40),eng="did:thesis:engineer";
const snapshot={
  session_id:"multi-plan-e2e",repository:repo,base_revision:sha,
  directories:["","apps","apps/backend","apps/frontend","tests"],
  files:["apps/backend/user.ts","apps/frontend/list.tsx",
    "apps/frontend/settings.tsx","tests/accessibility.test.tsx"]
};
const agents=Object.fromEntries(["backend","frontend","test"].map(role=>
  [role,{did:"did:thesis:"+role,card_ref:"trusted:"+role}]));
const content={
  "apps/backend/user.ts":"export const authorizedSearch=true;",
  "apps/frontend/list.tsx":"export const List='search';",
  "apps/frontend/settings.tsx":"export const Settings='accessible';",
  "tests/search.spec.ts":"test('search',()=>{});",
  "tests/accessibility.test.tsx":"test('accessible',()=>{});"
};
const branch=(id="branch")=>({id,agent_id:"orchestrator",
  title:"Start branch",description:"Create approved feature branch",
  depends_on:[],permissions:[{operation:"create_branch",path:null,reason:"Isolate"}]});
const edit=(id,role,after,path)=>({
  id,agent_id:role,title:"Implement change",
  description:"Edit approved file",depends_on:[after],
  permissions:[
    {operation:"read_file",path,reason:"Inspect source"},
    {operation:"update_file",path,reason:"Implement"}
  ]
});
function planned({alternate=false}={}){
  const workBranch=alternate?"feature/accessibility":"feature/search";
  const tasks=alternate?[
    branch("prepare"),
    edit("accessible-list","frontend","prepare","apps/frontend/settings.tsx"),
    {id:"checks",agent_id:"test",title:"Regression tests",
      description:"Update existing test",depends_on:["accessible-list"],
      permissions:[
        {operation:"read_file",path:"tests/accessibility.test.tsx",reason:"Inspect"},
        {operation:"update_file",path:"tests/accessibility.test.tsx",reason:"Regress"},
        {operation:"run_tests",path:null,reason:"Acceptance"}]},
    {id:"review",agent_id:"orchestrator",title:"Request review",
      description:"PR",depends_on:["checks"],
      permissions:[{operation:"create_pull_request",path:null,reason:"Review"}]}
  ]:[
    branch(),
    edit("backend","backend","branch","apps/backend/user.ts"),
    edit("frontend","frontend","backend","apps/frontend/list.tsx"),
    {id:"checks",agent_id:"test",title:"Regression tests",
      description:"Create independent test",depends_on:["frontend"],
      permissions:[
        {operation:"create_file",path:"tests/search.spec.ts",reason:"Regress"},
        {operation:"run_tests",path:null,reason:"Acceptance"}]},
    {id:"review",agent_id:"orchestrator",title:"Request review",
      description:"PR",depends_on:["checks"],
      permissions:[{operation:"create_pull_request",path:null,reason:"Review"}]}
  ];
  const proposed=compilePlanningProposal({
    tasks,assumptions:[],uncertainties:[]
  },{
    snapshot,requirement:alternate?
      "Improve accessibility":"Implement authenticated account search",
    planId:alternate?"dynamic-accessibility":"dynamic-search",
    workBranch,agents
  });
  const plan=proposed.plan;
  const approval=makeApproval(plan,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"fixture-approval",approved_by:eng,
    approved_at:"2026-10-27T12:00:00Z",
    approved_permission_ids:plan.requested_permissions.map(x=>x.id)
  });
  const approvedRows=assertApprovedPlanScope(plan,approval,{
    allowedOperations:new Set(RUST_OPERATIONS),
    expectedEngineerDid:eng
  });
  return {plan,approval,approvedRows,workBranch};
}
test("Block B: same plan-based script builder accepts independent role sets, file choices and test methods",()=>{
  const a=planned(),b=planned({alternate:true});
  const x=buildOfflineAdkScriptsFromApprovedPlan({
    plan:a.plan,approvedRows:a.approvedRows,repo,branch:a.workBranch,
    implementationContents:content
  });
  const y=buildOfflineAdkScriptsFromApprovedPlan({
    plan:b.plan,approvedRows:b.approvedRows,repo,branch:b.workBranch,
    implementationContents:content
  });
  assert.deepEqual(x.backend.map(s=>s.name),["read_file","update_file"]);
  assert.deepEqual(x.frontend.map(s=>s.name),["read_file","update_file"]);
  assert.deepEqual(x.test.map(s=>s.name),["create_file","run_tests"]);
  assert.equal(x.backend[1].args.path,"apps/backend/user.ts");
  assert.equal(x.test[0].args.path,"tests/search.spec.ts");
  assert.deepEqual(y.backend,[]);
  assert.equal(y.frontend[1].args.path,"apps/frontend/settings.tsx");
  assert.deepEqual(y.test.map(s=>s.name),
    ["read_file","update_file","run_tests"]);
  assert.equal(y.test[1].args.path,"tests/accessibility.test.tsx");
  assert.ok(!JSON.stringify(x).includes("settings.tsx"));
  assert.ok(!JSON.stringify(y).includes("apps/backend/user.ts"));
  assert.equal(Object.isFrozen(x),true);
  assert.notDeepEqual(a.plan.tasks.map(t=>t.id),b.plan.tasks.map(t=>t.id));
});
test("Block B: an Engineer permission subset removes an offline action rather than silently restoring it",()=>{
  const d=planned();
  const without=d.approval.approved_permission_ids.filter(id=>
    !d.plan.requested_permissions.some(p=>p.id===id&&
      p.agent_id==="frontend"&&p.operation==="update_file"));
  const approval=makeApproval(d.plan,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"reduced-permissions",approved_by:eng,
    approved_at:"2026-10-27T12:00:00Z",approved_permission_ids:without
  });
  const rows=assertApprovedPlanScope(d.plan,approval,{
    allowedOperations:new Set(RUST_OPERATIONS),expectedEngineerDid:eng
  });
  const action=buildOfflineAdkScriptsFromApprovedPlan({
    plan:d.plan,approvedRows:rows,repo,branch:d.workBranch,
    implementationContents:content
  });
  assert.deepEqual(action.frontend.map(c=>c.name),["read_file"]);
  assert.equal(action.test.length,2);
  assert.ok(!action.frontend.some(c=>c.name==="update_file"));
});
test("Block B: wrong branch, missing payload and unapproved tools fail closed",()=>{
  const d=planned(),input={
    plan:d.plan,approvedRows:d.approvedRows,repo,branch:d.workBranch,
    implementationContents:content
  };
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,branch:"feature/another"
  }),/NO-GO/);
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,implementationContents:{"apps/frontend/list.tsx":"X"}
  }),/NO-GO/);
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,approvedRows:[...d.approvedRows,{
      ...d.approvedRows[1],id:"forged",operation:"delete_file"
    }]
  }),/NO-GO/);
});
