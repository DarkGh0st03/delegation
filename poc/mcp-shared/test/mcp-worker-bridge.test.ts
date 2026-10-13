import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import express from "express";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {createSharedMcpHttpServer} from "../src/http-server.ts";
import {TaskRouter} from "../src/task-router.ts";
import {issueTaskToken} from "../src/task-token.ts";
import {PrivateMcpTaskRegistry} from "../../packages/agent-runtime/src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../../packages/agent-runtime/src/private-mcp-worker-http.ts";
import {DelegationEvidenceHandler} from "../../packages/agent-runtime/src/delegation-evidence-handler.ts";
import {GatewayControlledToolClient} from "../../packages/agent-runtime/src/gateway-tool-client.ts";

/**
 * All transport legs are real HTTP + the official MCP SDK.
 * Gateway and Adapter are deliberately simulated HTTP responses.
 * This does NOT constitute real Rust Verifier/OPA/Gitea E2E.
 */
const branch = "feature/account-suspension";
const path = "apps/backend/src/users/user.model.ts";
const resource = "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/" + path;

function keys() {
  const k = generateKeyPairSync("ed25519");
  return {
    private: k.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    public: k.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
async function listen(server: {listen:(port:number,host:string,cb:()=>void)=>unknown;address:()=>unknown}) {
  await new Promise<void>((resolve) => server.listen(0,"127.0.0.1",resolve));
  return "http://127.0.0.1:" + (server.address() as AddressInfo).port;
}
function close(server: {close:(cb:(err?:Error)=>void)=>unknown}) {
  return new Promise<void>((resolve,reject) => server.close(err=>err?reject(err):resolve()));
}
async function makeClient(url:string, bearer:string) {
  const transport = new StreamableHTTPClientTransport(new URL(url+"/mcp"),{
    requestInit:{headers:{authorization:"Bearer "+bearer}}
  });
  const client = new Client({name:"private-worker-bridge-test",version:"0.1.0"},{capabilities:{}});
  await client.connect(transport);
  return client;
}
test("shared MCP -> private active task -> Gateway prepare -> Adapter VP -> Gateway execute",async()=>{
  const backend=keys(),frontend=keys(),testing=keys();
  const trace:string[]=[];
  const fakeFetch:typeof fetch = async(input,init)=>{
    const url=String(input);
    const request=JSON.parse(String(init?.body)) as Record<string,unknown>;
    if(url.endsWith("/v1/authorization/prepare")){
      trace.push("gateway.prepare");
      assert.equal(request.agent_role,"backend");
      assert.equal(request.task_id,"task-A");
      assert.equal(request.tool,"read_file");
      assert.deepEqual(request.arguments,{branch,path});
      return Response.json({
        request_id:"req-A",audience:"cloud-access-gateway",challenge:"nonce-A",
        required_permission:{resource,operation:"read_file"},
        expires_at:"2030-01-01T00:00:00.000Z"
      });
    }
    if(url.endsWith("/v1/presentations")){
      trace.push("adapter.presentation");
      assert.equal(new Headers(init?.headers).get("authorization"),"Bearer backend-private-adapter-token");
      assert.equal(request.credential_id,"backend-task-A");
      assert.equal(request.challenge,"nonce-A");
      assert.deepEqual(request.disclosed_permissions,[{resource,operation:"read_file"}]);
      return Response.json({signed_vp:"signed-vp-A"});
    }
    if(url.endsWith("/v1/authorization/execute")){
      trace.push("gateway.execute");
      assert.deepEqual(request,{request_id:"req-A",signed_vp:"signed-vp-A"});
      return Response.json({execution:{
        provider:"gitea",performed:true,tool:"read_file",branch,path,
        revision:"a".repeat(40),blob_sha:"b".repeat(40),
        last_commit_sha:"a".repeat(40),size:4,encoding:"utf-8",content:"code"
      }});
    }
    throw new Error("Unexpected endpoint");
  };
  const evidence = new DelegationEvidenceHandler({
    adapterBaseUrl:"http://adapter.example.invalid",
    adapterToken:"backend-private-adapter-token",
    evidence:{credential:"private",credential_id:"backend-task-A",presenter_id:"backend"},
    fetchFn:fakeFetch
  });
  const gateway = new GatewayControlledToolClient({
    gatewayBaseUrl:"http://gateway.example.invalid",agentRole:"backend",
    taskId:"task-A",evidenceHandler:evidence,fetchFn:fakeFetch
  });
  const registry=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:backend.private,signingPublicKeyPem:backend.public
  });
  registry.begin("task-A",gateway);

  const agentApp=express();
  attachPrivateMcpWorker(agentApp,registry);
  const agentServer=agentApp.listen(0,"127.0.0.1");
  await new Promise<void>(r=>agentServer.once("listening",r));
  const agentUrl="http://127.0.0.1:"+(agentServer.address() as AddressInfo).port;

  const shared=createSharedMcpHttpServer({
    verificationKeys:{backend:backend.public,frontend:frontend.public,test:testing.public},
    router:new TaskRouter({
      backend:{baseUrl:agentUrl},frontend:{baseUrl:agentUrl},test:{baseUrl:agentUrl}
    })
  });
  const sharedUrl=await listen(shared);
  const clients:Client[]=[];
  try {
    const backendClient=await makeClient(sharedUrl,registry.bearerFor("task-A"));
    clients.push(backendClient);
    assert.deepEqual((await backendClient.listTools()).tools.map(t=>t.name),["read_file","update_file","create_file","run_tests"]);
    const result=await backendClient.callTool({name:"read_file",arguments:{branch,path}});
    assert.notEqual(result.isError,true);
    const output=result.structuredContent as {ok:boolean;result:{content:string}};
    assert.equal(output.ok,true);
    assert.equal(output.result.content,"code");
    assert.deepEqual(trace,["gateway.prepare","adapter.presentation","gateway.execute"]);

    // A valid signature for another task is not an active task authorization.
    const wrongTask=await makeClient(sharedUrl,issueTaskToken(backend.private,"backend","task-B"));
    clients.push(wrongTask);
    const denied=await wrongTask.callTool({name:"read_file",arguments:{branch,path}});
    assert.equal(denied.isError,true);
    assert.deepEqual(trace,["gateway.prepare","adapter.presentation","gateway.execute"]);

    // A different Agent role cannot borrow this Backend task worker.
    const wrongRole=await makeClient(sharedUrl,issueTaskToken(frontend.private,"frontend","task-A"));
    clients.push(wrongRole);
    const roleDenied=await wrongRole.callTool({name:"read_file",arguments:{branch,path}});
    assert.equal(roleDenied.isError,true);
    assert.equal(trace.length,3);

    registry.end("task-A");
    const afterStop=await backendClient.callTool({name:"read_file",arguments:{branch,path}});
    assert.equal(afterStop.isError,true);
    assert.equal(trace.length,3);
  } finally {
    for(const client of clients) await client.close();
    await close(shared);
    await close(agentServer);
  }
});
