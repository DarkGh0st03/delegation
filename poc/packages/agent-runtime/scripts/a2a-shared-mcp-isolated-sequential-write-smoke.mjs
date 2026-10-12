/**
 * Three real protected A2A Agents -> ONE shared MCP -> private task workers ->
 * real Gateway -> Rust Verifier/Adapter -> OPA -> disposable Gitea.
 *
 * Backend and Frontend: read_file + update_file. Test: create_file + run_tests.
 * Runner is an explicit INTERNAL FAILING STUB (not Docker): this stage checks
 * sequential stateful routing + fail-closed A2A, NOT passing tests/acceptance.
 *
 * Uses a scripted offline BaseLlm and only a temporary Gitea with no volumes,
 * host bind mounts or persistent repo access. No PR or merge requests at all.
 */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,randomBytes,randomUUID} from "node:crypto";
import {createServer as createNetServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {BaseLlm} from "@google/adk";
import {Role,TaskState} from "@a2a-js/sdk";
import {ClientFactory,ClientFactoryOptions,ServiceParameters,withA2AExtensions} from "@a2a-js/sdk/client";
import {startSpecializedAgentServer,assertDelegatedAuthorizationSupport,
  DELEGATED_AUTHORIZATION_EXTENSION_URI} from "../src/index.ts";
import {GatewayRuntime} from "../../../apps/gateway/src/runtime.ts";
import {createGatewayHttpServer} from "../../../apps/gateway/src/http.ts";
import {createRunnerHttpServer} from "../../../apps/test-runner-controller/src/http.ts";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";

const roles=["backend","frontend","test"];
const branch="feature/account-suspension";
const paths={
  backend:"apps/backend/src/users/user.service.ts",
  frontend:"apps/frontend/src/pages/UserDetailPage.tsx",
  test:"tests/e2e/account-suspension.spec.ts"
};
const sourceBefore={
  backend:"export class UserService { status = 'ACTIVE'; }\n",
  frontend:"export function UserDetailPage() { return 'ACTIVE'; }\n"
};
const sourceAfter={
  backend:"export class UserService { status = 'SUSPENDED'; }\n",
  frontend:"export function UserDetailPage() { return 'SUSPENDED'; }\n",
  test:"import { test, expect } from '@playwright/test';\ntest('account suspension',()=>expect('SUSPENDED').toBe('SUSPENDED'));\n"
};
const expectedActions={
  backend:[{name:"read_file",args:{branch,path:paths.backend}},
    {name:"update_file",args:{branch,path:paths.backend,content:sourceAfter.backend}}],
  frontend:[{name:"read_file",args:{branch,path:paths.frontend}},
    {name:"update_file",args:{branch,path:paths.frontend,content:sourceAfter.frontend}}],
  test:[{name:"create_file",args:{branch,path:paths.test,content:sourceAfter.test}},
    {name:"run_tests",args:{branch,profile:"poc-default"}}]
};
const tokens={
  engineer:process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator:process.env.ADAPTER_CALLER_ORCHESTRATOR,
  gateway:process.env.ADAPTER_CALLER_GATEWAY,
  backend:process.env.ADAPTER_CALLER_BACKEND,
  frontend:process.env.ADAPTER_CALLER_FRONTEND,
  test:process.env.ADAPTER_CALLER_TEST,
  adminUser:process.env.GITEA_ADMIN_USER,
  adminPassword:process.env.GITEA_ADMIN_PASSWORD,
  gatewayUser:process.env.GITEA_GATEWAY_USER,
  gatewayPassword:process.env.GITEA_GATEWAY_PASSWORD
};
for(const [k,v] of Object.entries(tokens))if(!v)throw Error("Missing development variable "+k);
const adapter=process.env.ADAPTER_SMOKE_URL??"http://127.0.0.1:8090";
const opa=process.env.OPA_URL??"http://127.0.0.1:8181";
for(const [label,u] of [["Adapter",adapter],["OPA",opa]]){
  const parsed=new URL(u);
  if(parsed.protocol!=="http:"||
     !["127.0.0.1","localhost","[::1]"].includes(parsed.hostname)||
     parsed.username||parsed.password||parsed.search||parsed.hash||
     parsed.pathname!=="/"){
    throw Error(label+" must be a loopback-only development URL");
  }
}
const id=randomBytes(6).toString("hex");
const container="delegation-mcp-a2a-write-"+id;
const image=process.env.GITEA_IMAGE??"docker.gitea.com/gitea:28.0.0";
const privateMarker="A2A_MCP_PRIVATE_"+randomBytes(10).toString("hex");
const runnerToken=randomBytes(32).toString("hex");
let started=false;
function docker(args,label){
  try{return execFileSync("docker",args,{encoding:"utf8",
    timeout:120000,stdio:["ignore","pipe","pipe"]}).trim();}
  catch{throw Error("Disposable Docker operation failed: "+label);}
}
function stopDocker(){
  try{execFileSync("docker",["stop","--time","5",container],{
    timeout:30000,stdio:"ignore"});}catch{/* already removed */}
}
for(const sig of ["SIGINT","SIGTERM"])process.once(sig,()=>{
  if(started)stopDocker();
  process.exitCode=130;
});
async function api(base,uri,{method="GET",body,auth,expected=[200,201],label=uri}={}){
  const headers={accept:"application/json"};
  if(body!==undefined)headers["content-type"]="application/json";
  if(auth)headers.authorization=auth;
  const response=await fetch(base+uri,{
    method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
    redirect:"error",signal:AbortSignal.timeout(15000)
  });
  if(!expected.includes(response.status)){
    // Never print a response body or a credential-bearing URL.
    throw Error("Isolated "+label+" HTTP "+response.status);
  }
  return response.status===204?{}:response.json();
}
function basic(u,p){return "Basic "+Buffer.from(u+":"+p).toString("base64");}
function auth(t){return "Bearer "+t;}
async function waitGitea(url){
  for(let i=0;i<180;i++){
    try{const response=await fetch(url+"/api/healthz",{
      signal:AbortSignal.timeout(1100)});
      if(response.ok)return;
    }catch{/* starting */}
    await delay(500);
  }
  throw Error("Disposable Gitea is not healthy");
}
async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
  });
  return "http://127.0.0.1:"+server.address().port;
}
async function stop(server){
  if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
async function freePort(){
  const s=createNetServer();await listen(s);
  const port=s.address().port;await stop(s);return port;
}
function pair(){
  const k=generateKeyPairSync("ed25519");
  return {privateKey:k.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKey:k.publicKey.export({type:"spki",format:"pem"}).toString()};
}
const pairs=Object.fromEntries(roles.map(r=>[r,pair()]));
function status(index){return {
  type:"BitstringStatusListEntry",statusPurpose:"revocation",
  statusListIndex:String(index),
  statusListCredential:"https://status.example/lists/a2a-isolated-mcp-multirole"
};}
class FixedRoleModel extends BaseLlm{
  requests=[];
  constructor(role){super({model:"offline-"+role+"-mcp"});this.role=role;}
  async *generateContentAsync(request){
    this.requests.push(request);
    const i=this.requests.length;
    const step=expectedActions[this.role][i-1];
    if(step){
      yield {content:{role:"model",parts:[{functionCall:{
        id:this.role+"-action-"+i,name:step.name,args:step.args
      }}]}};
    }else{
      yield {content:{role:"model",parts:[{text:"The controlled sequence has ended"}]}};
    }
  }
  connect(){return Promise.reject(Error("No external AI model allowed"));}
}
async function bootstrapGitea(url){
  for(const [username,password,admin] of [
    [tokens.adminUser,tokens.adminPassword,true],
    [tokens.gatewayUser,tokens.gatewayPassword,false]
  ]){
    docker(["exec","--user","1000:1000",container,
      "gitea","admin","user","create",
      "--username",username,"--password",password,
      "--email",(admin?"root":"gateway")+"@localhost.invalid",
      ...(admin?["--admin"]:[]),"--must-change-password=false"],"create isolated user");
  }
  const adminAuth=basic(tokens.adminUser,tokens.adminPassword);
  const gatewayAuth=basic(tokens.gatewayUser,tokens.gatewayPassword);
  await api(url,"/api/v1/orgs",{method:"POST",auth:adminAuth,
    label:"create private org",body:{username:"thesis",visibility:"private"}});
  await api(url,"/api/v1/orgs/thesis/repos",{
    method:"POST",auth:adminAuth,label:"create disposable repository",
    body:{name:"iam-console-poc",private:true,auto_init:true,
      default_branch:"main",readme:"Default"}
  });
  const repo="/api/v1/repos/thesis/iam-console-poc";
  const main=await api(url,repo+"/branches/main",{auth:adminAuth});
  const mainSha=main.commit?.id;
  assert.match(mainSha??"",/^[a-f0-9]{40}$/u);
  await api(url,repo+"/branches",{method:"POST",auth:adminAuth,
    body:{new_branch_name:branch,old_branch_name:"main"}});
  for(const role of ["backend","frontend"]){
    await api(url,repo+"/contents/"+paths[role],{method:"POST",
      auth:adminAuth,label:"seed feature source for "+role,
      body:{branch,content:Buffer.from(sourceBefore[role]).toString("base64"),
        message:"fixture: isolated "+role+" source"}});
  }
  const missing=await fetch(url+repo+"/contents/"+paths.test+
    "?ref="+encodeURIComponent(branch),{
      headers:{authorization:adminAuth},signal:AbortSignal.timeout(8000)
    });
  assert.equal(missing.status,404,"Test Agent create_file target must be absent");
  await api(url,repo+"/branch_protections",{method:"POST",auth:adminAuth,
    label:"protect disposable main",body:{
      branch_name:"main",enable_push:false,enable_force_push:false,
      required_approvals:1,block_admin_merge_override:true,
      dismiss_stale_approvals:true,block_on_outdated_branch:true
    }});
  await api(url,repo+"/collaborators/"+encodeURIComponent(tokens.gatewayUser),{
    method:"PUT",auth:adminAuth,expected:[204],
    body:{permission:"write"},label:"authorize isolated Gateway user"
  });
  const token=await api(url,"/api/v1/users/"+
    encodeURIComponent(tokens.gatewayUser)+"/tokens",{
    method:"POST",auth:gatewayAuth,
    label:"create scoped disposable Gitea token",
    body:{name:"a2a-mcp-multirole-"+id,scopes:["write:repository","read:user"]}
  });
  assert.ok(typeof token.sha1==="string"&&token.sha1.length>=20);
  await api(url,repo,{auth:"token "+token.sha1});
  const feature=await api(url,repo+"/branches/feature%2Faccount-suspension",
    {auth:adminAuth});
  return {adminAuth,token:token.sha1,mainSha,
    initialFeatureSha:feature.commit?.id,repo};
}
async function makeClient(base){
  const f=new ClientFactory(ClientFactoryOptions.createFrom(
    ClientFactoryOptions.default,{preferredTransports:["HTTP+JSON"]}
  ));
  const client=await f.createFromUrl(base);
  assertDelegatedAuthorizationSupport(await client.getAgentCard());
  return client;
}
async function a2aTask(client,role,childId){
  const pathsForRole=role==="test"?[paths.test]:[paths[role]];
  const response=await client.sendMessage({
    tenant:"",message:{
      messageId:randomUUID(),contextId:"",taskId:"",role:Role.ROLE_USER,
      parts:[{content:{$case:"data",value:{
        subtask_id:"isolated-"+role+"-"+id,
        instruction:"Perform only the scripted authorized operations",
        branch,relevant_paths:pathsForRole
      }},metadata:undefined,filename:"",mediaType:"application/json"}],
      metadata:{delegation_evidence:{
        credential:privateMarker,credential_id:childId,
        presenter_id:"did:thesis:"+role+"-agent"
      }},
      extensions:[DELEGATED_AUTHORIZATION_EXTENSION_URI],referenceTaskIds:[]
    },
    configuration:{acceptedOutputModes:["application/json"],historyLength:0,
      returnImmediately:true},
    metadata:{workflow:"account-suspension"}
  },{serviceParameters:ServiceParameters.create(
    withA2AExtensions(DELEGATED_AUTHORIZATION_EXTENSION_URI)
  )});
  let task=response;
  const terminal=new Set([TaskState.TASK_STATE_COMPLETED,TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_REJECTED,TaskState.TASK_STATE_CANCELED]);
  const deadline=Date.now()+35000;
  while(!terminal.has(task.status?.state)){
    if(Date.now()>deadline)throw Error("A2A task deadline exceeded for "+role);
    await delay(120);
    task=await client.getTask({id:response.id,historyLength:0},{
      signal:AbortSignal.timeout(5000)});
  }
  const visible=JSON.stringify(task);
  for(const secret of [privateMarker,childId,...Object.values(tokens)]){
    assert.equal(visible.includes(secret),false,
      "Private authority leaked through "+role+" A2A task");
  }
  return task;
}
function artifact(task){
  assert.equal(task.artifacts?.length,1);
  const item=task.artifacts[0];
  const data=item.parts.find(p=>p.content?.$case==="data");
  assert.ok(data);
  return data.content.value;
}
async function main(){
  assert.equal((await api(adapter,"/health",{label:"Rust Adapter health"})).status,"ok");
  const op=await fetch(opa+"/health",{signal:AbortSignal.timeout(4000)});
  assert.equal(op.status,200,"Real OPA is not running");
  docker(["run","--rm","--detach","--name",container,
    "--publish","127.0.0.1::3000/tcp",
    "--env","USER_UID=1000","--env","USER_GID=1000",
    "--env","GITEA__database__DB_TYPE=sqlite3",
    "--env","GITEA__database__PATH=/data/gitea/gitea.db",
    "--env","GITEA__server__DOMAIN=localhost",
    "--env","GITEA__server__ROOT_URL=http://localhost:3000/",
    "--env","GITEA__server__DISABLE_SSH=true",
    "--env","GITEA__service__DISABLE_REGISTRATION=true",
    "--env","GITEA__security__INSTALL_LOCK=true",
    "--env","GITEA__actions__ENABLED=false",image],
    "launch volume-free isolated Gitea");
  started=true;
  const agents={},models={};
  let gatewayServer,runnerServer,sharedServer;
  try{
    const portInfo=docker(["port",container,"3000/tcp"],
      "inspect isolated Gitea loopback port");
    const match=/127\.0\.0\.1:(\d+)/u.exec(portInfo);
    if(!match)throw Error("Gitea port is not loopback-only");
    const giteaUrl="http://127.0.0.1:"+match[1];
    await waitGitea(giteaUrl);
    const fixture=await bootstrapGitea(giteaUrl);
    const runnerRequests=[];
    // Intentionally negative Runner *stub*: proves fail-closed A2A gating.
    // The separate isolated-real-runner smoke already tested real Docker.
    runnerServer=createRunnerHttpServer({
      bind_host:"127.0.0.1",bind_port:1,
      gateway_token:runnerToken,
      contract:{repository:"gitea://gitea.local/thesis/iam-console-poc",branch}
    },{
      run:async request=>{
        runnerRequests.push(request);
        const failed={phase:"dependency_install",status:"fail",passed:0,failed:1};
        return {
          request_id:request.request_id,
          repository:request.repository,branch:request.branch,
          tested_commit_sha:request.commit_sha,runner_profile:request.profile,
          status:"fail",phases:[failed],
          project_tests:{status:"fail",phases:[failed]},
          researcher_acceptance:{phase:"researcher_acceptance",status:"skipped"}
        };
      }
    });
    const runnerUrl=await listen(runnerServer);
    const runtime=new GatewayRuntime({
      bind_host:"127.0.0.1",bind_port:1,
      prepare:{audience:"cloud-access-gateway",request_ttl_ms:120000,
        repository:{authority:"gitea.local",owner:"thesis",
          repository:"iam-console-poc"}},
      adapter_url:adapter,adapter_gateway_token:tokens.gateway,
      opa_url:opa,opa_timeout_ms:2000,
      provider_mode:"gitea",gitea_base_url:giteaUrl,
      gitea_gateway_token:fixture.token,gitea_timeout_ms:10000,
      runner_url:runnerUrl,runner_gateway_token:runnerToken,
      runner_timeout_ms:900000
    },{audit:{emit:()=>{ /* sanitized smoke logging */ }}});
    gatewayServer=createGatewayHttpServer(runtime);
    const gatewayUrl=await listen(gatewayServer);

    const rootId="urn:thesis:isolated-a2a-mcp-root:"+id;
    const childIds={};
    const permissions={};
    const operations={
      backend:[["read_file",{branch,path:paths.backend}],["update_file",{
        branch,path:paths.backend,content:sourceAfter.backend}]],
      frontend:[["read_file",{branch,path:paths.frontend}],["update_file",{
        branch,path:paths.frontend,content:sourceAfter.frontend}]],
      test:[["create_file",{branch,path:paths.test,content:sourceAfter.test}],
        ["run_tests",{branch,profile:"poc-default"}]]
    };
    for(const role of roles){
      permissions[role]=[];
      for(const [tool,args] of operations[role]){
        const p=await api(gatewayUrl,"/v1/authorization/prepare",{
          method:"POST",label:"prepare "+role+" "+tool,
          body:{task_id:"authorize-"+role+"-"+tool+"-"+id,
            agent_role:role,tool,arguments:args}
        });
        assert.equal(p.required_permission.operation,tool);
        permissions[role].push(p.required_permission);
      }
    }
    const now=new Date().toISOString();
    const allPermissions=roles.flatMap(role=>permissions[role]);
    await api(adapter,"/v1/credentials/root",{method:"POST",auth:auth(tokens.engineer),
      label:"issue disposable root DC",
      body:{credential_id:rootId,delegatee:"orchestrator",
        valid_from:now,validity_seconds:3600,credential_status:status(820),
        permissions:allPermissions}
    });
    for(const [i,role] of roles.entries()){
      childIds[role]="urn:thesis:isolated-a2a-mcp-"+role+":"+id;
      await api(adapter,"/v1/credentials/child",{method:"POST",
        auth:auth(tokens.orchestrator),label:"delegate "+role,
        body:{parent_credential_id:rootId,credential_id:childIds[role],
          delegatee:role,valid_from:now,validity_seconds:1800,
          credential_status:status(821+i),permissions:permissions[role]}
      });
    }
    const ports=Object.fromEntries(await Promise.all(roles.map(async r=>[r,await freePort()])));
    sharedServer=createSharedMcpHttpServer({
      verificationKeys:Object.fromEntries(roles.map(r=>[r,pairs[r].publicKey])),
      router:new TaskRouter(Object.fromEntries(roles.map(r=>[r,{
        baseUrl:"http://127.0.0.1:"+ports[r]
      }])))
    });
    const sharedUrl=(await listen(sharedServer))+"/mcp";
    for(const role of roles){
      const model=new FixedRoleModel(role);
      models[role]=model;
      agents[role]=await startSpecializedAgentServer({
        role,host:"127.0.0.1",port:ports[role],
        mcpTaskSigning:{
          signingPrivateKeyPem:pairs[role].privateKey,
          signingPublicKeyPem:pairs[role].publicKey
        },
        adk:{model,gatewayBaseUrl:gatewayUrl,adapterBaseUrl:adapter,
          adapterToken:tokens[role],maxModelTurns:5,
          scopeModelPaths:true,mcpSharedUrl:sharedUrl,
          ...(role!=="test"?{mcpUpdateFile:true}:
            {mcpCreateFile:true,mcpRunTests:true})}
      });
    }
    const committed={};
    for(const role of roles){
      const client=await makeClient(agents[role].baseUrl);
      const result=await a2aTask(client,role,childIds[role]);
      assert.equal(models[role].requests.length,3,
        role+" should make 2 tool calls plus final model response");
      const responseContext=JSON.stringify(models[role].requests);
      for(const secret of [rootId,childIds[role],privateMarker,
        pairs[role].privateKey,runnerToken,fixture.token,...Object.values(tokens)]){
        assert.equal(responseContext.includes(secret),false,
          "Model-visible authority leaked for "+role);
      }
      if(role!=="test"){
        assert.equal(result.status?.state,TaskState.TASK_STATE_COMPLETED,
          role+" A2A failed to publish a real authorized Artifact");
        const a=artifact(result);
        assert.equal(a.role,role);
        assert.deepEqual(a.files_modified,[paths[role]]);
        assert.deepEqual(a.files_created,[]);
        assert.match(a.revision??"",/^[0-9a-f]{40}$/u);
        committed[role]=a.revision;
        const actual=await api(giteaUrl,fixture.repo+"/branches/feature%2Faccount-suspension",
          {auth:fixture.adminAuth,label:"check "+role+" commit"});
        assert.equal(actual.commit.id,a.revision);
        const file=await api(giteaUrl,fixture.repo+"/contents/"+paths[role]+
          "?ref="+encodeURIComponent(a.revision),{auth:fixture.adminAuth});
        assert.equal(Buffer.from(file.content,"base64").toString("utf8"),
          sourceAfter[role]);
        if(role==="frontend")assert.notEqual(a.revision,committed.backend);
      }else{
        assert.equal(result.status?.state,TaskState.TASK_STATE_FAILED,
          "Failing controlled test gate must fail closed at A2A");
        assert.equal(result.artifacts?.length??0,0,
          "Test Agent published an Artifact without passing tests");
        assert.equal(runnerRequests.length,1);
        const current=await api(giteaUrl,fixture.repo+
          "/branches/feature%2Faccount-suspension",{auth:fixture.adminAuth});
        assert.equal(runnerRequests[0].commit_sha,current.commit.id,
          "Runner did not test the exact Test Agent create revision");
        committed.test=current.commit.id;
        const lastModel=JSON.stringify(models.test.requests.at(-1)?.contents??[]);
        assert.ok(lastModel.includes("tests_failed"),
          "Test Agent was not told about the mandatory test failure");
        const file=await api(giteaUrl,fixture.repo+"/contents/"+paths.test+
          "?ref="+encodeURIComponent(current.commit.id),{auth:fixture.adminAuth});
        assert.equal(Buffer.from(file.content,"base64").toString("utf8"),
          sourceAfter.test);
        assert.notEqual(committed.test,committed.frontend);
      }
      assert.equal(agents[role].executor.executionCount,1);
    }
    const main=await api(giteaUrl,fixture.repo+"/branches/main",
      {auth:fixture.adminAuth});
    assert.equal(main.commit.id,fixture.mainSha,"Protected main moved");
    const prs=await api(giteaUrl,fixture.repo+"/pulls?state=all",
      {auth:fixture.adminAuth,label:"verify no PR"});
    assert.ok(Array.isArray(prs)&&prs.length===0,"Unexpected PR");
    process.stdout.write(JSON.stringify({
      event:"a2a_shared_mcp_isolated_sequential_write_smoke",
      status:"PASS",model:"scripted_offline",
      a2a_roles:roles,shared_mcp_servers:1,
      backend_revision:committed.backend,
      frontend_revision:committed.frontend,
      test_create_revision:committed.test,
      runner:"controlled_http_stub_expected_failure",
      final_test_task:"FAILED_without_success_artifact",
      tests:["backend_real_mcp_update","frontend_real_mcp_update",
        "test_real_mcp_create","test_runner_fail_closed",
        "exact_branch_sha","main_unchanged","zero_pull_requests",
        "no_model_or_a2a_credential_leak","disposable_gitea_only"]
    })+"\n");
  }finally{
    try{
      for(const role of [...roles].reverse())
        await agents[role]?.close().catch(()=>undefined);
      await stop(sharedServer);
      await stop(gatewayServer);
      await stop(runnerServer);
    }finally{
      if(started){stopDocker();started=false;}
    }
  }
}
await main();
