import test from "node:test";
import assert from "node:assert/strict";
import {compilePlanningProposal}
  from "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {makeApproval,assertApprovedPlanScope}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {buildOfflineAdkScriptsFromApprovedPlan}
  from "./approved-plan-offline-adk-call-scripts.mjs";
// Share the existing nonbillable planner test gate with the source-derived
// route compiler; no additional CI permissions or provider calls.
import "./source-derived-route-offline-adk-model.test.mjs";

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
function planned({alternate=false,priorTestWrite=false}={}){
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
  if(priorTestWrite){
    if(!alternate)throw Error("Two signed Test Tasks require alternate fixture");
    tasks.splice(2,0,{
      id:"prepare-regression",agent_id:"test",title:"Prepare test",
      description:"First signed Test Task edits existing regression",
      depends_on:["accessible-list"],
      permissions:[
        {operation:"read_file",path:"tests/accessibility.test.tsx",
          reason:"Read earlier approved regression"},
        {operation:"update_file",path:"tests/accessibility.test.tsx",
          reason:"First authorized Test edit"}
      ]
    });
    tasks.find(t=>t.id==="checks").depends_on=["prepare-regression"];
  }
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

test("Block B: source-derived mode omits complete golden code for approved writable path",()=>{
  for(const alternate of [false,true]){
    const d=planned({alternate});
    const selected=alternate?"apps/frontend/settings.tsx":"apps/backend/user.ts";
    const implementations={...content};
    delete implementations[selected];
    const scripts=buildOfflineAdkScriptsFromApprovedPlan({
      plan:d.plan,approvedRows:d.approvedRows,repo,branch:d.workBranch,
      implementationContents:implementations,sourceDerivedPaths:[selected]
    });
    const role=alternate?"frontend":"backend";
    const update=scripts[role].find(c=>c.name==="update_file"&&
      c.args.path===selected);
    assert.ok(update);
    assert.deepEqual(Object.keys(update.args).sort(),["branch","path"]);
    assert.equal(JSON.stringify(scripts).includes(content[selected]),false);
    assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
      plan:d.plan,approvedRows:d.approvedRows,repo,branch:d.workBranch,
      implementationContents:content,sourceDerivedPaths:[selected]
    }),/NO-GO/,"golden bytes must not enter source-derived model calls");
    assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
      plan:d.plan,approvedRows:d.approvedRows,repo,branch:d.workBranch,
      implementationContents:implementations,
      sourceDerivedPaths:["src/not-in-approved-plan.ts"]
    }),/NO-GO/);
  }
});

test("Signed Test recovery script: real failure must precede a same-task approved repair and final test",()=>{
  const d=planned({alternate:true});
  const path="tests/accessibility.test.tsx";
  const failedContent=content[path]+"\nthrow new Error('offline forced regression');\n";
  const scripts=buildOfflineAdkScriptsFromApprovedPlan({
    plan:d.plan,approvedRows:d.approvedRows,repo,branch:d.workBranch,
    implementationContents:content,recoveryFixture:{path,failedContent}
  });
  assert.deepEqual(scripts.test.map(x=>x.name),[
    "read_file","update_file","run_tests",
    "read_file","update_file","run_tests"
  ]);
  assert.equal(scripts.test[1].args.content,failedContent);
  assert.equal(scripts.test[4].args.content,content[path]);
  assert.deepEqual(scripts.test[2].args,scripts.test[5].args);
  assert.equal(Object.isFrozen(scripts.test[4].args),true);
  assert.equal(scripts.frontend[1].args.content,content["apps/frontend/settings.tsx"]);
});
test("Signed Test recovery cannot add missing authority or pass fixture content as authorization",()=>{
  const d=planned({alternate:true});
  const input={plan:d.plan,approvedRows:d.approvedRows,repo,branch:d.workBranch,
    implementationContents:content};
  const path="tests/accessibility.test.tsx";
  const recoveryFixture={path,failedContent:content[path]+"\nthrow Error('regression');"};
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,recoveryFixture:{path:"apps/frontend/settings.tsx",
      failedContent:"unexpected"}
  }),/NO-GO/u,"Frontend permission is not a Test repair grant");
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,recoveryFixture:{path,failedContent:content[path]}
  }),/NO-GO/u,"The initial test must actually change content");
  const withoutWrite=d.approvedRows.filter(x=>
    !(x.agent_id==="test"&&x.operation==="update_file"));
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,approvedRows:withoutWrite,recoveryFixture
  }),/NO-GO/u,"A read grant cannot imply update authority");
  const withoutRead=d.approvedRows.filter(x=>
    !(x.agent_id==="test"&&x.operation==="read_file"));
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,approvedRows:withoutRead,recoveryFixture
  }),/NO-GO/u,"A write grant cannot imply read authority");
  const withoutRunner=d.approvedRows.filter(x=>
    !(x.agent_id==="test"&&x.operation==="run_tests"));
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,approvedRows:withoutRunner,recoveryFixture
  }),/NO-GO/u,"No retry without a signed runner operation");
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,recoveryFixture,sourceDerivedPaths:[path],
    implementationContents:Object.fromEntries(Object.entries(content)
      .filter(([p])=>p!==path))
  }),/NO-GO/u,"Golden payload cannot be smuggled through source-derived mode");
  const separate=planned();
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    plan:separate.plan,approvedRows:separate.approvedRows,repo,
    branch:separate.workBranch,implementationContents:content,recoveryFixture
  }),/NO-GO/u,"Test Task may only create tests when no read/update was approved");
});

test("Signed recovery selects the final Runner Task's write after an earlier Test Task edited the SAME file",()=>{
  const d=planned({alternate:true,priorTestWrite:true});
  const path="tests/accessibility.test.tsx";
  const failedContent=content[path]+"\nthrow Error('offline regression');";
  const input={plan:d.plan,approvedRows:d.approvedRows,
    repo,branch:d.workBranch,implementationContents:content,
    recoveryFixture:{path,failedContent}};
  const scripts=buildOfflineAdkScriptsFromApprovedPlan(input);
  assert.deepEqual(scripts.test.map(c=>c.name),[
    "read_file","update_file",
    "read_file","update_file","run_tests",
    "read_file","update_file","run_tests"
  ]);
  assert.equal(scripts.test[1].args.content,content[path]);
  assert.equal(scripts.test[3].args.content,failedContent);
  assert.equal(scripts.test[6].args.content,content[path]);
  assert.deepEqual(scripts.test[4].args,scripts.test[7].args);
  assert.ok(Object.isFrozen(scripts.test[6].args));
  const finalNoRepair=d.approvedRows.filter(g=>
    !(g.task_id==="checks"&&g.operation==="update_file"));
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,approvedRows:finalNoRepair
  }),/NO-GO/u,"Prior Task grant cannot be borrowed for later recovery");
  const finalNoRead=d.approvedRows.filter(g=>
    !(g.task_id==="checks"&&g.operation==="read_file"));
  assert.throws(()=>buildOfflineAdkScriptsFromApprovedPlan({
    ...input,approvedRows:finalNoRead
  }),/NO-GO/u,"The final Task needs its own source read grant");
});
