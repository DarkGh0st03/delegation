/**
 * Read-only integration gate:
 * three REAL protected A2A servers (Backend, Frontend, Test), each with
 * private task registry and Ed25519 role key, sharing ONE Streamable HTTP MCP
 * server backed by actual Gateway, Rust Verifier/Adapter, OPA and Gitea.
 *
 * Each role reads only its uniquely delegated file and attempts a foreign
 * read (denied). Every read-only A2A Task MUST finish FAILED without a Git
 * commit, rather than fabricating a successful Artifact.
 *
 * No Gitea mutations, no Gemini / paid provider, no fixture reset.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes,randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {setTimeout as sleep} from "node:timers/promises";
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
const revision=process.env.EXPECTED_GITEA_REVISION;
if(!/^[0-9a-f]{40}$/u.test(revision??"")){
  throw new Error("Set EXPECTED_GITEA_REVISION to the verified current feature SHA");
}
const branch="feature/account-suspension";
const paths={
  backend:"apps/backend/src/users/user.service.ts",
  frontend:"apps/frontend/src/pages/UserDetailPage.tsx",
  test:"tests/e2e/user-profile.spec.ts"
};
const unauthorized={
  backend:paths.frontend,
  frontend:paths.backend,
  test:paths.frontend
};
const roles=["backend","frontend","test"];
const tokens={
  engineer:process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator:process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend:process.env.ADAPTER_CALLER_BACKEND,
  frontend:process.env.ADAPTER_CALLER_FRONTEND,
  test:process.env.ADAPTER_CALLER_TEST
};
for(const [role,secret] of Object.entries(tokens)){
  if(!secret)throw new Error("Missing local Adapter token for "+role);
}
const id=randomBytes(7).toString("hex");
const privateMarker="TRIPLE_A2A_PRIVATE_"+randomBytes(10).toString("hex");

function keys(){
  const k=generateKeyPairSync("ed25519");
  return {privateKey:k.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKey:k.publicKey.export({type:"spki",format:"pem"}).toString()};
}
const keypairs={backend:keys(),frontend:keys(),test:keys()};
class ScriptedRoleReadLlm extends BaseLlm{
  requests=[];
  selected=null;
  turns=0;
  constructor(role){super({model:"scripted-"+role+"-shared-mcp-no-provider"});}
  start(path){this.selected={branch,path};this.turns=0;}
  async *generateContentAsync(request){
    this.requests.push(request);
    this.turns++;
    if(this.turns===1){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"read-"+this.requests.length,
        name:"read_file",args:this.selected
      }}]}};
    }else{
      yield {content:{role:"model",parts:[{text:"Read-only check finished"}]}};
    }
  }
  connect(){return Promise.reject(new Error("No external model is permitted"));}
}
async function api(url,options={},expected=[200,201]){
  const response=await fetch(url,{
    ...options,redirect:"error",signal:AbortSignal.timeout(10000)
  });
  // Raw provider messages may contain private data. Return only status.
  if(!expected.includes(response.status))throw new Error("Upstream HTTP "+response.status);
  return response.json();
}
function bearer(token){return {authorization:"Bearer "+token,"content-type":"application/json"};}
function status(index){return {
  type:"BitstringStatusListEntry",statusPurpose:"revocation",
  statusListIndex:String(index),
  statusListCredential:"https://status.example/lists/a2a-three-roles-mcp-read"
};}
async function unusedPort(){
  const server=createServer();
  await new Promise((resolve,reject)=>{
    server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
  });
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  return port;
}
async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
  });
  return "http://127.0.0.1:"+server.address().port;
}
async function close(server){
  if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
async function clientFor(url){
  const f=new ClientFactory(ClientFactoryOptions.createFrom(
    ClientFactoryOptions.default,{preferredTransports:["HTTP+JSON"]}
  ));
  const client=await f.createFromUrl(url);
  assertDelegatedAuthorizationSupport(await client.getAgentCard());
  return client;
}
async function submit(client,role,path,credentialId,label){
  const response=await client.sendMessage({
    tenant:"",
    message:{
      messageId:randomUUID(),contextId:"",taskId:"",role:Role.ROLE_USER,
      parts:[{content:{$case:"data",value:{
        subtask_id:"a2a-"+role+"-"+label,
        instruction:"Attempt only the delegated read and do not change files",
        branch,relevant_paths:[path]
      }},metadata:undefined,filename:"",mediaType:"application/json"}],
      metadata:{delegation_evidence:{
        credential:privateMarker,credential_id:credentialId,
        presenter_id:"did:thesis:"+role+"-agent"
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
  assert.ok(response?.id);
  let task=response;
  const deadline=Date.now()+35000;
  const done=new Set([
    TaskState.TASK_STATE_COMPLETED,TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_CANCELED,TaskState.TASK_STATE_REJECTED
  ]);
  while(!done.has(task.status?.state)){
    if(Date.now()>deadline)throw Error(role+" A2A task did not finish");
    await sleep(120);
    task=await client.getTask({id:response.id,historyLength:0},{
      signal:AbortSignal.timeout(5000)
    });
  }
  assert.equal(task.status?.state,TaskState.TASK_STATE_FAILED,
    "Read-only "+role+" Task published an unauthorized success");
  assert.equal(task.artifacts?.length??0,0);
  assert.equal(task.history?.length??0,0);
  const publicState=JSON.stringify(task);
  for(const item of [privateMarker,credentialId,...Object.values(tokens)]){
    assert.equal(publicState.includes(item),false,
      "Private authority was serialized into public A2A Task");
  }
  return response.id;
}
async function checkInactive(server,role,taskId,path){
  const token=issueTaskToken(keypairs[role].privateKey,role,taskId);
  const response=await fetch(server.baseUrl+"/internal/mcp-tool-call",{
    method:"POST",headers:{
      authorization:"Bearer "+token,
      "content-type":"application/json"
    },
    body:JSON.stringify({tool:"read_file",arguments:{branch,path}}),
    signal:AbortSignal.timeout(5000)
  });
  assert.equal(response.status,403,role+" kept stale MCP task active");
  assert.equal((await response.json())?.error?.kind,"inactive_task");
}
async function main(){
  const [adapter,gateway]=await Promise.all([
    api(adapterUrl+"/health",{},[200]),api(gatewayUrl+"/health",{},[200])
  ]);
  void adapter;
  assert.equal(gateway.provider,"gitea",
    "Persistent Gateway must be configured for real read-only Gitea");
  const prepared={};
  for(const role of roles){
    prepared[role]=await api(gatewayUrl+"/v1/authorization/prepare",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({
        task_id:"three-role-prepare-"+role+"-"+id,agent_role:role,
        tool:"read_file",arguments:{branch,path:paths[role]}
      })
    });
    assert.equal(prepared[role].required_permission.operation,"read_file");
  }
  const rootId="urn:thesis:a2a-three-role-mcp:root:"+id;
  const childIds={};
  const timestamp=new Date().toISOString();
  await api(adapterUrl+"/v1/credentials/root",{
    method:"POST",headers:bearer(tokens.engineer),
    body:JSON.stringify({
      credential_id:rootId,delegatee:"orchestrator",
      valid_from:timestamp,validity_seconds:3600,
      credential_status:status(780),
      permissions:roles.map(role=>prepared[role].required_permission)
    })
  });
  for(const [index,role] of roles.entries()){
    childIds[role]="urn:thesis:a2a-three-role-mcp:"+role+":"+id;
    await api(adapterUrl+"/v1/credentials/child",{
      method:"POST",headers:bearer(tokens.orchestrator),
      body:JSON.stringify({
        parent_credential_id:rootId,
        credential_id:childIds[role],
        delegatee:role,valid_from:timestamp,validity_seconds:1800,
        credential_status:status(781+index),
        permissions:[prepared[role].required_permission]
      })
    });
  }
  const ports={};
  for(const role of roles)ports[role]=await unusedPort();
  const shared=createSharedMcpHttpServer({
    verificationKeys:Object.fromEntries(
      roles.map(role=>[role,keypairs[role].publicKey])
    ),
    router:new TaskRouter(Object.fromEntries(
      roles.map(role=>[role,{baseUrl:"http://127.0.0.1:"+ports[role]}])
    ))
  });
  const agents={};
  const models={};
  try{
    const endpoint=(await listen(shared))+"/mcp";
    // Exactly one MCP listener; three real independent A2A+private workers.
    for(const role of roles){
      const model=new ScriptedRoleReadLlm(role);
      models[role]=model;
      agents[role]=await startSpecializedAgentServer({
        role,host:"127.0.0.1",port:ports[role],
        mcpTaskSigning:{
          signingPrivateKeyPem:keypairs[role].privateKey,
          signingPublicKeyPem:keypairs[role].publicKey
        },
        adk:{
          model,gatewayBaseUrl:gatewayUrl,adapterBaseUrl:adapterUrl,
          adapterToken:tokens[role],scopeModelPaths:true,
          maxModelTurns:4,mcpSharedUrl:endpoint
        }
      });
    }
    for(const role of roles){
      const model=models[role];
      const client=await clientFor(agents[role].baseUrl);
      model.start(paths[role]);
      const before=model.requests.length;
      const taskId=await submit(client,role,paths[role],childIds[role],"allow");
      assert.equal(model.requests.length,before+2);
      const result=JSON.stringify(model.requests.at(-1)?.contents??[]);
      assert.ok(result.includes(revision),
        role+" ADK did not receive the real Gitea revision");
      assert.ok(result.includes(paths[role]),
        role+" ADK did not receive its delegated file path");
      await checkInactive(agents[role],role,taskId,paths[role]);

      model.start(unauthorized[role]);
      const previous=model.requests.length;
      const deniedId=await submit(client,role,unauthorized[role],
        childIds[role],"foreign-deny");
      assert.equal(model.requests.length,previous+2);
      const denied=JSON.stringify(model.requests.at(-1)?.contents??[]);
      assert.ok(denied.includes("authorization_denied")||
        denied.includes("invalid_tool_call"),
        role+" foreign read did not receive a controlled refusal");
      assert.ok(!denied.includes('"content":"export'),
        "Out-of-scope request received source contents");
      await checkInactive(agents[role],role,deniedId,paths[role]);
      assert.equal(agents[role].executor.executionCount,2);
    }
    const modelContext=JSON.stringify(
      roles.flatMap(role=>models[role].requests)
    );
    for(const secret of [
      rootId,...Object.values(childIds),privateMarker,
      ...Object.values(tokens),...roles.map(role=>keypairs[role].privateKey)
    ]){
      assert.equal(modelContext.includes(secret),false,
        "Private authority leaked into a model request");
    }
    process.stdout.write(JSON.stringify({
      event:"a2a_three_roles_shared_mcp_real_read_smoke",
      status:"PASS",revision,model:"scripted_offline",
      shared_mcp_servers:1,a2a_agent_roles:roles,a2a_tasks:6,
      tests:["all_three_delegated_reads",
        "cross_role_out_of_scope_denials",
        "ended_task_bearer_rejected",
        "no_unconfirmed_a2a_artifacts",
        "no_private_evidence_in_a2a_or_models",
        "one_shared_mcp_server"]
    })+"\n");
  }finally{
    for(const role of [...roles].reverse()){
      await agents[role]?.close().catch(()=>undefined);
    }
    await close(shared);
  }
}
await main();
