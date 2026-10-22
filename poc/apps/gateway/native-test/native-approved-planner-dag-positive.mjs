/**
 * Positive native approved Planning DAG, on a disposable Gitea only.
 * Actual: Ed25519 signed plan, Rust EVM root and task child, VP, Core Rust,
 * OPA, real A2A HTTP SDK, Gitea branch/file mutation, Gateway corroboration.
 * Scripted fixed Backend handler: NOT autonomous Gemini/ADK code generation.
 */
import assert from "node:assert/strict";
import {randomBytes,randomInt} from "node:crypto";
import {createServer} from "node:net";
import {GatewayRuntime} from "../src/runtime.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {GiteaExecutor} from "../src/gitea-executor.ts";
import {OpaPolicyClient} from "../src/policy-client.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {startSpecializedAgentServer} from
  "../../../packages/agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator} from
  "../../../packages/agent-runtime/src/orchestrator.ts";

const adapterUrl="http://127.0.0.1:8090";
const change="\n// Trusted offline A2A Backend: approved working-branch edit.\n";
async function presentation(credential_id,prepared,caller){
  const response=await fetch(adapterUrl+"/v1/presentations",{
    method:"POST",headers:{
      authorization:"Bearer "+caller,"content-type":"application/json"
    },body:JSON.stringify({
      credential_id,disclosed_permissions:[prepared.required_permission],
      audience:prepared.audience,challenge:prepared.challenge
    })
  });
  assert.equal(response.status,200);
  const jwt=(await response.json()).signed_vp;
  assert.ok(typeof jwt==="string"&&jwt.length>100);
  return jwt;
}
async function port(){
  const server=createServer();
  await new Promise((resolve,reject)=>{
    server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
  });
  const id=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return id;
}
export async function runNativePositiveApprovedDag({
  coordinator,reviewGate,approvedPlans,sessionId,planDigest,baseSha,
  operationalRootId,branch,file,repo,giteaBase,readerToken,writerToken,
  opaUrl,engineerDid,orchestratorToken,backendToken
}){
  assert.match(giteaBase,/^http:\/\/127\.0\.0\.1:\d+$/u);
  for(const token of [readerToken,writerToken,orchestratorToken,backendToken])
    assert.ok(typeof token==="string"&&token.length>10);
  const reader=new GiteaClient({baseUrl:giteaBase,token:readerToken,
    owner:repo.owner,repository:repo.repository,timeoutMs:20000});
  const writer=new GiteaClient({baseUrl:giteaBase,token:writerToken,
    owner:repo.owner,repository:repo.repository,timeoutMs:20000});
  const original=await reader.readTextFile("main",file,baseSha);
  assert.ok(original.content.includes("listUsers"));
  assert.ok(!original.content.includes(change.trim()));
  await assert.rejects(()=>reader.getBranchMetadata(branch));
  const gateway=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",request_ttl_ms:120000,
      repository:repo},opa_url:opaUrl,opa_timeout_ms:15000,
    provider_mode:"mock",gitea_timeout_ms:15000
  },{
    approvedPlans,verifier:loadDirectCoreRustVerifier(),
    policy:new OpaPolicyClient({baseUrl:opaUrl,timeoutMs:15000}),
    executor:new GiteaExecutor(writer)
  });
  let backendCalls=0,backendReads=0,backendWrites=0;
  const server=await startSpecializedAgentServer({
    role:"backend",host:"127.0.0.1",port:await port(),
    delegatedAuthorization:true,capabilityProfile:"approved-plan",
    taskHandler:async context=>{
      backendCalls++;
      assert.equal(context.role,"backend");
      assert.equal(context.subtask.subtask_id,"backend");
      assert.equal(context.subtask.branch,branch);
      assert.deepEqual(context.subtask.relevant_paths,[file]);
      assert.deepEqual(context.subtask.approved_file_permissions,[
        {path:file,operation:"read_file"},{path:file,operation:"update_file"}
      ]);
      assert.equal(context.delegation_evidence.presenter_id,
        process.env.ADAPTER_ID_BACKEND);
      const taskId=context.trusted_gateway_task_id;
      assert.match(taskId,/^dispatch_[A-Za-z0-9_-]{22}$/u);
      const childId=context.delegation_evidence.credential_id;
      const read=gateway.prepare({task_id:taskId,agent_role:"backend",
        tool:"read_file",arguments:{branch,path:file}});
      const readVp=await presentation(childId,read,backendToken);
      const observed=await gateway.execute({request_id:read.request_id,
        signed_vp:readVp});
      assert.equal(observed.execution.tool,"read_file");
      assert.equal(observed.execution.content,original.content);
      assert.equal(observed.verified_delegation.presenter_id,
        process.env.ADAPTER_ID_BACKEND);
      backendReads++;
      const update=gateway.prepare({task_id:taskId,agent_role:"backend",
        tool:"update_file",arguments:{branch,path:file,
          content:original.content+change}});
      const updateVp=await presentation(childId,update,backendToken);
      const actual=await gateway.execute({
        request_id:update.request_id,signed_vp:updateVp
      });
      assert.equal(actual.policy.allow,true);
      assert.equal(actual.policy.policy_version,"phase6-approved-branch-v2");
      assert.equal(actual.execution.tool,"update_file");
      assert.equal(actual.execution.path,file);
      assert.equal(actual.execution.provider,"gitea");
      backendWrites++;
      return {
        role:"backend",summary:"Actual approved Gitea update with Rust-signed child",
        files_modified:[file],files_created:[],branch,
        revision:actual.execution.commit_sha,
        commit_sha:actual.execution.commit_sha,
        test_outcome:"not_run",errors:[]
      };
    }
  });
  try{
    const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
      approvals:reviewGate,coordinator,sessionId,
      expectedPlanDigest:planDigest,baseRevision:baseSha,
      expectedEngineerDid:engineerDid,
      agentBaseUrls:{backend:server.baseUrl,
        frontend:"http://127.0.0.1:1",test:"http://127.0.0.1:1"},
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:120000,initialIntervalMs:50,maxIntervalMs:200
      }),
      adapter:{adapterBaseUrl:adapterUrl,bearerToken:orchestratorToken,
        timeoutMs:30000},
      async authorityForTask(taskId,role){
        assert.equal(taskId,"backend");assert.equal(role,"backend");
        return {
          parent_credential_id:operationalRootId,
          credential_id:"urn:native:approved-planning-child-"+
            randomBytes(8).toString("hex"),
          valid_from:new Date(Date.now()-1000).toISOString(),
          validity_seconds:300,
          credential_status:{type:"BitstringStatusListEntry",
            statusPurpose:"revocation",
            statusListIndex:String(randomInt(66001,69000)),
            statusListCredential:"https://status.example/lists/approved-planning"}
        };
      }
    });
    await assert.rejects(dispatcher.dispatch("backend"),/dependencies/);
    assert.equal(backendCalls,0);
    const result=await dispatcher.executeApprovedDag({
      async invokeOrchestratorTask(planTaskId,runtimeTaskId){
        assert.equal(planTaskId,"branch");
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
        const jwt=await presentation(operationalRootId,prep,orchestratorToken);
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
    assert.deepEqual(result.completed_task_ids,["branch","backend"]);
    assert.equal(result.specialized_results.length,1);
    assert.equal(backendCalls,1);
    assert.equal(backendReads,1);assert.equal(backendWrites,1);
    const after=await reader.getBranchMetadata(branch);
    assert.notEqual(after.commit_sha,baseSha);
    assert.equal(result.specialized_results[0].artifact.commit_sha,after.commit_sha);
    assert.equal((await reader.readTextFile(branch,file)).content,
      original.content+change);
    assert.equal((await reader.getBranchMetadata("main")).commit_sha,baseSha);
    assert.equal((await reader.readTextFile("main",file,baseSha)).content,
      original.content);
    assert.throws(()=>gateway.prepare({
      task_id:"after_closed",agent_role:"backend",tool:"update_file",
      arguments:{branch,path:file,content:"unapproved"}
    }),error=>error?.code==="approved_plan_denied");
    return {
      status:"pass",signed_dag_completed:true,
      completed_task_ids:result.completed_task_ids,
      real_a2a_sdk:true,rust_evm_child:true,
      native_verifier:true,live_opa:true,real_gitea:true,
      source_reads:backendReads,source_writes:backendWrites,
      main_unchanged:true,operational_root_revoked:true,
      approved_branch_sha:after.commit_sha
    };
  }finally{await server.close();}
}
