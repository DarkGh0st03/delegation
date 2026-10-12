import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import express from "express";
import {BaseLlm,InMemorySessionService,Runner,type LlmRequest,
  type LlmResponse,type BaseLlmConnection} from "@google/adk";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";

const args={branch:"feature/account-suspension",path:"apps/backend/src/users/user.service.ts",
  content:"export class UserService { suspend() {} }"};
const sha="e".repeat(40);
const confirmed={provider:"gitea",performed:true,tool:"update_file",
  branch:args.branch,path:args.path,revision:sha,commit_sha:sha,
  blob_sha:"f".repeat(40),precondition_blob_sha:"d".repeat(40)};
function pair(){
  const kp=generateKeyPairSync("ed25519");
  return {private:kp.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    public:kp.publicKey.export({format:"pem",type:"spki"}).toString()};
}
class ScriptedWriteModel extends BaseLlm {
  requests:LlmRequest[]=[];
  constructor(){super({model:"scripted-update-mcp-no-provider"});}
  override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
    this.requests.push(req);
    if(this.requests.length===1)yield {content:{role:"model",parts:[{
      functionCall:{id:"mcp-write-1",name:"update_file",args}
    }]}};
    else yield {content:{role:"model",parts:[{text:"Done"}]}};
  }
  override connect(_req:LlmRequest):Promise<BaseLlmConnection>{
    throw new Error("External model use prohibited");
  }
}
function close(s:{close:(cb:(err?:Error)=>void)=>unknown}){
  return new Promise<void>((resolve,reject)=>s.close(e=>e?reject(e):resolve()));
}
test("Native ADK update_file uses opted-in MCPToolset without direct FunctionTool write",async()=>{
  const b=pair(),f=pair(),t=pair();
  const calls:string[]=[];
  const active=new PrivateMcpTaskRegistry({role:"backend",
    signingPrivateKeyPem:b.private,signingPublicKeyPem:b.public});
  active.begin("adk-write",{
    invoke:async(tool,payload)=>{
      calls.push(tool);assert.deepEqual(payload,args);
      return confirmed;
    }
  });
  const app=express();attachPrivateMcpWorker(app,active);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(r=>worker.once("listening",r));
  const url="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{backend:b.public,frontend:f.public,test:t.public},
    router:new TaskRouter({backend:{baseUrl:url},frontend:{baseUrl:url},test:{baseUrl:url}})
  });
  await new Promise<void>(r=>shared.listen(0,"127.0.0.1",r));
  const endpoint="http://127.0.0.1:"+(shared.address() as AddressInfo).port+"/mcp";
  let built:ReturnType<typeof createAdkSpecializedAgent>|undefined;
  try{
    let bypass=0;
    const model=new ScriptedWriteModel();
    const outcomes:unknown[]=[];
    built=createAdkSpecializedAgent({
      role:"backend",model,
      gatewayClient:{invoke:async()=>{bypass++;throw new Error("legacy bypass");}} as never,
      mcpReadFile:{endpoint,bearerForRequest:()=>active.bearerFor("adk-write")},
      mcpUpdateFile:true,
      onToolOutcome:o=>outcomes.push(o)
    });
    const sessions=new InMemorySessionService();
    const runner=new Runner({appName:"native_mcp_write",agent:built.agent,sessionService:sessions});
    await sessions.createSession({appName:"native_mcp_write",userId:"test",sessionId:"adk-write"});
    for await(const _ of runner.runAsync({userId:"test",sessionId:"adk-write",
      newMessage:{role:"user",parts:[{text:"Update delegated Backend file"}]}})){}
    assert.equal(model.requests.length,2);
    assert.equal(bypass,0);
    assert.deepEqual(calls,["update_file"]);
    assert.deepEqual(outcomes,[{name:"update_file",arguments:args,payload:{ok:true,result:confirmed}}]);
    const advertised=(model.requests[0]?.config?.tools??[])
      .flatMap(t=>t.functionDeclarations??[]).map(t=>t.name);
    assert.deepEqual(advertised.filter(n=>n==="update_file"),["update_file"]);
    assert.ok(!JSON.stringify(model.requests).includes(b.private));
    assert.ok(!JSON.stringify(model.requests).includes(active.bearerFor("adk-write")));
  }finally{
    await built?.mcpToolset?.close();active.end("adk-write");
    await close(shared);await close(worker);
  }
});
