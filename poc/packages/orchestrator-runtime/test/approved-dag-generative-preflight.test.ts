import test from "node:test";
import assert from "node:assert/strict";
import {compilePlanningProposal} from
  "../src/trusted-adk-planner.ts";
import {assertApprovedPlanScope,makeApproval} from
  "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {preflightApprovedPilotDag} from
  "../../../apps/gateway/native-test/approved-dag-preflight.mjs";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension";
const snapshot={
  repository:repo,session_id:"matrix-session",base_revision:"a".repeat(40),
  directories:["","apps","apps/backend","apps/frontend","tests"],
  files:[
    ...Array.from({length:3},(_,i)=>"apps/backend/service-"+i+".ts"),
    ...Array.from({length:2},(_,i)=>"apps/frontend/view-"+i+".tsx"),
    ...Array.from({length:4},(_,i)=>"tests/existing-"+i+".test.ts")
  ]
};
const agents=Object.fromEntries(["backend","frontend","test"].map(role=>
  [role,{did:"did:thesis:"+role,card_ref:"trusted:"+role}]));
const perm=(operation:string,path:string|null)=>({
  operation,path,reason:"Signed scenario permission"
});
type Shape={b:number;f:number;t:number;edits:number;
  mode:"create"|"update"|"mixed";early:boolean};
function makeDraft(shape:Shape){
  const tasks:any[]=[{id:"branch",agent_id:"orchestrator",
    title:"Prepare",description:"Create approved branch",depends_on:[],
    permissions:[perm("create_branch",null)]}];
  const bIds:string[]=[],fIds:string[]=[],testIds:string[]=[];
  for(let i=0;i<shape.b;i++){
    const id="backend-"+i,path="apps/backend/service-"+i+".ts";
    tasks.push({id,agent_id:"backend",title:"Backend "+i,
      description:"Change backend file",depends_on:[bIds.at(-1)??"branch"],
      permissions:[perm("read_file",path),perm("update_file",path)]});
    bIds.push(id);
  }
  for(let i=0;i<shape.f;i++){
    const id="frontend-"+i,path="apps/frontend/view-"+i+".tsx";
    tasks.push({id,agent_id:"frontend",title:"Frontend "+i,
      description:"Change frontend file",depends_on:[fIds.at(-1)??"branch"],
      permissions:[perm("read_file",path),perm("update_file",path)]});
    fIds.push(id);
  }
  const edits=Array.from({length:shape.t},()=>[] as any[]);
  for(let i=0;i<shape.edits;i++){
    const at=i<shape.t-1?i:i%shape.t;
    const creation=shape.mode==="create"||
      (shape.mode==="mixed"&&i%2===0);
    const path=creation?"tests/new-"+i+".test.ts":
      "tests/existing-"+i+".test.ts";
    edits[at].push(...(creation?[perm("create_file",path)]:
      [perm("read_file",path),perm("update_file",path)]));
  }
  for(let i=0;i<shape.t;i++){
    const id="test-"+i,last=i===shape.t-1;
    const deps=i===0?["branch"]:[testIds.at(-1)];
    if(!shape.early||last)
      for(const dep of [...bIds,...fIds])
        if(!deps.includes(dep))deps.push(dep);
    tasks.push({id,agent_id:"test",title:"Test "+i,
      description:last?"Controlled Docker acceptance":"Prepare regression",
      depends_on:deps,permissions:[...edits[i],
        ...(last?[perm("run_tests",null)]:[])]});
    testIds.push(id);
  }
  tasks.push({id:"pr",agent_id:"orchestrator",title:"Reviewed PR",
    description:"Only tested feature SHA",
    depends_on:[testIds.at(-1)],
    permissions:[perm("create_pull_request",null)]});
  return tasks;
}
function fullReview(tasks:any[]){
  const proposed=compilePlanningProposal({tasks,
    assumptions:[],uncertainties:[]},{
    snapshot,requirement:"Implement feature and regression coverage",
    planId:"generative-preflight",workBranch:branch,agents
  });
  const approved_by="did:thesis:engineer";
  const approval=makeApproval(proposed.plan,{
    allowedOperations:new Set(RUST_OPERATIONS),decision_id:"matrix-review",
    approved_by,approved_at:"2026-10-28T08:00:00Z",
    approved_permission_ids:proposed.plan.requested_permissions.map(p=>p.id)
  });
  const grants=assertApprovedPlanScope(proposed.plan,approval,{
    allowedOperations:new Set(RUST_OPERATIONS),expectedEngineerDid:approved_by
  });
  return preflightApprovedPilotDag({plan:proposed.plan,grants,repo,branch});
}
test("216 deterministic diverse Planner → approval → pilot preflight cases",()=>{
  let checked=0,zeroEdits=0,multiTest=0;
  for(let b=1;b<=3;b++)for(let f=1;f<=2;f++)
    for(let t=1;t<=3;t++)for(let e=0;e<4;e++)
      for(const mode of ["create","update","mixed"] as const){
        const edits=Math.max(t-1,e);
        const shape:Shape={b,f,t,edits,mode,early:checked%2===0};
        const got=fullReview(makeDraft(shape));
        assert.equal(got.approvedTaskCount,2+b+f+t);
        assert.equal(got.taskIdsByRole.backend.length,b);
        assert.equal(got.taskIdsByRole.frontend.length,f);
        assert.equal(got.taskIdsByRole.test.length,t);
        assert.equal(got.expectedTestWriteKeys.size,edits);
        if(edits===0)zeroEdits++;
        if(t>1)multiTest++;
        checked++;
      }
  assert.equal(checked,216);
  assert.ok(zeroEdits>0&&multiTest>0);
});
test("Read-only specialist is valid in a signed dynamic DAG",()=>{
  const draft=makeDraft({b:2,f:1,t:2,edits:2,mode:"mixed",early:true});
  const prep=draft.find(x=>x.id==="test-0");
  prep.permissions=[perm("read_file","tests/existing-0.test.ts")];
  const shape=fullReview(draft);
  assert.equal(shape.taskIdsByRole.test.length,2);
  assert.equal(shape.runnerTaskId,"test-1");
});

test("Signed sequential Backend and Test edits may target the same resource",()=>{
  const draft=makeDraft({b:1,f:1,t:2,edits:1,mode:"update",early:false});
  const testPrep=draft.find(t=>t.id==="test-0");
  testPrep.permissions=[
    perm("read_file","apps/backend/service-0.ts"),
    perm("update_file","apps/backend/service-0.ts")
  ];
  const accepted=fullReview(draft);
  assert.equal(accepted.taskIdsByRole.backend.length,1);
  assert.equal(accepted.taskIdsByRole.test.length,2);
  assert.deepEqual(accepted.updatedTestFiles,["apps/backend/service-0.ts"]);
  assert.equal(accepted.expectedTestWriteKeys.size,1);
});

test("Mutation suite rejects unsafe DAGs without any billed model",()=>{
  const base:Shape={b:2,f:2,t:2,edits:2,mode:"mixed",early:true};
  const mutations:Array<[string,(tasks:any[])=>void,RegExp]>=[
    ["unverified final test",ts=>{
      ts.find(t=>t.id==="test-1").depends_on=["test-0"];
    },/Runner must follow/u],
    ["PR before Runner",ts=>{
      ts.find(t=>t.id==="pr").depends_on=["branch"];
    },/PR must depend/u],
    ["missing same-Task read",ts=>{
      ts.find(t=>t.id==="backend-1").permissions=[
        perm("update_file","apps/backend/service-1.ts")];
    },/same-Task read/u],
    ["independent writes collide",ts=>{
      ts.find(t=>t.id==="frontend-0").permissions=[
        perm("read_file","apps/backend/service-0.ts"),
        perm("update_file","apps/backend/service-0.ts")];
    },/independent Tasks cannot modify|unordered or overlapping/u],
    ["no final Runner",ts=>{
      ts.find(t=>t.id==="test-1").permissions=[
        perm("create_file","tests/new-3.test.ts")];
    },/expected one test run_tests/u]
  ];
  for(const [name,mutate,pattern] of mutations){
    const draft=makeDraft(base);mutate(draft);
    assert.throws(()=>fullReview(draft),pattern,name);
  }
});
