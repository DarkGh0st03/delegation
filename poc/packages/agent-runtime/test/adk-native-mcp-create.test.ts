import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import express from "express";
import {BaseLlm,InMemorySessionService,Runner,
  type LlmRequest,type LlmResponse,type BaseLlmConnection} from "@google/adk";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";

const args={
  branch:"feature/account-suspension",
  path:"tests/e2e/account-suspension.spec.ts",
  content:"import { test } from '@playwright/test';\ntest('account suspension',()=>{});"
};
const sha="c".repeat(40);
const confirmed={
  provider:"gitea",performed:true,tool:"create_file",
  branch:args.branch,path:args.path,revision:sha,commit_sha:sha,blob_sha:"d".repeat(40)
};
function keys(){
  const key=generateKeyPairSync("ed25519");
  return {
    privateKey:key.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKey:key.publicKey.export({type:"spki",format:"pem"}).toString()
  };
}
class ScriptedCreateModel extends BaseLlm{
  requests:LlmRequest[]=[];
  constructor(){super({model:"scripted-mcp-create-no-provider"});}
  override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
    this.requests.push(req);
    if(this.requests.length===1){
      yield {content:{role:"model",parts:[{
        functionCall:{id:"mcp-create",name:"create_file",args}
      }]}};
    }else yield {content:{role:"model",parts:[{text:"Test file created"}]}};
  }
  override connect(_req:LlmRequest):Promise<BaseLlmConnection>{
    throw new Error("External model invocation disabled");
  }
}
function close(server:{close:(cb:(err?:Error)=>void)=>unknown}){
  return new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
test("native ADK Test Agent create_file invokes shared MCP, not legacy FunctionTool",async()=>{
  const b=keys(),f=keys(),t=keys();
  const reached:string[]=[];
  const registry=new PrivateMcpTaskRegistry({
    role:"test",signingPrivateKeyPem:t.privateKey,signingPublicKeyPem:t.publicKey
  });
  registry.begin("adk-create",{
    invoke:async(tool,payload)=>{
      reached.push(tool);
      assert.deepEqual(payload,args);
      return confirmed;
    }
  },undefined,{allowCreateFile:true});
  const app=express();
  attachPrivateMcpWorker(app,registry);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>worker.once("listening",resolve));
  const workerUrl="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{
      backend:b.publicKey,frontend:f.publicKey,test:t.publicKey
    },
    router:new TaskRouter({
      backend:{baseUrl:workerUrl},
      frontend:{baseUrl:workerUrl},
      test:{baseUrl:workerUrl}
    })
  });
  await new Promise<void>(resolve=>shared.listen(0,"127.0.0.1",resolve));
  const endpoint="http://127.0.0.1:"+(shared.address() as AddressInfo).port+"/mcp";
  let built:ReturnType<typeof createAdkSpecializedAgent>|undefined;
  try{
    const model=new ScriptedCreateModel();
    const outcomes:unknown[]=[];
    let directCalls=0;
    built=createAdkSpecializedAgent({
      role:"test",model,
      gatewayClient:{invoke:async()=>{directCalls++;throw new Error("legacy tool bypass");}} as never,
      mcpReadFile:{endpoint,bearerForRequest:()=>registry.bearerFor("adk-create")},
      mcpCreateFile:true,
      onToolOutcome:outcome=>outcomes.push(outcome)
    });
    const sessions=new InMemorySessionService();
    const appName="mcp_native_test_create";
    const runner=new Runner({appName,agent:built.agent,sessionService:sessions});
    await sessions.createSession({appName,userId:"offline",sessionId:"adk-create"});
    for await(const _event of runner.runAsync({
      userId:"offline",sessionId:"adk-create",
      newMessage:{role:"user",parts:[{text:"Create the authorized E2E test file"}]}
    })){}
    assert.equal(model.requests.length,2);
    assert.deepEqual(reached,["create_file"]);
    assert.equal(directCalls,0);
    assert.deepEqual(outcomes,[{name:"create_file",arguments:args,payload:{ok:true,result:confirmed}}]);
    const advertised=(model.requests[0]?.config?.tools??[])
      .flatMap(t=>t.functionDeclarations??[]).map(t=>t.name);
    assert.deepEqual(advertised.filter(t=>t==="create_file"),["create_file"]);
    assert.ok(advertised.includes("run_tests"),"Test runner remains a FunctionTool");
    const modelText=JSON.stringify(model.requests);
    assert.equal(modelText.includes(t.privateKey),false);
    assert.equal(modelText.includes(registry.bearerFor("adk-create")),false);
  }finally{
    await built?.mcpToolset?.close();
    registry.end("adk-create");
    await close(shared);
    await close(worker);
  }
});
