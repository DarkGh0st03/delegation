import assert from "node:assert/strict";
import test from "node:test";
import {
  BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection
} from "@google/adk";
import {validatePlan} from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {compilePlanningProposal,TrustedAdkReadOnlyPlanner}
  from "../src/trusted-adk-planner.ts";

const FILE="src/billing/invoice.ts";
const SNAPSHOT={
  session_id:"trusted-plan-session",
  repository:{authority:"gitea.local",owner:"thesis",repository:"invoices"},
  base_revision:"a".repeat(40),
  directories:["","src","src/billing"],
  files:[FILE]
};
const AGENTS={
  backend:{did:"did:thesis:backend",card_ref:"trusted:backend"},
  frontend:{did:"did:thesis:frontend",card_ref:"trusted:frontend"},
  test:{did:"did:thesis:test",card_ref:"trusted:test"}
};
const cfg={
  snapshot:SNAPSHOT,requirement:"Sort invoices in descending due-date order",
  planId:"draft-invoices-v1",workBranch:"feature/invoice-sort",
  agents:AGENTS
};
function draft(){
  return {
    tasks:[
      {id:"branch",agent_id:"orchestrator",title:"Create work branch",
       description:"Create a feature branch from trusted main",depends_on:[],
       permissions:[{operation:"create_branch",path:null,reason:"Isolate source edits"}]},
      {id:"backend",agent_id:"backend",title:"Implement invoice ordering",
       description:"Read then modify the approved service",depends_on:["branch"],
       permissions:[
         {operation:"read_file",path:FILE,reason:"Inspect existing behavior"},
         {operation:"update_file",path:FILE,reason:"Implement requested ordering"}
       ]}
    ],
    assumptions:[],uncertainties:[]
  };
}
class Scripted extends BaseLlm {
  requests:LlmRequest[]=[];
  constructor(readArgs:Record<string,unknown>, readonly output:unknown){
    super({model:"offline-planner-script"});this.readArgs=readArgs;
  }
  readonly readArgs:Record<string,unknown>;
  override async *generateContentAsync(r:LlmRequest):AsyncGenerator<LlmResponse,void>{
    this.requests.push(r);
    if(this.requests.length===1){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"read-pinned-source",name:"read_file",args:this.readArgs
      }}]}};return;
    }
    yield {content:{role:"model",parts:[{text:JSON.stringify(this.output)}]}};
  }
  override connect(_r:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(Error("No network model"));
  }
}
test("proposal compiler creates a strict plan without an approval or credential",()=>{
  const result=compilePlanningProposal(draft(),cfg);
  assert.equal(result.status,"unapproved_proposal");
  assert.equal(result.plan.base_revision,SNAPSHOT.base_revision);
  assert.deepEqual(result.plan.repository,SNAPSHOT.repository);
  assert.equal(result.plan.candidate_agents[0]?.did,AGENTS.backend.did);
  assert.equal(result.plan.tasks[1]?.agent_id,"backend");
  assert.equal(result.plan.requested_permissions[2]?.operation,"update_file");
  assert.ok(result.plan.requested_permissions[2]?.resource.includes(
    "/branches/feature%2Finvoice-sort/files/src/billing/invoice.ts"));
  validatePlan(result.plan,{allowedOperations:new Set(RUST_OPERATIONS)});
  assert.equal("approval" in result,false);
  assert.equal(result.digest.length,64);
});
test("ADK Planner reads real Gateway-shaped pinned source, returning only a draft",async()=>{
  const portCalls:Array<{tool:string;args:Record<string,unknown>}>=[];
  const model=new Scripted({branch:"main",path:FILE},draft());
  const port={async invoke(tool:string,args:Record<string,unknown>){
    portCalls.push({tool,args});
    return {provider:"gitea",performed:true,tool,path:FILE,branch:"main",
      revision:SNAPSHOT.base_revision,content:"export const invoices = [];"};
  }};
  const result=await new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:port
  }).propose();
  assert.equal(result.verified_source_reads,1);
  assert.deepEqual(portCalls,[{tool:"read_file",args:{branch:"main",path:FILE}}]);
  assert.equal(result.plan.base_revision,SNAPSHOT.base_revision);
  const exposed=JSON.stringify(model.requests.map(r=>({
    contents:r.contents,tools:r.config?.tools
  })));
  for(const forbidden of ["signed_vp","delegation_evidence","private_key",
    "execute_plan","create_branch\"","update_file\""]){
    assert.ok(!exposed.includes(forbidden),forbidden);
  }
  assert.ok(exposed.includes("read_file"));
});
test("out-of-scope Planning read is denied before the trusted provider",async()=>{
  let calls=0;
  const model=new Scripted({branch:"main",path:"secrets/production.env"},draft());
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:{async invoke(){calls++;return {};}}
  }).propose(),/no verified read-only grounded proposal/);
  assert.equal(calls,0);
});
test("mismatched pinned SHA is rejected, even with a plausible model plan",async()=>{
  const model=new Scripted({branch:"main",path:FILE},draft());
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:{async invoke(tool:string){
      return {provider:"gitea",performed:true,tool,branch:"main",path:FILE,
        revision:"b".repeat(40),content:"untrusted"};
    }}
  }).propose(),/no verified read-only grounded proposal/);
});
test("untrusted model cannot request arbitrary operations, unknown source or second branch",()=>{
  const operations=[
    (d:any)=>{d.tasks[1].permissions[1].operation="merge_pull_request";},
    (d:any)=>{d.tasks[1].permissions[1].path="private/unknown.ts";},
    (d:any)=>{d.tasks[0].agent_id="backend";},
    (d:any)=>{d.tasks[1].depends_on=[];},
    (d:any)=>{d.tasks[1].permissions[1].resource="gitea://attacker/private";},
    (d:any)=>{d.tasks[1].permissions[1].path="../secrets";},
    (d:any)=>{d.tasks[1].permissions[1].path="src/billing/other.ts";}
  ];
  for(const mutate of operations){
    const d=draft();mutate(d);
    assert.throws(()=>compilePlanningProposal(d,cfg));
  }
});
