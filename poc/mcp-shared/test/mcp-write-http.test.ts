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
  return {
    private:k.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    public:k.publicKey.export({type:"spki",format:"pem"}).toString()
  };
}
async function listen(server:{listen:(n:number,h:string,cb:()=>void)=>unknown;address:()=>unknown}){
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  return "http://127.0.0.1:"+(server.address() as AddressInfo).port;
}
function stop(server:{close:(cb:(err?:Error)=>void)=>unknown}){
  return new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}
async function clientFor(url:string,token:string){
  const transport=new StreamableHTTPClientTransport(new URL(url+"/mcp"),{
    requestInit:{headers:{authorization:"Bearer "+token}}
  });
  const client=new Client({name:"mcp-write-authorization-test",version:"0.1.0"},{capabilities:{}});
  await client.connect(transport);
  return client;
}
test("ONE shared MCP update_file routes only permitted active task writes to private client",async()=>{
  const b=pair(),f=pair(),t=pair();
  const branch="feature/account-suspension";
  const allowed={branch,path:"apps/backend/src/users/user.service.ts",content:"export class UserService {}"};
  const outScope={branch,path:"apps/backend/src/users/user.controller.ts",content:"export class UserController {}"};
  const wrongRolePath={branch,path:"apps/frontend/src/styles.css",content:"html {}"};
  const calls:Array<{tool:string;args:unknown}>=[];
  const confirmed={
    provider:"gitea",performed:true,tool:"update_file",
    branch,path:allowed.path,revision:"a".repeat(40),commit_sha:"a".repeat(40),
    blob_sha:"b".repeat(40),precondition_blob_sha:"c".repeat(40)
  };
  const registry=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:b.private,signingPublicKeyPem:b.public
  });
  registry.begin("write-task",{
    invoke:async(tool,args)=>{
      calls.push({tool,args});
      if(args.path!==allowed.path)throw new ControlledToolError(
        "authorization_denied","Mock Gateway policy denied write"
      );
      return confirmed;
    }
  },undefined,{allowUpdateFile:true});
  const app=express();
  attachPrivateMcpWorker(app,registry);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>worker.once("listening",resolve));
  const url="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{backend:b.public,frontend:f.public,test:t.public},
    router:new TaskRouter({backend:{baseUrl:url},frontend:{baseUrl:url},test:{baseUrl:url}})
  });
  const sharedUrl=await listen(shared);
  const clients:Client[]=[];
  try{
    const c=await clientFor(sharedUrl,registry.bearerFor("write-task"));
    clients.push(c);
    assert.deepEqual((await c.listTools()).tools.map(x=>x.name),
      ["read_file","update_file","create_file"]);
    const wrote=await c.callTool({name:"update_file",arguments:allowed});
    assert.notEqual(wrote.isError,true);
    assert.equal((wrote.structuredContent as {result?:{commit_sha?:string};error?:{kind?:string}})?.result?.commit_sha,confirmed.commit_sha);
    assert.deepEqual(calls,[{tool:"update_file",args:allowed}]);
    const denied=await c.callTool({name:"update_file",arguments:outScope});
    assert.equal(denied.isError,true);
    assert.equal((denied.structuredContent as {result?:{commit_sha?:string};error?:{kind?:string}})?.error?.kind,"authorization_denied");
    assert.equal(calls.length,2);
    const localScope=await c.callTool({name:"update_file",arguments:wrongRolePath});
    assert.equal(localScope.isError,true);
    assert.equal((localScope.structuredContent as {result?:{commit_sha?:string};error?:{kind?:string}})?.error?.kind,"invalid_tool_call");
    assert.equal(calls.length,2,"Wrong-role writable path reached trusted Gateway client");
    const frontendCaller=await clientFor(sharedUrl,
      issueTaskToken(f.private,"frontend","write-task"));
    clients.push(frontendCaller);
    assert.equal((await frontendCaller.callTool({
      name:"update_file",arguments:allowed
    })).isError,true);
    assert.equal(calls.length,2,"Cross-role update reached trusted Gateway client");
    const inactive=await clientFor(sharedUrl,issueTaskToken(b.private,"backend","other-task"));
    clients.push(inactive);
    assert.equal((await inactive.callTool({name:"update_file",arguments:allowed})).isError,true);
    assert.equal(calls.length,2);
    registry.end("write-task");
    assert.equal((await c.callTool({name:"update_file",arguments:allowed})).isError,true);
    assert.equal(calls.length,2);
  }finally{
    registry.end("write-task");
    for(const c of clients)await c.close();
    await stop(shared);await stop(worker);
  }
});
