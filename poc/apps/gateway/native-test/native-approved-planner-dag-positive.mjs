/**
 * One native, signed four-task DAG over the disposable Gitea repository:
 *   branch -> Backend -> Frontend -> Test
 * Real Rust/EVM task-scoped children, native VP, OPA, Gateway provider effects,
 * HTTP A2A SDK, and exact-SHA Docker Runner with independent acceptance.
 * All 11 reference changes are named in the signed plan, not applied by an
 * out-of-band bootstrap. This is deterministic test code, NOT Gemini output.
 */
import assert from "node:assert/strict";
import {randomBytes,randomInt} from "node:crypto";
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
  const childIds={},servers=[],urls={};
  try{
    for(const role of EDIT_ROLES){
      const targets=files[role],token=agentTokens[role];
      const server=await startSpecializedAgentServer({
        role,host:"127.0.0.1",port:await freePort(),
        delegatedAuthorization:true,capabilityProfile:"approved-plan",
        taskHandler:async context=>{
          counts[role]++;
          assert.equal(context.role,role);
          assert.equal(context.subtask.subtask_id,role);
          assert.equal(context.subtask.branch,branch);
          assert.deepEqual(context.subtask.relevant_paths,targets);
          assert.deepEqual(context.subtask.approved_file_permissions,
            targets.flatMap(path=>[
              {path,operation:"read_file"},
              {path,operation:"update_file"}
            ]));
          assert.equal(context.delegation_evidence.presenter_id,
            process.env["ADAPTER_ID_"+role.toUpperCase()]);
          assert.equal(context.delegation_evidence.credential_id,childIds[role]);
          const taskId=context.trusted_gateway_task_id;
          assert.match(taskId,/^dispatch_[A-Za-z0-9_-]{22}$/u);
          let finalSha=null;
          for(const path of targets){
            const read=gateway.prepare({task_id:taskId,agent_role:role,
              tool:"read_file",arguments:{branch,path}});
            const readJwt=await signedVp(childIds[role],read,token);
            const source=await gateway.execute({
              request_id:read.request_id,signed_vp:readJwt
            });
            assert.equal(source.execution.tool,"read_file");
            assert.equal(source.execution.content,originals[path]);
            reads[role]++;
            const replace=gateway.prepare({task_id:taskId,agent_role:role,
              tool:"update_file",arguments:{branch,path,
                content:ACCOUNT_SUSPENSION_REFERENCE_FILES[path]}});
            const updateJwt=await signedVp(childIds[role],replace,token);
            const effect=await gateway.execute({
              request_id:replace.request_id,signed_vp:updateJwt
            });
            assert.equal(effect.policy.allow,true);
            assert.equal(effect.policy.policy_version,"phase6-approved-branch-v2");
            assert.equal(effect.execution.provider,"gitea");
            assert.equal(effect.execution.tool,"update_file");
            assert.equal(effect.execution.path,path);
            finalSha=effect.execution.commit_sha;
            writes[role]++;
          }
          assert.match(finalSha,SHA);
          assert.notEqual(finalSha,baseSha);
          latestSha=finalSha;
          return {
            role,summary:"Exact signed reference updates from "+role,
            files_modified:[...targets],files_created:[],branch,
            revision:finalSha,commit_sha:finalSha,
            test_outcome:"not_run",errors:[]
          };
        }
      });
      servers.push(server);urls[role]=server.baseUrl;
    }
    const testAgent=await startSpecializedAgentServer({
      role:"test",host:"127.0.0.1",port:await freePort(),
      delegatedAuthorization:true,capabilityProfile:"approved-plan",
      taskHandler:async context=>{
        testCalls++;
        try{
          assert.equal(context.role,"test");
          assert.equal(context.subtask.subtask_id,"test");
          assert.equal(context.subtask.branch,branch);
          assert.deepEqual(context.subtask.relevant_paths,[createdTestFile]);
          assert.deepEqual(context.subtask.approved_file_permissions,[
            {path:createdTestFile,operation:"create_file"}
          ]);
          assert.equal(context.delegation_evidence.presenter_id,
            process.env.ADAPTER_ID_TEST);
          assert.equal(context.delegation_evidence.credential_id,childIds.test);
          assert.deepEqual(counts,{backend:1,frontend:1});
          const taskId=context.trusted_gateway_task_id;
          const before=await reader.getBranchMetadata(branch);
          assert.equal(before.commit_sha,latestSha);
          // The test file was missing on main. Only the Engineer-approved
          // Test task creates it through Rust+Gateway, never a bootstrap push.
          const preparedCreate=gateway.prepare({task_id:taskId,
            agent_role:"test",tool:"create_file",arguments:{
              branch,path:createdTestFile,
              content:ACCOUNT_SUSPENSION_REFERENCE_FILES[createdTestFile]}
          });
          const createVp=await signedVp(
            childIds.test,preparedCreate,agentTokens.test);
          const created=await gateway.execute({
            request_id:preparedCreate.request_id,signed_vp:createVp
          });
          assert.equal(created.execution.tool,"create_file");
          assert.equal(created.execution.path,createdTestFile);
          testCreates++;
          const pinned=await reader.getBranchMetadata(branch);
          assert.equal(pinned.commit_sha,created.execution.commit_sha);
          const prepared=gateway.prepare({
            task_id:taskId,agent_role:"test",tool:"run_tests",
            arguments:{branch,profile:"poc-default"}
          });
          assert.equal(prepared.required_permission.resource,
            repositoryUri+"/branches/"+encodeURIComponent(branch));
          const signed=await signedVp(childIds.test,prepared,agentTokens.test);
          const executed=await gateway.execute({
            request_id:prepared.request_id,signed_vp:signed
          });
          const effect=executed.execution;
          process.stderr.write("[native-dag-test] docker_phase_status "+
            JSON.stringify({
              status:effect.status,
              phases:effect.phases?.map(x=>({phase:x.phase,status:x.status})),
              project_tests:effect.project_tests?.status,
              researcher_acceptance:effect.researcher_acceptance?.status
            })+"\n");
          assert.equal(executed.verified_delegation.presenter_id,
            process.env.ADAPTER_ID_TEST);
          assert.equal(executed.policy.allow,true);
          assert.equal(effect.provider,"runner");
          assert.equal(effect.tool,"run_tests");
          assert.equal(effect.status,"pass");
          assert.equal(effect.tested_commit_sha,pinned.commit_sha);
          assert.equal(effect.project_tests?.status,"pass");
          assert.equal(effect.researcher_acceptance?.status,"pass");
          assert.deepEqual(effect.phases.map(x=>x.phase),[
            "dependency_install","typecheck","backend_tests","frontend_tests",
            "build","playwright_e2e","researcher_acceptance"
          ]);
          assert.ok(effect.phases.every(x=>x.status==="pass"));
          runnerRuns++;
          runnerOutcome=effect;
          return {
            role:"test",summary:"Exact-SHA Docker and researcher acceptance",
            files_modified:[],files_created:[createdTestFile],branch,
            revision:effect.tested_commit_sha,
            commit_sha:effect.tested_commit_sha,
            test_outcome:"pass",errors:[],
            tested_commit_sha:effect.tested_commit_sha,
            runner_profile:effect.runner_profile,
            project_tests:effect.project_tests.status,
            researcher_acceptance:effect.researcher_acceptance.status
          };
        }catch(error){
          process.stderr.write("[native-dag-test] bounded_failure "+
            JSON.stringify({
              kind:error?.constructor?.name??"Error",
              code:error?.code??"unknown",
              message:String(error?.message??"test_failed").slice(0,220)
            })+"\n");
          throw error;
        }
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
      approved_branch_sha:head.commit_sha
    };
  }finally{
    try{
      for(const server of servers.reverse())await server.close();
    }finally{
      await new Promise(resolve=>runnerServer.close(resolve));
      await rm(runLogs,{recursive:true,force:true});
    }
  }
}
