/**
 * One native, signed four-task DAG over the disposable Gitea repository:
 *   branch -> Backend -> Frontend -> Test
 * Real Rust/EVM task-scoped children, native VP, OPA, Gateway provider effects,
 * HTTP A2A SDK, and exact-SHA Docker Runner with independent acceptance.
 * All 11 reference changes are named in the signed plan, not applied by an
 * out-of-band bootstrap. This is deterministic test code, NOT Gemini output.
 */
import assert from "node:assert/strict";
import {randomBytes,randomInt,generateKeyPairSync} from "node:crypto";
import {createServer} from "node:net";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {GatewayRuntime} from "../src/runtime.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {GiteaExecutor} from "../src/gitea-executor.ts";
import {RunnerClient} from "../src/runner-client.ts";
import {OpaPolicyClient} from "../src/policy-client.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";
import {IsolatedDockerRunnerExecutor} from
  "../../test-runner-controller/src/isolated-executor.ts";
import {createRunnerHttpServer} from
  "../../test-runner-controller/src/http.ts";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from
  "../../test-runner-controller/fixtures/account-suspension-reference.mjs";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {startSpecializedAgentServer} from
  "../../../packages/agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator} from
  "../../../packages/agent-runtime/src/orchestrator.ts";
import {OfflineApprovedAdkModel} from "./offline-approved-adk-model.mjs";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";
import {createSharedMcpHttpServer}
  from "../../../mcp-shared/src/http-server.ts";

const adapterUrl="http://127.0.0.1:8090";
const EDIT_ROLES=["backend","frontend"];
const ROLES=[...EDIT_ROLES,"test"];
const SHA=/^[0-9a-f]{40}$/u;
async function signedVp(credentialId,challenge,token){
  const response=await fetch(adapterUrl+"/v1/presentations",{
    method:"POST",headers:{authorization:"Bearer "+token,
      "content-type":"application/json"},
    body:JSON.stringify({
      credential_id:credentialId,
      disclosed_permissions:[challenge.required_permission],
      audience:challenge.audience,challenge:challenge.challenge
    })
  });
  assert.equal(response.status,200,"Native Adapter must sign exact permission");
  const signed_vp=(await response.json()).signed_vp;
  assert.ok(typeof signed_vp==="string"&&signed_vp.length>100);
  return signed_vp;
}
async function freePort(){
  const listener=createServer();
  await new Promise((resolve,reject)=>{
    listener.once("error",reject);listener.listen(0,"127.0.0.1",resolve);
  });
  const number=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return number;
}
export async function runNativePositiveApprovedDag({
  coordinator,reviewGate,approvedPlans,sessionId,planDigest,baseSha,
  operationalRootId,branch,files,createdTestFile,repo,giteaBase,
  readerToken,writerToken,opaUrl,engineerDid,orchestratorToken,agentTokens
}){
  assert.match(giteaBase,/^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.match(baseSha,SHA);
  for(const token of [readerToken,writerToken,orchestratorToken,
    ...ROLES.map(role=>agentTokens[role])])
    assert.ok(typeof token==="string"&&token.length>10);
  assert.equal(coordinator.phase,"execution");
  assert.deepEqual(Object.keys(files).sort(),[...EDIT_ROLES].sort());
  const expectedExisting=[...files.backend,...files.frontend];
  assert.equal(expectedExisting.length,10);
  assert.deepEqual([...expectedExisting,createdTestFile].sort(),
    Object.keys(ACCOUNT_SUSPENSION_REFERENCE_FILES).sort());
  const reader=new GiteaClient({
    baseUrl:giteaBase,token:readerToken,owner:repo.owner,
    repository:repo.repository,timeoutMs:20000
  });
  const writer=new GiteaClient({
    baseUrl:giteaBase,token:writerToken,owner:repo.owner,
    repository:repo.repository,timeoutMs:20000
  });
  const originals={};
  for(const path of expectedExisting){
    const result=await reader.readTextFile("main",path,baseSha);
    assert.equal(result.revision,baseSha);
    originals[path]=result.content;
    assert.notEqual(result.content,ACCOUNT_SUSPENSION_REFERENCE_FILES[path],
      "Native reference fixture must actually change the approved baseline");
  }
  await assert.rejects(()=>reader.getBranchMetadata(branch));
  const repositoryUri="gitea://"+repo.authority+"/"+repo.owner+"/"+repo.repository;
  const runnerToken=randomBytes(32).toString("hex");
  const runLogs=await mkdtemp(join(tmpdir(),"native-approved-dag-runner-"));
  const executor=new IsolatedDockerRunnerExecutor({
    gitea_base_url:giteaBase,gitea_owner:repo.owner,
    gitea_repository:repo.repository,gitea_token:readerToken,
    docker_image:process.env.TEST_RUNNER_DOCKER_IMAGE??"node:22.15.0-bookworm",
    phase_timeout_ms:300000,total_timeout_ms:840000,
    log_dir:runLogs,acceptance_enabled:true,
    acceptance_dir:fileURLToPath(new URL("../../../runner/acceptance/",import.meta.url))
  });
  const runnerServer=createRunnerHttpServer({
    bind_host:"127.0.0.1",bind_port:0,gateway_token:runnerToken,
    contract:{repository:repositoryUri,branch}
  },executor);
  await new Promise((resolve,reject)=>{
    runnerServer.once("error",reject);
    runnerServer.listen(0,"127.0.0.1",resolve);
  });
  const runnerClient=new RunnerClient({
    baseUrl:"http://127.0.0.1:"+runnerServer.address().port,
    gatewayToken:runnerToken,timeoutMs:845000
  });
  const gateway=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",
      request_ttl_ms:120000,repository:repo},
    opa_url:opaUrl,opa_timeout_ms:15000,
    provider_mode:"mock",gitea_timeout_ms:15000
  },{
    approvedPlans,verifier:loadDirectCoreRustVerifier(),
    policy:new OpaPolicyClient({baseUrl:opaUrl,timeoutMs:15000}),
    executor:new GiteaExecutor(writer,runnerClient,repositoryUri)
  });
  const counts={backend:0,frontend:0},reads={backend:0,frontend:0},
    writes={backend:0,frontend:0};
  let testCalls=0,testCreates=0,runnerRuns=0,runnerOutcome=null,latestSha=baseSha;
  const childIds={},servers=[],urls={},models={};
  // Explicit opt-in makes the SAME real-provider test exercise the
  // production shared MCP and private A2A worker rather than FunctionTool
  // transport. Agent model instructions and signed plan are unchanged.
  const sharedMcpEnabled=process.env.APPROVED_RUNNER_NATIVE_MCP==="1";
  let normalMcpCalls=0,privateCryptoMcpCalls=0;
  const mcpServers=[];
  const roleMcpKeys={},rolePorts={};
  let mcpSharedUrl,mcpCryptoUrl;
  const readPaths={backend:new Set(),frontend:new Set()};
  const writePaths={backend:new Set(),frontend:new Set()};
  const adkGatewayBase="http://approved-native-gateway.invalid";
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json"}
  });
  // ADK makes real controlled FunctionTool calls; this small in-process
  // transport only avoids opening an unauthenticated public Gateway port.
  // The Gateway itself still validates signed plans, live Rust VPs, OPA
  // and Gitea/Docker provider effects for EVERY operation.
  const adkFetchFor=role=>async(url,options)=>{
    const target=String(url);
    if(target.startsWith(adapterUrl+"/"))
      return fetch(url,options);
    if(!target.startsWith(adkGatewayBase+"/v1/authorization/"))
      throw Error("ADK attempted unknown transport");
    let operation="unknown",pathIndex=-1,stage="decode";
    try{
      const request=JSON.parse(String(options?.body));
      operation=request?.tool??"execute";
      if(request?.arguments?.path){
        pathIndex=files[role]?.indexOf(request.arguments.path)??-1;
      }
      if(target===adkGatewayBase+"/v1/authorization/prepare"){
        stage="prepare-assertions";
        assert.equal(request.agent_role,role);
        assert.match(request.task_id,/^dispatch_[A-Za-z0-9_-]{22}$/u);
        if(role==="test"){
          assert.ok(["create_file","run_tests"].includes(request.tool));
          if(request.tool==="create_file"){
            assert.equal(request.arguments.path,createdTestFile);
            assert.equal(request.arguments.branch,branch);
          }else{
            assert.equal(request.arguments.branch,branch);
            assert.equal(request.arguments.profile,"poc-default");
            assert.equal(testCreates,1);
          }
        }else{
          assert.ok(["read_file","update_file"].includes(request.tool));
          assert.ok(files[role].includes(request.arguments.path));
          assert.equal(request.arguments.branch,branch);
          if(request.tool==="update_file"){
            assert.ok(readPaths[role].has(request.arguments.path));
            assert.equal(request.arguments.content,
              ACCOUNT_SUSPENSION_REFERENCE_FILES[request.arguments.path]);
          }
        }
        return reply(gateway.prepare(request),201);
      }
      if(target===adkGatewayBase+"/v1/authorization/execute"){
        stage="gateway-execute";
        const executed=await gateway.execute(request);
        stage="execute-assertions";
        const executedPath=executed.execution?.path;
        if(typeof executedPath==="string")
          pathIndex=files[role]?.indexOf(executedPath)??-1;
        operation=executed.execution?.tool??"execute";
        assert.equal(executed.policy.allow,true);
        assert.equal(executed.policy.policy_version,"phase6-approved-branch-v2");
        assert.equal(executed.verified_delegation.presenter_id,
          process.env["ADAPTER_ID_"+role.toUpperCase()]);
        assert.equal(executed.verified_delegation.credential_id,
          childIds[role]);
        const effect=executed.execution;
        if(role!=="test"){
          assert.equal(effect.provider,"gitea");
          assert.ok(files[role].includes(effect.path));
          if(effect.tool==="read_file"){
            assert.equal(effect.content,originals[effect.path]);
            assert.ok(!readPaths[role].has(effect.path));
            readPaths[role].add(effect.path);
            reads[role]++;
          }else if(effect.tool==="update_file"){
            assert.ok(readPaths[role].has(effect.path));
            assert.ok(!writePaths[role].has(effect.path));
            assert.match(effect.commit_sha,SHA);
            writePaths[role].add(effect.path);
            writes[role]++;
            latestSha=effect.commit_sha;
            if(writePaths[role].size===files[role].length)counts[role]++;
          }else throw Error("ADK attempted unexpected approved provider operation");
        }else if(effect.tool==="create_file"){
          assert.equal(testCreates,0);
          assert.equal(effect.provider,"gitea");
          assert.equal(effect.path,createdTestFile);
          assert.match(effect.commit_sha,SHA);
          assert.deepEqual(counts,{backend:1,frontend:1});
          const head=await reader.getBranchMetadata(branch);
          assert.equal(head.commit_sha,effect.commit_sha);
          testCalls++;testCreates++;
        }else if(effect.tool==="run_tests"){
          assert.equal(testCreates,1);
          const pinned=await reader.getBranchMetadata(branch);
          assert.equal(effect.provider,"runner");
          assert.equal(effect.tested_commit_sha,pinned.commit_sha);
          process.stderr.write("[native-dag-adk] docker_phase_status "+
            JSON.stringify({
              status:effect.status,
              phases:effect.phases?.map(x=>({phase:x.phase,status:x.status})),
              project_tests:effect.project_tests?.status,
              researcher_acceptance:effect.researcher_acceptance?.status
            })+"\n");
          assert.equal(effect.status,"pass");
          assert.equal(effect.project_tests?.status,"pass");
          assert.equal(effect.researcher_acceptance?.status,"pass");
          assert.deepEqual(effect.phases.map(x=>x.phase),[
            "dependency_install","typecheck","backend_tests","frontend_tests",
            "build","playwright_e2e","researcher_acceptance"
          ]);
          assert.ok(effect.phases.every(x=>x.status==="pass"));
          runnerRuns++;runnerOutcome=effect;
        }else throw Error("ADK Test Agent attempted unexpected operation");
        return reply(executed);
      }
      throw Error("Unsupported trusted Gateway route");
    }catch(error){
      // The model sees a generic denied result, never raw provider exceptions,
      // confidential request arguments, VP, source data or service tokens.
      // Test-only SAFE diagnostics: stage, operation, file index and
      // the failing assertion's source line (never its raw values/message).
      const site=String(error?.stack??"").match(
        /native-approved-planner-dag-positive\.mjs:(\d+):(\d+)/u
      );
      process.stderr.write("[native-dag-adk] controlled_denial "+
        JSON.stringify({role,stage,operation,pathIndex,
          assertion_line:site?Number(site[1]):null,
          kind:error?.constructor?.name??"Error",
          code:error?.code??"unknown"})+"\n");
      return reply({error:"trusted_operation_denied"},403);
    }
  };
  try{
    if(sharedMcpEnabled){
      // All ports and public keys are created by the trusted offline host.
      // No MCP server receives an Adapter caller token or credential bytes.
      for(const role of ROLES){
        const keys=generateKeyPairSync("ed25519");
        roleMcpKeys[role]={
          signingPrivateKeyPem:keys.privateKey.export({
            type:"pkcs8",format:"pem"
          }).toString(),
          signingPublicKeyPem:keys.publicKey.export({
            type:"spki",format:"pem"
          }).toString()
        };
        rolePorts[role]=await freePort();
      }
      const verificationKeys=Object.fromEntries(
        ROLES.map(role=>[role,roleMcpKeys[role].signingPublicKeyPem])
      );
      const router=new TaskRouter(Object.fromEntries(
        ROLES.map(role=>[role,{
          baseUrl:"http://127.0.0.1:"+rolePorts[role]
        }])
      ));
      for(const profile of ["legacy","crypto"]){
        const server=createSharedMcpHttpServer({
          verificationKeys,router,
          ...(profile==="crypto"?{profile:"crypto"}:{})
        });
        server.on("request",req=>{
          if(req.method==="POST"&&req.url==="/mcp"){
            if(profile==="crypto")privateCryptoMcpCalls++;
            else normalMcpCalls++;
          }
        });
        await new Promise((resolve,reject)=>{
          server.once("error",reject);
          server.listen(0,"127.0.0.1",resolve);
        });
        mcpServers.push(server);
        const endpoint="http://127.0.0.1:"+server.address().port+"/mcp";
        if(profile==="crypto")mcpCryptoUrl=endpoint;
        else mcpSharedUrl=endpoint;
      }
      assert.ok(mcpSharedUrl&&mcpCryptoUrl);
    }
    for(const role of EDIT_ROLES){
      const targets=files[role];
      const scripted=targets.flatMap(path=>[
        {name:"read_file",args:{branch,path}},
        {name:"update_file",args:{
          branch,path,content:ACCOUNT_SUSPENSION_REFERENCE_FILES[path]
        }}
      ]);
      const model=new OfflineApprovedAdkModel(role,scripted);
      models[role]=model;
      const server=await startSpecializedAgentServer({
        role,host:"127.0.0.1",
        port:sharedMcpEnabled?rolePorts[role]:await freePort(),
        delegatedAuthorization:true,capabilityProfile:"approved-plan",
        ...(sharedMcpEnabled?{mcpTaskSigning:roleMcpKeys[role]}:{}),
        adk:{
          model,gatewayBaseUrl:adkGatewayBase,adapterBaseUrl:adapterUrl,
          adapterToken:agentTokens[role],fetchFn:adkFetchFor(role),
          ...(sharedMcpEnabled?{
            mcpSharedUrl,mcpCryptoUrl,mcpUpdateFile:true
          }:{}),
          maxModelTurns:scripted.length+2,maxModelCallMs:30000,
          gatewayTimeoutMs:30000
        }
      });
      servers.push(server);urls[role]=server.baseUrl;
    }
    const testScript=[
      {name:"create_file",args:{
        branch,path:createdTestFile,
        content:ACCOUNT_SUSPENSION_REFERENCE_FILES[createdTestFile]
      }},
      {name:"run_tests",args:{branch,profile:"poc-default"}}
    ];
    const testModel=new OfflineApprovedAdkModel("test",testScript);
    models.test=testModel;
    const testAgent=await startSpecializedAgentServer({
      role:"test",host:"127.0.0.1",
      port:sharedMcpEnabled?rolePorts.test:await freePort(),
      delegatedAuthorization:true,capabilityProfile:"approved-plan",
      ...(sharedMcpEnabled?{mcpTaskSigning:roleMcpKeys.test}:{}),
      adk:{
        model:testModel,gatewayBaseUrl:adkGatewayBase,adapterBaseUrl:adapterUrl,
        adapterToken:agentTokens.test,fetchFn:adkFetchFor("test"),
        ...(sharedMcpEnabled?{
          mcpSharedUrl,mcpCryptoUrl,mcpCreateFile:true,mcpRunTests:true
        }:{}),
        maxModelTurns:4,maxModelCallMs:30000,
        gatewayTimeoutMs:30000
      }
    });
    servers.push(testAgent);urls.test=testAgent.baseUrl;
    const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
      approvals:reviewGate,coordinator,sessionId,
      expectedPlanDigest:planDigest,baseRevision:baseSha,
      expectedEngineerDid:engineerDid,agentBaseUrls:urls,
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:500000,initialIntervalMs:50,maxIntervalMs:250
      }),
      adapter:{adapterBaseUrl:adapterUrl,
        bearerToken:orchestratorToken,timeoutMs:30000},
      async authorityForTask(taskId,role){
        assert.equal(taskId,role);
        assert.ok(ROLES.includes(role));
        assert.equal(childIds[role],undefined);
        childIds[role]="urn:native:approved-dag-"+role+"-"+
          randomBytes(8).toString("hex");
        return {
          parent_credential_id:operationalRootId,
          credential_id:childIds[role],
          valid_from:new Date(Date.now()-1000).toISOString(),
          validity_seconds:300,
          credential_status:{type:"BitstringStatusListEntry",
            statusPurpose:"revocation",
            statusListIndex:String(randomInt(66001,69000)),
            statusListCredential:"https://status.example/lists/approved-dag"}
        };
      }
    });
    for(const role of ROLES)await assert.rejects(
      dispatcher.dispatch(role),/dependencies/);
    assert.deepEqual(counts,{backend:0,frontend:0});
    const result=await dispatcher.executeApprovedDag({
      async invokeOrchestratorTask(planId,runtimeTaskId){
        assert.equal(planId,"branch");
        assert.throws(()=>gateway.prepare({
          task_id:runtimeTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{
            base_branch:"main",branch:"feature/not-approved"}
        }),/approved plan/i);
        const prep=gateway.prepare({
          task_id:runtimeTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{base_branch:"main",branch}
        });
        const jwt=await signedVp(
          operationalRootId,prep,orchestratorToken);
        const created=await gateway.execute({
          request_id:prep.request_id,signed_vp:jwt
        });
        assert.equal(created.execution.tool,"create_branch");
        assert.equal(created.execution.commit_sha,baseSha);
        assert.equal((await reader.getBranchMetadata(branch)).commit_sha,baseSha);
      }
    });
    assert.equal(coordinator.phase,"closed");
    assert.equal(result.plan_digest,planDigest);
    assert.deepEqual(result.completed_task_ids,["branch",...ROLES]);
    assert.deepEqual(result.specialized_results.map(x=>x.role),ROLES);
    assert.deepEqual(counts,{backend:1,frontend:1});
    assert.deepEqual(reads,{backend:6,frontend:4});
    assert.deepEqual(writes,{backend:6,frontend:4});
    assert.equal(testCalls,1);
    assert.equal(testCreates,1);
    assert.equal(runnerRuns,1);
    assert.equal(models.backend.calls,13);
    assert.equal(models.frontend.calls,9);
    assert.equal(models.test.calls,3);
    // This is the proof that the same signed DAG actually used both the
    // normal shared MCP and separate private cryptographic MCP. A green
    // FunctionTool fallback alone cannot satisfy this gate.
    if(sharedMcpEnabled){
      assert.ok(normalMcpCalls>=21,
        "Approved ADK tools must traverse real shared MCP HTTP");
      assert.ok(privateCryptoMcpCalls>=21,
        "Adapter VP generation must traverse the crypto MCP boundary");
    }
    assert.ok(result.specialized_results.every(x=>
      x.artifact.model_id?.startsWith("offline-signed-approved-plan-")));
    assert.ok(new Set(Object.values(childIds)).size===3);
    assert.equal(result.specialized_results[2].artifact.test_outcome,"pass");
    assert.equal(result.specialized_results[2].artifact.tested_commit_sha,
      runnerOutcome.tested_commit_sha);
    for(const path of expectedExisting){
      const updated=await reader.readTextFile(branch,path);
      assert.equal(updated.content,ACCOUNT_SUSPENSION_REFERENCE_FILES[path]);
      const unchanged=await reader.readTextFile("main",path,baseSha);
      assert.equal(unchanged.content,originals[path]);
    }
    const savedTest=await reader.readTextFile(branch,createdTestFile);
    assert.equal(savedTest.content,
      ACCOUNT_SUSPENSION_REFERENCE_FILES[createdTestFile]);
    const head=await reader.getBranchMetadata(branch);
    assert.equal(head.commit_sha,runnerOutcome.tested_commit_sha);
    assert.equal((await reader.getBranchMetadata("main")).commit_sha,baseSha);
    assert.throws(()=>gateway.prepare({
      task_id:"after_closed",agent_role:"backend",
      tool:"update_file",arguments:{
        branch,path:files.backend[0],content:"unapproved"
      }
    }),e=>e?.code==="approved_plan_denied");
    return {
      status:"pass",signed_dag_completed:true,
      completed_task_ids:result.completed_task_ids,
      real_a2a_sdk:true,native_rust_child_credentials:3,
      native_verifier:true,live_opa:true,real_gitea:true,
      source_reads:10,source_writes:10,created_test_files:1,
      test_runner_runs:runnerRuns,
      test_runner_phases:runnerOutcome.phases.map(x=>x.phase),
      project_tests:runnerOutcome.project_tests.status,
      researcher_acceptance:runnerOutcome.researcher_acceptance.status,
      tested_commit_sha:runnerOutcome.tested_commit_sha,
      main_unchanged:true,operational_root_revoked:true,
      approved_branch_sha:head.commit_sha,
      adk_agents_executed:3,scripted_adk_no_paid_model:true,
      approved_shared_mcp_enabled:sharedMcpEnabled,
      shared_mcp_http_requests:normalMcpCalls,
      private_crypto_mcp_http_requests:privateCryptoMcpCalls,
      adk_model_turns:{
        backend:models.backend.calls,
        frontend:models.frontend.calls,
        test:models.test.calls
      }
    };
  }finally{
    try{
      for(const server of servers.reverse())await server.close();
    }finally{
      for(const server of mcpServers.reverse()){
        await new Promise((resolve,reject)=>
          server.close(error=>error?reject(error):resolve())
        );
      }
      await new Promise(resolve=>runnerServer.close(resolve));
      await rm(runLogs,{recursive:true,force:true});
    }
  }
}
