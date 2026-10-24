/**
 * Three real protected A2A Agents -> ONE shared MCP -> private task workers ->
 * real Gateway -> Rust Verifier/Adapter -> OPA -> disposable Gitea.
 *
 * Backend and Frontend: read_file + update_file. Test: create_file + run_tests.
 * This variant uses the ACTUAL AccountSuspensionSequentialCoordinator,
 * production Orchestrator Gateway client, root DC bootstrap, role templates,
 * real delegated A2A Role Runner, and A2A/ADK/MCP/Gateway stack.
 * Controlled Runner is an explicit FAILING HTTP STUB, NOT real Docker.
 * Expected: coordinator aborts before create_pull_request, no merge.
 *
 * Uses a scripted offline BaseLlm and the Compose-managed Gitea on a dedicated GitHub-hosted
 * runner; the job removes the Gitea data volume at teardown. No PR or merge requests at all.
 */
import assert from "node:assert/strict";
import {assertPreparedComposeGitea,GITEA_COMPOSE_CONTAINER as container,GITEA_COMPOSE_URL as giteaUrl} from "./compose-gitea.mjs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,randomBytes,randomUUID} from "node:crypto";
import {createServer as createNetServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {BaseLlm} from "@google/adk";
import {Role,TaskState} from "@a2a-js/sdk";
import {ClientFactory,ClientFactoryOptions,ServiceParameters,withA2AExtensions} from "@a2a-js/sdk/client";
import {startSpecializedAgentServer,DeterministicA2AOrchestrator} from "../src/index.ts";
import {
  DelegatedA2ARoleRunner,
} from "../../orchestrator-runtime/src/index.ts";
/** Legacy Account Suspension Gateway write helpers; NOT signed DAG API. */
import {OrchestratorProtectedGatewayClient}
  from "../../orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts";
/** Historical static-template child issuance: never canonical approved DAG. */
import {
  DeterministicOrchestratorAuthorityIssuer,
  LegacySoftwareEngineerAuthorityBootstrap as SoftwareEngineerAuthorityBootstrap
} from "../../orchestrator-runtime/src/legacy-authority-client.ts";
// Historical Account Suspension coordinator is intentionally NOT public API.
import {AccountSuspensionSequentialCoordinator} from
  "../../orchestrator-runtime/src/sequential-coordinator.ts";
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
const privateMarker="A2A_MCP_PRIVATE_"+randomBytes(10).toString("hex");
const runnerToken=randomBytes(32).toString("hex");
function docker(args,label){
  try{return execFileSync("docker",args,{encoding:"utf8",
    timeout:120000,stdio:["ignore","pipe","pipe"]}).trim();}
  catch{throw Error("Disposable Docker operation failed: "+label);}
}
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
  // Seed ONLY main before protecting it. Production Coordinator must call
  // Orchestrator Gateway create_branch; do not precreate its feature branch.
  for(const role of ["backend","frontend"]){
    await api(url,repo+"/contents/"+paths[role],{method:"POST",
      auth:adminAuth,label:"seed main baseline source for "+role,
      body:{branch:"main",content:Buffer.from(sourceBefore[role]).toString("base64"),
        message:"fixture: main baseline "+role+" source"}});
  }
  const missing=await fetch(url+repo+"/contents/"+paths.test+
    "?ref=main",{
      headers:{authorization:adminAuth},signal:AbortSignal.timeout(8000)
    });
  assert.equal(missing.status,404,"Test Agent create_file target must be absent");
  const frozenMain=await api(url,repo+"/branches/main",{auth:adminAuth});
  const frozenMainSha=frozenMain.commit?.id;
  assert.match(frozenMainSha??"",/^[a-f0-9]{40}$/u);
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
  // The production Coordinator must create this branch, not fixture setup.
  const absentBranch=await fetch(url+repo+
    "/branches/feature%2Faccount-suspension",{
      headers:{authorization:adminAuth},signal:AbortSignal.timeout(8000)
    });
  assert.equal(absentBranch.status,404,"Production feature branch exists before Coordinator");
  return {adminAuth,token:token.sha1,mainSha:frozenMainSha,repo};
}
async function main(){
  assert.equal((await api(adapter,"/health",{label:"Rust Adapter health"})).status,"ok");
  const op=await fetch(opa+"/health",{signal:AbortSignal.timeout(4000)});
  assert.equal(op.status,200,"Real OPA is not running");
  // Avoid unexpected image downloads and disk pressure during the smoke.
  assertPreparedComposeGitea();
  const agents={},models={};
  let gatewayServer,runnerServer,sharedServer;
  try{
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

    const rootId="urn:thesis:isolated-coordinator-root:"+id;
    // Real Software Engineer -> Orchestrator DC template: includes Orchestrator
    // branch/PR scope and all three role child templates.
    const bootstrap=new SoftwareEngineerAuthorityBootstrap({
      adapterBaseUrl:adapter,bearerToken:tokens.engineer
    });
    const root=await bootstrap.issueOrchestratorRoot({
      credential_id:rootId,valid_from:new Date().toISOString(),
      validity_seconds:3600,credential_status:status(880)
    });
    assert.equal(root.id,rootId);
    const orchestratorGateway=new OrchestratorProtectedGatewayClient({
      gatewayBaseUrl:gatewayUrl,adapterBaseUrl:adapter,
      adapterToken:tokens.orchestrator,rootCredentialId:rootId
    });
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
    const completed=[];
    let createBranchCalls=0;
    let prCalls=0;
    const wrappedGateway={
      async createFeatureBranch(taskId){
        createBranchCalls++;
        return orchestratorGateway.createFeatureBranch(taskId);
      },
      async createAccountSuspensionPullRequest(taskId){
        prCalls++;
        // This is intentionally a fail-closed smoke. No PR is permitted
        // regardless of downstream accidental success.
        throw Error("Unexpected PR request before successful acceptance");
      }
    };
    const actualRoleRunner=new DelegatedA2ARoleRunner({
      authorityIssuer:new DeterministicOrchestratorAuthorityIssuer({
        adapterBaseUrl:adapter,bearerToken:tokens.orchestrator
      }),
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:60_000,initialIntervalMs:120,maxIntervalMs:1000
      })
    });
    const roleRunner={
      async issueAndRun(input){
        const role=input.role;
        // The production Coordinator uses stable logical credential IDs.
        // Give test runs an isolated unique suffix in the development Adapter.
        const delegated=await actualRoleRunner.issueAndRun({
          ...input,credential_id:input.credential_id+":"+id
        });
        completed.push(role);
        const a=delegated.artifact;
        assert.equal(a.role,role);
        assert.deepEqual(a.files_modified,[paths[role]]);
        assert.deepEqual(a.files_created,[]);
        assert.match(a.revision??"",/^[0-9a-f]{40}$/u);
        committed[role]=a.revision;
        const actual=await api(giteaUrl,fixture.repo+
          "/branches/feature%2Faccount-suspension",{
            auth:fixture.adminAuth,label:"verify "+role+" SHA"
          });
        assert.equal(actual.commit.id,a.revision);
        const file=await api(giteaUrl,fixture.repo+"/contents/"+paths[role]+
          "?ref="+encodeURIComponent(a.revision),{auth:fixture.adminAuth});
        assert.equal(Buffer.from(file.content,"base64").toString("utf8"),
          sourceAfter[role]);
        if(role==="frontend")assert.notEqual(a.revision,committed.backend);
        return delegated;
      }
    };
    const coordinator=new AccountSuspensionSequentialCoordinator({
      gateway:wrappedGateway,roleRunner,rootCredentialId:rootId,
      agentBaseUrls:Object.fromEntries(roles.map(r=>[r,agents[r].baseUrl])),
      statusListCredential:"https://status.example/lists/a2a-isolated-coordinator",
      childValiditySeconds:1800
    });
    await assert.rejects(()=>coordinator.run(),
      /Protected A2A task ended without completion/u,
      "The production Coordinator must fail on the Test Agent test gate");
    assert.equal(createBranchCalls,1,
      "Production Orchestrator did not create the feature branch");
    assert.equal(prCalls,0,"Production Coordinator attempted a PR on failed tests");
    assert.deepEqual(completed,["backend","frontend"],
      "Production Coordinator accepted Test failure or violated role order");

    const feature=await api(giteaUrl,fixture.repo+
      "/branches/feature%2Faccount-suspension",{auth:fixture.adminAuth});
    const testedCommit=feature.commit.id;
    assert.equal(runnerRequests.length,1,"Test Runner was not invoked exactly once");
    assert.equal(runnerRequests[0].commit_sha,testedCommit,
      "Runner was not bound to the final actual Gitea revision");
    assert.notEqual(testedCommit,committed.frontend,
      "Test Agent did not produce a separate Gitea commit");
    const testFile=await api(giteaUrl,fixture.repo+"/contents/"+paths.test+
      "?ref="+encodeURIComponent(testedCommit),{auth:fixture.adminAuth});
    assert.equal(Buffer.from(testFile.content,"base64").toString("utf8"),
      sourceAfter.test);
    assert.equal(agents.backend.executor.executionCount,1);
    assert.equal(agents.frontend.executor.executionCount,1);
    assert.equal(agents.test.executor.executionCount,1);
    assert.equal(models.backend.requests.length,3);
    assert.equal(models.frontend.requests.length,3);
    assert.equal(models.test.requests.length,3);
    const lastModel=JSON.stringify(models.test.requests.at(-1)?.contents??[]);
    assert.ok(lastModel.includes("tests_failed"),
      "Test Agent did not receive controlled failing Runner verdict");

    const modelContext=JSON.stringify(roles.flatMap(role=>models[role].requests));
    for(const secret of [rootId,privateMarker,runnerToken,fixture.token,
      ...roles.map(role=>pairs[role].privateKey),...Object.values(tokens)]){
      assert.equal(modelContext.includes(secret),false,
        "Credential or private authority leaked into ADK model context");
    }
    const main=await api(giteaUrl,fixture.repo+"/branches/main",
      {auth:fixture.adminAuth});
    assert.equal(main.commit.id,fixture.mainSha,"Protected main moved");
    const prs=await api(giteaUrl,fixture.repo+"/pulls?state=all",
      {auth:fixture.adminAuth,label:"verify no PR"});
    assert.ok(Array.isArray(prs)&&prs.length===0,"Unexpected PR");
    process.stdout.write(JSON.stringify({
      event:"a2a_production_coordinator_mcp_isolated_fail_closed",
      status:"PASS",model:"scripted_offline",
      a2a_roles:roles,shared_mcp_servers:1,
      actual_coordinator:"AccountSuspensionSequentialCoordinator",
      actual_authority_bootstrap:true,
      actual_role_runner:"DelegatedA2ARoleRunner",
      completed_roles:completed,
      backend_revision:committed.backend,
      frontend_revision:committed.frontend,
      test_create_revision:testedCommit,
      runner:"controlled_http_stub_expected_failure",
      coordinator_result:"REJECTED_ON_FAILED_TEST_GATE",
      attempted_pr_calls:prCalls,
      tests:["real_gateway_branch_creation",
        "production_root_and_role_child_delegation",
        "backend_real_a2a_mcp_update","frontend_real_a2a_mcp_update",
        "test_real_mcp_create","test_runner_fail_closed",
        "coordinator_blocks_pr","exact_branch_sha","main_unchanged",
        "zero_pull_requests","no_model_credential_leak","disposable_gitea_only"]
    })+"\n");
  }finally{
    try{
      // Do not skip socket cleanup just because one server close fails.
      await Promise.allSettled([
        ...[...roles].reverse().map(role=>agents[role]?.close()),
        stop(sharedServer),stop(gatewayServer),stop(runnerServer)
      ]);
    }finally{
      
    }
  }
}
await main();
