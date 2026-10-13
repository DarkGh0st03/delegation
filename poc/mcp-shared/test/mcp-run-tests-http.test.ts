import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import express from "express";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {createSharedMcpHttpServer} from "../src/http-server.ts";
import {TaskRouter} from "../src/task-router.ts";
import {PrivateMcpTaskRegistry} from "../../packages/agent-runtime/src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../../packages/agent-runtime/src/private-mcp-worker-http.ts";
import {ControlledToolError} from "../../packages/agent-runtime/src/controlled-errors.ts";
import {issueTaskToken} from "../src/task-token.ts";

function pair(){
  const k=generateKeyPairSync("ed25519");
  return {private:k.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    public:k.publicKey.export({type:"spki",format:"pem"}).toString()};
}
async function clientFor(url:string,token:string){
  const transport=new StreamableHTTPClientTransport(new URL(url+"/mcp"),{
    requestInit:{headers:{authorization:"Bearer "+token}}
  });
  const client=new Client({name:"test-runner-mcp-http",version:"0.1.0"},{capabilities:{}});
  await client.connect(transport);
  return client;
}
function close(server:{close:(cb:(e?:Error)=>void)=>unknown}){
  return new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
test("one shared MCP run_tests routes only opted-in active Test role through private Runner client",async()=>{
  const b=pair(),f=pair(),t=pair();
  const args={branch:"feature/account-suspension",profile:"poc-default"};
  const sha="a".repeat(40);
  const result={provider:"runner",performed:true,tool:"run_tests",
    branch:args.branch,revision:sha,tested_commit_sha:sha,
    runner_profile:"poc-default",status:"pass",
    phases:[{phase:"backend_tests",status:"pass"}],
    project_tests:{status:"pass",phases:[{phase:"backend_tests",status:"pass"}]},
    researcher_acceptance:{phase:"researcher_acceptance",status:"pass"}};
  let attempted=0;
  let fail=false;
  const registry=new PrivateMcpTaskRegistry({
    role:"test",signingPrivateKeyPem:t.private,signingPublicKeyPem:t.public});
  const gateway={invoke:async(tool:string,input:unknown)=>{
    attempted++;
    assert.equal(tool,"run_tests");
    assert.deepEqual(input,args);
    if(fail)throw new ControlledToolError("tests_failed","private runner failure details");
    return result;
  }};
  registry.begin("test-active",gateway,undefined,{allowRunTests:true});
  registry.begin("test-readonly",gateway);
  const app=express();
  attachPrivateMcpWorker(app,registry);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(res=>worker.once("listening",res));
  const workerUrl="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{backend:b.public,frontend:f.public,test:t.public},
    router:new TaskRouter({
      backend:{baseUrl:workerUrl},frontend:{baseUrl:workerUrl},test:{baseUrl:workerUrl}
    })
  });
  await new Promise<void>(res=>shared.listen(0,"127.0.0.1",res));
  const base="http://127.0.0.1:"+(shared.address() as AddressInfo).port;
  const clients:Client[]=[];
  try{
    const active=await clientFor(base,registry.bearerFor("test-active"));
    clients.push(active);
    assert.deepEqual((await active.listTools()).tools.map(x=>x.name),
      ["read_file","update_file","create_file","run_tests"]);
    const ok=await active.callTool({name:"run_tests",arguments:args});
    assert.notEqual(ok.isError,true);
    assert.deepEqual((ok.structuredContent as {result:unknown}).result,result);
    assert.equal(attempted,1);
    fail=true;
    const denied=await active.callTool({name:"run_tests",arguments:args});
    assert.equal(denied.isError,true);
    assert.equal((denied.structuredContent as {error:{kind:string}}).error.kind,"tests_failed");
    assert.equal(JSON.stringify(denied).includes("private runner failure details"),false);
    assert.equal(attempted,2);
    const wrongProfile=await active.callTool({name:"run_tests",
      arguments:{...args,profile:"shell-command"}});
    assert.equal(wrongProfile.isError,true);
    assert.equal(attempted,2,"Invalid profile must not reach Runner");
    const defaultClient=await clientFor(base,registry.bearerFor("test-readonly"));
    clients.push(defaultClient);
    const noOpt=await defaultClient.callTool({name:"run_tests",arguments:args});
    assert.equal(noOpt.isError,true);
    assert.equal(attempted,2,"Opt-out task must not reach Runner");
    const roleClient=await clientFor(base,issueTaskToken(b.private,"backend","test-active"));
    clients.push(roleClient);
    assert.equal((await roleClient.callTool({name:"run_tests",arguments:args})).isError,true);
    assert.equal(attempted,2,"Cross-role task must not reach Runner");
    registry.end("test-active");
    assert.equal((await active.callTool({name:"run_tests",arguments:args})).isError,true);
    assert.equal(attempted,2);
  }finally{
    registry.end("test-active");
    registry.end("test-readonly");
    for(const client of clients)await client.close();
    await close(shared);
    await close(worker);
  }
});
