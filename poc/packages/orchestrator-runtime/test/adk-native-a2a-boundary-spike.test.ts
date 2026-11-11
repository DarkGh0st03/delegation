/**
 * Offline ADK 2.2.1 interoperability spike. No Gemini billing, no network.
 * Probes actual ADK classes without trusting its session as authorization.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BaseLlm,FunctionTool,InMemorySessionService,LlmAgent,
  RemoteA2AAgent,Runner,
  type BaseLlmConnection,type LlmRequest,type LlmResponse
} from "@google/adk";
import {z} from "zod";

class NoNetworkModel extends BaseLlm {
  constructor(){super({model:"offline-adk-spike"});}
  override async *generateContentAsync(_req:LlmRequest):AsyncGenerator<LlmResponse,void>{
    yield {content:{role:"model",parts:[{text:"No approval granted."}]}};
  }
  override connect(_req:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(Error("Real models prohibited in offline spike"));
  }
}

test("ADK structured-output agent with subagent cannot be assumed to transfer freely",()=>{
  const tool=new FunctionTool({
    name:"trusted_read_directory",
    description:"Read a fixture only; never issue permissions",
    parameters:z.object({path:z.string().min(1)}).strict(),
    execute:async({path})=>({path,entries:["src","test"]})
  });
  const remote=new RemoteA2AAgent({
    name:"offline_backend_peer",
    client:{sendMessageStream:async function*(){
      throw Error("Unexpected send during constructor probe");
    }} as any
  });
  const agent=new LlmAgent({
    name:"offline_planning_spike",model:new NoNetworkModel(),
    instruction:"Analyze only; no authority is created by ADK",
    tools:[tool],subAgents:[remote],
    outputSchema:z.object({tasks:z.array(z.object({
      id:z.string(),agent_id:z.string()
    }))})
  });
  assert.equal(agent.tools.length,1);
  assert.ok(agent.outputSchema);
  assert.equal(remote.name,"offline_backend_peer");
  // Verified in pinned upstream @google/adk 2.2.1 LlmAgent constructor:
  assert.equal(agent.disallowTransferToParent,true);
  assert.equal(agent.disallowTransferToPeers,true);
});

test("An unbound native RemoteA2AAgent request is blocked before A2A transport",async()=>{
  let blocked=0,networkSends=0;
  const remote=new RemoteA2AAgent({
    name:"unbound_native_remote",
    client:{
      sendMessageStream:async function*(){
        networkSends++;
        throw Error("Forbidden A2A send");
      },
      sendMessage:async()=>{
        networkSends++;
        throw Error("Forbidden nonstreaming A2A send");
      }
    } as any,
    beforeRequestCallbacks:[(_ctx,params)=>{
      blocked++;
      assert.equal(params.message.kind,"message");
      // A fresh native A2A conversation has no trusted prebound Task ID;
      // request-scoped signed delegation must be enforced elsewhere.
      assert.equal(params.message.taskId,undefined);
      throw Error("trusted_prebound_task_required");
    }]
  });
  const appName="native_adk_offline_boundary",userId="engineer",
    sessionId="unapproved_1";
  const sessions=new InMemorySessionService();
  await sessions.createSession({appName,userId,sessionId});
  const runner=new Runner({agent:remote,appName,sessionService:sessions});
  const events=[];
  for await(const event of runner.runAsync({
    userId,sessionId,
    newMessage:{role:"user",parts:[{text:"Unapproved task request"}]}
  }))events.push(event);
  assert.equal(blocked,1);
  assert.equal(networkSends,0);
  assert.ok(events.some(e=>e.errorMessage?.includes("trusted_prebound_task_required")),
    "The native wrapper should fail visibly, not report completion");
});

test("ADK A2A metadata is not an Engineer approval or a scoped child credential",async()=>{
  let networkSends=0,observed=false;
  const remote=new RemoteA2AAgent({
    name:"metadata_native_remote",metadata:{scenario:"offline",role:"backend"},
    client:{sendMessageStream:async function*(){
      networkSends++;
      throw Error("No provider transport authorized");
    }} as any,
    beforeRequestCallbacks:[(_ctx,params)=>{
      observed=true;
      assert.equal(params.metadata?.scenario,"offline");
      assert.equal(params.metadata?.role,"backend");
      assert.equal(params.message.taskId,undefined);
      assert.equal("signed_vp" in (params.metadata??{}),false);
      throw Error("missing_signed_authority");
    }]
  });
  const appName="adk_metadata_probe",userId="engineer",
    sessionId="metadata_1";
  const sessions=new InMemorySessionService();
  await sessions.createSession({appName,userId,sessionId});
  const runner=new Runner({agent:remote,appName,sessionService:sessions});
  const events=[];
  for await(const event of runner.runAsync({
    userId,sessionId,newMessage:{
      role:"user",parts:[{text:"Check remote metadata"}]
    }
  }))events.push(event);
  assert.ok(observed);
  assert.equal(networkSends,0);
  assert.ok(events.some(e=>e.errorMessage?.includes("missing_signed_authority")));
});
