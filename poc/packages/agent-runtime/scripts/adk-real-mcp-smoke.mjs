/**
 * Opt-in REAL Google ADK → ONE shared MCP → private worker → Gateway →
 * Rust Adapter/Verifier → OPA → Gitea (read-only) integration test.
 *
 * The model is scripted locally. No Gemini/OpenAI request; no repository writes.
 * Requires running Phase 5A Gitea/OPA, Rust Adapter and read-only Gateway.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import express from "express";
import {BaseLlm,InMemorySessionService,Runner} from "@google/adk";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";
import {GatewayControlledToolClient} from "../src/gateway-tool-client.ts";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";

const gatewayUrl=process.env.GATEWAY_SMOKE_URL??"http://127.0.0.1:8080";
const adapterUrl=process.env.ADAPTER_SMOKE_URL??"http://127.0.0.1:8090";
const revision=process.env.EXPECTED_GITEA_REVISION??"405748b1e77992b6bd8630a3ab6f990658d32f6b";
const branch="feature/account-suspension";
const permitted={branch,path:"apps/backend/src/users/user.service.ts"};
// Valid model-facing Backend path, but not delegated by the smoke child DC.
const denied={branch,path:"apps/backend/src/users/user.model.ts"};
const roles={
  engineer:process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator:process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend:process.env.ADAPTER_CALLER_BACKEND
};
for(const [role,token] of Object.entries(roles)){
  if(!token)throw new Error("Missing local Adapter caller token for "+role);
}
const taskId="adk-mcp-real-"+randomBytes(8).toString("hex");

class ScriptedReadLlm extends BaseLlm {
  requests=[];
  constructor(){super({model:"scripted-adk-mcp-real-no-provider"});}
  async *generateContentAsync(request){
    this.requests.push(request);
    const n=this.requests.length;
    if(n<=3){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"read-"+n,name:"read_file",args:n===2?denied:permitted
      }}]}};
    }else{
      yield {content:{role:"model",parts:[{text:"Read-only delegation check finished"}]}};
    }
  }
  connect(){return Promise.reject(new Error("No live provider allowed in this smoke"));}
}
function pair(){
  const key=generateKeyPairSync("ed25519");
  return {
    privateKey:key.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:key.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
async function api(url,options={},expected=[200,201]){
  const r=await fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(10000)});
  // Intentionally don't print upstream responses: these may contain private data.
  if(!expected.includes(r.status))throw new Error("Upstream status "+r.status);
  return r.json();
}
async function checkHealthy(base,label){
  const r=await fetch(base+"/health",{signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw new Error(label+" health failed");
  return r.json();
}
function auth(token){return {authorization:"Bearer "+token,"content-type":"application/json"};}
function status(index){
  return {type:"BitstringStatusListEntry",statusPurpose:"revocation",
    statusListIndex:String(index),
    statusListCredential:"https://status.example/lists/adk-mcp-real-read"};
}
async function start(server){
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  return "http://127.0.0.1:"+server.address().port;
}
async function close(server){
  if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
function assertRealRead(outcome){
  assert.equal(outcome?.name,"read_file");
  assert.deepEqual(outcome.arguments,permitted);
  assert.equal(outcome.payload.ok,true,"ADK authorized read was not accepted");
  const r=outcome.payload.result;
  assert.equal(r?.provider,"gitea");
  assert.equal(r?.performed,true);
  assert.equal(r?.tool,"read_file");
  assert.equal(r?.branch,branch);
  assert.equal(r?.path,permitted.path);
  assert.equal(r?.revision,revision);
  assert.match(r?.blob_sha??"",/^[a-f0-9]{40}$/u);
  assert.ok(typeof r?.content==="string" && r.content.includes("export class UserService"));
  return r;
}

async function main(){
  await checkHealthy(adapterUrl,"Rust Adapter");
  const gateway=await checkHealthy(gatewayUrl,"Gateway");
  assert.equal(gateway.provider,"gitea");
  const prepared=await api(gatewayUrl+"/v1/authorization/prepare",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({task_id:taskId,agent_role:"backend",
      tool:"read_file",arguments:permitted})
  });
  assert.equal(prepared.required_permission.operation,"read_file");
  const id=randomBytes(8).toString("hex");
  const rootId="urn:thesis:adk-mcp-real:root:"+id;
  const childId="urn:thesis:adk-mcp-real:backend:"+id;
  const now=new Date().toISOString();
  await api(adapterUrl+"/v1/credentials/root",{
    method:"POST",headers:auth(roles.engineer),
    body:JSON.stringify({credential_id:rootId,delegatee:"orchestrator",
      valid_from:now,validity_seconds:3600,credential_status:status(640),
      permissions:[prepared.required_permission]})
  });
  await api(adapterUrl+"/v1/credentials/child",{
    method:"POST",headers:auth(roles.orchestrator),
    body:JSON.stringify({parent_credential_id:rootId,credential_id:childId,
      delegatee:"backend",valid_from:now,validity_seconds:1800,
      credential_status:status(641),permissions:[prepared.required_permission]})
  });
  const evidence=new DelegationEvidenceHandler({
    adapterBaseUrl:adapterUrl,adapterToken:roles.backend,
    evidence:{credential:"",credential_id:childId,
      presenter_id:"did:thesis:backend-agent"}
  });
  const authorizedClient=new GatewayControlledToolClient({
    gatewayBaseUrl:gatewayUrl,agentRole:"backend",taskId,
    evidenceHandler:evidence
  });
  const backend=pair(),frontend=pair(),testing=pair();
  const active=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:backend.privateKey,
    signingPublicKeyPem:backend.publicKey
  });
  active.begin(taskId,authorizedClient);
  const app=express();
  attachPrivateMcpWorker(app,active);
  let worker,shared,built;
  try{
    worker=app.listen(0,"127.0.0.1");
    await new Promise(resolve=>worker.once("listening",resolve));
    const workerUrl="http://127.0.0.1:"+worker.address().port;
    shared=createSharedMcpHttpServer({
      verificationKeys:{backend:backend.publicKey,
        frontend:frontend.publicKey,test:testing.publicKey},
      router:new TaskRouter({backend:{baseUrl:workerUrl},
        frontend:{baseUrl:workerUrl},test:{baseUrl:workerUrl}})
    });
    const sharedUrl=await start(shared);
    const model=new ScriptedReadLlm();
    const outcomes=[];
    built=createAdkSpecializedAgent({
      role:"backend",model,scopeModelPaths:true,
      // If ADK ever bypasses MCP to invoke the legacy read FunctionTool, fail.
      gatewayClient:{invoke:async()=>{throw new Error("MCP bypass detected");}},
      mcpReadFile:{endpoint:sharedUrl+"/mcp",
        bearerForRequest:()=>active.bearerFor(taskId)},
      onToolOutcome:event=>outcomes.push(event)
    });
    const sessionService=new InMemorySessionService();
    const appName="adk_real_mcp_read_smoke";
    const runner=new Runner({appName,agent:built.agent,sessionService});
    await sessionService.createSession({appName,userId:"smoke",sessionId:taskId});
    for await(const _event of runner.runAsync({
      userId:"smoke",sessionId:taskId,
      newMessage:{role:"user",parts:[{text:"Check delegated Backend read-only access"}]}
    })) { /* Observe only the real controlled MCP outcomes, never model prose. */ }

    assert.equal(model.requests.length,4);
    assert.equal(outcomes.length,3,"Exactly three real MCP tool invocations required");
    const first=assertRealRead(outcomes[0]);
    assert.equal(outcomes[1]?.name,"read_file");
    assert.deepEqual(outcomes[1]?.arguments,denied);
    assert.equal(outcomes[1]?.payload?.ok,false,"Out-of-scope read was allowed");
    assert.ok(["authorization_denied","invalid_tool_call"].includes(
      outcomes[1].payload.error.kind),"Unexpected denial classification");
    const last=assertRealRead(outcomes[2]);
    assert.equal(first.content,last.content,"Gitea file content changed");
    assert.equal(first.revision,last.revision,"Gitea revision changed");

    const requestData=JSON.stringify(model.requests);
    for(const secret of [backend.privateKey,rootId,childId,...Object.values(roles)]){
      assert.ok(!requestData.includes(secret),"Private authority leaked into ADK model context");
    }
    assert.ok(!requestData.includes(active.bearerFor(taskId)),
      "MCP task bearer leaked into ADK model context");
    const declarations=(model.requests[0]?.config?.tools??[])
      .flatMap(t=>t.functionDeclarations??[]).map(d=>d.name);
    assert.equal(declarations.filter(name=>name==="read_file").length,1);
    assert.ok(declarations.includes("update_file"));
    process.stdout.write(JSON.stringify({
      event:"adk_mcp_real_read_smoke",status:"PASS",
      path:"native_adk_shared_mcp_worker_gateway_rust_opa_gitea",
      revision,model:"scripted_offline",mcp_tool_calls:3,
      tests:["authorized_read","out_of_scope_deny","post_denial_read",
        "unchanged_file","private_authority_not_model_visible"]
    })+"\n");
  }finally{
    await built?.mcpToolset?.close();
    active.end(taskId);
    await close(shared);
    await close(worker);
  }
}
await main();
