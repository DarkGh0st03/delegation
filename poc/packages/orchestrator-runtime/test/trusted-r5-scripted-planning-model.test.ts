import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm,type LlmRequest,type LlmResponse,
  type BaseLlmConnection} from "@google/adk";
import {TrustedAdkReadOnlyPlanner}
  from "../src/trusted-adk-planner.ts";
import {R5ScriptedNoProviderPlanningModel,
  isBoundR5NoProviderPlanningModel}
  from "../src/trusted-r5-scripted-planning-model.ts";
const backend="src/backend/user-status.ts";
const frontend="src/frontend/user-status.tsx";
const newTestFile="tests/status.spec.ts";
const SNAPSHOT={
  session_id:"r5-original-engineer-session",
  repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console"},
  base_revision:"a".repeat(40),
  directories:["","src","src/backend","src/frontend","tests"],
  files:[backend,frontend]
};
const intent={
  snapshot:SNAPSHOT,
  workBranch:"feature/account-suspension",
  edits:{backend:[backend],frontend:[frontend]},
  newTestFile
};
test("R5 bounded no-provider ADK model produces original-snapshot scoped plan after genuine Gateway-shaped reads",async()=>{
  const model=new R5ScriptedNoProviderPlanningModel(intent);
  assert.equal(isBoundR5NoProviderPlanningModel(
    model,SNAPSHOT,intent.workBranch),true);
  const called=[];
  const result=await new TrustedAdkReadOnlyPlanner({
    model,snapshot:SNAPSHOT,requirement:"Implement ACTIVE/SUSPENDED status",
    planId:"r5-scripted-owner-plan",workBranch:intent.workBranch,
    agents:{
      backend:{did:"did:example:backend",card_ref:"private:backend"},
      frontend:{did:"did:example:frontend",card_ref:"private:frontend"},
      test:{did:"did:example:test",card_ref:"private:test"}
    },
    readPort:{async invoke(tool,args){
      called.push({tool,args});
      return {provider:"gitea",performed:true,tool,
        branch:"main",path:args.path,
        revision:SNAPSHOT.base_revision,
        content:"export const currentStatus = 'ACTIVE';"};
    }}
  }).propose();
  assert.equal(result.status,"unapproved_proposal");
  assert.equal(result.verified_source_reads,2);
  assert.deepEqual(called,[
    {tool:"read_file",args:{branch:"main",path:backend}},
    {tool:"read_file",args:{branch:"main",path:frontend}}
  ]);
  assert.deepEqual(result.plan.tasks.map(t=>t.id),
    ["branch","backend","frontend","test","pr"]);
  assert.equal(result.plan.base_revision,SNAPSHOT.base_revision);
  assert.equal(result.plan.tasks.at(-1).agent_id,"orchestrator");
  assert.equal(result.plan.requested_permissions
    .filter(p=>p.operation==="update_file").length,2);
  assert.equal(Object.hasOwn(result,"engineer_approval"),false);
});
test("R5 no-provider ADK model denies any API/model network connection or unbounded repeat",async()=>{
  const model=new R5ScriptedNoProviderPlanningModel(intent);
  await assert.rejects(model.connect({} as LlmRequest),
    /no network provider/);
  const responses=[];
  for(let i=0;i<3;i++){
    const one=[];
    for await(const x of model.generateContentAsync({} as LlmRequest))
      one.push(x);
    responses.push(one);
  }
  assert.equal(responses[0][0].content?.parts?.[0]?.functionCall?.name,"read_file");
  assert.equal(responses[1][0].content?.parts?.[0]?.functionCall?.name,"read_file");
  assert.ok(responses[2][0].content?.parts?.[0]?.text?.includes("create_pull_request"));
  await assert.rejects(async()=>{
    for await(const _ of model.generateContentAsync({} as LlmRequest)){}
  },/cannot be reused/);
});
test("R5 rejects fee-capable BaseLlm and altered snapshot/branch binding",()=>{
  class PaidLike extends BaseLlm{
    constructor(){super({model:"gemini-3.8-flash"});}
    override async *generateContentAsync():AsyncGenerator<LlmResponse,void>{
      yield {content:{role:"model",parts:[{text:"{}"}]}};
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("would access provider"));
    }
  }
  const offline=new R5ScriptedNoProviderPlanningModel(intent);
  assert.equal(isBoundR5NoProviderPlanningModel(new PaidLike(),SNAPSHOT,
    intent.workBranch),false);
  assert.equal(isBoundR5NoProviderPlanningModel(
    offline,{...SNAPSHOT,base_revision:"b".repeat(40)},intent.workBranch),false);
  assert.equal(isBoundR5NoProviderPlanningModel(
    offline,SNAPSHOT,"feature/other"),false);
  assert.equal(isBoundR5NoProviderPlanningModel(
    Object.create(R5ScriptedNoProviderPlanningModel.prototype),
    SNAPSHOT,intent.workBranch),false);
});
test("R5 refuses unauthorized files, overlapping writes, invalid test target and branch",()=>{
  const mutate=[
    x=>x.edits.backend=["src/unknown.ts"],
    x=>x.edits.frontend=[backend],
    x=>x.edits.frontend=["../private.env"],
    x=>x.newTestFile="../untrusted.ts",
    x=>x.newTestFile=backend,
    x=>x.newTestFile="no-directory/test.ts",
    x=>x.workBranch="main",
    x=>x.edits.backend=[],
    x=>x.edits.extra=["src/unknown.ts"]
  ];
  for(const bad of mutate){
    const x=structuredClone(intent);bad(x);
    assert.throws(()=>new R5ScriptedNoProviderPlanningModel(x),
      /R5 scripted no-provider Planning denied/);
  }
});
