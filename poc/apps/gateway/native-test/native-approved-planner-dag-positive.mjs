/**
 * Positive native signed Planning DAG with two real specialized A2A roles.
 * Real Rust/EVM scoped child credentials, verified native VPs, OPA and
 * disposable Gitea branch/file updates. Each fixed script is a TEST fixture:
 * it does not demonstrate generative Gemini software development.
 */
import assert from "node:assert/strict";
import {randomBytes,randomInt} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";
import {GatewayRuntime} from "../src/runtime.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {GiteaExecutor} from "../src/gitea-executor.ts";
import {RunnerClient} from "../src/runner-client.ts";
import {IsolatedDockerRunnerExecutor} from
  "../../test-runner-controller/src/isolated-executor.ts";
import {createRunnerHttpServer} from
  "../../test-runner-controller/src/http.ts";
import {OpaPolicyClient} from "../src/policy-client.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {startSpecializedAgentServer} from
  "../../../packages/agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator} from
  "../../../packages/agent-runtime/src/orchestrator.ts";

const adapterUrl="http://127.0.0.1:8090";
const ROLES=["backend","frontend"];
const ALL_ROLES=[...ROLES,"test"];
const MARKERS={
  backend:"\n// Trusted offline Backend: approved task-scoped edit.\n",
  frontend:"\n// Trusted offline Frontend: approved task-scoped edit.\n"
};
async function signedVp(credentialId,challenge,callerToken){
  const response=await fetch(adapterUrl+"/v1/presentations",{
    method:"POST",headers:{
      authorization:"Bearer "+callerToken,"content-type":"application/json"
    },body:JSON.stringify({
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
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return port;
}
export async function runNativePositiveApprovedDag({
  coordinator,reviewGate,approvedPlans,sessionId,planDigest,baseSha,
  operationalRootId,branch,files,repo,giteaBase,readerToken,writerToken,
  opaUrl,engineerDid,orchestratorToken,agentTokens
}){
  assert.match(giteaBase,/^http:\/\/127\.0\.0\.1:\d+$/u);
  for(const v of [readerToken,writerToken,orchestratorToken,
    ...ALL_ROLES.map(role=>agentTokens[role])])
    assert.ok(typeof v==="string"&&v.length>10);
  assert.equal(coordinator.phase,"execution");
  assert.deepEqual(Object.keys(files).sort(),[...ROLES].sort());
  const reader=new GiteaClient({
    baseUrl:giteaBase,token:readerToken,
    owner:repo.owner,repository:repo.repository,timeoutMs:20000
  });
  const writer=new GiteaClient({
    baseUrl:giteaBase,token:writerToken,
    owner:repo.owner,repository:repo.repository,timeoutMs:20000
  });
  const originals={};
  for(const role of ROLES){
    const source=await reader.readTextFile("main",files[role],baseSha);
    assert.equal(source.revision,baseSha);
    assert.ok(source.content.length>100);
    assert.ok(!source.content.includes(MARKERS[role].trim()));
    originals[role]=source.content;
  }
  await assert.rejects(()=>reader.getBranchMetadata(branch));
  const repoUri="gitea://"+repo.authority+"/"+repo.owner+"/"+repo.repository;
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
    contract:{repository:repoUri,branch}
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
    prepare:{audience:"cloud-access-gateway",request_ttl_ms:120000,
      repository:repo},
    opa_url:opaUrl,opa_timeout_ms:15000,
    provider_mode:"mock",gitea_timeout_ms:15000
  },{
    approvedPlans,verifier:loadDirectCoreRustVerifier(),
    policy:new OpaPolicyClient({baseUrl:opaUrl,timeoutMs:15000}),
    executor:new GiteaExecutor(writer,runnerClient,repoUri)
  });
  const counts={backend:0,frontend:0},reads={backend:0,frontend:0},
    writes={backend:0,frontend:0};
  let testCalls=0,runnerRuns=0,runnerOutcome=null,frontendCommit=null;
  const servers=[],urls={},childIds={};
  try{
    for(const role of ROLES){
      const file=files[role],token=agentTokens[role],original=originals[role];
      const server=await startSpecializedAgentServer({
        role,host:"127.0.0.1",port:await freePort(),
        delegatedAuthorization:true,capabilityProfile:"approved-plan",
        taskHandler:async context=>{
          counts[role]++;
          assert.equal(context.role,role);
          assert.equal(context.subtask.subtask_id,role);
          assert.equal(context.subtask.branch,branch);
          assert.deepEqual(context.subtask.relevant_paths,[file]);
          assert.deepEqual(context.subtask.approved_file_permissions,[
            {path:file,operation:"read_file"},
            {path:file,operation:"update_file"}
          ]);
          assert.equal(context.delegation_evidence.presenter_id,
            process.env["ADAPTER_ID_"+role.toUpperCase()]);
          const taskId=context.trusted_gateway_task_id;
          assert.match(taskId,/^dispatch_[A-Za-z0-9_-]{22}$/u);
          const credentialId=context.delegation_evidence.credential_id;
          assert.equal(credentialId,childIds[role]);
          const pre=gateway.prepare({
            task_id:taskId,agent_role:role,
            tool:"read_file",arguments:{branch,path:file}
          });
          const jwt=await signedVp(credentialId,pre,token);
          const read=await gateway.execute({
            request_id:pre.request_id,signed_vp:jwt
          });
          assert.equal(read.execution.tool,"read_file");
          assert.equal(read.execution.content,original);
          assert.equal(read.verified_delegation.presenter_id,
            process.env["ADAPTER_ID_"+role.toUpperCase()]);
          reads[role]++;
          const updated=gateway.prepare({
            task_id:taskId,agent_role:role,
            tool:"update_file",arguments:{branch,path:file,
              content:original+MARKERS[role]}
          });
          const updateVp=await signedVp(credentialId,updated,token);
          const executed=await gateway.execute({
            request_id:updated.request_id,signed_vp:updateVp
          });
          assert.equal(executed.policy.allow,true);
          assert.equal(executed.policy.policy_version,"phase6-approved-branch-v2");
          assert.equal(executed.execution.tool,"update_file");
          assert.equal(executed.execution.provider,"gitea");
          assert.equal(executed.execution.path,file);
          writes[role]++;
          if(role==="frontend")frontendCommit=executed.execution.commit_sha;
          return {
            role,summary:"Trusted bounded real Gitea edit for "+role,
            files_modified:[file],files_created:[],branch,
            revision:executed.execution.commit_sha,
            commit_sha:executed.execution.commit_sha,
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
        assert.equal(context.role,"test");
        assert.equal(context.subtask.subtask_id,"test");
        assert.equal(context.subtask.branch,branch);
        assert.deepEqual(context.subtask.relevant_paths,[]);
        assert.equal(context.delegation_evidence.presenter_id,
          process.env.ADAPTER_ID_TEST);
        assert.equal(context.delegation_evidence.credential_id,childIds.test);
        assert.equal(counts.backend,1);
        assert.equal(counts.frontend,1);
        const pinned=await reader.getBranchMetadata(branch);
        assert.equal(pinned.commit_sha,frontendCommit);
        const prepared=gateway.prepare({
          task_id:context.trusted_gateway_task_id,
          agent_role:"test",tool:"run_tests",
          arguments:{branch,profile:"poc-default"}
        });
        assert.equal(prepared.required_permission.resource,
          repoUri+"/branches/"+encodeURIComponent(branch));
        const signed=await signedVp(childIds.test,prepared,agentTokens.test);
        const executed=await gateway.execute({
          request_id:prepared.request_id,signed_vp:signed
        });
        const effect=executed.execution;
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
          role:"test",summary:"Actual exact-SHA Docker and independent acceptance",
          files_modified:[],files_created:[],branch,
          revision:effect.tested_commit_sha,
          commit_sha:effect.tested_commit_sha,
          test_outcome:"pass",errors:[],
          tested_commit_sha:effect.tested_commit_sha,
          runner_profile:effect.runner_profile,
          project_tests:effect.project_tests.status,
          researcher_acceptance:effect.researcher_acceptance.status
        };
      }
    });
    servers.push(testAgent);urls.test=testAgent.baseUrl;
    const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
      approvals:reviewGate,coordinator,sessionId,
      expectedPlanDigest:planDigest,baseRevision:baseSha,
      expectedEngineerDid:engineerDid,
      agentBaseUrls:urls,
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:120000,initialIntervalMs:50,maxIntervalMs:200
      }),
      adapter:{adapterBaseUrl:adapterUrl,bearerToken:orchestratorToken,timeoutMs:30000},
      async authorityForTask(taskId,role){
        assert.equal(taskId,role);
        assert.ok(ALL_ROLES.includes(role));
        assert.equal(childIds[role],undefined);
        childIds[role]="urn:native:positive-"+role+"-"+
          randomBytes(8).toString("hex");
        return {
          parent_credential_id:operationalRootId,
          credential_id:childIds[role],
          valid_from:new Date(Date.now()-1000).toISOString(),
          validity_seconds:300,
          credential_status:{
            type:"BitstringStatusListEntry",statusPurpose:"revocation",
            statusListIndex:String(randomInt(66001,69000)),
            statusListCredential:"https://status.example/lists/approved-dag"
          }
        };
      }
    });
    for(const role of ALL_ROLES)await assert.rejects(
      dispatcher.dispatch(role),/dependencies/);
    assert.deepEqual(counts,{backend:0,frontend:0});
    let previousSha=baseSha;
    const result=await dispatcher.executeApprovedDag({
      async invokeOrchestratorTask(planId,runtimeTaskId){
        assert.equal(planId,"branch");
        assert.throws(()=>gateway.prepare({
          task_id:runtimeTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{
            base_branch:"main",branch:"feature/not-approved"
          }
        }),/approved plan/i);
        const prep=gateway.prepare({
          task_id:runtimeTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{base_branch:"main",branch}
        });
        const jwt=await signedVp(operationalRootId,prep,orchestratorToken);
        const created=await gateway.execute({
          request_id:prep.request_id,signed_vp:jwt
        });
        assert.equal(created.policy.allow,true);
        assert.equal(created.execution.tool,"create_branch");
        assert.equal(created.execution.commit_sha,baseSha);
        assert.equal((await reader.getBranchMetadata(branch)).commit_sha,baseSha);
      }
    });
    assert.equal(coordinator.phase,"closed");
    assert.equal(result.plan_digest,planDigest);
    assert.deepEqual(result.completed_task_ids,["branch",...ALL_ROLES]);
    assert.deepEqual(result.specialized_results.map(x=>x.role),ALL_ROLES);
    assert.deepEqual(counts,{backend:1,frontend:1});
    assert.deepEqual(reads,{backend:1,frontend:1});
    assert.deepEqual(writes,{backend:1,frontend:1});
    assert.ok(childIds.backend!==childIds.frontend);
    assert.ok(childIds.test!==childIds.frontend&&childIds.test!==childIds.backend);
    assert.equal(testCalls,1);
    assert.equal(runnerRuns,1);
    assert.equal(runnerOutcome?.tested_commit_sha,frontendCommit);
    assert.equal(runnerOutcome?.status,"pass");
    assert.equal(result.specialized_results[2].artifact.test_outcome,"pass");
    assert.equal(result.specialized_results[2].artifact.tested_commit_sha,
      frontendCommit);
    for(let i=0;i<ROLES.length;i++){
      const role=ROLES[i];
      const outcome=result.specialized_results[i];
      assert.deepEqual(outcome.artifact.files_modified,[files[role]]);
      assert.equal(outcome.artifact.test_outcome,"not_run");
      assert.ok(outcome.artifact.commit_sha!==baseSha);
      if(i>0)assert.notEqual(outcome.artifact.commit_sha,
        result.specialized_results[i-1].artifact.commit_sha);
      const saved=await reader.readTextFile(branch,files[role]);
      assert.equal(saved.content,originals[role]+MARKERS[role]);
    }
    const head=await reader.getBranchMetadata(branch);
    assert.equal(head.commit_sha,result.specialized_results.at(-1).artifact.commit_sha);
    assert.notEqual(head.commit_sha,previousSha);
    for(const role of ROLES){
      const intact=await reader.readTextFile("main",files[role],baseSha);
      assert.equal(intact.content,originals[role]);
    }
    assert.equal((await reader.getBranchMetadata("main")).commit_sha,baseSha);
    assert.throws(()=>gateway.prepare({
      task_id:"after_closed",agent_role:"backend",
      tool:"update_file",arguments:{
        branch,path:files.backend,content:"unapproved"
      }
    }),e=>e?.code==="approved_plan_denied");
    return {
      status:"pass",signed_dag_completed:true,
      completed_task_ids:result.completed_task_ids,
      real_a2a_sdk:true,native_rust_child_credentials:2,
      native_verifier:true,live_opa:true,real_gitea:true,
      source_reads:2,source_writes:2,test_runner_runs:runnerRuns,
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
