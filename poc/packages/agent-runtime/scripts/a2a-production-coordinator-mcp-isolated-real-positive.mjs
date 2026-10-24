/**
 * Three real protected A2A Agents -> ONE shared MCP -> private task workers ->
 * real Gateway -> Rust Verifier/Adapter -> OPA -> disposable Gitea.
 *
 * Backend and Frontend: read_file + update_file. Test: create_file + run_tests.
 * This variant uses the ACTUAL AccountSuspensionSequentialCoordinator,
 * production Orchestrator Gateway client, root DC bootstrap, role templates,
 * real delegated A2A Role Runner, and A2A/ADK/MCP/Gateway stack.
 * REAL Docker Runner executes six project phases and independent acceptance.
 * 11 pinned reference files are written by protected ADK/A2A/MCP role tools.
 * Scripted model only: this does NOT prove generative Gemini correctness.
 * Trusted CI status is published ONLY by a separate, privileged harness
 * after independent real Docker execution; no human review or merge is faked.
 *
 * Uses a scripted offline BaseLlm and the Compose-managed Gitea on a dedicated GitHub-hosted
 * runner; the job removes the Gitea data volume at teardown. PR creation only; NO merge.
 */
import assert from "node:assert/strict";
import {provisionProtectedGiteaFixture} from "./protected-gitea-bootstrap.mjs";
import {assertPreparedComposeGitea,GITEA_COMPOSE_CONTAINER as container,GITEA_COMPOSE_URL as giteaUrl} from "./compose-gitea.mjs";
import {execFileSync} from "node:child_process";
import {mkdtemp,rm,stat,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {generateKeyPairSync,randomBytes,randomUUID} from "node:crypto";
import {createServer as createNetServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {BaseLlm} from "@google/adk";
import {Role,TaskState} from "@a2a-js/sdk";
import {ClientFactory,ClientFactoryOptions,ServiceParameters,withA2AExtensions} from "@a2a-js/sdk/client";
import {startSpecializedAgentServer,DeterministicA2AOrchestrator} from "../src/index.ts";
import {
  DelegatedA2ARoleRunner,
  OrchestratorProtectedGatewayClient,
  GiteaMergeReadinessVerifier,MergeReadinessDenied
} from "../../orchestrator-runtime/src/index.ts";
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
import {IsolatedDockerRunnerExecutor} from "../../../apps/test-runner-controller/src/isolated-executor.ts";
import {TrustedGiteaSecurityCi,SECURITY_STATUS_CONTEXT} from "../../../apps/test-runner-controller/src/trusted-security-ci.ts";
import {TrustedGiteaMergeExecutor} from "../../orchestrator-runtime/src/trusted-merge.ts";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES as reference} from "../../../apps/test-runner-controller/fixtures/account-suspension-reference.mjs";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";
import {assertCurrentAuthorityBoundaries} from "./assert-current-authority-boundaries.mjs";
import {runResearcherAcceptanceNegative} from "./assert-researcher-acceptance-negative.mjs";

const roles=["backend","frontend","test"];
const branch="feature/account-suspension";
const baselineSha="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const referenceSource="https://github.com/DarkGh0st03/iam-console-poc.git";
const filesByRole={
  backend:["packages/shared/src/account-status.ts",
    "apps/backend/src/users/user.service.ts",
    "apps/backend/src/users/user.controller.ts",
    "apps/backend/src/users/user.routes.ts"],
  frontend:["apps/frontend/src/api/users-api.ts",
    "apps/frontend/src/pages/UserDetailPage.tsx",
    "apps/frontend/src/styles.css"],
  test:["tests/backend/user.service.test.ts",
    "tests/backend/user.routes.test.ts",
    "tests/frontend/UserDetailPage.test.tsx",
    "tests/e2e/account-suspension.spec.ts"]
};
const expectedPaths=Object.values(filesByRole).flat();
assert.equal(expectedPaths.length,11);
assert.deepEqual(new Set(expectedPaths),new Set(Object.keys(reference)));
const readThenUpdate=path=>[
  {name:"read_file",args:{branch,path}},
  {name:"update_file",args:{branch,path,content:reference[path]}}
];
const expectedActions={
  backend:filesByRole.backend.flatMap(readThenUpdate),
  frontend:filesByRole.frontend.flatMap(readThenUpdate),
  test:[...filesByRole.test.slice(0,-1).flatMap(readThenUpdate),
    {name:"create_file",args:{branch,path:filesByRole.test.at(-1),
      content:reference[filesByRole.test.at(-1)]}},
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
// Disabled by default. This flag authorizes a synthetic REVIEW + MERGE
// only in the Compose-managed Gitea fixture provided by GitHub Actions.
// It never represents authentic human approval or production authorization.
const simulatedPositiveMerge=process.env.DISPOSABLE_SIMULATED_MERGE_TEST==="1";
const nodeImage=process.env.TEST_RUNNER_DOCKER_IMAGE??"node:22.15.0-bookworm";
let realRunnerResult=null;
function docker(args,label){
  try{return execFileSync("docker",args,{encoding:"utf8",
    timeout:120000,stdio:["ignore","pipe","pipe"]}).trim();}
  catch{throw Error("Disposable Docker operation failed: "+label);}
}
function safeGit(args,{cwd,auth,label="isolated Git operation"}={}){
  const env={...process.env,GIT_TERMINAL_PROMPT:"0",
    GIT_ASKPASS:"",GCM_INTERACTIVE:"never"};
  if(auth){
    env.GIT_CONFIG_COUNT="1";
    env.GIT_CONFIG_KEY_0="http.extraheader";
    env.GIT_CONFIG_VALUE_0="Authorization: "+auth;
  }
  try{return execFileSync("git",args,{cwd,env,encoding:"utf8",
    timeout:180000,stdio:["ignore","pipe","pipe"]}).trim();}
  catch{throw Error(label+" failed (no credentials or raw stderr printed)");}
}
async function seedPinnedMain(url,admin){
  const dir=await mkdtemp(join(tmpdir(),"pinned-iam-main-"));
  try{
    const app=join(dir,"iam-console-poc");
    safeGit(["clone","--single-branch","--branch",
      "baseline-before-account-suspension",referenceSource,app],
      {label:"clone pinned full IAM history"});
    assert.equal(safeGit(["rev-parse","HEAD"],{cwd:app}),baselineSha);
    safeGit(["branch","-M","main"],{cwd:app});
    safeGit(["push",url+"/thesis/iam-console-poc.git","HEAD:refs/heads/main"],
      {cwd:app,auth:admin,label:"push immutable main"});
    const repo="/api/v1/repos/thesis/iam-console-poc";
    let observed=null;
    for(let i=0;i<50;i++){
      observed=await api(url,repo,{auth:admin,label:"observe post-receive metadata"});
      if(observed.empty===false)break;
      await delay(400);
    }
    assert.equal(observed?.empty,false,"Gitea did not initialize pushed main");
    const main=await api(url,repo+"/branches/main",{auth:admin});
    assert.equal(main.commit.id,baselineSha);
  }finally{await rm(dir,{recursive:true,force:true});}
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
  // Synthetic identities are CREATED ONLY in the disposable Gitea.
  // Only the isolated CI service may publish real CI statuses; no account
  // may forge a human review or carry out a merge in this test.
  const readonlyName="auditor-"+id;
  const reviewerName="reviewer-"+id;
  const ciName="security-ci-"+id;
  const mergeName="merge-operator-"+id;
  const auditorPassword=randomBytes(24).toString("hex");
  const ciPassword=randomBytes(24).toString("hex");
  const reviewerPassword=randomBytes(24).toString("hex");
  const mergePassword=randomBytes(24).toString("hex");
  for(const [username,password,email] of [
    [readonlyName,auditorPassword,"audit"],
    [reviewerName,reviewerPassword,"review"],
    [ciName,ciPassword,"security"],
    ...(simulatedPositiveMerge?[[mergeName,mergePassword,"merge"]]:[])
  ]){
    docker(["exec","--user","1000:1000",container,
      "gitea","admin","user","create",
      "--username",username,"--password",password,
      "--email",email+"-"+id+"@localhost.invalid",
      "--must-change-password=false"],"create isolated readiness identity");
  }
  const fixtureBase=await provisionProtectedGiteaFixture({
    url,api,basic,seedPinnedMain,tokens,id,adminAuth,gatewayAuth,
    readonlyName,reviewerName,ciName,auditorPassword,ciPassword,
    baselineSha,lastTestPath:filesByRole.test.at(-1)
  });
  const {repo}=fixtureBase;
  let positiveMergeFixture=null;
  if(simulatedPositiveMerge){
    // Synthetic reviewer is NOT a substitute for real human action.
    // This actor only exists in this fresh, automatically removed Gitea.
    for(const name of [reviewerName,mergeName]){
      await api(url,repo+"/collaborators/"+encodeURIComponent(name),{
        method:"PUT",auth:adminAuth,expected:[204],
        body:{permission:"write"},
        label:"grant isolated simulated merge fixture collaborator"
      });
    }
    const reviewToken=await api(url,"/api/v1/users/"+
      encodeURIComponent(reviewerName)+"/tokens",{
        method:"POST",auth:basic(reviewerName,reviewerPassword),
        label:"create isolated synthetic-review token",
        body:{name:"temporary-review-"+id,
          scopes:["write:repository","read:user"]}
      });
    const mergeToken=await api(url,"/api/v1/users/"+
      encodeURIComponent(mergeName)+"/tokens",{
        method:"POST",auth:basic(mergeName,mergePassword),
        label:"create separate isolated merge-operator token",
        body:{name:"temporary-merge-"+id,
          scopes:["write:repository","read:user"]}
      });
    const mergeActor=await api(url,"/api/v1/user",{
      auth:"token "+mergeToken.sha1,
      label:"resolve independent test merge operator"
    });
    assert.equal(mergeActor.login,mergeName);
    assert.equal(mergeActor.is_admin,false);
    positiveMergeFixture={
      reviewToken:reviewToken.sha1,
      mergeToken:mergeToken.sha1,
      mergeActor:{id:mergeActor.id,login:mergeActor.login}
    };
  }
  // The production Coordinator must create this branch, not fixture setup.
  const absentBranch=await fetch(url+repo+
    "/branches/feature%2Faccount-suspension",{
      headers:{authorization:adminAuth},signal:AbortSignal.timeout(8000)
    });
  assert.equal(absentBranch.status,404,"Production feature branch exists before Coordinator");
  return {adminAuth,...fixtureBase,positiveMergeFixture};
}
async function main(){
  assert.equal((await api(adapter,"/health",{label:"Rust Adapter health"})).status,"ok");
  const op=await fetch(opa+"/health",{signal:AbortSignal.timeout(4000)});
  assert.equal(op.status,200,"Real OPA is not running");
  const acceptanceDir=fileURLToPath(new URL(
    "../../../runner/acceptance/",import.meta.url));
  assert.ok((await stat(acceptanceDir)).isDirectory());
  docker(["image","inspect",nodeImage],"check cached Node Runner image");
  assertPreparedComposeGitea();
  const agents={},models={};
  let gatewayServer,runnerServer,sharedServer,runnerLogs;
  try{
    await waitGitea(giteaUrl);
    const fixture=await bootstrapGitea(giteaUrl);
    const runnerRequests=[];
    runnerLogs=await mkdtemp(join(tmpdir(),"shared-mcp-positive-runner-"));
    const executor=new IsolatedDockerRunnerExecutor({
      gitea_base_url:giteaUrl,gitea_owner:"thesis",
      gitea_repository:"iam-console-poc",
      gitea_token:fixture.mergeReadToken,
      docker_image:nodeImage,phase_timeout_ms:300000,
      log_dir:runnerLogs,acceptance_enabled:true,
      acceptance_dir:acceptanceDir
    });
    runnerServer=createRunnerHttpServer({
      bind_host:"127.0.0.1",bind_port:1,
      gateway_token:runnerToken,
      contract:{repository:"gitea://gitea.local/thesis/iam-console-poc",branch}
    },{
      run:async request=>{
        runnerRequests.push(request);
        const result=await executor.run(request);
        realRunnerResult=result;
        process.stderr.write(JSON.stringify({
          event:"shared_mcp_real_runner",
          status:result.status,
          project_tests:result.project_tests?.status,
          researcher_acceptance:result.researcher_acceptance?.status,
          phases:result.phases.map(p=>({phase:p.phase,status:p.status}))
        })+"\n");
        return result;
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
          adapterToken:tokens[role],maxModelTurns:20,
          scopeModelPaths:true,mcpSharedUrl:sharedUrl,
          ...(role!=="test"?{mcpUpdateFile:true}:
            {mcpUpdateFile:true,mcpCreateFile:true,mcpRunTests:true})}
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
        // The real Orchestrator uses Gateway DC/VP/OPA -> Gitea.
        // There is NO merge operation in this code path.
        return orchestratorGateway.createAccountSuspensionPullRequest(taskId);
      }
    };
    const actualRoleRunner=new DelegatedA2ARoleRunner({
      authorityIssuer:new DeterministicOrchestratorAuthorityIssuer({
        adapterBaseUrl:adapter,bearerToken:tokens.orchestrator
      }),
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:1200_000,initialIntervalMs:120,maxIntervalMs:1000
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
        assert.deepEqual([...(a.files_modified??[])].sort(),
          [...(role==="test"?filesByRole.test.slice(0,-1):
            filesByRole[role])].sort());
        assert.deepEqual([...(a.files_created??[])].sort(),
          role==="test"?[filesByRole.test.at(-1)]:[]);
        assert.match(a.revision??"",/^[0-9a-f]{40}$/u);
        committed[role]=a.revision;
        const actual=await api(giteaUrl,fixture.repo+
          "/branches/feature%2Faccount-suspension",{
            auth:fixture.adminAuth,label:"verify "+role+" SHA"
          });
        assert.equal(actual.commit.id,a.revision);
        for(const path of filesByRole[role]){
          const file=await api(giteaUrl,fixture.repo+"/contents/"+path+
            "?ref="+encodeURIComponent(a.revision),{auth:fixture.adminAuth});
          assert.equal(Buffer.from(file.content,"base64").toString("utf8"),
            reference[path],"Unexpected authorized agent file "+path);
        }
        if(role==="frontend")assert.notEqual(a.revision,committed.backend);
        if(role==="test"){
          assert.equal(a.test_outcome,"pass");
          assert.equal(a.project_tests,"pass");
          assert.equal(a.researcher_acceptance,"pass");
          assert.equal(a.tested_commit_sha,a.revision);
          assert.equal(a.runner_profile,"poc-default");
        }
        return delegated;
      }
    };
    const coordinator=new AccountSuspensionSequentialCoordinator({
      gateway:wrappedGateway,roleRunner,rootCredentialId:rootId,
      agentBaseUrls:Object.fromEntries(roles.map(r=>[r,agents[r].baseUrl])),
      statusListCredential:"https://status.example/lists/a2a-isolated-coordinator",
      childValiditySeconds:1800
    });
    const coordinated=await coordinator.run();
    assert.equal(coordinated.workflow.state,"pr_created");
    assert.equal(createBranchCalls,1,
      "Production Orchestrator did not create the feature branch");
    assert.equal(prCalls,1,
      "Production Coordinator must create exactly one PR after Test PASS");
    assert.deepEqual(completed,["backend","frontend","test"],
      "Production Coordinator violated the role order");

    const authorityBoundaries=await assertCurrentAuthorityBoundaries({
      gatewayBaseUrl:gatewayUrl,adapterBaseUrl:adapter,tokens,
      rootCredentialId:rootId,delegatedTasks:coordinated.delegated_tasks,
      giteaBaseUrl:giteaUrl,giteaRepo:fixture.repo,
      giteaAuthorization:fixture.adminAuth,branch,runId:id,
      runnerRequestCount:()=>runnerRequests.length
    });
    process.stderr.write(JSON.stringify({event:"current_authority_boundaries",
      status:"PASS",...authorityBoundaries})+"\n");

    const feature=await api(giteaUrl,fixture.repo+
      "/branches/feature%2Faccount-suspension",{auth:fixture.adminAuth});
    const testedCommit=feature.commit.id;
    assert.equal(runnerRequests.length,1,"Test Runner was not invoked exactly once");
    assert.equal(runnerRequests[0].commit_sha,testedCommit,
      "Runner was not bound to the final actual Gitea revision");
    assert.notEqual(testedCommit,committed.frontend,
      "Test Agent did not produce a separate Gitea commit");
    assert.equal(testedCommit,committed.test);
    assert.equal(coordinated.workflow.current_revision,testedCommit);
    assert.equal(coordinated.pull_request.revision,testedCommit);
    for(const path of expectedPaths){
      const f=await api(giteaUrl,fixture.repo+"/contents/"+path+
        "?ref="+encodeURIComponent(testedCommit),{auth:fixture.adminAuth});
      assert.equal(Buffer.from(f.content,"base64").toString("utf8"),
        reference[path],"Final source differs from pinned reference "+path);
    }
    assert.equal(realRunnerResult?.status,"pass");
    assert.equal(realRunnerResult?.tested_commit_sha,testedCommit);
    assert.equal(realRunnerResult?.project_tests?.status,"pass");
    assert.equal(realRunnerResult?.researcher_acceptance?.status,"pass");
    assert.equal(realRunnerResult?.phases?.length,7);
    assert.ok(realRunnerResult.phases.every(p=>p.status==="pass"));
    const acceptanceNegative=await runResearcherAcceptanceNegative({
      giteaBaseUrl:giteaUrl,giteaWriteToken:fixture.token,
      giteaReadToken:fixture.mergeReadToken,dockerImage:nodeImage,
      logDir:runnerLogs,acceptanceDir,baselineSha,candidateBranch:branch
    });
    process.stderr.write(JSON.stringify(acceptanceNegative)+"\n");
    assert.equal(agents.backend.executor.executionCount,1);
    assert.equal(agents.frontend.executor.executionCount,1);
    assert.equal(agents.test.executor.executionCount,1);
    for(const role of roles)assert.equal(models[role].requests.length,
      expectedActions[role].length+1,"Incorrect scripted ADK tool sequence");
    const lastModel=JSON.stringify(models.test.requests.at(-1)?.contents??[]);
    assert.ok(lastModel.includes("researcher_acceptance"),
      "Test Agent did not receive structured real acceptance verdict");

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
      {auth:fixture.adminAuth,label:"verify exactly one PR"});
    assert.ok(Array.isArray(prs)&&prs.length===1,"Exactly one isolated PR required");
    const pr=prs[0];
    assert.equal(pr.number,coordinated.pull_request.pull_request_number);
    assert.equal(pr.state,"open","Human approval pending: PR must stay OPEN");
    assert.equal(pr.merged,false,"No automated merge may happen");
    assert.equal(pr.head?.sha,testedCommit);
    assert.equal(pr.base?.ref,"main");
    assert.equal(pr.head?.ref,branch);
    const reviews=await api(giteaUrl,fixture.repo+"/pulls/"+pr.number+"/reviews",
      {auth:fixture.adminAuth,label:"verify human review is absent"});
    assert.ok(Array.isArray(reviews)&&reviews.length===0,
      "Smoke must not submit a review or forge a human approval");
    assert.equal(coordinated.workflow.pull_request?.number,pr.number);
    assert.equal(coordinated.workflow.pull_request?.head_revision,testedCommit);

    // The Test Agent's real Docker PASS alone is insufficient to attest
    // security CI. Prove that no Agent/Gateway posted a trusted CI status.
    const statusUrl=fixture.repo+"/commits/"+testedCommit+"/statuses";
    const beforeCi=await api(giteaUrl,statusUrl,{
      auth:"token "+fixture.mergeReadToken,
      label:"verify agents cannot forge trusted CI evidence"
    });
    assert.ok(Array.isArray(beforeCi)&&
      beforeCi.every(item=>item.context!==SECURITY_STATUS_CONTEXT),
      "Agent or Gateway published privileged CI status");
    // A separate trusted service validates the same exact SHA *again* using
    // an independent real Docker Runner, and publishes pending -> success.
    // Neither the test model nor its delegated credentials have this token.
    const independentCi=new TrustedGiteaSecurityCi({
      giteaBaseUrl:giteaUrl,
      giteaReadToken:fixture.mergeReadToken,
      giteaStatusToken:fixture.ciStatusToken,
      trustedStatusActor:fixture.mergeCI,
      runner:{run:request=>executor.run(request)}
    });
    const ciOutcome=await independentCi.run({
      request_id:"independent-trusted-ci-"+randomUUID(),
      repository:"gitea://gitea.local/thesis/iam-console-poc",
      branch,commit_sha:testedCommit,profile:"poc-default"
    });
    assert.equal(ciOutcome.status,"success");
    assert.equal(ciOutcome.tested_commit_sha,testedCommit);
    assert.equal(ciOutcome.context,SECURITY_STATUS_CONTEXT);
    const ciStatuses=await api(giteaUrl,statusUrl,{
      auth:"token "+fixture.mergeReadToken,
      label:"read exact-SHA independent security status attestation"
    });
    const trusted=ciStatuses.filter(s=>s.context===SECURITY_STATUS_CONTEXT);
    assert.equal(trusted.length,2,"Expected pending and success only");
    assert.ok(trusted.some(s=>s.status==="pending"));
    assert.ok(trusted.some(s=>s.status==="success"&&
      s.creator?.id===fixture.mergeCI.id&&
      s.creator?.login===fixture.mergeCI.login&&
      s.id===ciOutcome.gitea_status_id));
    assert.ok(!trusted.some(s=>s.status==="failure"||s.status==="error"));
    // Even a real trusted Security CI success cannot authorize a merge
    // without an authentic human approval bound to this same revision.
    // The isolated synthetic reviewer is never used to submit a review.
    const verifier=new GiteaMergeReadinessVerifier({
      giteaBaseUrl:giteaUrl,
      readToken:fixture.mergeReadToken,
      branchProtectionReadToken:fixture.mergeProtectionReadToken,
      humanReviewer:fixture.mergeReviewer,
      securityPipelineActor:fixture.mergeCI
    });
    let denial=null;
    try{
      await verifier.verify({pullRequestNumber:pr.number,
        expectedHeadSha:testedCommit});
    }catch(error){
      if(!(error instanceof MergeReadinessDenied))throw error;
      denial=error.reason;
    }
    // Even a perfectly formed PR number is not transferable to a
    // different Git revision: prove the real PR rejects stale SHA.
    await assert.rejects(
      ()=>verifier.verify({pullRequestNumber:pr.number,
        expectedHeadSha:fixture.mainSha}),
      error=>error instanceof MergeReadinessDenied&&
        error.reason==="pr_revision_mismatch",
      "Live Gitea merge readiness accepted stale revision"
    );
    assert.notEqual(denial,null,
      "Unsafe: real Runner PASS without approval and trusted CI made merge READY");
    assert.ok([
      "human_approval_missing",
      "pr_not_mergeable"
    ].includes(denial),
      "Unexpected live Gitea readiness denial: "+denial);
    // Re-check the live PR is still open after trusted CI publication,
    // with neither an approval nor an unauthorized merge.
    const afterReviews=await api(giteaUrl,fixture.repo+
      "/pulls/"+pr.number+"/reviews",{auth:fixture.adminAuth,
      label:"verify CI did not fabricate a human review"});
    assert.deepEqual(afterReviews,[]);
    const afterPr=await api(giteaUrl,fixture.repo+"/pulls/"+pr.number,{
      auth:fixture.adminAuth,label:"verify CI left PR open"
    });
    assert.equal(afterPr.merged,false);
    assert.equal(afterPr.state,"open");
    assert.equal(afterPr.head?.sha,testedCommit);
    let positiveMerge=null;
    if(simulatedPositiveMerge){
      const fixtureIdentity=fixture.positiveMergeFixture;
      assert.ok(fixtureIdentity,"Positive merge fixture missing isolated identity");
      // This is deliberately a SIMULATED review, on an ephemeral repo only.
      // Production review must come from a real human acting in Gitea.
      const submitted=await api(giteaUrl,fixture.repo+
        "/pulls/"+pr.number+"/reviews",{
        method:"POST",auth:"token "+fixtureIdentity.reviewToken,
        label:"temporary simulated human-review API fixture",
        body:{event:"APPROVED",commit_id:testedCommit,
          body:"SYNTHETIC REVIEW -- DISPOSABLE CI TEST ONLY"}
      });
      assert.equal(submitted.state,"APPROVED");
      assert.equal(submitted.commit_id,testedCommit);
      assert.equal(submitted.user?.id,fixture.mergeReviewer.id);
      assert.equal(submitted.user?.login,fixture.mergeReviewer.login);
      const guarded=new TrustedGiteaMergeExecutor({
        giteaBaseUrl:giteaUrl,
        readToken:fixture.mergeReadToken,
        branchProtectionReadToken:fixture.mergeProtectionReadToken,
        humanReviewer:fixture.mergeReviewer,
        securityPipelineActor:fixture.mergeCI,
        mergeToken:fixtureIdentity.mergeToken,
        mergeActor:fixtureIdentity.mergeActor
      });
      // Gitea computes mergeability asynchronously on some versions.
      // We only wait for this positive fixture to become ready; all other
      // errors remain fail closed and do not lead to a merge attempt.
      let ready=false;
      for(let attempt=0;attempt<25;attempt++){
        try{
          const observed=await verifier.verify({
            pullRequestNumber:pr.number,expectedHeadSha:testedCommit
          });
          assert.equal(observed.ready,true);
          ready=true;
          break;
        }catch(error){
          if(!(error instanceof MergeReadinessDenied)||
            error.reason!=="pr_not_mergeable")throw error;
          await delay(400);
        }
      }
      assert.equal(ready,true,
        "Simulated review and CI did not establish protected merge readiness");
      positiveMerge=await guarded.execute({
        pullRequestNumber:pr.number,expectedHeadSha:testedCommit
      });
      assert.equal(positiveMerge.merged,true);
      assert.equal(positiveMerge.head_sha,testedCommit);
      assert.equal(positiveMerge.previous_main_sha,baselineSha);
      assert.notEqual(positiveMerge.merged_main_sha,baselineSha);
      const finalPr=await api(giteaUrl,fixture.repo+"/pulls/"+pr.number,{
        auth:fixture.adminAuth,label:"verify isolated merged PR"
      });
      assert.equal(finalPr.state,"closed");
      assert.equal(finalPr.merged,true);
      assert.equal(finalPr.head?.sha,testedCommit);
      const mainAfter=await api(giteaUrl,fixture.repo+"/branches/main",{
        auth:fixture.adminAuth,label:"verify isolated main merge commit"
      });
      assert.equal(mainAfter.commit.id,positiveMerge.merged_main_sha);
      assert.equal(positiveMerge.merge_actor_id,fixtureIdentity.mergeActor.id);
      const serializedModelContext=JSON.stringify(
        roles.flatMap(role=>models[role].requests));
      for(const t of [fixtureIdentity.reviewToken,fixtureIdentity.mergeToken,
        fixture.ciStatusToken]){
        assert.ok(!serializedModelContext.includes(t),
          "Privileged review/CI/merge token leaked to agent model context");
      }
    }
    process.stdout.write(JSON.stringify({
      event:"a2a_production_coordinator_mcp_real_positive_acceptance",
      status:"PASS",model:"scripted_offline_11_reference_files",
      a2a_roles:roles,shared_mcp_servers:1,
      actual_coordinator:"AccountSuspensionSequentialCoordinator",
      actual_authority_bootstrap:true,
      actual_role_runner:"DelegatedA2ARoleRunner",
      authority_boundaries:authorityBoundaries,
      researcher_acceptance_negative:acceptanceNegative,
      completed_roles:completed,
      backend_revision:committed.backend,
      frontend_revision:committed.frontend,
      test_create_revision:testedCommit,
      runner:"real_docker_six_phases_and_independent_acceptance",
      coordinator_result:"PR_CREATED_PENDING_HUMAN_APPROVAL",
      pull_request_number:coordinated.pull_request.pull_request_number,
      attempted_pr_calls:prCalls,merge_calls:positiveMerge?1:0,
      merge_readiness:"DENIED",
      merge_readiness_denial:denial,
      security_pipeline_context_present:true,
      trusted_security_ci:"pending_then_success_by_separate_actor",
      trusted_status_id:ciOutcome.gitea_status_id,
      independent_real_runner:true,
      approval_created:simulatedPositiveMerge,
      simulated_review_fixture_only:simulatedPositiveMerge,
      merge_outcome:positiveMerge?"MERGED_ONLY_IN_DISPOSABLE_GITEA":"NOT_MERGED",
      tests:["real_gateway_branch_and_pr_creation",
        "production_root_and_role_child_delegation",
        "six_real_role_authority_denials_and_unrelated_proof_rejections",
        "backend_real_a2a_mcp_update","frontend_real_a2a_mcp_update",
        "test_real_mcp_create","all_11_files_written_by_role_scoped_mcp_tools",
        "real_docker_all_project_phases_and_acceptance_pass",
        "baseline_project_pass_independent_researcher_acceptance_fail",
        "production_coordinator_positive_gate",
        "pr_open_no_reviews_no_merge",
        "live_read_only_merge_readiness_denied",
        "live_stale_pr_sha_denied",
        "no_agent_forged_trusted_ci_status",
        "trusted_independent_real_docker_ci_pass",
        "exact_sha_pending_then_success_status_by_ci_actor",
        "trusted_ci_does_not_create_human_approval",
        "exact_branch_sha","main_unchanged",
        "no_model_credential_leak","disposable_gitea_only"]
    })+"\n");
  }finally{
    try{
      // Do not skip socket cleanup just because one server close fails.
      await Promise.allSettled([
        ...[...roles].reverse().map(role=>agents[role]?.close()),
        stop(sharedServer),stop(gatewayServer),stop(runnerServer)
      ]);
    }finally{
      if(runnerLogs)await rm(runnerLogs,{recursive:true,force:true});
      
    }
  }
}
await main();
