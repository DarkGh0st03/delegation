/**
 * Opt-in REAL protected A2A -> native Google ADK -> ONE shared MCP server
 * -> private per-task Worker -> Gateway -> Rust Verifier / OPA -> Gitea.
 *
 * Intentionally read-only: an A2A task must FAIL CLOSED without a confirmed
 * Git revision, even when its delegated read_file succeeds.
 * Uses a local scripted BaseLlm. NEVER contacts Gemini/OpenAI.
 * Requires running local Phase 5A Gitea/OPA/Adapter/read-only Gateway.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes,randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {BaseLlm} from "@google/adk";
import {Role,TaskState} from "@a2a-js/sdk";
import {
  ClientFactory,ClientFactoryOptions,ServiceParameters,withA2AExtensions
} from "@a2a-js/sdk/client";
import {
  DELEGATED_AUTHORIZATION_EXTENSION_URI,
  assertDelegatedAuthorizationSupport,
  startSpecializedAgentServer
} from "../src/index.ts";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";
import {issueTaskToken} from "../../../mcp-shared/src/task-token.ts";

const gatewayUrl=process.env.GATEWAY_SMOKE_URL??"http://127.0.0.1:8080";
const adapterUrl=process.env.ADAPTER_SMOKE_URL??"http://127.0.0.1:8090";
const expectedRevision=process.env.EXPECTED_GITEA_REVISION??"405748b1e77992b6bd8630a3ab6f990658d32f6b";
const branch="feature/account-suspension";
const permitted={branch,path:"apps/backend/src/users/user.service.ts"};
// Same Backend model-visible read-only context, but absent from delegated DC.
const forbidden={branch,path:"apps/backend/src/users/user.model.ts"};
const tokens={
  engineer:process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator:process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend:process.env.ADAPTER_CALLER_BACKEND
};
for(const [role,secret] of Object.entries(tokens)) {
  if(!secret)throw new Error("Missing local Adapter token for "+role);
}
const privateEvidence="A2A_PRIVATE_EVIDENCE_"+randomBytes(16).toString("hex");

class ScriptedA2AReadModel extends BaseLlm {
  requests=[];
  nextArgs=permitted;
  turn=0;
  constructor(){super({model:"scripted-a2a-mcp-no-provider"});}
  async *generateContentAsync(request){
    this.requests.push(request);
    this.turn++;
    if(this.turn===1) {
      yield {content:{role:"model",parts:[{functionCall:{
        id:"a2a-mcp-read-"+this.requests.length,name:"read_file",args:this.nextArgs
      }}]}};
    }else{
      yield {content:{role:"model",parts:[{text:"Controlled read attempted"}]}};
    }
  }
  connect(){return Promise.reject(new Error("External model calls are disabled"));}
  startTask(args){this.nextArgs=args;this.turn=0;}
}
function keypair(){
  const kp=generateKeyPairSync("ed25519");
  return {
    privateKey:kp.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:kp.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
async function api(url,options={},expected=[200,201]){
  const response=await fetch(url,{
    ...options,redirect:"error",signal:AbortSignal.timeout(10000)
  });
  // Never echo upstream response bodies or credentials.
  if(!expected.includes(response.status))throw new Error("Upstream HTTP "+response.status);
  return response.json();
}
function auth(token){
  return {authorization:"Bearer "+token,"content-type":"application/json"};
}
function credentialStatus(index){
  return {type:"BitstringStatusListEntry",statusPurpose:"revocation",
    statusListIndex:String(index),
    statusListCredential:"https://status.example/lists/a2a-shared-mcp-read"};
}
async function unusedPort(){
  const server=createServer();
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  return port;
}
async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  return "http://127.0.0.1:"+server.address().port;
}
async function stop(server){
  if(server)await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}
async function clientFor(agentUrl){
  const factory=new ClientFactory(ClientFactoryOptions.createFrom(
    ClientFactoryOptions.default,{preferredTransports:["HTTP+JSON"]}
  ));
  const client=await factory.createFromUrl(agentUrl);
  const card=await client.getAgentCard();
  assertDelegatedAuthorizationSupport(card);
  return client;
}
async function protectedRead(client,args,credentialId,label){
  const output=await client.sendMessage({
    tenant:"",
    message:{
      messageId:randomUUID(),contextId:"",taskId:"",role:Role.ROLE_USER,
      parts:[{content:{$case:"data",value:{
        subtask_id:label,
        instruction:"Attempt only the delegated read; never change repository files",
        branch,relevant_paths:[args.path]
      }},metadata:undefined,filename:"",mediaType:"application/json"}],
      metadata:{delegation_evidence:{
        credential:privateEvidence,
        credential_id:credentialId,
        presenter_id:"did:thesis:backend-agent"
      }},
      extensions:[DELEGATED_AUTHORIZATION_EXTENSION_URI],
      referenceTaskIds:[]
    },
    configuration:{
      acceptedOutputModes:["application/json"],
      taskPushNotificationConfig:undefined,
      historyLength:0,returnImmediately:true
    },
    metadata:{workflow:"account-suspension"}
  },{serviceParameters:ServiceParameters.create(
    withA2AExtensions(DELEGATED_AUTHORIZATION_EXTENSION_URI)
  )});
  assert.ok(output&&typeof output==="object"&&"id" in output&&output.id);
  let task=output;
  const stopAt=Date.now()+30000;
  const finished=new Set([
    TaskState.TASK_STATE_COMPLETED,TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_CANCELED,TaskState.TASK_STATE_REJECTED
  ]);
  while(!finished.has(task.status?.state)){
    if(Date.now()>stopAt)throw new Error("A2A protected read timed out");
    await delay(150);
    task=await client.getTask({id:output.id,historyLength:0},{
      signal:AbortSignal.timeout(5000)
    });
  }
  assert.equal(task.status?.state,TaskState.TASK_STATE_FAILED,
    "Read-only A2A must not publish success without a confirmed Git revision");
  assert.equal(task.artifacts?.length??0,0,"Failed A2A published an Artifact");
  assert.equal(task.history?.length??0,0,"Protected A2A returned task history");
  assert.ok(!JSON.stringify(task).includes(privateEvidence),
    "Private Delegation Evidence leaked into public A2A Task");
  assert.ok(!JSON.stringify(task).includes(credentialId),
    "Credential identifier leaked into public A2A Task");
  return output.id;
}
async function main(){
  const [adapter, gateway]=await Promise.all([
    api(adapterUrl+"/health",{},[200]),
    api(gatewayUrl+"/health",{},[200])
  ]);
  void adapter;
  assert.equal(gateway.provider,"gitea");
  const prepared=await api(gatewayUrl+"/v1/authorization/prepare",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({
      task_id:"a2a-mcp-preparation",agent_role:"backend",
      tool:"read_file",arguments:permitted
    })
  });
  assert.equal(prepared.required_permission.operation,"read_file");
  const suffix=randomBytes(8).toString("hex");
  const rootId="urn:thesis:a2a-mcp-smoke:root:"+suffix;
  const childId="urn:thesis:a2a-mcp-smoke:backend:"+suffix;
  const now=new Date().toISOString();
  await api(adapterUrl+"/v1/credentials/root",{
    method:"POST",headers:auth(tokens.engineer),
    body:JSON.stringify({
      credential_id:rootId,delegatee:"orchestrator",
      valid_from:now,validity_seconds:3600,
      credential_status:credentialStatus(660),
      permissions:[prepared.required_permission]
    })
  });
  await api(adapterUrl+"/v1/credentials/child",{
    method:"POST",headers:auth(tokens.orchestrator),
    body:JSON.stringify({
      parent_credential_id:rootId,credential_id:childId,
      delegatee:"backend",valid_from:now,validity_seconds:1800,
      credential_status:credentialStatus(661),
      permissions:[prepared.required_permission]
    })
  });

  const backend=keypair(),frontend=keypair(),testing=keypair();
  const port=await unusedPort();
  const agentUrl="http://127.0.0.1:"+port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{
      backend:backend.publicKey,frontend:frontend.publicKey,
      test:testing.publicKey
    },
    router:new TaskRouter({
      backend:{baseUrl:agentUrl},
      frontend:{baseUrl:agentUrl},
      test:{baseUrl:agentUrl}
    })
  });
  let agent;
  try {
    const sharedUrl=await listen(shared);
    const model=new ScriptedA2AReadModel();
    agent=await startSpecializedAgentServer({
      role:"backend",host:"127.0.0.1",port,
      mcpTaskSigning:{
        signingPrivateKeyPem:backend.privateKey,
        signingPublicKeyPem:backend.publicKey
      },
      adk:{
        model,gatewayBaseUrl:gatewayUrl,adapterBaseUrl:adapterUrl,
        adapterToken:tokens.backend,
        scopeModelPaths:true,maxModelTurns:4,
        mcpSharedUrl:sharedUrl+"/mcp"
      }
    });
    const client=await clientFor(agent.baseUrl);

    model.startTask(permitted);
    const initialCount=model.requests.length;
    const firstTaskId=await protectedRead(client,permitted,childId,"allowed-read");
    assert.equal(model.requests.length,initialCount+2);
    const firstResult=JSON.stringify(model.requests.at(-1)?.contents??[]);
    assert.ok(firstResult.includes("export class UserService"),
      "The native ADK model did not receive Gitea read contents over MCP");
    assert.ok(firstResult.includes(expectedRevision),
      "The native ADK model did not receive the expected real Gitea revision");

    // The completed A2A task must have been deregistered from its worker.
    // A newly signed token for that OLD task is not an active authorization.
    const expiredTaskToken=issueTaskToken(backend.privateKey,"backend",firstTaskId);
    const stale=await fetch(sharedUrl+"/mcp",{
      method:"POST",
      headers:{
        authorization:"Bearer "+expiredTaskToken,
        "content-type":"application/json",
        accept:"application/json, text/event-stream"
      },
      body:JSON.stringify({
        jsonrpc:"2.0",id:777,method:"tools/call",
        params:{name:"read_file",arguments:permitted}
      }),
      signal:AbortSignal.timeout(5000)
    });
    assert.ok(stale.status<500,"Stale A2A task caused a server-side failure");
    const staleText=await stale.text();
    assert.ok(
      stale.status===401||stale.status===403||
      staleText.includes("inactive_task")||staleText.includes("unauthorized"),
      "An ended A2A task was still authorized"
    );

    model.startTask(forbidden);
    const deniedCount=model.requests.length;
    await protectedRead(client,forbidden,childId,"out-of-scope-read");
    assert.equal(model.requests.length,deniedCount+2);
    const deniedResult=JSON.stringify(model.requests.at(-1)?.contents??[]);
    assert.ok(deniedResult.includes("authorization_denied")||
      deniedResult.includes("invalid_tool_call"),
      "Real Gateway/OPA denial was not returned to ADK through MCP");
    assert.ok(!deniedResult.includes("export class UserService"),
      "Out-of-scope MCP result improperly included protected file contents");

    const allRequests=JSON.stringify(model.requests);
    for(const value of [privateEvidence,rootId,childId,backend.privateKey,
      ...Object.values(tokens)]){
      assert.ok(!allRequests.includes(value),"Authority-bearing data leaked to the model");
    }
    assert.equal(agent.executor.executionCount,2);

    process.stdout.write(JSON.stringify({
      event:"a2a_mcp_real_read_smoke",
      status:"PASS",
      path:"protected_a2a_native_adk_shared_mcp_gateway_rust_opa_gitea",
      revision:expectedRevision,model:"scripted_offline",
      a2a_tasks:2,
      expected_terminal_state:"FAILED_without_write",
      tests:["authorized_mcp_read","out_of_scope_policy_deny",
        "a2a_fail_closed_no_revision","no_unauthorized_artifact",
        "private_evidence_not_disclosed","inactive_task_rejected"]
    })+"\n");
  }finally{
    await agent?.close();
    await stop(shared);
  }
}
await main();
