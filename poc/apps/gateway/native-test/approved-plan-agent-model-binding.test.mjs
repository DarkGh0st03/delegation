import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm,InMemorySessionService,Runner} from "@google/adk";
import {createAdkSpecializedAgent}
  from "../../../packages/agent-runtime/src/adk-specialized-agents.ts";
import {compilePlanningProposal}
  from "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {makeApproval,assertApprovedPlanScope}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {bindModelsToApprovedRoleTasks}
  from "./approved-plan-agent-model-binding.mjs";
import {getApprovedOfflineScenario}
  from "../../test-runner-controller/fixtures/approved-scenarios.mjs";

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
  // Two different Engineer-reviewable functional objectives. The local
  // source-driven model does not receive either file's implementation.
  const frontend=tasks.find(t=>t.agent_id==="frontend");
  frontend.description=alternate
    ? "Rename exported function showAccess to showPermissions"
    : "Rename exported function renderList to renderDirectory";
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

/**
 * An intentionally LIMITED offline software transformation model. This is
 * not Gemini, and proves no autonomous reasoning or native DC/VP enforcement.
 * Unlike golden-content tool schedules, its update_file bytes must come from
 * an ADK read_file result, with paths taken from approved Task permissions.
 */
class SourceDrivenRenameModel extends BaseLlm {
  #turn=0;
  constructor(context){
    super({model:"offline-source-derived-rename-"+context.role});
    const task=context.tasks.find(t=>/^Rename exported function /u.test(t.description));
    const names=task?.description.match(
      /^Rename exported function ([A-Za-z_$][\w$]*) to ([A-Za-z_$][\w$]*)$/u);
    const writable=context.approved_permissions.filter(g=>
      g.task_id===task?.id&&g.operation==="update_file");
    if(!names||writable.length!==1||!context.approved_permissions.some(g=>
      g.task_id===task.id&&g.operation==="read_file"&&
      g.resource===writable[0].resource))
      throw Error("Offline source-derived model requires exact approved read and update");
    const resource=writable[0].resource;
    const scoped=resource.match(/\/branches\/([^/]+)\/files\/(.+)$/u);
    if(!scoped)throw Error("Unrecognized approved repository path");
    this.branch=decodeURIComponent(scoped[1]);
    this.path=scoped[2].split("/").map(decodeURIComponent).join("/");
    this.from=names[1];this.to=names[2];
    this.sourceSeen=false;
  }
  async *generateContentAsync(request){
    this.#turn++;
    if(this.#turn===1){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"source-driven-read",name:"read_file",
        args:{branch:this.branch,path:this.path}
      }}]}};
      return;
    }
    if(this.#turn===2){
      const responses=(request.contents??[]).flatMap(c=>c.parts??[])
        .filter(p=>p.functionResponse?.name==="read_file")
        .map(p=>p.functionResponse.response);
      let payload=responses.at(-1);
      // FunctionTool may wrap return values under "result".
      if(payload?.result && !Object.hasOwn(payload,"ok"))payload=payload.result;
      if(payload?.ok!==true ||
         typeof payload.result?.content!=="string"){
        yield {content:{role:"model",parts:[{
          text:"Refused: no confirmed authorized read_file content."
        }]}};
        return;
      }
      const source=payload.result.content;
      this.sourceSeen=true;
      const before="export function "+this.from+"(";
      if(source.split(before).length!==2||
         source.includes("export function "+this.to+"(")){
        yield {content:{role:"model",parts:[{
          text:"Refused: source did not contain one unambiguous rename target."
        }]}};
        return;
      }
      const updated=source.replace(before,"export function "+this.to+"(");
      yield {content:{role:"model",parts:[{functionCall:{
        id:"source-driven-update",name:"update_file",
        args:{branch:this.branch,path:this.path,content:updated}
      }}]}};
      return;
    }
    yield {content:{role:"model",parts:[{
      text:"Offline transformation issued; provider confirmation remains authoritative."
    }]}};
  }
  connect(){throw Error("Source-driven offline model cannot access external inference");}
}

async function runSourceDrivenReview(alternate,{badSource=false}={}){
  const {plan,approvedRows}=reviewed(alternate);
  const chosen=alternate
    ? {path:"src/accessibility.tsx",from:"showAccess",to:"showPermissions"}
    : {path:"src/list.tsx",from:"renderList",to:"renderDirectory"};
  const branch=alternate?"feature/access":"feature/search";
  const source=badSource
    ? "export function unrelated() { return 9; }\n"
    : "export function "+chosen.from+"() { return 9; }\n";
  let current=source,readSeen=false;
  const calls=[],seenFactory=[];
  const selected=bindModelsToApprovedRoleTasks({
    plan,approvedRows,
    modelFactory:context=>{
      seenFactory.push(context);
      return context.role==="frontend"
        ?new SourceDrivenRenameModel(context):new DummyModel(context.role);
    }
  });
  const model=selected.models.frontend;
  assert.ok(model instanceof SourceDrivenRenameModel);
  assert.equal(JSON.stringify(seenFactory).includes(source),false,
    "No golden or source bytes may be passed to model constructors");
  const built=createAdkSpecializedAgent({
    role:"frontend",model,trustedBranch:branch,
    trustedTaskPaths:[chosen.path],
    trustedFilePermissions:[
      {operation:"read_file",path:chosen.path},
      {operation:"update_file",path:chosen.path}
    ],
    gatewayClient:{async invoke(name,args){
      calls.push(name);
      assert.equal(args.path,chosen.path);
      assert.equal(args.branch,branch);
      if(name==="read_file"){
        readSeen=true;
        return {content:current};
      }
      if(name==="update_file"){
        assert.equal(readSeen,true,"Never update without a successful controlled read");
        assert.equal(typeof args.content,"string");
        current=args.content;
        return {commit_sha:"c".repeat(40),revision:"c".repeat(40)};
      }
      throw Error("Unexpected tool "+name);
    }}
  });
  const appName="source_derived_"+(alternate?"access":"search");
  const sessionService=new InMemorySessionService();
  const runner=new Runner({appName,agent:built.agent,sessionService});
  await sessionService.createSession({appName,userId:"offline",sessionId:"one"});
  for await(const event of runner.runAsync({
    userId:"offline",sessionId:"one",
    newMessage:{role:"user",parts:[{
      text:plan.tasks.find(t=>t.agent_id==="frontend").description
    }]}
  })){
    assert.equal(event.errorCode,undefined);
  }
  return {chosen,source,current,calls,model};
}

test("Block B: actual ADK reads distinct approved source files and derives updates without golden payloads",async()=>{
  for(const alternate of [false,true]){
    const {chosen,source,current,calls,model}=await runSourceDrivenReview(alternate);
    assert.deepEqual(calls,["read_file","update_file"]);
    assert.equal(model.sourceSeen,true);
    assert.equal(current,source.replace(
      "export function "+chosen.from+"(",
      "export function "+chosen.to+"("));
    assert.notEqual(current,source);
  }
});
test("Block B: source-driven offline ADK refuses to write when actual source disagrees with Task",async()=>{
  const {source,current,calls,model}=await runSourceDrivenReview(true,{
    badSource:true
  });
  assert.equal(model.sourceSeen,true);
  assert.deepEqual(calls,["read_file"]);
  assert.equal(current,source);
});

test("Block B: Account Suspension tasks explicitly specify the required lifecycle routes",()=>{
  const task=getApprovedOfflineScenario("account-suspension")
    .planning_intent.taskInstructions.backend;
  assert.ok(task.includes(
    "ROUTE POST /:id/suspend suspendUser AFTER PATCH /:id/profile"));
  assert.ok(task.includes(
    "ROUTE POST /:id/reactivate reactivateUser AFTER POST /:id/suspend"));
});
