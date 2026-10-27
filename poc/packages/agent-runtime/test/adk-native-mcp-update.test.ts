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
  },undefined,{allowUpdateFile:true});
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


/**
 * Regression for the alternative ALREADY permitted by the Gemini Planner:
 * a Test Agent reads and updates an existing discovered test file before
 * invoking Docker tests, rather than creating a new test file.
 *
 * Exercise the real ADK/MCP HTTP bridges with prebound Task permissions.
 * The stub Gateway response represents trusted provider effects only;
 * signature/OPA verification is covered independently by the native E2E.
 */
test("reviewed Test Agent read -> update existing regression -> run_tests remains scoped",async()=>{
  const b=pair(),f=pair(),t=pair();
  const branch="feature/account-suspension";
  const path="tests/backend/user.service.test.ts";
  const forbidden="apps/backend/src/users/user.service.ts";
  const original="test('existing user validation',()=>{});\n";
  const revised="test('existing user validation',()=>{});\ntest('suspension authorization',()=>{});\n";
  const initialSha="a".repeat(40),updatedSha="b".repeat(40);
  const operations=[
    {name:"read_file",args:{branch,path}},
    {name:"update_file",args:{branch,path,content:revised}},
    {name:"run_tests",args:{branch,profile:"poc-default"}}
  ];
  class TestUpdateModel extends BaseLlm{
    requests:LlmRequest[]=[];
    constructor(){super({model:"offline-test-existing-file-update"});}
    override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
      this.requests.push(req);
      const step=this.requests.length-1;
      if(step<operations.length){
        const op=operations[step];
        yield {content:{role:"model",parts:[{functionCall:{
          id:"reviewed-test-"+step,name:op.name,args:op.args
        }}]}};
      }else yield {content:{role:"model",parts:[{text:"Test evidence is complete."}]}};
    }
    override connect(_req:LlmRequest):Promise<BaseLlmConnection>{
      throw Error("Real provider not permitted in offline signed-scope regression");
    }
  }
  const registry=new PrivateMcpTaskRegistry({
    role:"test",signingPrivateKeyPem:t.private,signingPublicKeyPem:t.public
  });
  const observed:string[]=[];
  let content=original;
  registry.begin("reviewed-test-update",{
    invoke:async(tool,args)=>{
      observed.push(tool);
      if(tool==="read_file"){
        assert.deepEqual(args,{branch,path});
        return {provider:"gitea",performed:true,tool,branch,path,
          revision:initialSha,content};
      }
      if(tool==="update_file"){
        assert.deepEqual(args,{branch,path,content:revised});
        assert.equal(content,original);
        content=revised;
        return {provider:"gitea",performed:true,tool,branch,path,
          revision:updatedSha,commit_sha:updatedSha,
          blob_sha:"c".repeat(40),precondition_blob_sha:"d".repeat(40)};
      }
      assert.equal(tool,"run_tests");
      assert.deepEqual(args,{branch,profile:"poc-default"});
      assert.equal(content,revised);
      return {provider:"runner",performed:true,tool,branch,
        revision:updatedSha,tested_commit_sha:updatedSha,
        runner_profile:"poc-default",status:"pass",
        phases:[{phase:"backend_tests",status:"pass"}],
        project_tests:{status:"pass",phases:[{phase:"backend_tests",status:"pass"}]},
        researcher_acceptance:{phase:"researcher_acceptance",status:"pass"}};
    }
  },undefined,{
    approvedBranch:branch,allowedPaths:[path],
    allowedFilePermissions:[
      {operation:"read_file",path},{operation:"update_file",path}
    ],
    allowUpdateFile:true,allowCreateFile:false,allowRunTests:true
  });
  const app=express();attachPrivateMcpWorker(app,registry);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>worker.once("listening",resolve));
  const workerUrl="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{backend:b.public,frontend:f.public,test:t.public},
    router:new TaskRouter({backend:{baseUrl:workerUrl},
      frontend:{baseUrl:workerUrl},test:{baseUrl:workerUrl}})
  });
  await new Promise<void>(resolve=>shared.listen(0,"127.0.0.1",resolve));
  const endpoint="http://127.0.0.1:"+(shared.address() as AddressInfo).port+"/mcp";
  let built:ReturnType<typeof createAdkSpecializedAgent>|undefined;
  try{
    let bypass=0;
    const model=new TestUpdateModel();
    const outcomes:Array<{name:string;payload:{ok:boolean}}>= [];
    built=createAdkSpecializedAgent({
      role:"test",model,
      gatewayClient:{invoke:async()=>{bypass++;throw Error("Unapproved bypass");}} as never,
      trustedBranch:branch,trustedTaskPaths:[path],
      trustedFilePermissions:[
        {path,operation:"read_file"},{path,operation:"update_file"}
      ],
      mcpReadFile:{endpoint,
        bearerForRequest:()=>registry.bearerFor("reviewed-test-update")},
      mcpUpdateFile:true,mcpRunTests:true,
      onToolOutcome:event=>outcomes.push(event)
    });
    const sessions=new InMemorySessionService();
    const runner=new Runner({
      appName:"reviewed_test_update",agent:built.agent,sessionService:sessions
    });
    await sessions.createSession({
      appName:"reviewed_test_update",userId:"offline",sessionId:"reviewed-test-update"
    });
    for await(const _ of runner.runAsync({
      userId:"offline",sessionId:"reviewed-test-update",
      newMessage:{role:"user",parts:[{text:"Edit approved existing Account Suspension regression test, then run controlled tests."}]}
    })){}
    assert.equal(model.requests.length,4);
    assert.equal(bypass,0);
    assert.equal(content,revised);
    assert.deepEqual(observed,["read_file","update_file","run_tests"]);
    assert.deepEqual(outcomes.map(x=>[x.name,x.payload.ok]),
      [["read_file",true],["update_file",true],["run_tests",true]]);
    const declared=(model.requests[0]?.config?.tools??[])
      .flatMap(x=>x.functionDeclarations??[]).map(x=>x.name);
    for(const name of ["read_file","update_file","run_tests"])
      assert.ok(declared.includes(name),"Missing approved Test tool "+name);
    assert.ok(!declared.includes("create_file"),
      "Test role must not gain a create-file tool without a grant");
    const token="Bearer "+registry.bearerFor("reviewed-test-update");
    for(const bad of [
      {tool:"update_file",arguments:{branch,path:forbidden,content:"unauthorized"}},
      {tool:"create_file",arguments:{branch,path,content:"unauthorized"}}
    ])await assert.rejects(registry.invoke(token,bad),/invalid_tool_call/);
    assert.equal(observed.length,3,"Denied operations must not reach Gateway");
    const visible=JSON.stringify(model.requests);
    assert.ok(!visible.includes(t.private));
    assert.ok(!visible.includes(registry.bearerFor("reviewed-test-update")));
  }finally{
    await built?.mcpToolset?.close();
    registry.end("reviewed-test-update");
    await close(shared);await close(worker);
  }
});
