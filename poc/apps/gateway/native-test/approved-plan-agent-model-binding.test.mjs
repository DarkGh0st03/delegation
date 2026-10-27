import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {compilePlanningProposal}
  from "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {makeApproval,assertApprovedPlanScope}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {bindModelsToApprovedRoleTasks}
  from "./approved-plan-agent-model-binding.mjs";

const snapshot={
  session_id:"independent-approved-roles",base_revision:"b".repeat(40),
  repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
  files:["src/backend.ts","src/list.tsx","src/accessibility.tsx"],
  directories:["","src","tests"]
};
const agents=Object.fromEntries(["backend","frontend","test"].map(role=>[
  role,{did:"did:thesis:"+role,card_ref:"trusted:"+role}
]));
const task=(id,role,depends_on,permissions)=>({
  id,agent_id:role,title:"Generic task",description:"Approved task",
  depends_on,permissions
});
const file=(op,path)=>({operation:op,path,reason:"Exact approved operation"});
const branch=()=>task("branch","orchestrator",[],[file("create_branch",null)]);
const review=(dep)=>task("pr","orchestrator",[dep],[
  file("create_pull_request",null)
]);
const update=(id,role,dep,path)=>task(id,role,[dep],[
  file("read_file",path),file("update_file",path)
]);
const check=(dep)=>task("verify","test",[dep],[
  file("create_file","tests/change.spec.ts"),
  file("run_tests",null)
]);
function reviewed(alternate=false){
  const workBranch=alternate?"feature/access":"feature/search";
  const tasks=alternate?[
    branch(),update("access","frontend","branch","src/accessibility.tsx"),
    check("access"),review("verify")
  ]:[
    branch(),update("api","backend","branch","src/backend.ts"),
    update("ui","frontend","api","src/list.tsx"),
    check("ui"),review("verify")
  ];
  const {plan}=compilePlanningProposal({
    tasks,assumptions:[],uncertainties:[]
  },{
    snapshot,agents,requirement:"A requirement with differing agent roles",
    planId:alternate?"access-plan":"search-plan",workBranch
  });
  const approval=makeApproval(plan,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"decision",approved_by:"did:thesis:engineer",
    approved_at:"2026-10-27T12:00:00Z",
    approved_permission_ids:plan.requested_permissions.map(p=>p.id)
  });
  return {plan,approvedRows:assertApprovedPlanScope(plan,approval,{
    allowedOperations:new Set(RUST_OPERATIONS),
    expectedEngineerDid:"did:thesis:engineer"
  })};
}
class DummyModel extends BaseLlm{
  constructor(role){super({model:"offline-only-"+role});}
  async *generateContentAsync(){
    yield {content:{role:"model",parts:[{text:"fixture model"}]}};
  }
  connect(){throw Error("no live provider");}
}
test("Block B: same binding works for 3-role and 2-role independently approved plans",()=>{
  for(const [alternate,expected] of [
    [false,["backend","frontend","test"]],
    [true,["frontend","test"]]
  ]){
    const input=reviewed(alternate);
    const contexts=[];
    const bound=bindModelsToApprovedRoleTasks({...input,
      modelFactory:context=>{
        contexts.push(context);
        assert.equal("referenceFiles" in context,false);
        assert.equal("implementationContents" in context,false);
        assert.equal("apiKey" in context,false);
        assert.ok(context.approved_permissions.every(g=>
          g.task_id&&g.operation&&g.resource));
        assert.ok(context.tasks.every(t=>typeof t.id==="string"));
        return new DummyModel(context.role);
      }
    });
    assert.deepEqual(bound.selected_roles,expected);
    assert.deepEqual(contexts.map(c=>c.role),expected);
    assert.equal(Object.isFrozen(bound),true);
    assert.equal(Object.isFrozen(contexts[0].approved_permissions),true);
    assert.ok(!JSON.stringify(bound.contexts).includes("trusted-secret"));
  }
});
test("Block B: permission reduction removes a role from model construction",()=>{
  const input=reviewed();
  const grants=input.approvedRows.filter(g=>g.agent_id!=="backend");
  const roles=[];
  const result=bindModelsToApprovedRoleTasks({
    plan:input.plan,approvedRows:grants,
    modelFactory:context=>{
      roles.push(context.role);
      return new DummyModel(context.role);
    }
  });
  assert.deepEqual(result.selected_roles,["frontend","test"]);
  assert.deepEqual(roles,["frontend","test"]);
});
test("Block B: forged permissions and non-ADK models are rejected before starting any A2A workers",()=>{
  const input=reviewed();
  for(const change of [
    g=>[...g,{...g[0],id:"duplicate",agent_id:"evil"}],
    g=>[...g,{...g[0]}]
  ])assert.throws(()=>bindModelsToApprovedRoleTasks({
    plan:input.plan,approvedRows:change(input.approvedRows),
    modelFactory:context=>new DummyModel(context.role)
  }),/NO-GO/);
  assert.throws(()=>bindModelsToApprovedRoleTasks({
    ...input,modelFactory:()=>({model:"text-only-not-a-BaseLlm"})
  }),/NO-GO/);
});

test("Block B: model factory never sees substituted grant operation, path or identity",()=>{
  const input=reviewed();
  const read=input.approvedRows.find(g=>
    g.agent_id==="backend"&&g.operation==="read_file");
  assert.ok(read);
  // A different operation on the same Task and resource can also be a
  // legitimate *separate* permission: preserving the original ID matters.
  for(const mutate of [
    g=>({...g,operation:"update_file"}),
    g=>({...g,resource:g.resource+"/unapproved"}),
    g=>({...g,id:"new-unapproved-grant"})
  ]){
    let factoryCalls=0;
    assert.throws(()=>bindModelsToApprovedRoleTasks({
      ...input,
      approvedRows:input.approvedRows.map(g=>g===read?mutate(g):g),
      modelFactory:context=>{
        factoryCalls++;
        return new DummyModel(context.role);
      }
    }),/NO-GO/);
    assert.equal(factoryCalls,0,"all grants must be checked before model creation");
  }
  let factoryCalls=0;
  assert.throws(()=>bindModelsToApprovedRoleTasks({
    ...input,
    plan:{...input.plan,requested_permissions:[
      ...input.plan.requested_permissions,input.plan.requested_permissions[0]
    ]},
    modelFactory:context=>{
      factoryCalls++;
      return new DummyModel(context.role);
    }
  }),/NO-GO/);
  assert.equal(factoryCalls,0);
});
