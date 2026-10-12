/**
 * Real read-only authorization smoke:
 * official MCP Client -> ONE shared MCP HTTP server -> trusted private worker
 * -> Gateway prepare -> Rust Adapter signed VP -> Gateway execute
 * -> Rust Verifier -> OPA -> real Gitea provider.
 *
 * Intentionally avoids Gemini and does not modify the protected repository.
 * Requires the existing Phase 5A fixture and running services.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync, randomBytes} from "node:crypto";
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

const gatewayBaseUrl=process.env.GATEWAY_SMOKE_URL??"http://127.0.0.1:8080";
const adapterBaseUrl=process.env.ADAPTER_SMOKE_URL??"http://127.0.0.1:8090";
const expectedRevision=process.env.EXPECTED_GITEA_REVISION??"405748b1e77992b6bd8630a3ab6f990658d32f6b";
const taskId="mcp-real-read-A";
const args={branch:"feature/account-suspension",path:"apps/backend/src/users/user.service.ts"};
const notAuthorizedArgs={
  branch:args.branch,path:"apps/backend/src/users/user.model.ts"
};
const tokens={
  engineer:process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator:process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend:process.env.ADAPTER_CALLER_BACKEND
};
for(const [role,token] of Object.entries(tokens)){
  if(!token)throw new Error("MCP smoke missing Adapter caller configuration for "+role);
}
function keyPair(){
  const key=generateKeyPairSync("ed25519");
  return {
    privateKey:key.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:key.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
async function api(url,init={},expected=[200,201]){
  const response=await fetch(url,{...init,redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!expected.includes(response.status)){
    // Never echo Adapter/provider responses: they may contain credentials.
    throw new Error("smoke upstream response status "+response.status);
  }
  return response.json();
}
async function healthy(url,label){
  const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(label+" is not healthy");
  return response.json();
}
function status(index,base){
  return {type:"BitstringStatusListEntry",statusPurpose:"revocation",
    statusListIndex:String(index),statusListCredential:base};
}
function auth(token){
  return {authorization:"Bearer "+token,"content-type":"application/json"};
}
async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  return "http://127.0.0.1:"+(server.address()).port;
}
async function stop(server){
  if(!server)return;
  await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
async function makeClient(address,token){
  const transport=new StreamableHTTPClientTransport(new URL(address+"/mcp"),{
    requestInit:{headers:{authorization:"Bearer "+token}}
  });
  const client=new Client({name:"thesis-mcp-real-smoke",version:"0.1.0"},{capabilities:{}});
  await client.connect(transport);
  return client;
}
function readResult(response,label){
  assert.notEqual(response.isError,true,label+" was rejected");
  const envelope=response.structuredContent;
  assert.equal(envelope?.ok,true,label+" missing success envelope");
  const result=envelope.result;
  assert.equal(result?.provider,"gitea");
  assert.equal(result?.performed,true);
  assert.equal(result?.tool,"read_file");
  assert.equal(result?.path,args.path);
  assert.equal(result?.revision,expectedRevision);
  assert.match(result?.blob_sha??"",/^[a-f0-9]{40}$/u);
  assert.ok(typeof result?.content==="string" &&
    result.content.includes("export class UserService"));
  return result;
}
async function main(){
  const adapterHealth=await healthy(adapterBaseUrl+"/health","Adapter");
  const gatewayHealth=await healthy(gatewayBaseUrl+"/health","Gateway");
  assert.equal(gatewayHealth.provider,"gitea");
  void adapterHealth;
  const prepared=await api(gatewayBaseUrl+"/v1/authorization/prepare",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({task_id:taskId,agent_role:"backend",tool:"read_file",arguments:args})
  });
  assert.equal(prepared.required_permission.operation,"read_file");
  const tag=randomBytes(8).toString("hex");
  const rootId="urn:thesis:mcp-smoke:root:"+tag;
  const childId="urn:thesis:mcp-smoke:backend:"+tag;
  const statusBase="https://status.example/lists/mcp-shared-read";
  const now=new Date().toISOString();
  await api(adapterBaseUrl+"/v1/credentials/root",{
    method:"POST",headers:auth(tokens.engineer),
    body:JSON.stringify({
      credential_id:rootId,delegatee:"orchestrator",valid_from:now,
      validity_seconds:3600,credential_status:status(610,statusBase),
      permissions:[prepared.required_permission]
    })
  });
  await api(adapterBaseUrl+"/v1/credentials/child",{
    method:"POST",headers:auth(tokens.orchestrator),
    body:JSON.stringify({
      parent_credential_id:rootId,credential_id:childId,
      delegatee:"backend",valid_from:now,validity_seconds:1800,
      credential_status:status(611,statusBase),
      permissions:[prepared.required_permission]
    })
  });
  const evidence=new DelegationEvidenceHandler({
    adapterBaseUrl,adapterToken:tokens.backend,
    evidence:{credential:"",credential_id:childId,presenter_id:"did:thesis:backend-agent"}
  });
  const gatewayClient=new GatewayControlledToolClient({
    gatewayBaseUrl,agentRole:"backend",taskId,evidenceHandler: evidence
  });
  const backend=keyPair(),frontend=keyPair(),testing=keyPair();
  const registry=new PrivateMcpTaskRegistry({
    role:"backend",
    signingPrivateKeyPem:backend.privateKey,
    signingPublicKeyPem:backend.publicKey
  });
  registry.begin(taskId,gatewayClient);
  const agentApp=express();
  attachPrivateMcpWorker(agentApp,registry);
  let agentServer;
  let sharedServer;
  const clients=[];
  try {
    agentServer=agentApp.listen(0,"127.0.0.1");
    await new Promise(r=>agentServer.once("listening",r));
    const agentUrl="http://127.0.0.1:"+(agentServer.address()).port;
    sharedServer=createSharedMcpHttpServer({
      verificationKeys:{
        backend:backend.publicKey,
        frontend:frontend.publicKey,test:testing.publicKey
      },
      router:new TaskRouter({
        backend:{baseUrl:agentUrl},
        frontend:{baseUrl:agentUrl},
        test:{baseUrl:agentUrl}
      })
    });
    const sharedUrl=await listen(sharedServer);
    const c=await makeClient(sharedUrl,registry.bearerFor(taskId));
    clients.push(c);
    assert.deepEqual((await c.listTools()).tools.map(t=>t.name),["read_file","update_file","create_file","run_tests"]);
    const first=readResult(await c.callTool({name:"read_file",arguments:args}),"valid read");

    // DC does not authorize a different resource. Tool availability is irrelevant.
    const denied=await c.callTool({name:"read_file",arguments:notAuthorizedArgs});
    assert.equal(denied.isError,true,"out-of-scope DC read must be denied");

    // Another task has a validly signed identity bearer, but no active client/evidence.
    const other=await makeClient(sharedUrl,
      issueTaskToken(backend.privateKey,"backend","mcp-real-read-B"));
    clients.push(other);
    assert.equal((await other.callTool({name:"read_file",arguments:args})).isError,true);

    // A Frontend caller cannot borrow the Backend worker's task/evidence.
    const wrong=await makeClient(sharedUrl,
      issueTaskToken(frontend.privateKey,"frontend",taskId));
    clients.push(wrong);
    assert.equal((await wrong.callTool({name:"read_file",arguments:args})).isError,true);

    // Denials and reads must not mutate the protected Git branch.
    const second=readResult(await c.callTool({name:"read_file",arguments:args}),"post-denial read");
    assert.equal(second.content,first.content,"protected Gitea file changed");
    registry.end(taskId);
    assert.equal((await c.callTool({name:"read_file",arguments:args})).isError,true);
    process.stdout.write(JSON.stringify({
      event:"mcp_real_read_smoke",status:"PASS",
      phase:"real_adapter_verifier_opa_gitea",
      provider:"gitea",revision:first.revision,
      tests:["allow","out_of_scope_deny","cross_task_deny",
             "cross_role_deny","inactive_task_deny","unchanged_file"]
    })+"\n");
  }finally{
    registry.end(taskId);
    for(const c of clients)await c.close();
    await stop(sharedServer);
    await stop(agentServer);
  }
}
await main();
