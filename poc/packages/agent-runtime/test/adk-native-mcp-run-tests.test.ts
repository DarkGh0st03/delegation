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

const args={branch:"feature/account-suspension",profile:"poc-default"};
const sha="f".repeat(40);
const execution={provider:"runner",performed:true,tool:"run_tests",
  branch:args.branch,revision:sha,tested_commit_sha:sha,runner_profile:"poc-default",
  status:"pass",phases:[{phase:"backend_tests",status:"pass"}],
  project_tests:{status:"pass",phases:[{phase:"backend_tests",status:"pass"}]},
  researcher_acceptance:{phase:"researcher_acceptance",status:"pass"}};
function keys(){
  const k=generateKeyPairSync("ed25519");
  return {privateKey:k.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKey:k.publicKey.export({type:"spki",format:"pem"}).toString()};
}
class ScriptedTestsModel extends BaseLlm{
  requests:LlmRequest[]=[];
  constructor(){super({model:"scripted-mcp-tests-no-provider"});}
  override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
    this.requests.push(request);
    if(this.requests.length===1){
      yield {content:{role:"model",parts:[{
        functionCall:{id:"mcp-runner",name:"run_tests",args}
      }]}};
    }else yield {content:{role:"model",parts:[{text:"Done"}]}};
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    throw new Error("No paid model connection permitted");
  }
}
function close(server:{close:(cb:(error?:Error)=>void)=>unknown}){
  return new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
test("native ADK Test Agent calls run_tests via shared MCP and verifies Runner PASS",async()=>{
  const b=keys(),f=keys(),t=keys();
  const seen:string[]=[];
  const tasks=new PrivateMcpTaskRegistry({role:"test",
    signingPrivateKeyPem:t.privateKey,signingPublicKeyPem:t.publicKey});
  tasks.begin("mcp-runner-task",{
    invoke:async(tool,payload)=>{
      seen.push(tool);assert.deepEqual(payload,args);
      return execution;
    }
  },undefined,{allowRunTests:true});
  const app=express();
  attachPrivateMcpWorker(app,tasks);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(res=>worker.once("listening",res));
  const workerUrl="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{backend:b.publicKey,frontend:f.publicKey,test:t.publicKey},
    router:new TaskRouter({backend:{baseUrl:workerUrl},
      frontend:{baseUrl:workerUrl},test:{baseUrl:workerUrl}})
  });
  await new Promise<void>(res=>shared.listen(0,"127.0.0.1",res));
  const endpoint="http://127.0.0.1:"+(shared.address() as AddressInfo).port+"/mcp";
  let built:ReturnType<typeof createAdkSpecializedAgent>|undefined;
  try{
    let bypass=0;
    const model=new ScriptedTestsModel();
    const outcomes:unknown[]=[];
    built=createAdkSpecializedAgent({role:"test",model,
      gatewayClient:{invoke:async()=>{bypass++;throw new Error("legacy bypass");}} as never,
      mcpReadFile:{endpoint,bearerForRequest:()=>tasks.bearerFor("mcp-runner-task")},
      mcpRunTests:true,
      onToolOutcome:event=>outcomes.push(event)
    });
    const sessions=new InMemorySessionService();
    const runner=new Runner({appName:"native_mcp_run_tests",agent:built.agent,
      sessionService:sessions});
    await sessions.createSession({appName:"native_mcp_run_tests",userId:"offline",
      sessionId:"mcp-runner-task"});
    for await(const _event of runner.runAsync({
      userId:"offline",sessionId:"mcp-runner-task",
      newMessage:{role:"user",parts:[{text:"Run controlled tests"}]}
    })){}
    assert.equal(model.requests.length,2);
    assert.deepEqual(seen,["run_tests"]);
    assert.equal(bypass,0);
    assert.deepEqual(outcomes,[{name:"run_tests",arguments:args,
      payload:{ok:true,result:execution}}]);
    const declared=(model.requests[0]?.config?.tools??[])
      .flatMap(t=>t.functionDeclarations??[]).map(t=>t.name);
    assert.deepEqual(declared.filter(n=>n==="run_tests"),["run_tests"]);
    assert.ok(declared.includes("create_file"),"Create remains legacy unless separately opted in");
    const modelContext=JSON.stringify(model.requests);
    assert.equal(modelContext.includes(t.privateKey),false);
    assert.equal(modelContext.includes(tasks.bearerFor("mcp-runner-task")),false);
  }finally{
    await built?.mcpToolset?.close();
    tasks.end("mcp-runner-task");
    await close(shared);
    await close(worker);
  }
});
