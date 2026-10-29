import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo, Server} from "node:net";
import express from "express";
import {
  BaseLlm, InMemorySessionService, Runner,
  type LlmRequest, type LlmResponse, type BaseLlmConnection
} from "@google/adk";
import {createAdkSpecializedAgent, type AdkControlledToolOutcome} from "../src/adk-specialized-agents.ts";
import {safeAdkFunctionHistoryShape} from "../src/adk-request-shape.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";
import {ControlledToolError} from "../src/controlled-errors.ts";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";

const args={branch:"feature/account-suspension",path:"apps/backend/src/users/user.service.ts"};
const SYNTHETIC_SIGNATURE="OFFLINE_NATIVE_MCP_SIGNATURE_NO_PROVIDER";
const result={
  provider:"gitea",performed:true,tool:"read_file",...args,
  revision:"a".repeat(40),blob_sha:"b".repeat(40),
  last_commit_sha:"a".repeat(40),size:13,encoding:"utf-8",content:"class Service"
};

/** No AI provider request. Native ADK Runner still performs full tool discovery/call. */
class ScriptedReadModel extends BaseLlm {
  readonly requests:LlmRequest[]=[];
  constructor(readonly signedFirstCall=false) {super({model:"local-mcp-test-no-provider"});}
  override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void> {
    this.requests.push(request);
    if(this.requests.length===1) {
      yield {content:{role:"model",parts:[{functionCall:{
        id:"native-mcp-read-1",name:"read_file",args
      },...(this.signedFirstCall?{thoughtSignature:SYNTHETIC_SIGNATURE}:{})}]}};
    } else {
      yield {content:{role:"model",parts:[{text:"Read request processed"}]}};
    }
  }
  override async connect(_request:LlmRequest):Promise<BaseLlmConnection> {
    throw new Error("No live provider connection is permitted");
  }
}

function keypair() {
  const pair=generateKeyPairSync("ed25519");
  return {
    privateKey:pair.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:pair.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
async function serverAddress(server:{listen:(port:number,host:string,fn:()=>void)=>unknown;address:()=>unknown}):Promise<string> {
  await new Promise<void>((resolve,reject)=>{
    // Local-only ephemeral port; never publish the private Worker outside loopback.
    (server as unknown as {once:(name:string,cb:(error:Error)=>void)=>void}).once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  return "http://127.0.0.1:"+(server.address() as AddressInfo).port;
}
async function close(server: {close:(fn:(error?:Error)=>void)=>unknown}) {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}

async function exercise(authorized:boolean,signedFirstCall=false) {
  const backend=keypair(),frontend=keypair(),testing=keypair();
  const calls:string[]=[];
  const active=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:backend.privateKey,
    signingPublicKeyPem:backend.publicKey
  });
  active.begin("adk-mcp-task",{
    invoke:async(name,input)=>{
      calls.push(name);
      assert.deepEqual(input,args);
      if(!authorized)throw new ControlledToolError(
        "authorization_denied","DO_NOT_EXPOSE_PRIVATE_WORKER_ERROR"
      );
      return result;
    }
  });
  const app=express();
  attachPrivateMcpWorker(app,active);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>worker.once("listening",resolve));
  const workerBaseUrl="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{
      backend:backend.publicKey,frontend:frontend.publicKey,test:testing.publicKey
    },
    router:new TaskRouter({
      backend:{baseUrl:workerBaseUrl},
      frontend:{baseUrl:workerBaseUrl},
      test:{baseUrl:workerBaseUrl}
    })
  });
  let built:ReturnType<typeof createAdkSpecializedAgent>|undefined;
  try {
    const sharedBaseUrl=await serverAddress(shared);
    const model=new ScriptedReadModel(signedFirstCall);
    const outcomes:AdkControlledToolOutcome[]=[];
    let directGatewayCalls=0;
    built=createAdkSpecializedAgent({
      role:"backend",model,
      gatewayClient:{invoke:async()=>{
        directGatewayCalls++;throw new Error("Direct FunctionTool read bypassed MCP");
      }} as never,
      mcpReadFile:{
        endpoint:sharedBaseUrl+"/mcp",
        bearerForRequest:()=>active.bearerFor("adk-mcp-task")
      },
      onToolOutcome: outcome=>outcomes.push(outcome)
    });
    const service=new InMemorySessionService();
    const runner=new Runner({appName:"mcp_native_adk_bridge",agent:built.agent,sessionService:service});
    await service.createSession({appName:"mcp_native_adk_bridge",userId:"dev",sessionId:"adk-mcp-task"});
    for await(const _event of runner.runAsync({
      userId:"dev",sessionId:"adk-mcp-task",
      newMessage:{role:"user",parts:[{text:"Please read the delegated Backend file."}]}
    })) { /* ADK tool callbacks supply authority-confirmed events. */ }
    assert.equal(model.requests.length,2);
    if(signedFirstCall){
      const second=model.requests[1]!;
      const history=second.contents;
      const callIndex=history.findIndex(content=>content.role==="model"&&
        content.parts?.some(part=>part.functionCall?.name==="read_file"));
      assert.ok(callIndex>=0,"Signed MCP functionCall is present in next request");
      const responseIndex=history.findIndex((content,index)=>index>callIndex&&
        content.parts?.some(part=>part.functionResponse?.name==="read_file"));
      assert.ok(responseIndex>callIndex,"MCP functionResponse follows model functionCall");
      const firstCall=history[callIndex]?.parts?.find(part=>
        part.functionCall?.name==="read_file");
      assert.equal(firstCall?.thoughtSignature,SYNTHETIC_SIGNATURE);
      assert.deepEqual(safeAdkFunctionHistoryShape(second),{
        function_call_messages:1,function_call_messages_missing_signature:0
      });
      assert.equal(JSON.stringify(safeAdkFunctionHistoryShape(second))
        .includes(SYNTHETIC_SIGNATURE),false);
    }
    assert.equal(directGatewayCalls,0);
    assert.deepEqual(calls,["read_file"]);
    assert.equal(outcomes.length,1);
    assert.equal(outcomes[0]?.name,"read_file");
    assert.deepEqual(outcomes[0]?.arguments,args);
    if(authorized) {
      assert.deepEqual(outcomes[0]?.payload,{ok:true,result});
    } else {
      assert.equal(outcomes[0]?.payload.ok,false);
      if(outcomes[0]?.payload.ok===false){
        assert.equal(outcomes[0].payload.error.kind,"authorization_denied");
      }
    }
    // No private token, signing key or downstream error enters the model request.
    const modelInput=JSON.stringify(model.requests);
    assert.equal(modelInput.includes(backend.privateKey),false);
    assert.equal(modelInput.includes(active.bearerFor("adk-mcp-task")),false);
    assert.equal(modelInput.includes("DO_NOT_EXPOSE_PRIVATE_WORKER_ERROR"),false);
    assert.equal(modelInput.includes("MCP_TASK_SIGNING_PRIVATE_KEY"),false);
    const declared=(model.requests[0]?.config?.tools??[])
      .flatMap(t=>t.functionDeclarations??[]).map(t=>t.name);
    assert.equal(declared.filter(name=>name==="read_file").length,1);
    assert.ok(declared.includes("update_file"),"Other controlled tools remain local");
  }finally{
    await built?.mcpToolset?.close();
    active.end("adk-mcp-task");
    await close(shared);
    await close(worker);
  }
}

test("Native ADK MCPToolset read_file reaches one shared server and its active worker",async()=>{
  await exercise(true);
});

test("Native ADK MCPToolset preserves worker authorization denial and cannot forge success",async()=>{
  await exercise(false);
});

test("Native shared MCP roundtrip retains synthetic signature after the function response",async()=>{
  await exercise(true,true);
});
