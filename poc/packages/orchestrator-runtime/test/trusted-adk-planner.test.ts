import assert from "node:assert/strict";
import test from "node:test";
import {
  BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection
} from "@google/adk";
import {TrustedAdkReadOnlyPlanner} from "../src/trusted-adk-planner.ts";

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
/** A permission-only Planning draft (never Tasks, DIDs or approvals). */
function draft(){
  return {
    requested_permissions:[
      {operation:"read_file",resource_type:"file",path:FILE},
      {operation:"update_file",resource_type:"file",path:FILE}
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
test("out-of-scope Planning read is denied before the trusted provider",async()=>{
  let calls=0;
  const model=new Scripted({branch:"main",path:"secrets/production.env"},draft());
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:{async invoke(){calls++;return {};}}
  }).proposeAuthority(),/no verified read-only grounded proposal/);
  assert.equal(calls,0);
});
test("mismatched pinned SHA is rejected, even with a plausible model plan",async()=>{
  const model=new Scripted({branch:"main",path:FILE},draft());
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:{async invoke(tool:string){
      return {provider:"gitea",performed:true,tool,branch:"main",path:FILE,
        revision:"b".repeat(40),content:"untrusted"};
    }}
  }).proposeAuthority(),/no verified read-only grounded proposal/);
});
test("ADK Planner reads Gateway-shaped pinned source and returns only a permission draft",async()=>{
  const portCalls:Array<{tool:string;args:Record<string,unknown>}>=[];
  const model=new Scripted({branch:"main",path:FILE},draft());
  const port={async invoke(tool:string,args:Record<string,unknown>){
    portCalls.push({tool,args});
    return {provider:"gitea",performed:true,tool,path:FILE,branch:"main",
      revision:SNAPSHOT.base_revision,content:"export const invoices = [];"};
  }};
  const result=await new TrustedAdkReadOnlyPlanner({...cfg,model,readPort:port}).proposeAuthority();
  assert.equal(result.verified_source_reads,1);
  assert.deepEqual(portCalls,[{tool:"read_file",args:{branch:"main",path:FILE}}]);
  assert.equal(result.proposal.base_revision,SNAPSHOT.base_revision);
  const exposed=JSON.stringify(model.requests.map(r=>({contents:r.contents,tools:r.config?.tools})));
  for(const forbidden of ["signed_vp","delegation_evidence","private_key","execute_plan"])
    assert.ok(!exposed.includes(forbidden),forbidden);
  assert.ok(exposed.includes("read_file"));
  const system=JSON.stringify(model.requests[0]?.config?.systemInstruction??{});
  assert.ok(system.includes("maximum permission scope"));
  assert.ok(system.includes("This output grants nothing"));
});
test("multi-read Planning proposes only the permission scope, pinned to the exact SHA",async()=>{
  const UI="src/ui/invoice-list.tsx";
  const E2E="tests/e2e/invoice-order.spec.ts";
  const snapshot={...SNAPSHOT,
    directories:["","src","src/billing","src/ui","tests","tests/e2e"],
    files:[FILE,UI]
  };
  const proposed={
    requested_permissions:[
      {operation:"create_branch",resource_type:"repository",path:null},
      {operation:"read_file",resource_type:"file",path:FILE},
      {operation:"update_file",resource_type:"file",path:FILE},
      {operation:"read_file",resource_type:"file",path:UI},
      {operation:"update_file",resource_type:"file",path:UI},
      {operation:"create_file",resource_type:"file",path:E2E},
      {operation:"run_tests",resource_type:"branch",path:null},
      {operation:"create_pull_request",resource_type:"repository",path:null}
    ],assumptions:[],uncertainties:[]
  };
  const readSequence=[
    {name:"read_repository",args:{repository:"invoices"}},
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
      // Gemini often wraps the JSON in one Markdown fence: accepted as is.
      yield {content:{role:"model",parts:[{text:"```json\n"+JSON.stringify(proposed,null,2)+"\n```"}]}};
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
  }).proposeAuthority();
  assert.equal(plan.verified_source_reads,2);
  assert.deepEqual(invoked,readSequence.map(x=>x.name));
  // The new test file is paired with read_file+update_file of the same path
  // (so it can be repaired after a failing run): 8 requested + 2 paired.
  assert.equal(plan.proposal.requested_permissions.length,10);
  const e2e=plan.proposal.requested_permissions.filter(p=>p.resource.endsWith("/files/tests/e2e/invoice-order.spec.ts"));
  assert.deepEqual(e2e.map(p=>p.operation).sort(),["create_file","read_file","update_file"]);
  assert.equal(plan.proposal.base_revision,snapshot.base_revision);
  assert.equal(plan.proposal.branch,cfg.workBranch);
  // A permission-only draft: no Tasks, agents, DIDs or approval.
  assert.equal("approval" in plan,false);
  assert.equal("tasks" in plan.proposal,false);
});

test("Planner validates per-call and output-token bounds before any model request",()=>{
  const model=new Scripted({branch:"main",path:FILE},draft());
  const port={async invoke(){return {};}};
  for(const budget of [
    {maxModelTurns:0},{maxModelTurns:97},{maxModelTurns:NaN},
    {maxModelCallMs:999},{maxModelCallMs:360001},
    {maxModelCallMs:NaN},{maxOutputTokens:0},
    {maxOutputTokens:32001},{maxOutputTokens:1.5},
    {maxPlanningMs:999},{maxPlanningMs:900001},
    {maxPlanningMs:Infinity},{maxPlanningMs:1.5},
    {thinkingLevel:"MINIMAL"}
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
  }).proposeAuthority();
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
  }).proposeAuthority(),/no verified read-only grounded proposal/);
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
  }).proposeAuthority(),/no verified read-only grounded proposal/);
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
  }).proposeAuthority(),/no verified read-only grounded proposal/);
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
  const result=await planner.proposeAuthority();
  assert.equal(result.status,"unapproved_authority_proposal");
  assert.equal(providerCalls,1);
  const modelTurns=model.requests.length;
  await assert.rejects(planner.proposeAuthority(),/already attempted/);
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
  const first=planner.proposeAuthority();
  await assert.rejects(planner.proposeAuthority(),/already attempted/);
  assert.equal((await first).status,"unapproved_authority_proposal");
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
  }).proposeAuthority();
  assert.equal(result.status,"unapproved_authority_proposal");
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
  }).proposeAuthority(),/no verified read-only grounded proposal/);
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
  }).proposeAuthority(),/no verified read-only grounded proposal/);
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
  }).proposeAuthority();
  assert.equal(result.status,"unapproved_authority_proposal");
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
  }).proposeAuthority());
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
  }).proposeAuthority());
  assert.ok(trace.some(e=>e.kind==="model_failure"&&
    e.category==="quota_or_rate_limit"&&e.phase==="model_error_response"));
  assert.ok(!JSON.stringify(trace).includes("ERROR_MESSAGE_CONTAINS_PRIVATE_PROMPT"));
});


test("Gemini function declarations avoid empty objects and empty-string enum",async()=>{
  const model=new Scripted({branch:"main",path:FILE},draft());
  const result=await new TrustedAdkReadOnlyPlanner({
    ...cfg,model,readPort:{async invoke(tool:string){
      return {provider:"gitea",performed:true,tool,
        branch:"main",path:FILE,revision:SNAPSHOT.base_revision,
        content:"export const invoices=[];"};
    }}
  }).proposeAuthority();
  assert.equal(result.status,"unapproved_authority_proposal");
  const tools=(model.requests[0].config as any)?.tools;
  assert.ok(Array.isArray(tools)&&tools.length>0,"ADK function schemas exist");
  const declarations=tools.flatMap((t:any)=>t.functionDeclarations??[]);
  assert.ok(declarations.some((x:any)=>x.name==="read_repository"));
  for(const declaration of declarations){
    const parameters=declaration.parameters;
    if(parameters?.type?.toString().toLowerCase()==="object"){
      assert.ok(parameters.properties&&
        Object.keys(parameters.properties).length>0,
        "Gemini rejects zero-property OBJECT for "+declaration.name);
    }
    const walk=(value:any)=>{
      if(!value||typeof value!=="object")return;
      if(Array.isArray(value)){for(const v of value)walk(v);return;}
      for(const [key,item] of Object.entries(value)){
        if(key==="enum"&&Array.isArray(item))
          assert.ok(!item.includes(""),"Gemini rejects empty-string enum values");
        walk(item);
      }
    };
    walk(parameters);
  }
});

test("long-horizon Planner handles >12 real ADK model turns with MEDIUM thinking and stops on a valid draft",async()=>{
  class LongHorizonScripted extends BaseLlm{
    turns=0;requests:LlmRequest[]=[];
    constructor(){super({model:"offline-long-horizon-fixture"});}
    override async *generateContentAsync(
      request:LlmRequest
    ):AsyncGenerator<LlmResponse,void>{
      this.requests.push(request);
      this.turns++;
      if(this.turns<=14){
        yield {content:{role:"model",parts:[{functionCall:{
          id:"long-horizon-read-"+this.turns,name:"read_file",
          args:{branch:"main",path:FILE}
        }}]}};
        return;
      }
      yield {content:{role:"model",parts:[{text:JSON.stringify(draft())}]}};
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("scripted test uses no network"));
    }
  }
  const model=new LongHorizonScripted();
  let readCalls=0;
  const observations:Array<Record<string,unknown>>=[];
  const output=await new TrustedAdkReadOnlyPlanner({
    ...cfg,model,maxModelTurns:96,thinkingLevel:"MEDIUM",
    maxPlanningMs:900000,maxOutputTokens:16384,
    onObservation(e){observations.push({...e});},
    readPort:{async invoke(tool:string){
      readCalls++;
      return {provider:"gitea",performed:true,tool,branch:"main",
        path:FILE,revision:SNAPSHOT.base_revision,
        content:"export const invoices=[];"};
    }}
  }).proposeAuthority();
  assert.equal(output.status,"unapproved_authority_proposal");
  assert.equal(readCalls,14);
  assert.equal(model.turns,15);
  assert.equal(model.requests.length,15);
  assert.equal((model.requests[0].config as any)?.maxOutputTokens,16384);
  assert.equal((model.requests[0].config as any)?.thinkingConfig?.thinkingLevel,"MEDIUM");
  assert.equal(observations.filter(e=>e.kind==="model_turn"&&e.status==="started").length,15);
  assert.equal(observations.filter(e=>e.kind==="proposal").length,1);
});


test("Planner reports invalid JSON with a fixed non-content-bearing code",async()=>{
  class InvalidJsonModel extends BaseLlm {
    turns=0;
    constructor(){super({model:"offline-invalid-json"});}
    override async *generateContentAsync():AsyncGenerator<LlmResponse,void>{
      this.turns++;
      if(this.turns===1)
        yield {content:{role:"model",parts:[{functionCall:{
          name:"read_file",id:"source",args:{branch:"main",path:FILE}
        }}]}};
      else yield {content:{role:"model",parts:[{text:"PRIVATE_NOT_JSON{"}]}};
    }
    override connect():Promise<BaseLlmConnection>{
      throw Error("Provider forbidden");
    }
  }
  const observations:Array<Record<string,unknown>>=[];
  await assert.rejects(()=>new TrustedAdkReadOnlyPlanner({
    ...cfg,model:new InvalidJsonModel(),
    onObservation(e){observations.push({...e});},
    readPort:{async invoke(tool:string){
      return {provider:"gitea",performed:true,tool,branch:"main",path:FILE,
        revision:SNAPSHOT.base_revision,content:"PRIVATE_GITEA_SOURCE"};
    }}
  }).proposeAuthority(),/model output was not strict JSON/);
  assert.deepEqual(observations.filter(e=>e.kind==="plan_rejection"),[{
    kind:"plan_rejection",stage:"json",reason:"invalid_json"
  }]);
  assert.ok(!JSON.stringify(observations).includes("PRIVATE_NOT_JSON"));
  assert.ok(!JSON.stringify(observations).includes("PRIVATE_GITEA_SOURCE"));
});


test("a rejected Planner draft gets one signed-scope correction in its existing session",async()=>{
  class CorrectionModel extends BaseLlm{
    turns=0; requests:LlmRequest[]=[];
    constructor(){super({model:"offline-correct-draft"});}
    override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
      this.requests.push(req);
      this.turns++;
      if(this.turns===1){
        yield {content:{role:"model",parts:[{functionCall:{
          id:"pinned",name:"read_file",args:{branch:"main",path:FILE}
        }}]}};return;
      }
      const plan=draft();
      if(this.turns===2)plan.requested_permissions[1].path="PRIVATE_UNDISCOVERED.ts";
      yield {content:{role:"model",parts:[{text:JSON.stringify(plan)}]}};
    }
    override connect():Promise<BaseLlmConnection>{throw Error("Offline only");}
  }
  const model=new CorrectionModel(),events:Array<Record<string,unknown>>=[];
  let reads=0;
  const outcome=await new TrustedAdkReadOnlyPlanner({
    ...cfg,model,maxProposalRevisions:1,maxModelTurns:3,
    onObservation(e){events.push({...e});},
    readPort:{async invoke(tool:string){
      reads++;
      return {provider:"gitea",performed:true,tool,branch:"main",path:FILE,
        revision:SNAPSHOT.base_revision,content:"PRIVATE_SOURCE_CONTENT"};
    }}
  }).proposeAuthority();
  assert.equal(outcome.status,"unapproved_authority_proposal");
  assert.equal(model.turns,3);
  assert.equal(reads,1);
  assert.deepEqual(events.filter(e=>e.kind==="plan_rejection"),[{
    kind:"plan_rejection",stage:"contract",reason:"invalid_permissions"
  }]);
  assert.equal(events.filter(e=>e.kind==="proposal").length,1);
  // The same ADK session contains earlier model output by design.
  // Only the newly authored trusted feedback message must omit draft data.
  const latestUserMessage=model.requests[2].contents.at(-1);
  assert.equal(latestUserMessage?.role,"user");
  assert.ok(JSON.stringify(latestUserMessage).includes("invalid_permissions"));
  assert.ok(!JSON.stringify(latestUserMessage).includes("PRIVATE_UNDISCOVERED"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE_UNDISCOVERED"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE_SOURCE_CONTENT"));
});

test("shape feedback reaches model and permits bounded same-session correction",async()=>{
 const requests:LlmRequest[]=[];
 class Retry extends BaseLlm{
  count=0;
  constructor(){super({model:"offline-fixed-preflight-feedback"});}
  override async *generateContentAsync(r:LlmRequest):AsyncGenerator<LlmResponse,void>{
   requests.push(r);this.count++;
   if(this.count===1){
    yield {content:{role:"model",parts:[{functionCall:{id:"read",name:"read_file",
     args:{branch:"main",path:FILE}}}]}};return;
   }
   yield {content:{role:"model",parts:[{text:JSON.stringify(this.count===2?{...draft(),assumptions:"PRIVATE_VALUE"}:draft())}]}};
  }
  override connect(_r:LlmRequest):Promise<BaseLlmConnection>{return Promise.reject(Error("offline"));}
 }
 const observations:any[]=[];let attempts=0;
 const result=await new TrustedAdkReadOnlyPlanner({
  ...cfg,model:new Retry(),maxProposalRevisions:1,maxModelTurns:4,
  readPort:{async invoke(tool:string){return {provider:"gitea",performed:true,tool,
   branch:"main",path:FILE,revision:SNAPSHOT.base_revision,content:"source"};}},
  onObservation:o=>observations.push(o)
 }).proposeAuthority();
 assert.equal(result.status,"unapproved_authority_proposal");
 assert.deepEqual(observations.filter(o=>o.kind==="plan_rejection"),[
  {kind:"plan_rejection",stage:"contract",reason:"invalid_permissions"}]);
 const feedback=JSON.stringify(requests[2].contents.at(-1));
 assert.ok(feedback.includes("invalid_permissions"));
 assert.ok(feedback.includes("no new authority"));
 assert.ok(!feedback.includes("PRIVATE_SOURCE_CONTENT"));
 assert.ok(!JSON.stringify(observations).includes("private"));
});

test("Planner really uses a host-only published approved-plan Agent Card FunctionTool",async()=>{
 class CardAware extends BaseLlm{
  requests:LlmRequest[]=[];
  constructor(){super({model:"offline-agent-card-discovery"});}
  override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
   this.requests.push(req);
   const turn=this.requests.length;
   if(turn===1)yield {content:{role:"model",parts:[{functionCall:{
     id:"agent-card-read",name:"read_agent_card",args:{role:"backend"}
   }}]}};
   else if(turn===2)yield {content:{role:"model",parts:[{functionCall:{
     id:"pinned-source-read",name:"read_file",args:{branch:"main",path:FILE}
   }}]}};
   else yield {content:{role:"model",parts:[{text:JSON.stringify(draft())}]}};
  }
  override connect():Promise<BaseLlmConnection>{
   return Promise.reject(Error("No paid model in card discovery test"));
  }
 }
 const model=new CardAware();
 const reads:string[]=[];
 const result=await new TrustedAdkReadOnlyPlanner({...cfg,model,
  readPort:{async invoke(tool:string,args:Record<string,unknown>){
   reads.push(tool);
   return {provider:"gitea",performed:true,tool,branch:"main",path:args.path,
    revision:SNAPSHOT.base_revision,content:"export const safe=true;"};
  }}
 }).proposeAuthority();
 assert.equal(result.status,"unapproved_authority_proposal");
 assert.deepEqual(reads,["read_file"]);
 assert.equal(result.verified_source_reads,1);
 const declarations=JSON.stringify(model.requests[0].config?.tools);
 assert.ok(declarations.includes("read_agent_card"));
 const next=JSON.stringify(model.requests[1].contents);
 assert.ok(next.includes("Backend Software Engineering"));
 assert.ok(next.includes(AGENTS.backend.card_ref));
 assert.ok(!next.includes("private_key"));
});

test("live ADK Planning reads a host-pinned extra specialist Card",async()=>{
 const docs={did:"did:thesis:docs",card_ref:"trusted:docs",
  capabilities:["read_file"] as const,
  card:{name:"Documentation specialist",description:"Inspect authorized source",
   skills:[{id:"docs-review",name:"Review docs",description:"Inspect approved source"}]}
 };
 const proposal={requested_permissions:[
  {operation:"read_file",resource_type:"file",path:FILE}],assumptions:[],uncertainties:[]};
 class CardFirst extends BaseLlm {
  calls=0;requests:LlmRequest[]=[];
  constructor(){super({model:"r401-offline-card-discovery"});}
  override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
   this.requests.push(req);
   if(++this.calls===1){
    yield {content:{role:"model",parts:[{functionCall:{
     id:"registered-docs-card",name:"read_agent_card",args:{role:"auditor"}
    }}]}};return;
   }
   if(this.calls===2){
    yield {content:{role:"model",parts:[{functionCall:{
     id:"read-pinned-source",name:"read_file",args:{branch:"main",path:FILE}
    }}]}};return;
   }
   yield {content:{role:"model",parts:[{text:JSON.stringify(proposal)}]}};
  }
  override connect(_r:LlmRequest):Promise<BaseLlmConnection>{
   return Promise.reject(Error("No model network"));
  }
 }
 const model=new CardFirst();
 let readCount=0;
 const result=await new TrustedAdkReadOnlyPlanner({...cfg,agents:{auditor:docs},model,
  readPort:{async invoke(tool:string){
   assert.equal(tool,"read_file");readCount++;
   return {provider:"gitea",performed:true,tool,branch:"main",
    path:FILE,revision:SNAPSHOT.base_revision,content:"export const sample = true;"};
  }}
 }).proposeAuthority();
 assert.equal(readCount,1);
 assert.deepEqual(result.proposal.requested_permissions.map(p=>p.operation),["read_file"]);
 assert.ok(JSON.stringify(model.requests[0]?.config?.tools??[]).includes("auditor"));
});
