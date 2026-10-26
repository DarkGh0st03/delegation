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
  readonly readArgs:Record<string,unknown>;
  readonly output:unknown;
  constructor(readArgs:Record<string,unknown>,output:unknown){
    super({model:"offline-planner-script"});
    this.readArgs=readArgs;this.output=output;
  }
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

test("branch-only sketches cannot silently select the legacy branch",()=>{
  const d=draft();
  d.tasks[1]={id:"pr",agent_id:"orchestrator",title:"Open PR",
    description:"Open a review request",depends_on:["branch"],
    permissions:[{operation:"create_pull_request",path:null,reason:"Review"}]};
  assert.throws(()=>compilePlanningProposal(d,cfg),/exact trusted work branch/);
});

test("generic multi-read Planning permits independent disjoint edits and exact-SHA review",async()=>{
  const UI="src/ui/invoice-list.tsx";
  const E2E="tests/e2e/invoice-order.spec.ts";
  const snapshot={...SNAPSHOT,
    directories:["","src","src/billing","src/ui","tests","tests/e2e"],
    files:[FILE,UI]
  };
  const proposed={
    tasks:[
      {id:"branch",agent_id:"orchestrator",title:"Start isolated branch",
       description:"Create an approved work branch",depends_on:[],
       permissions:[{operation:"create_branch",path:null,reason:"Isolate writes"}]},
      {id:"backend",agent_id:"backend",title:"Update billing ordering",
       description:"Update due-date sort",depends_on:["branch"],
       permissions:[
         {operation:"read_file",path:FILE,reason:"Inspect billing"},
         {operation:"update_file",path:FILE,reason:"Fix ordering"}]},
      {id:"frontend",agent_id:"frontend",title:"Update invoice display",
       description:"Display sorted invoices",depends_on:["branch"],
       permissions:[
         {operation:"read_file",path:UI,reason:"Inspect UI"},
         {operation:"update_file",path:UI,reason:"Show ordering"}]},
      {id:"test",agent_id:"test",title:"Test ordering",
       description:"Run exact pinned SHA acceptance",
       depends_on:["backend","frontend"],permissions:[
         {operation:"create_file",path:E2E,reason:"Create regression"},
         {operation:"run_tests",path:null,reason:"Check final SHA"}]},
      {id:"pr",agent_id:"orchestrator",title:"Request human review",
       description:"Open PR without merge",depends_on:["test"],
       permissions:[{operation:"create_pull_request",path:null,reason:"Review only"}]}
    ],assumptions:[],uncertainties:[]
  };
  const readSequence=[
    {name:"read_repository",args:{}},
    {name:"list_directory",args:{branch:"main",path:""}},
    {name:"read_file",args:{branch:"main",path:FILE}},
    {name:"read_file",args:{branch:"main",path:UI}}
  ];
  class DiscoveryModel extends BaseLlm{
    turns=0;
    constructor(){super({model:"offline-generic-discovery"});}
    override async *generateContentAsync():AsyncGenerator<LlmResponse,void>{
      const step=readSequence[this.turns++];
      if(step){
        yield {content:{role:"model",parts:[{functionCall:{
          id:"trusted-discovery-"+this.turns,name:step.name,args:step.args
        }}]}};return;
      }
      yield {content:{role:"model",parts:[{text:JSON.stringify(proposed)}]}};
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("No paid model in offline tests"));
    }
  }
  const invoked:string[]=[];
  const plan=await new TrustedAdkReadOnlyPlanner({
    ...cfg,snapshot,model:new DiscoveryModel(),
    readPort:{async invoke(tool:string,args:Record<string,unknown>){
      invoked.push(tool);
      const base={provider:"gitea",performed:true,tool,
        revision:snapshot.base_revision};
      if(tool==="read_repository")
        return {...base,default_branch:"main",full_name:"thesis/invoices"};
      if(tool==="list_directory")
        return {...base,branch:"main",path:args.path,entries:[
          {type:"dir",path:"src"},{type:"dir",path:"tests"}]};
      return {...base,branch:"main",path:args.path,
        content:"export const publicSource = true;"};
    }}
  }).propose();
  assert.equal(plan.verified_source_reads,2);
  assert.deepEqual(invoked,readSequence.map(x=>x.name));
  assert.equal(plan.plan.requested_permissions.length,8);
  assert.deepEqual(plan.plan.tasks.find(x=>x.id==="frontend")?.depends_on,["branch"]);
  assert.deepEqual(plan.plan.tasks.find(x=>x.id==="test")?.depends_on,
    ["backend","frontend"]);
  assert.deepEqual(plan.plan.requested_permissions
    .filter(x=>x.operation==="create_pull_request").map(x=>x.agent_id),
    ["orchestrator"]);
  assert.equal(plan.plan.base_revision,snapshot.base_revision);
  assert.equal("approval" in plan,false);
});

test("Planner rejects unordered writes to the same discovered file",()=>{
  const UI="src/ui/invoice-list.tsx";
  const snapshot={...SNAPSHOT,files:[FILE,UI],
    directories:["","src","src/billing","src/ui"]};
  const config={...cfg,snapshot};
  const proposed=draft();
  proposed.tasks.push({
    id:"frontend",agent_id:"frontend",
    title:"Conflicting UI edit",description:"Update same invoice service",
    depends_on:["branch"],permissions:[
      {operation:"update_file",path:FILE,reason:"Conflicting change"}
    ]
  });
  assert.throws(()=>compilePlanningProposal(proposed,config),
    /independent Tasks cannot modify the same file/);
  proposed.tasks[2].depends_on=["backend"];
  assert.doesNotThrow(()=>compilePlanningProposal(proposed,config));
  const duplicate=draft();
  duplicate.tasks[1].permissions.push({
    operation:"update_file",path:FILE,reason:"Duplicate write"});
  assert.throws(()=>compilePlanningProposal(duplicate,config),
    /duplicate Task permission/);
});

test("Planner validates per-call and output-token bounds before any model request",()=>{
  const model=new Scripted({branch:"main",path:FILE},draft());
  const port={async invoke(){return {};}};
  for(const budget of [
    {maxModelCallMs:999},{maxModelCallMs:360001},
    {maxModelCallMs:NaN},{maxOutputTokens:0},
    {maxOutputTokens:32001},{maxOutputTokens:1.5},
    {maxPlanningMs:999},{maxPlanningMs:900001},
    {maxPlanningMs:Infinity},{maxPlanningMs:1.5}
  ])assert.throws(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:port,...budget
  }),/invalid trusted Planning config/);
  assert.equal(model.requests.length,0);
});

test("Planner propagates bounded inference config into real ADK model requests",async()=>{
  const model=new Scripted({branch:"main",path:FILE},draft());
  const result=await new TrustedAdkReadOnlyPlanner({
    ...cfg,model,maxModelCallMs:2000,maxOutputTokens:1234,
    readPort:{async invoke(tool:string){
      return {provider:"gitea",performed:true,tool,branch:"main",path:FILE,
        revision:SNAPSHOT.base_revision,content:"export const invoices=[];"};
    }}
  }).propose();
  assert.equal(result.verified_source_reads,1);
  assert.equal(model.requests.length,2);
  assert.equal((model.requests[0].config as any)?.maxOutputTokens,1234);
});

test("Planner fails closed after a model ignores the per-call abort signal",async()=>{
  let observed:AbortSignal|undefined;
  class SlowScripted extends BaseLlm{
    constructor(){super({model:"offline-hanging-planner"});}
    override async *generateContentAsync(
      _r:LlmRequest,_stream?:boolean,signal?:AbortSignal
    ):AsyncGenerator<LlmResponse,void>{
      observed=signal;
      await new Promise(resolve=>setTimeout(resolve,1200));
      yield {content:{role:"model",parts:[{text:JSON.stringify(draft())}]}};
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("No model network"));
    }
  }
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model:new SlowScripted(),maxModelCallMs:1000,
    readPort:{async invoke(){throw Error("unexpected provider read");}}
  }).propose(),/no verified read-only grounded proposal/);
  // The ADK Runner deliberately collapses internal model errors into
  // a generic unapproved-plan denial; the abort signal proves the deadline.
  assert.equal(observed?.aborted,true);
});

test("Planner's total session budget aborts a model even when per-call budget remains",async()=>{
  let observed:AbortSignal|undefined;
  class Stalled extends BaseLlm{
    constructor(){super({model:"offline-delayed-session"});}
    override async *generateContentAsync(
      _r:LlmRequest,_s?:boolean,signal?:AbortSignal
    ):AsyncGenerator<LlmResponse,void>{
      observed=signal;
      await new Promise(resolve=>setTimeout(resolve,1200));
      yield {content:{role:"model",parts:[{text:JSON.stringify(draft())}]}};
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("Offline model has no network"));
    }
  }
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model:new Stalled(),maxPlanningMs:1000,maxModelCallMs:3000,
    readPort:{async invoke(){throw Error("provider must not be used");}}
  }).propose(),/no verified read-only grounded proposal/);
  assert.equal(observed?.aborted,true);
});

test("Planner refuses a late real-provider-shaped source read after session deadline",async()=>{
  const model=new Scripted({branch:"main",path:FILE},draft());
  let calls=0;
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model,maxPlanningMs:1000,maxModelCallMs:3000,
    readPort:{async invoke(tool:string){
      calls++;
      await new Promise(resolve=>setTimeout(resolve,1200));
      return {provider:"gitea",performed:true,tool,branch:"main",
        path:FILE,revision:SNAPSHOT.base_revision,
        content:"export const invoices=[];"};
    }}
  }).propose(),/no verified read-only grounded proposal/);
  assert.equal(calls,1);
});


test("R5 Planner is one-shot even after a successful unsigned proposal",async()=>{
  const model=new Scripted({branch:"main",path:FILE},draft());
  let providerCalls=0;
  const planner=new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:{async invoke(tool:string){
      providerCalls++;
      return {provider:"gitea",performed:true,tool,branch:"main",path:FILE,
        revision:SNAPSHOT.base_revision,content:"export const invoices=[];"};
    }}
  });
  const result=await planner.propose();
  assert.equal(result.status,"unapproved_proposal");
  assert.equal(providerCalls,1);
  const modelTurns=model.requests.length;
  await assert.rejects(planner.propose(),/already attempted/);
  assert.equal(providerCalls,1);
  assert.equal(model.requests.length,modelTurns);
});

test("R5 Planner concurrent calls cannot generate two independent drafts",async()=>{
  let runs=0;
  const model=new Scripted({branch:"main",path:FILE},draft());
  const planner=new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:{async invoke(tool:string){
      runs++;
      return {provider:"gitea",performed:true,tool,branch:"main",path:FILE,
        revision:SNAPSHOT.base_revision,content:"export const invoices=[];"};
    }}
  });
  const first=planner.propose();
  await assert.rejects(planner.propose(),/already attempted/);
  assert.equal((await first).status,"unapproved_proposal");
  assert.equal(runs,1);
});

test("trusted Planner observations expose bounded metadata but not source or prompts",async()=>{
  const events:Array<Record<string,unknown>>=[];
  const model=new Scripted({branch:"main",path:FILE},draft());
  const result=await new TrustedAdkReadOnlyPlanner({
    ...cfg,model,
    onObservation(event){events.push({...event});},
    readPort:{async invoke(tool:string){
      return {provider:"gitea",performed:true,tool,branch:"main",path:FILE,
        revision:SNAPSHOT.base_revision,content:"PRIVATE_TEST_SOURCE_PAYLOAD"};
    }}
  }).propose();
  assert.equal(result.status,"unapproved_proposal");
  assert.deepEqual(events.filter(e=>e.kind==="model_turn"&&e.status==="started")
    .map(e=>e.turn),[1,2]);
  assert.deepEqual(events.filter(e=>e.kind==="read"&&e.status==="verified")
    .map(e=>({tool:e.tool,path:e.path})),[{tool:"read_file",path:FILE}]);
  const proposalEvents=events.filter(e=>e.kind==="proposal");
  assert.equal(proposalEvents.length,1);
  assert.equal(proposalEvents[0].digest,result.digest);
  assert.equal(proposalEvents[0].verified_source_reads,1);
  assert.ok(!JSON.stringify(events).includes("PRIVATE_TEST_SOURCE_PAYLOAD"));
  assert.ok(!JSON.stringify(events).includes(cfg.requirement));
});

test("ADK rejects out-of-scope arguments before invoking the trusted provider",async()=>{
  const events:Array<Record<string,unknown>>=[];
  let providerCalls=0;
  const model=new Scripted({branch:"main",path:"private/secret.env"},draft());
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model,onObservation(event){events.push({...event});},
    readPort:{async invoke(){providerCalls++;return {};}}
  }).propose(),/no verified read-only grounded proposal/);
  assert.equal(providerCalls,0);
  // The ADK FunctionTool schema rejects invalid path enums before our read()
  // callback is invoked. Absence of a read event is correct, not a bypass.
  assert.ok(!events.some(e=>e.kind==="read"&&e.status==="verified"));
  assert.ok(!JSON.stringify(events).includes("private/secret.env"));
  assert.ok(!events.some(e=>e.kind==="proposal"));
});

test("trusted provider denial emits metadata-only failure without a draft",async()=>{
  const events:Array<Record<string,unknown>>=[];
  let providerCalls=0;
  const model=new Scripted({branch:"main",path:FILE},draft());
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model,onObservation(event){events.push({...event});},
    readPort:{async invoke(){providerCalls++;return {
      provider:"gitea",performed:true,tool:"read_file",path:FILE,
      branch:"main",revision:"b".repeat(40),content:"PRIVATE_PROVIDER_BYTES"
    };}}
  }).propose(),/no verified read-only grounded proposal/);
  assert.equal(providerCalls,1);
  assert.ok(events.some(e=>e.kind==="read"&&e.status==="denied"&&
    e.reason==="trusted_planning_read_failed"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE_PROVIDER_BYTES"));
  assert.ok(!events.some(e=>e.kind==="proposal"));
});

test("optional ADK provider token reports are captured once per call without source text",async()=>{
  class UsageScripted extends Scripted {
    override async *generateContentAsync(r:LlmRequest):AsyncGenerator<LlmResponse,void>{
      for await(const response of super.generateContentAsync(r)){
        yield {...response,usageMetadata:{
          promptTokenCount:20,candidatesTokenCount:8,
          thoughtsTokenCount:2,totalTokenCount:30
        }};
      }
    }
  }
  const model=new UsageScripted({branch:"main",path:FILE},draft());
  const events:Array<Record<string,unknown>>=[];
  const result=await new TrustedAdkReadOnlyPlanner({
    ...cfg,model,onObservation(event){events.push({...event});},
    readPort:{async invoke(tool:string){
      return {provider:"gitea",performed:true,tool,branch:"main",
        path:FILE,revision:SNAPSHOT.base_revision,
        content:"PRIVATE_SOURCE_NEVER_EXPORTED"};
    }}
  }).propose();
  assert.equal(result.status,"unapproved_proposal");
  const usages=events.filter(e=>e.kind==="model_usage");
  assert.deepEqual(usages.map(x=>({turn:x.turn,input:x.input_tokens,
    output:x.output_tokens,total:x.total_tokens,thought:x.thought_tokens})),[
      {turn:1,input:20,output:8,total:30,thought:2},
      {turn:2,input:20,output:8,total:30,thought:2}
    ]);
  assert.ok(usages.every(x=>x.source==="provider_reported"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE_SOURCE_NEVER_EXPORTED"));
  assert.ok(!JSON.stringify(events).includes(cfg.requirement));
});


test("failed Gemini delegate preserves only HTTP classification before ADK collapses error",async()=>{
  class ProviderErrorModel extends BaseLlm{
    constructor(){super({model:"offline-provider-error"});}
    override async *generateContentAsync():AsyncGenerator<LlmResponse,void>{
      const error=Object.assign(
        new Error("PROVIDER_MESSAGE_CONTAINS_PRIVATE_PROMPT_AND_KEY"),{
          status:400,request:{prompt:"PRIVATE_SOURCE"},key:"SENSITIVE_KEY"
        });
      throw error;
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("No network"));
    }
  }
  const trace:Array<Record<string,unknown>>=[];
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model:new ProviderErrorModel(),
    onObservation(event){trace.push({...event});},
    readPort:{async invoke(){throw Error("unexpected source read");}}
  }).propose());
  const failures=trace.filter(e=>e.kind==="model_failure");
  assert.ok(failures.some(e=>e.phase==="delegate_exception"&&
    e.http_status===400&&e.category==="invalid_request_or_tool_schema"));
  const safe=JSON.stringify(trace);
  assert.ok(!safe.includes("PROVIDER_MESSAGE_CONTAINS_PRIVATE_PROMPT_AND_KEY"));
  assert.ok(!safe.includes("PRIVATE_SOURCE"));
  assert.ok(!safe.includes("SENSITIVE_KEY"));
  assert.equal(trace.filter(e=>e.kind==="model_turn"&&e.status==="started").length,1);
});

test("ADK returned structured model error is observed without raw provider text",async()=>{
  class ModelErrorResponse extends BaseLlm{
    constructor(){super({model:"offline-returned-error"});}
    override async *generateContentAsync():AsyncGenerator<LlmResponse,void>{
      yield {errorCode:"RESOURCE_EXHAUSTED",
        errorMessage:"ERROR_MESSAGE_CONTAINS_PRIVATE_PROMPT"};
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("No network"));
    }
  }
  const trace:Array<Record<string,unknown>>=[];
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model:new ModelErrorResponse(),
    onObservation(event){trace.push({...event});},
    readPort:{async invoke(){throw Error("unexpected provider call");}}
  }).propose());
  assert.ok(trace.some(e=>e.kind==="model_failure"&&
    e.category==="quota_or_rate_limit"&&e.phase==="model_error_response"));
  assert.ok(!JSON.stringify(trace).includes("ERROR_MESSAGE_CONTAINS_PRIVATE_PROMPT"));
});
