import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySessionService, Runner, type LlmRequest } from "@google/adk";
import { createAdkSpecializedAgent, OpenAIAdkModel } from "../src/index.ts";

const BRANCH = "feature/account-suspension";
const PATH = "apps/backend/src/users/user.service.ts";
const SECRET = "CHILD_DELEGATION_SECRET_NEVER_FOR_OPENAI";
const TOOL = {
  name:"update_file",
  description:"Update an existing controlled repository file.",
  parameters:{
    type:"OBJECT",
    properties:{
      branch:{type:"STRING",enum:[BRANCH]},
      path:{type:"STRING",minLength:1},
      content:{type:"STRING"}
    },
    required:["branch","path","content"],
    additionalProperties:false
  }
};
const modelRequest = (contents: unknown[]): LlmRequest => ({
  contents:contents as LlmRequest["contents"],
  config:{systemInstruction:"Use only controlled repository functions.",
    tools:[{functionDeclarations:[TOOL]}]},
  toolsDict:{},liveConnectConfig:{}
}) as LlmRequest;

test("Phase 4 OpenAI adapter maps ADK tool declarations and the full function roundtrip",async()=>{
  const captured: Array<Record<string,unknown>> = [];
  const responses = [
    {id:"rsp-1",model:"gpt-5.6-sol-effective",status:"completed",output:[{
      type:"function_call",call_id:"call-phase4-1",name:"update_file",
      arguments:JSON.stringify({branch:BRANCH,path:PATH,content:"updated"})
    }]},
    {id:"rsp-2",model:"gpt-5.6-sol-effective",status:"completed",output:[{
      type:"message",role:"assistant",status:"completed",content:[{
        type:"output_text",text:"Confirmed one controlled edit."
      }]
    }]}
  ];
  const client={responses:{create:async(request:Record<string,unknown>)=>{
    captured.push(structuredClone(request));
    const response=responses.shift();
    if(!response) throw new Error("Unexpected provider invocation");
    return response;
  }}};
  const adapter=new OpenAIAdkModel({client:client as never,model:"gpt-5.6-sol",maxOutputTokens:1024});
  const input=[{role:"user",parts:[{text:"Modify permitted backend service."}]}];
  const first=await Array.fromAsync(adapter.generateContentAsync(modelRequest(input)));
  const call=first[0]?.content?.parts?.[0]?.functionCall;
  assert.equal(call?.name,"update_file");
  assert.equal(call?.id,"call-phase4-1");
  assert.equal(first[0]?.modelVersion,"gpt-5.6-sol-effective");
  assert.equal(captured[0]?.parallel_tool_calls,false);
  assert.equal(captured[0]?.model,"gpt-5.6-sol");
  const defs=captured[0]?.tools as Array<Record<string,unknown>>;
  assert.deepEqual(defs.map(d=>d.name),["update_file"]);
  assert.equal(defs[0]?.strict,true);
  const params=defs[0]?.parameters as Record<string,unknown>;
  assert.equal(params.type,"object");
  assert.equal(params.additionalProperties,false);
  assert.deepEqual(params.required,["branch","path","content"]);
  const text2=[
    ...input,
    {role:"model",parts:[{functionCall:{id:call?.id,name:"update_file",args:call?.args}}]},
    {role:"user",parts:[{functionResponse:{id:"call-phase4-1",name:"update_file",
      response:{ok:true,result:{commit_sha:"0".repeat(40)}}}}]}
  ];
  const second=await Array.fromAsync(adapter.generateContentAsync(modelRequest(text2)));
  assert.equal(second[0]?.content?.parts?.[0]?.text,"Confirmed one controlled edit.");
  const history=captured[1]?.input as Array<Record<string,unknown>>;
  assert.deepEqual(history.map(x=>x.type??"message"),["message","function_call","function_call_output"]);
  assert.equal(history[1]?.call_id,"call-phase4-1");
  assert.equal(history[2]?.call_id,"call-phase4-1");
  assert.equal(JSON.stringify(captured).includes(SECRET),false);
});

test("Phase 4 executes an actual ADK Runner tool cycle through injected OpenAI Responses",async()=>{
  const calls: Array<{name:string,args:Record<string,unknown>}> = [];
  const providerRequests: Array<Record<string,unknown>>=[];
  let turn=0;
  const client={responses:{create:async(req:Record<string,unknown>)=>{
    providerRequests.push(req);
    turn++;
    if(turn===1) return {status:"completed",model:"gpt-5.6-sol-effective",output:[{
      type:"function_call",call_id:"call-adk-1",name:"read_file",
      arguments:JSON.stringify({branch:BRANCH,path:PATH})
    }]};
    return {status:"completed",model:"gpt-5.6-sol-effective",output:[{
      type:"message",role:"assistant",status:"completed",content:[{
        type:"output_text",text:"Read completed; no write requested."
      }]
    }]};
  }}};
  const model=new OpenAIAdkModel({client:client as never,model:"gpt-5.6-sol"});
  const gateway={
    privateCredential:SECRET,
    invoke:async(name:string,args:Record<string,unknown>)=>{
      calls.push({name,args});
      return {provider:"gitea",content:"safe application source"};
    }
  };
  const {agent}=createAdkSpecializedAgent({role:"backend",model,gatewayClient:gateway as never});
  const appName="adk_openai_phase4",userId="phase4",sessionId="phase4-task";
  const sessionService=new InMemorySessionService();
  const runner=new Runner({agent,appName,sessionService});
  await sessionService.createSession({appName,userId,sessionId});
  const output:string[]=[];
  const failures:string[]=[];
  for await (const event of runner.runAsync({
    userId,sessionId,
    newMessage:{role:"user",parts:[{text:JSON.stringify({
      task:{task_id:"phase4",role:"backend",subtask:{
        instruction:"Read one allowed file",branch:BRANCH,relevant_paths:[PATH]
      }}
    })}]}
  })){
    for(const part of event.content?.parts??[]){
      if(typeof part.text==="string") output.push(part.text);
    }
    if (event.errorCode || event.errorMessage) failures.push(String(event.errorCode)+": "+String(event.errorMessage));
  }
  assert.equal(turn,2,JSON.stringify(failures));
  assert.deepEqual(calls,[{name:"read_file",args:{branch:BRANCH,path:PATH}}]);
  assert.ok(output.includes("Read completed; no write requested."));
  const serialized=JSON.stringify(providerRequests);
  assert.equal(serialized.includes(SECRET),false);
  assert.equal(serialized.includes("delegation_evidence"),false);
  assert.equal(serialized.includes("signed_vp"),false);
});

test("Phase 4 rejects unapproved built-in tools and dangerous function names",async()=>{
  const model=new OpenAIAdkModel({client:{responses:{create:async()=>{throw new Error("Provider must not be called");}}} as never});
  await assert.rejects(async()=>{
    for await(const _ of model.generateContentAsync({
      ...modelRequest([{role:"user",parts:[{text:"Hello"}]}]),
      config:{tools:[{googleSearch:{}}]}
    } as LlmRequest)){}
  },/built-in and remote tools/u);
  await assert.rejects(async()=>{
    for await(const _ of model.generateContentAsync({
      ...modelRequest([{role:"user",parts:[{text:"Hello"}]}]),
      config:{tools:[{functionDeclarations:[{...TOOL,name:"shell_exec"}]}]}
    } as LlmRequest)){}
  },/Forbidden or duplicate/u);
});

test("Phase 4 rejects invalid provider arguments and non-completed responses",async()=>{
  const model=new OpenAIAdkModel({client:{responses:{create:async()=>({
    status:"completed",model:"gpt-5.6-sol",output:[{
      type:"function_call",call_id:"bad",name:"update_file",arguments:"not-json"
    }]
  })}} as never});
  await assert.rejects(async()=>{
    for await(const _ of model.generateContentAsync(modelRequest([{role:"user",parts:[{text:"Hello"}]}]))) {}
  },/Invalid OpenAI function arguments/u);
  const incomplete=new OpenAIAdkModel({client:{responses:{create:async()=>({
    status:"incomplete",model:"gpt-5.6-sol",output:[]
  })}} as never});
  await assert.rejects(async()=>{
    for await(const _ of incomplete.generateContentAsync(modelRequest([{role:"user",parts:[{text:"Hello"}]}]))) {}
  },/non-completed/u);
});

test("Phase 4 fails fast when OpenAI is enabled without a provider API key",()=>{
  assert.throws(()=>new OpenAIAdkModel({apiKey:""}),/OPENAI_API_KEY/u);
});

test("Phase 7 OpenAI tool bridge restricts Orchestrator mode to a single explicit workflow tool",async()=>{
  assert.throws(()=>new OpenAIAdkModel({
    client:{responses:{create:async()=>{throw new Error("No call expected");}}} as never,
    allowedToolNames:["run_account_suspension_workflow","update_file"]
  }),/Invalid OpenAI ADK tool allowlist/u);
  assert.throws(()=>new OpenAIAdkModel({
    client:{responses:{create:async()=>{throw new Error("No call expected");}}} as never,
    allowedToolNames:["shell_exec"]
  }),/Invalid OpenAI ADK tool allowlist/u);
  let calls=0;
  const client={responses:{create:async(req:Record<string,unknown>)=>{
    calls++;
    const tools=req.tools as Array<Record<string,unknown>>;
    assert.deepEqual(tools.map(t=>t.name),["run_account_suspension_workflow"]);
    const params=tools[0]?.parameters as Record<string,unknown>;
    assert.equal(params.additionalProperties,false);
    if(calls===1)return {
      status:"completed",model:"gpt-provider-effective",output:[{
        type:"function_call",call_id:"call-orchestrator",name:"run_account_suspension_workflow",
        arguments:'{"workflow":"account_suspension"}'
      }]
    };
    const input=req.input as Array<Record<string,unknown>>;
    assert.ok(input.some(item=>item.type==="function_call_output" &&
      item.call_id==="call-orchestrator"));
    return {
      status:"completed",model:"gpt-provider-effective",output:[{
        type:"message",content:[{type:"output_text",text:"Workflow completed."}]
      }]
    };
  }}};
  const model=new OpenAIAdkModel({
    client:client as never,model:"gpt-provider-test",
    allowedToolNames:["run_account_suspension_workflow"]
  });
  const tool={
    name:"run_account_suspension_workflow",
    description:"Execute the fixed authorized workflow.",
    parameters:{
      type:"OBJECT",properties:{workflow:{type:"STRING",enum:["account_suspension"]}},
      required:["workflow"],additionalProperties:false
    }
  };
  const config={systemInstruction:"Invoke the fixed workflow only.",tools:[{functionDeclarations:[tool]}]};
  const part={role:"user",parts:[{text:"Perform Account Suspension."}]};
  const first=await Array.fromAsync(model.generateContentAsync({contents:[part],config} as LlmRequest));
  const fc=first[0]?.content?.parts?.[0]?.functionCall;
  assert.equal(fc?.name,"run_account_suspension_workflow");
  assert.equal(fc?.id,"call-orchestrator");
  const second=await Array.fromAsync(model.generateContentAsync({
    contents:[
      part,
      {role:"model",parts:[{functionCall:fc}]},
      {role:"user",parts:[{functionResponse:{
        id:fc?.id,name:fc?.name,
        response:{ok:true,workflow_state:"pr_created"}
      }}]}
    ],config
  } as LlmRequest));
  assert.equal(second[0]?.content?.parts?.[0]?.text,"Workflow completed.");
  assert.equal(calls,2);
  await assert.rejects(async()=>{
    for await(const _ of model.generateContentAsync({
      contents:[part],config:{tools:[{functionDeclarations:[{
        ...tool,name:"update_file"
      }]}]}
    } as LlmRequest)){}
  },/Forbidden or duplicate ADK tool/u);
});

test("Phase 7 strict provider schemas defer numeric constraints to Zod runtime validation",async()=>{
  let captured:Record<string,unknown>|undefined;
  const model=new OpenAIAdkModel({model:"phase7-mock-model",client:{responses:{
    create:async(req:Record<string,unknown>)=>{
      captured=req;
      return {model:"phase7-mock-model",status:"completed",output:[{
        type:"message",content:[{type:"output_text",text:"ok"}]
      }]};
    }
  }} as never});
  await Array.fromAsync(model.generateContentAsync({
    contents:[{role:"user",parts:[{text:"Read a file."}]}],
    config:{tools:[{functionDeclarations:[{
      name:"read_file",description:"Read",
      parameters:{type:"OBJECT",properties:{
        branch:{type:"STRING",enum:["feature/account-suspension"]},
        path:{type:"STRING",minLength:"1"}
      },required:["branch","path"],additionalProperties:false}
    }]}]}
  } as LlmRequest));
  const tools=captured?.tools as Array<Record<string,unknown>>;
  const schema=tools[0]?.parameters as Record<string,unknown>;
  const path=(schema.properties as Record<string,Record<string,unknown>>).path;
  assert.equal(path.minLength,undefined);
  assert.equal(path.type,"string");
  assert.equal(schema.additionalProperties,false);
});
