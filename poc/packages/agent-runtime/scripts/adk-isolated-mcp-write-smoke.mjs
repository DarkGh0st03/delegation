/**
 * Real MCP UPDATE smoke on a disposable Gitea Docker container.
 *
 * Actual chain: native Google ADK -> ONE shared MCP Streamable HTTP server ->
 * trusted role/task-scoped Worker -> Gateway prepare/execute -> Rust verifier
 * -> unchanged OPA policy -> genuine Gitea write.
 *
 * Docker --rm, no bind mounts and NO volumes, randomly assigned host port.
 * Never touches delegation-poc-gitea or its thesis/iam-console-poc repository.
 * No Gemini/OpenAI generation: a local BaseLlm deterministically requests
 * one permitted update followed by a denied out-of-scope update.
 *
 * Requires Docker Desktop, local Rust Adapter + OPA, and poc/infra/.env loaded.
 */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {setTimeout as sleep} from "node:timers/promises";
import express from "express";
import {BaseLlm,InMemorySessionService,Runner} from "@google/adk";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";
import {GatewayControlledToolClient} from "../src/gateway-tool-client.ts";
import {GatewayRuntime} from "../../../apps/gateway/src/runtime.ts";
import {createGatewayHttpServer} from "../../../apps/gateway/src/http.ts";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";

const required={
  adminUser:process.env.GITEA_ADMIN_USER,
  adminPassword:process.env.GITEA_ADMIN_PASSWORD,
  gatewayUser:process.env.GITEA_GATEWAY_USER,
  gatewayPassword:process.env.GITEA_GATEWAY_PASSWORD,
  engineer:process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator:process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend:process.env.ADAPTER_CALLER_BACKEND,
  gateway:process.env.ADAPTER_CALLER_GATEWAY
};
for(const [key,value] of Object.entries(required)){
  if(!value)throw new Error("Missing isolated write fixture variable: "+key);
}
const adapterUrl=process.env.ADAPTER_SMOKE_URL??"http://127.0.0.1:8090";
const opaUrl=process.env.OPA_URL??"http://127.0.0.1:8181";
// The script issues fresh DCs: prevent accidental use against a remote Adapter.
for(const [label,address] of [["Adapter",adapterUrl],["OPA",opaUrl]]){
  const parsed=new URL(address);
  if(parsed.protocol!=="http:"||
     !["localhost","127.0.0.1","[::1]"].includes(parsed.hostname)||
     parsed.username||parsed.password||parsed.search||parsed.hash||
     (parsed.pathname!=="/"&&parsed.pathname!=="")){
    throw new Error(label+" must use a local-loopback development URL");
  }
}
const image=process.env.GITEA_IMAGE??"docker.gitea.com/gitea:28.0.0";
const suffix=randomBytes(5).toString("hex");
const containerName="delegation-mcp-write-"+suffix;
const taskId="isolated-mcp-update-"+suffix;
const branch="feature/account-suspension";
const path="apps/backend/src/users/user.service.ts";
const fixtureContent="export class UserService { status = 'ACTIVE'; }\n";
const replacementContent="export class UserService { status = 'SUSPENDED'; }\n";
const permitted={branch,path,content:replacementContent};
const forbidden={branch,path:"apps/backend/src/users/user.controller.ts",
  content:"export class UserController {}\n"};

function docker(args,label){
  try {
    return execFileSync("docker",args,{
      encoding:"utf8",timeout:120000,stdio:["ignore","pipe","pipe"]
    }).trim();
  }catch{
    // Never print commands: some bootstrap commands contain local passwords.
    throw new Error("Isolated Docker step failed: "+label);
  }
}
function stopDocker(){
  try{
    execFileSync("docker",["stop","--time","5",containerName],{
      stdio:"ignore",timeout:30000
    });
  }catch{/* A crashed container may already be gone. */}
}
let containerStarted=false;
for(const sig of ["SIGINT","SIGTERM"]){
  process.once(sig,()=>{
    if(containerStarted)stopDocker();
    process.exitCode=130;
  });
}
function basic(user,password){
  return "Basic "+Buffer.from(user+":"+password).toString("base64");
}
async function json(base,endpoint,options={}){
  const {
    method="GET",body,auth,expected=[200,201],label=endpoint
  }=options;
  const headers={accept:"application/json"};
  if(body!==undefined)headers["content-type"]="application/json";
  if(auth)headers.authorization=auth;
  const response=await fetch(base+endpoint,{
    method,headers,
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    redirect:"error",signal:AbortSignal.timeout(15000)
  });
  if(!expected.includes(response.status)){
    // Never echo response bodies, auth headers or confidential tokens.
    throw new Error("Isolated "+label+" returned HTTP "+response.status);
  }
  return response.status===204?{}:response.json();
}
async function untilHealthy(base){
  for(let attempt=0;attempt<180;attempt++){
    try {
      const response=await fetch(base+"/api/healthz",{
        signal:AbortSignal.timeout(1200)
      });
      if(response.ok)return;
    }catch{/* The temporary container is still starting. */}
    await sleep(500);
  }
  throw new Error("Temporary Gitea did not become healthy");
}
async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  return "http://127.0.0.1:"+server.address().port;
}
async function close(server){
  if(server)await new Promise((resolve,reject)=>
    server.close(error=>error?reject(error):resolve()));
}
function keyPair(){
  const pair=generateKeyPairSync("ed25519");
  return {
    privateKey:pair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKey:pair.publicKey.export({type:"spki",format:"pem"}).toString()
  };
}
function status(index){
  return {type:"BitstringStatusListEntry",statusPurpose:"revocation",
    statusListIndex:String(index),
    statusListCredential:"https://status.example/lists/mcp-isolated-write"};
}
class ScriptedWriteLlm extends BaseLlm{
  requests=[];
  constructor(){super({model:"scripted-mcp-isolated-write-no-provider"});}
  async *generateContentAsync(request){
    this.requests.push(request);
    const i=this.requests.length;
    if(i===1||i===2){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"isolated-update-"+i,name:"update_file",
        args:i===1?permitted:forbidden
      }}]}};
    }else{
      yield {content:{role:"model",parts:[{text:"Finished verifying write and denial"}]}};
    }
  }
  connect(){return Promise.reject(new Error("External model not allowed"));}
}

async function bootstrapIsolatedGitea(base){
  docker(["exec","--user","1000:1000",containerName,
    "gitea","admin","user","create",
    "--username",required.adminUser,"--password",required.adminPassword,
    "--email","thesis-admin@localhost.invalid","--admin",
    "--must-change-password=false"],"create isolated admin");
  docker(["exec","--user","1000:1000",containerName,
    "gitea","admin","user","create",
    "--username",required.gatewayUser,"--password",required.gatewayPassword,
    "--email","thesis-gateway@localhost.invalid",
    "--must-change-password=false"],"create isolated Gateway user");
  const adminAuth=basic(required.adminUser,required.adminPassword);
  const gatewayAuth=basic(required.gatewayUser,required.gatewayPassword);
  await json(base,"/api/v1/orgs",{method:"POST",auth:adminAuth,label:"create org",
    body:{username:"thesis",full_name:"Isolated MCP test org",visibility:"private"}});
  await json(base,"/api/v1/orgs/thesis/repos",{
    method:"POST",auth:adminAuth,label:"create temporary Gitea repository",
    body:{name:"iam-console-poc",private:true,auto_init:true,
      default_branch:"main",readme:"Default"}
  });
  const main=await json(base,"/api/v1/repos/thesis/iam-console-poc/branches/main",{
    auth:adminAuth,label:"main metadata"
  });
  assert.match(main.commit?.id??"",/^[a-f0-9]{40}$/u);
  await json(base,"/api/v1/repos/thesis/iam-console-poc/branches",{
    method:"POST",auth:adminAuth,label:"create isolated feature branch",
    body:{new_branch_name:branch,old_branch_name:"main"}
  });
  // Create fixture file ONLY on the isolated feature branch.
  const fileUrl="/api/v1/repos/thesis/iam-console-poc/contents/"+path;
  await json(base,fileUrl,{method:"POST",auth:adminAuth,
    label:"create isolated feature file",body:{
      branch,content:Buffer.from(fixtureContent).toString("base64"),
      message:"fixture: isolated MCP write smoke"
    }
  });
  await json(base,"/api/v1/repos/thesis/iam-console-poc/branch_protections",{
    method:"POST",auth:adminAuth,label:"protect isolated main",body:{
      branch_name:"main",enable_push:false,enable_force_push:false,
      required_approvals:1,block_admin_merge_override:true,
      dismiss_stale_approvals:true,block_on_outdated_branch:true
    }
  });
  await json(base,"/api/v1/repos/thesis/iam-console-poc/collaborators/"+
    encodeURIComponent(required.gatewayUser),{
    method:"PUT",auth:adminAuth,expected:[204],label:"grant isolated Gateway",
    body:{permission:"write"}
  });
  const credential=await json(base,
    "/api/v1/users/"+encodeURIComponent(required.gatewayUser)+"/tokens",{
    method:"POST",auth:gatewayAuth,label:"issue isolated Gateway credential",
    body:{name:"mcp-write-"+suffix,scopes:["write:repository","read:user"]}
  });
  if(typeof credential.sha1!=="string"||credential.sha1.length<20){
    throw new Error("Isolated Gitea did not return a scoped Gateway credential");
  }
  const tokenAuth="token "+credential.sha1;
  await json(base,"/api/v1/repos/thesis/iam-console-poc",{
    auth:tokenAuth,label:"verify isolated Gateway repository access"
  });
  return {adminAuth,token:credential.sha1,mainSha:main.commit.id,fileUrl};
}

async function prepareGateway(url,args){
  return json(url,"/v1/authorization/prepare",{
    method:"POST",label:"Gateway prepare",body:{
      task_id:taskId,agent_role:"backend",
      tool:"update_file",arguments:args
    }
  });
}
async function issueCredentials(gatewayUrl){
  const prepared=await prepareGateway(gatewayUrl,permitted);
  assert.equal(prepared.required_permission.operation,"update_file");
  const rootId="urn:thesis:isolated-write:root:"+suffix;
  const childId="urn:thesis:isolated-write:backend:"+suffix;
  const now=new Date().toISOString();
  await json(adapterUrl,"/v1/credentials/root",{
    method:"POST",auth:"Bearer "+required.engineer,
    label:"create temporary root delegation",body:{
      credential_id:rootId,delegatee:"orchestrator",
      valid_from:now,validity_seconds:3600,credential_status:status(720),
      permissions:[prepared.required_permission]
    }
  });
  await json(adapterUrl,"/v1/credentials/child",{
    method:"POST",auth:"Bearer "+required.orchestrator,
    label:"create temporary Backend delegation",body:{
      parent_credential_id:rootId,credential_id:childId,
      delegatee:"backend",valid_from:now,validity_seconds:1800,
      credential_status:status(721),permissions:[prepared.required_permission]
    }
  });
  return {rootId,childId};
}
async function main(){
  assert.equal((await json(adapterUrl,"/health",{label:"Adapter health"})).status,"ok");
  const opaResponse=await fetch(opaUrl+"/health",{signal:AbortSignal.timeout(5000)});
  assert.equal(opaResponse.status,200,"Real OPA is not healthy");

  // Image is reused from the existing Docker Compose Gitea installation.
  // No named volumes or host bind mounts: stopping removes the test repo.
  docker(["run","--rm","--detach","--name",containerName,
    "--publish","127.0.0.1::3000/tcp",
    "--env","USER_UID=1000","--env","USER_GID=1000",
    "--env","GITEA__database__DB_TYPE=sqlite3",
    "--env","GITEA__database__PATH=/data/gitea/gitea.db",
    "--env","GITEA__server__DOMAIN=localhost",
    "--env","GITEA__server__ROOT_URL=http://localhost:3000/",
    "--env","GITEA__server__DISABLE_SSH=true",
    "--env","GITEA__service__DISABLE_REGISTRATION=true",
    "--env","GITEA__security__INSTALL_LOCK=true",
    "--env","GITEA__actions__ENABLED=false",
    image],"launch isolated temporary Gitea");
  containerStarted=true;
  let gatewayServer,agentServer,sharedServer,built;
  let active;
  try {
    const portInfo=docker(["port",containerName,"3000/tcp"],"inspect private test port");
    const match=/127\.0\.0\.1:(\d+)/u.exec(portInfo);
    if(!match)throw new Error("Docker did not assign a loopback-only Gitea port");
    const giteaUrl="http://127.0.0.1:"+match[1];
    await untilHealthy(giteaUrl);
    const fixture=await bootstrapIsolatedGitea(giteaUrl);

    // Ephemeral Gateway runtime, entirely separate from 127.0.0.1:8080.
    // The repository identifier is identical to the unchanged OPA allowlist.
    const runtime=new GatewayRuntime({
      bind_host:"127.0.0.1",bind_port:1,
      prepare:{
        audience:"cloud-access-gateway",request_ttl_ms:120000,
        repository:{authority:"gitea.local",owner:"thesis",
          repository:"iam-console-poc"}
      },
      adapter_url:adapterUrl,adapter_gateway_token:required.gateway,
      opa_url:opaUrl,opa_timeout_ms:2000,
      provider_mode:"gitea",gitea_base_url:giteaUrl,
      gitea_gateway_token:fixture.token,gitea_timeout_ms:10000,
      runner_timeout_ms:900000
    },{audit:{emit:()=>{ /* no identifiers or credentials in smoke logs */ }}});
    gatewayServer=createGatewayHttpServer(runtime);
    const gatewayUrl=await listen(gatewayServer);
    const {rootId,childId}=await issueCredentials(gatewayUrl);
    const evidence=new DelegationEvidenceHandler({
      adapterBaseUrl:adapterUrl,adapterToken:required.backend,
      evidence:{credential:"",credential_id:childId,
        presenter_id:"did:thesis:backend-agent"}
    });
    const client=new GatewayControlledToolClient({
      gatewayBaseUrl:gatewayUrl,agentRole:"backend",taskId,
      evidenceHandler:evidence,timeoutMs:15000
    });
    const b=keyPair(),f=keyPair(),t=keyPair();
    active=new PrivateMcpTaskRegistry({
      role:"backend",signingPrivateKeyPem:b.privateKey,
      signingPublicKeyPem:b.publicKey
    });
    active.begin(taskId,client,undefined,{allowUpdateFile:true});
    const app=express();
    attachPrivateMcpWorker(app,active);
    agentServer=app.listen(0,"127.0.0.1");
    await new Promise(resolve=>agentServer.once("listening",resolve));
    const agentUrl="http://127.0.0.1:"+agentServer.address().port;
    sharedServer=createSharedMcpHttpServer({
      verificationKeys:{
        backend:b.publicKey,frontend:f.publicKey,test:t.publicKey
      },
      router:new TaskRouter({
        backend:{baseUrl:agentUrl},
        frontend:{baseUrl:agentUrl},
        test:{baseUrl:agentUrl}
      })
    });
    const sharedUrl=await listen(sharedServer);
    const model=new ScriptedWriteLlm();
    const outcomes=[];
    built=createAdkSpecializedAgent({
      role:"backend",model,scopeModelPaths:true,
      gatewayClient:client,
      mcpReadFile:{
        endpoint:sharedUrl+"/mcp",
        bearerForRequest:()=>active.bearerFor(taskId)
      },
      mcpUpdateFile:true,
      onToolOutcome:e=>outcomes.push(e)
    });
    const sessions=new InMemorySessionService();
    const appName="mcp_isolated_write_smoke";
    const runner=new Runner({appName,agent:built.agent,sessionService:sessions});
    await sessions.createSession({appName,userId:"smoke",sessionId:taskId});
    for await(const _event of runner.runAsync({
      userId:"smoke",sessionId:taskId,
      newMessage:{role:"user",parts:[{text:"Check isolated controlled MCP update"}]}
    })) {/* Only trusted tool callback outcomes are authoritative. */}
    assert.equal(model.requests.length,3);
    assert.equal(outcomes.length,2);
    assert.equal(outcomes[0]?.name,"update_file");
    assert.deepEqual(outcomes[0]?.arguments,permitted);
    assert.equal(outcomes[0]?.payload?.ok,true,"Authorized real MCP write failed");
    const wrote=outcomes[0].payload.result;
    assert.equal(wrote?.provider,"gitea");
    assert.equal(wrote?.performed,true);
    assert.equal(wrote?.tool,"update_file");
    assert.match(wrote?.commit_sha??"",/^[a-f0-9]{40}$/u);
    assert.equal(wrote?.revision,wrote.commit_sha);
    assert.notEqual(wrote.commit_sha,fixture.mainSha);

    assert.equal(outcomes[1]?.name,"update_file");
    assert.deepEqual(outcomes[1]?.arguments,forbidden);
    assert.equal(outcomes[1]?.payload?.ok,false,"Out-of-scope write was allowed");
    assert.ok(["authorization_denied","invalid_tool_call"].includes(
      outcomes[1].payload.error.kind),"Incorrect denial classification");

    const feature=await json(giteaUrl,
      "/api/v1/repos/thesis/iam-console-poc/branches/feature%2Faccount-suspension",
      {auth:fixture.adminAuth,label:"verify modified isolated feature SHA"});
    assert.equal(feature.commit?.id,wrote.commit_sha);
    const content=await json(giteaUrl,fixture.fileUrl+
      "?ref="+encodeURIComponent(wrote.commit_sha),{
        auth:fixture.adminAuth,label:"verify updated isolated Gitea file"
      });
    assert.equal(Buffer.from(content.content,"base64").toString("utf8"),
      replacementContent);
    const unchangedMain=await json(giteaUrl,
      "/api/v1/repos/thesis/iam-console-poc/branches/main",{
        auth:fixture.adminAuth,label:"verify isolated main unmodified"
      });
    assert.equal(unchangedMain.commit?.id,fixture.mainSha);

    const modelText=JSON.stringify(model.requests);
    for(const secret of [rootId,childId,b.privateKey,fixture.token,
      ...Object.values(required)]){
      assert.ok(!modelText.includes(secret),"Private authority leaked to model");
    }
    assert.ok(!modelText.includes(active.bearerFor(taskId)));

    process.stdout.write(JSON.stringify({
      event:"adk_mcp_isolated_real_write_smoke",status:"PASS",
      path:"native_adk_shared_mcp_gateway_rust_opa_isolated_gitea",
      model:"scripted_offline",authorized_write_commit_sha:wrote.commit_sha,
      tests:["real_gitea_write_confirmed","exact_commit_sha",
        "out_of_scope_write_denied","main_unchanged",
        "credentials_not_model_visible","temporary_repository_isolated"]
    })+"\n");
  }finally{
    try{
      await built?.mcpToolset?.close();
      active?.end(taskId);
      await close(sharedServer);
      await close(agentServer);
      await close(gatewayServer);
    }finally{
      // Isolated Docker must stop even when cleanup of an MCP session fails.
      if(containerStarted) {
        stopDocker();
        containerStarted=false;
      }
    }
  }
}
await main();
