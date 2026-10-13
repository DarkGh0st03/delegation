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
import {issueTaskToken} from "../src/task-token.ts";

function keyPair(){
  const k=generateKeyPairSync("ed25519");
  return {
    privateKey:k.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:k.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
async function makeClient(base:string,token:string){
  const transport=new StreamableHTTPClientTransport(new URL(base+"/mcp"),{
    requestInit:{headers:{authorization:"Bearer "+token}}
  });
  const client=new Client({name:"mcp-test-create",version:"0.1.0"},{capabilities:{}});
  await client.connect(transport);
  return client;
}
function close(server:{close:(cb:(err?:Error)=>void)=>unknown}){
  return new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}

test("shared MCP create_file requires active Test task, explicit opt-in and exact creatable path",async()=>{
  const backend=keyPair(),front=keyPair(),testKey=keyPair();
  const args={
    branch:"feature/account-suspension",
    path:"tests/e2e/account-suspension.spec.ts",
    content:"import { test } from '@playwright/test';"
  };
  const confirmed={provider:"gitea",performed:true,tool:"create_file",
    branch:args.branch,path:args.path,revision:"a".repeat(40),
    commit_sha:"a".repeat(40),blob_sha:"b".repeat(40)};
  const calls:string[]=[];
  const registry=new PrivateMcpTaskRegistry({role:"test",
    signingPrivateKeyPem:testKey.privateKey,signingPublicKeyPem:testKey.publicKey});
  const mock={invoke:async(tool:string,input:unknown)=>{
    calls.push(tool);
    assert.deepEqual(input,args);
    return confirmed;
  }};
  registry.begin("test-inactive-create",mock);
  registry.begin("test-create",mock,undefined,{allowCreateFile:true});
  const app=express();
  attachPrivateMcpWorker(app,registry);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(r=>worker.once("listening",r));
  const url="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{
      backend:backend.publicKey,frontend:front.publicKey,test:testKey.publicKey
    },
    router:new TaskRouter({
      backend:{baseUrl:url},frontend:{baseUrl:url},test:{baseUrl:url}
    })
  });
  await new Promise<void>(r=>shared.listen(0,"127.0.0.1",r));
  const base="http://127.0.0.1:"+(shared.address() as AddressInfo).port;
  const clients:Client[]=[];
  try{
    const c=await makeClient(base,registry.bearerFor("test-create"));
    clients.push(c);
    assert.deepEqual((await c.listTools()).tools.map(t=>t.name),
      ["read_file","update_file","create_file","run_tests"]);
    const success=await c.callTool({name:"create_file",arguments:args});
    assert.notEqual(success.isError,true);
    assert.deepEqual((success.structuredContent as {result:unknown}).result,confirmed);
    assert.deepEqual(calls,["create_file"]);

    const wrongPath=await c.callTool({name:"create_file",
      arguments:{...args,path:"apps/backend/src/users/user.service.ts"}});
    assert.equal(wrongPath.isError,true);
    assert.equal(calls.length,1);

    const defaultDenied=await makeClient(base,registry.bearerFor("test-inactive-create"));
    clients.push(defaultDenied);
    assert.equal((await defaultDenied.callTool({name:"create_file",arguments:args})).isError,true);
    assert.equal(calls.length,1);

    const backendCaller=await makeClient(base,
      issueTaskToken(backend.privateKey,"backend","test-create"));
    clients.push(backendCaller);
    assert.equal((await backendCaller.callTool({name:"create_file",arguments:args})).isError,true);
    assert.equal(calls.length,1);

    registry.end("test-create");
    assert.equal((await c.callTool({name:"create_file",arguments:args})).isError,true);
    assert.equal(calls.length,1);
  }finally{
    registry.end("test-create");
    registry.end("test-inactive-create");
    for(const c of clients)await c.close();
    await close(shared);
    await close(worker);
  }
});
