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

import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {startSpecializedAgentServer} from
  "../../../packages/agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator} from
  "../../../packages/agent-runtime/src/orchestrator.ts";
import {OfflineApprovedAdkModel} from "./offline-approved-adk-model.mjs";
import {buildOfflineAdkScriptsFromApprovedPlan}
  from "./approved-plan-offline-adk-call-scripts.mjs";
import {bindModelsToApprovedRoleTasks}
  from "./approved-plan-agent-model-binding.mjs";
import {assertApprovedPlanScope,planDigest as hashApprovedPlan} from
  "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {canonicalRepositoryUri,canonicalBranchUri,canonicalFileUri}
  from "../src/canonical.ts";
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
  operationalRootId,branch,
  referenceFiles,scenarioId,repo,giteaBase,
  readerToken,writerToken,opaUrl,engineerDid,orchestratorToken,agentTokens,
  /** Trusted owner-only factory for non-fixture ADK models; never CLI/env. */
  approvedAgentModelFactory
}){
  if(approvedAgentModelFactory!==undefined&&
     typeof approvedAgentModelFactory!=="function")
    throw Error("Approved model factory must be host-owned");
  assert.match(giteaBase,/^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.match(baseSha,SHA);
  for(const token of [readerToken,writerToken,orchestratorToken,
    ...ROLES.map(role=>agentTokens[role])])
    assert.ok(typeof token==="string"&&token.length>10);
  assert.equal(coordinator.phase,"execution");
  assert.match(scenarioId,/^[a-z][a-z0-9-]{0,63}$/u);
  if(!approvedAgentModelFactory&&
     (!["account-suspension","department-directory"].includes(scenarioId)||
     !referenceFiles||typeof referenceFiles!=="object"||
     Array.isArray(referenceFiles)))
    throw Error("Invalid offline implementation fixture");
  // The signed, authenticated Engineer receipt determines every file/operation.
  // Reference payloads remain scripted test inputs, NEVER a grant of authority.
  const signed=await reviewGate.loadAuthenticatedApproval(sessionId);
  assert.equal(hashApprovedPlan(signed.plan),planDigest);
  const grants=assertApprovedPlanScope(signed.plan,signed.approval,{
    allowedOperations:new Set(RUST_OPERATIONS),
    expectedEngineerDid:engineerDid
  });
  // A single generic compiler selects tool calls from the AUTHENTICATED
  // Engineer-signed plan. Only the resulting code bytes remain test fixtures.
  // No reference fixture chooses the resources, roles or permissions.
  const hostModels=approvedAgentModelFactory
    ? bindModelsToApprovedRoleTasks({
        plan:signed.plan,approvedRows:grants,
        modelFactory:approvedAgentModelFactory
      })
    : null;
  // In the zero-billing CI, script contents are supplied by independent
  // offline acceptance fixtures. With host-selected ADK models, NO fixture
  // payload is supplied to the model factory or the ADK worker.
  const offlineScripts=hostModels?null:buildOfflineAdkScriptsFromApprovedPlan({
    plan:signed.plan,approvedRows:grants,repo,branch,
    implementationContents:referenceFiles
  });
  if(hostModels)
    assert.deepEqual(hostModels.selected_roles,[...ROLES],
      "This existing three-role native acceptance harness requires all roles");
  const root=canonicalRepositoryUri(repo);
  const scopedBranch=canonicalBranchUri(repo,branch);
  const filePrefix=scopedBranch+"/files/";
  const approvedFiles=(role,operation)=>grants.filter(g=>
    g.agent_id===role&&g.operation===operation).map(g=>{
    assert.ok(g.resource.startsWith(filePrefix),"Wrong approved file branch");
    const encoded=g.resource.slice(filePrefix.length);
    const parts=encoded.split("/");
    assert.ok(parts.length>0&&parts.every(x=>x.length>0));
    const decoded=parts.map(decodeURIComponent);
    assert.ok(decoded.every(x=>x&&x!=="."&&x!==".."&&
      !x.includes("/")&&!x.includes("\\")&&!/[\x00-\x1f\x7f]/u.test(x)),
      "Invalid approved file path");
    const path=decoded.join("/");
    assert.equal(canonicalFileUri(repo,branch,path),g.resource);
    return path;
  });
  const files={};
  for(const role of EDIT_ROLES){
    files[role]=approvedFiles(role,"update_file");
    const read=approvedFiles(role,"read_file");
    assert.ok(files[role].length>0,"Signed role has no approved edits");
    assert.deepEqual([...read].sort(),[...files[role]].sort());
    assert.equal(new Set(files[role]).size,files[role].length);
  }
  const approvedTestCreates=approvedFiles("test","create_file");
  assert.equal(approvedTestCreates.length,1,"Only one exact approved Test creation");
  const createdTestFile=approvedTestCreates[0];
  const allowedNonFile=[
    ["orchestrator","create_branch",root],
    ["orchestrator","create_pull_request",root],
    ["test","run_tests",scopedBranch]
  ];
  for(const [role,operation,resource] of allowedNonFile){
    assert.equal(grants.filter(g=>g.agent_id===role&&
      g.operation===operation&&g.resource===resource).length,1);
  }
  const approvedCount=files.backend.length*2+files.frontend.length*2+
    approvedTestCreates.length+allowedNonFile.length;
  assert.equal(grants.length,approvedCount,
    "Signed plan contains unexpected extra tool grants");
  const expectedExisting=[...files.backend,...files.frontend];
  assert.equal(new Set([...expectedExisting,createdTestFile]).size,
    expectedExisting.length+1);
  if(!hostModels)assert.deepEqual([...expectedExisting,createdTestFile].sort(),
    Object.keys(referenceFiles).sort());
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
    if(!hostModels)assert.notEqual(result.content,referenceFiles[path],
      "Native offline fixture must actually change approved baseline");
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
  let createdPr=null;
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
    try{
      const request=JSON.parse(String(options?.body));
      if(target===adkGatewayBase+"/v1/authorization/prepare"){
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
            if(hostModels){
              assert.equal(typeof request.arguments.content,"string");
              assert.ok(request.arguments.content.length>0&&
                request.arguments.content.length<=250000,
                "Host-selected model must supply bounded complete file text");
            }else{
              assert.equal(request.arguments.content,
                referenceFiles[request.arguments.path]);
            }
          }
        }
        return reply(gateway.prepare(request),201);
      }
      if(target===adkGatewayBase+"/v1/authorization/execute"){
        const executed=await gateway.execute(request);
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
      process.stderr.write("[native-dag-adk] controlled_denial "+
        JSON.stringify({role,kind:error?.constructor?.name??"Error",
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
      const scripted=offlineScripts?.[role];
      if(scripted)assert.deepEqual(scripted.flatMap(c=>
        c.name==="update_file"?[c.args.path]:[]).sort(),[...targets].sort(),
        "Signed plan must determine all scripted ADK writes");
      const model=hostModels?.models[role]??new OfflineApprovedAdkModel(role,scripted);
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
          maxModelTurns:scripted?scripted.length+2:24,
          maxModelCallMs:hostModels?90000:30000,
          gatewayTimeoutMs:30000
        }
      });
      servers.push(server);urls[role]=server.baseUrl;
    }
    const testScript=offlineScripts?.test;
    if(testScript){
      assert.deepEqual(testScript.map(c=>c.name),
        ["create_file","run_tests"],
        "Signed test permissions must determine ADK test sequence");
      assert.equal(testScript[0].args.path,createdTestFile);
    }
    const testModel=hostModels?.models.test??
      new OfflineApprovedAdkModel("test",testScript);
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
        maxModelTurns:hostModels?24:4,
        maxModelCallMs:hostModels?90000:30000,
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
        if(planId==="pr"){
          // Approval of the repository operation is a separate signed Task.
          // It may run only after the Test Agent's provider-corroborated
          // exact-SHA Docker and independent researcher acceptance.
          assert.equal(runnerRuns,1);
          assert.equal(runnerOutcome?.status,"pass");
          assert.equal(runnerOutcome?.project_tests?.status,"pass");
          assert.equal(runnerOutcome?.researcher_acceptance?.status,"pass");
          assert.equal((await reader.getBranchMetadata(branch)).commit_sha,
            runnerOutcome.tested_commit_sha);
          assert.throws(()=>gateway.prepare({
            task_id:runtimeTaskId,agent_role:"orchestrator",
            tool:"create_pull_request",arguments:{
              head_branch:"main",base_branch:"main",title:"Unapproved main PR"
            }
          }),e=>e?.code==="approved_plan_denied");
          const prepared=gateway.prepare({
            task_id:runtimeTaskId,agent_role:"orchestrator",
            tool:"create_pull_request",arguments:{
              head_branch:branch,base_branch:"main",
              title:"Reviewed "+scenarioId+" changes",
              body:"Engineer-signed plan digest: "+planDigest+
                "\nExact tested feature SHA: "+runnerOutcome.tested_commit_sha+
                "\nHuman approval and merge are NOT performed by this run."
            }
          });
          const vp=await signedVp(
            operationalRootId,prepared,orchestratorToken);
          const executed=await gateway.execute({
            request_id:prepared.request_id,signed_vp:vp
          });
          assert.equal(executed.execution.provider,"gitea");
          assert.equal(executed.execution.tool,"create_pull_request");
          assert.equal(executed.execution.head_branch,branch);
          assert.equal(executed.execution.base_branch,"main");
          assert.equal(executed.execution.revision,
            runnerOutcome.tested_commit_sha);
          assert.ok(Number.isSafeInteger(
            executed.execution.pull_request_number));
          createdPr=executed.execution;
          return;
        }
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
    assert.deepEqual(result.completed_task_ids,["branch",...ROLES,"pr"]);
    assert.ok(createdPr,"A signed, provider-confirmed PR must be opened");
    assert.deepEqual(result.specialized_results.map(x=>x.role),ROLES);
    assert.deepEqual(counts,{backend:1,frontend:1});
    assert.deepEqual(reads,{
      backend:files.backend.length,frontend:files.frontend.length
    });
    assert.deepEqual(writes,{
      backend:files.backend.length,frontend:files.frontend.length
    });
    assert.equal(testCalls,1);
    assert.equal(testCreates,1);
    assert.equal(runnerRuns,1);
    if(!hostModels){
      assert.equal(models.backend.calls,2*files.backend.length+1);
      assert.equal(models.frontend.calls,2*files.frontend.length+1);
      assert.equal(models.test.calls,3);
    }
    // This is the proof that the same signed DAG actually used both the
    // normal shared MCP and separate private cryptographic MCP. A green
    // FunctionTool fallback alone cannot satisfy this gate.
    if(sharedMcpEnabled){
      assert.ok(normalMcpCalls>=2*expectedExisting.length+2,
        "Approved ADK tools must traverse real shared MCP HTTP");
      assert.ok(privateCryptoMcpCalls>=2*expectedExisting.length+2,
        "Adapter VP generation must traverse the crypto MCP boundary");
    }
    if(!hostModels)assert.ok(result.specialized_results.every(x=>
      x.artifact.model_id?.startsWith("offline-signed-approved-plan-")));
    assert.ok(new Set(Object.values(childIds)).size===3);
    assert.equal(result.specialized_results[2].artifact.test_outcome,"pass");
    assert.equal(result.specialized_results[2].artifact.tested_commit_sha,
      runnerOutcome.tested_commit_sha);
    for(const path of expectedExisting){
      const updated=await reader.readTextFile(branch,path);
      if(!hostModels){
        assert.equal(updated.content,referenceFiles[path]);
      }else{
        assert.notEqual(updated.content,originals[path],
          "Agent must change the signed approved resource");
        assert.ok(updated.content.length>0);
      }
      const unchanged=await reader.readTextFile("main",path,baseSha);
      assert.equal(unchanged.content,originals[path]);
    }
    const savedTest=await reader.readTextFile(branch,createdTestFile);
    if(!hostModels)
      assert.equal(savedTest.content,referenceFiles[createdTestFile]);
    else assert.ok(savedTest.content.length>0);
    const head=await reader.getBranchMetadata(branch);
    assert.equal(head.commit_sha,runnerOutcome.tested_commit_sha);
    assert.equal(createdPr.revision,head.commit_sha);
    assert.equal((await reader.getBranchMetadata("main")).commit_sha,baseSha);
    assert.throws(()=>gateway.prepare({
      task_id:"after_closed",agent_role:"backend",
      tool:"update_file",arguments:{
        branch,path:files.backend[0],content:"unapproved"
      }
    }),e=>e?.code==="approved_plan_denied");
    return {
      status:"pass",signed_dag_completed:true,
      scenario_id:scenarioId,approved_work_branch:branch,
      completed_task_ids:result.completed_task_ids,
      real_a2a_sdk:true,native_rust_child_credentials:3,
      native_verifier:true,live_opa:true,real_gitea:true,
      source_reads:expectedExisting.length,
      source_writes:expectedExisting.length,created_test_files:1,
      manifest_source:"engineer_signed_approved_plan",
      test_runner_runs:runnerRuns,
      test_runner_phases:runnerOutcome.phases.map(x=>x.phase),
      project_tests:runnerOutcome.project_tests.status,
      researcher_acceptance:runnerOutcome.researcher_acceptance.status,
      tested_commit_sha:runnerOutcome.tested_commit_sha,
      main_unchanged:true,operational_root_revoked:true,
      approved_branch_sha:head.commit_sha,
      pr_created:true,pull_request_number:createdPr.pull_request_number,
      pull_request_url:createdPr.url??null,merge_calls:0,
      adk_agents_executed:3,
      // Model injection alone does not establish independent code generation.
      // Scripted ADK instances carry source bytes in their tool-call payloads,
      // even when the native runner did not receive a referenceFiles argument.
      scripted_adk_no_paid_model:Object.values(models).every(
        model=>model instanceof OfflineApprovedAdkModel),
      model_source:hostModels
        ? (Object.values(models).every(model=>
            model instanceof OfflineApprovedAdkModel)
            ? "host_supplied_scripted_tool_calls"
            : "host_supplied_unclassified_adk_models")
        : "inline_scripted_tool_calls",
      fixture_scripted_payloads_reach_adk_runner:Object.values(models).some(
        model=>model instanceof OfflineApprovedAdkModel),
      independent_model_software_output_verified:false,
      approved_shared_mcp_enabled:sharedMcpEnabled,
      shared_mcp_http_requests:normalMcpCalls,
      private_crypto_mcp_http_requests:privateCryptoMcpCalls,
      adk_model_turns:{
        backend:models.backend instanceof OfflineApprovedAdkModel
          ?models.backend.calls:null,
        frontend:models.frontend instanceof OfflineApprovedAdkModel
          ?models.frontend.calls:null,
        test:models.test instanceof OfflineApprovedAdkModel
          ?models.test.calls:null
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
