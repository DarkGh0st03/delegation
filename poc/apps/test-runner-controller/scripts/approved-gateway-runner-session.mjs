/**
 * Real disposable Gitea + HTTP Docker Runner + signed Engineer Plan:
 * the Test Task goes through Gateway Prepare -> verifier/policy ->
 * real GiteaExecutor -> RunnerClient -> Runner HTTP -> real Docker phases,
 * and the Gateway independently checks the exact tested SHA when accepting
 * a trusted Task-completion observation.
 *
 * This provider integration uses an injected verifier and policy stub;
 * native Rust VP/EVM/OPA are tested separately in the cumulative EVM job.
 * The trusted signed plan and its Gateway enforcement are NOT stubbed.
 * No AI model is contacted; no authorization/merge endpoint is published.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../gateway/src/operation-catalog.ts";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedApprovedExecutionPlans} from
  "../../gateway/src/approved-execution-plans.ts";
import {GatewayCorroboratedTaskAttestor} from
  "../../gateway/src/trusted-task-observation.ts";
import {GatewayRuntime} from "../../gateway/src/runtime.ts";
import {GiteaClient} from "../../gateway/src/gitea-client.ts";
import {GiteaExecutor} from "../../gateway/src/gitea-executor.ts";
import {RunnerClient} from "../../gateway/src/runner-client.ts";
import {createRunnerHttpServer} from "../src/http.ts";

const URI="gitea://gitea.local/thesis/iam-console-poc";
const DID="did:thesis:engineer";
const TEST_DID="did:thesis:test";
const REPOSITORY={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const BRANCH="feature/account-suspension";
const SHA=/^[a-f0-9]{40}$/u;

export async function beginApprovedRealRunnerSession({
  giteaBaseUrl,giteaGatewayToken,giteaReadToken,executor,mainSha,featureSha
}){
  if(!SHA.test(mainSha)||!SHA.test(featureSha)||mainSha===featureSha){
    throw Error("Approved Test Task requires distinct observed immutable Git SHAs");
  }
  const sessionId="signed-runner-"+randomBytes(8).toString("hex");
  const privateRoot=await mkdtemp(join(tmpdir(),"delegation-approved-runner-"));
  let server;
  let registry;
  try{
    const branchUri=URI+"/branches/"+encodeURIComponent(BRANCH);
    const plan={
      schema_version:"1.0.0",plan_id:"real-gitea-runner-plan",
      session_id:sessionId,version:1,repository:REPOSITORY,base_revision:mainSha,
      requirement:"Run exact pinned feature SHA in Docker with researcher-owned acceptance",
      candidate_agents:[{agent_id:"test",did:TEST_DID,card_ref:"trusted:test"}],
      tasks:[{id:"verify",agent_id:"test",title:"Verify feature branch",
        description:"Run all required project and independent acceptance tests",
        depends_on:[],resources:[branchUri]}],
      requested_permissions:[{id:"approved-runner-only",
        task_id:"verify",agent_id:"test",resource:branchUri,
        operation:"run_tests",reason:"Verify the exact approved feature revision"}],
      assumptions:[],uncertainties:[]
    };
    const now=new Date().toISOString();
    const approval=makeApproval(plan,{allowedOperations:new Set(RUST_OPERATIONS),
      decision_id:"signed-runner-"+sessionId,approved_by:DID,approved_at:now,
      approved_permission_ids:["approved-runner-only"]});
    const {privateKey,publicKey}=generateKeyPairSync("ed25519");
    const keyId="runner-fixture-pinned-v1";
    const signed=signEngineerApproval({
      plan,approval,engineerDid:DID,keyId,
      privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}).toString(),
      issuedAt:now,expiresAt:new Date(Date.now()+30*60*1000).toISOString()
    });
    await writeFile(join(privateRoot,sessionId+".json"),
      JSON.stringify(signed),{mode:0o600});
    const approvals=new SignedEngineerApprovalFileStore({
      directory:privateRoot,engineerDid:DID,trustedKeys:{
        [keyId]:{engineer_did:DID,
          public_key_pem:publicKey.export({format:"pem",type:"spki"}).toString()}
      }
    });
    registry=new TrustedApprovedExecutionPlans({
      repository:REPOSITORY,engineerDid:DID,approvals,
      completionAttestor:new GatewayCorroboratedTaskAttestor()
    });
    assert.equal(await registry.activate(sessionId,mainSha),planDigest(plan));
    const taskId="dispatch_"+randomBytes(16).toString("base64url");
    registry.bindTask(sessionId,"verify",taskId,"test");
    const runnerToken=randomBytes(32).toString("hex");
    server=createRunnerHttpServer({
      bind_host:"127.0.0.1",bind_port:0,gateway_token:runnerToken,
      contract:{repository:URI,branch:BRANCH}
    },executor);
    await new Promise((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,"127.0.0.1",resolve);
    });
    const port=server.address()?.port;
    if(!port)throw Error("Real Runner HTTP endpoint did not bind");
    const runnerClient=new RunnerClient({
      baseUrl:"http://127.0.0.1:"+port,gatewayToken:runnerToken,
      timeoutMs:24*60*1000
    });
    const realGitea=new GiteaClient({
      baseUrl:giteaBaseUrl,token:giteaGatewayToken,
      owner:REPOSITORY.owner,repository:REPOSITORY.repository,timeoutMs:20_000
    });
    const gateway=new GatewayRuntime({
      bind_host:"127.0.0.1",bind_port:0,
      prepare:{audience:"cloud-access-gateway",request_ttl_ms:25*60*1000,
        repository:REPOSITORY},
      opa_url:"http://fixture-disabled",opa_timeout_ms:1000,
      provider_mode:"mock",gitea_timeout_ms:20_000
    },{
      approvedPlans:registry,executor:new GiteaExecutor(realGitea,runnerClient,URI),
      verifier:{async verify(request){
        assert.equal(request.presenter,"test");
        return {
          presenter_id:TEST_DID,issuer_id:"did:thesis:orchestrator",
          credential_id:"urn:scoped:runner-fixture",
          permissions:[request.required_permission],hierarchy_depth:1,
          expiration:new Date(Date.now()+30*60*1000).toISOString()
        };
      }},
      policy:{async evaluate(input){
        // Policy is separately tested with live OPA in the cumulative gate.
        // Here reject any provider action not in the signed Test Task.
        assert.equal(input.approved_plan_digest,planDigest(plan));
        assert.equal(input.approved_work_branch,BRANCH);
        assert.equal(input.tool,"run_tests");
        assert.equal(input.required_permission.resource,branchUri);
        assert.equal(input.arguments.branch,BRANCH);
        return {allow:true,policy_version:"signed-runner-provider-isolation-fixture"};
      }}
    });
    // Even the approved Test role cannot select main or another feature
    // branch: rejection happens BEFORE a Runner HTTP request exists.
    for(const forbidden of ["main","feature/attacker"]){
      assert.throws(()=>gateway.prepare({
        task_id:taskId,agent_role:"test",tool:"run_tests",
        arguments:{branch:forbidden,profile:"poc-default"}
      }),/approved plan|Provider branch|denied/i);
    }
    const prepared=gateway.prepare({
      task_id:taskId,agent_role:"test",tool:"run_tests",
      arguments:{branch:BRANCH,profile:"poc-default"}
    });
    assert.equal(prepared.required_permission.resource,branchUri);
    let used=false,completed=false;
    return {
      request:{request_id:prepared.request_id,repository:URI,
        branch:BRANCH,commit_sha:featureSha,profile:"poc-default"},
      async run(request){
        if(used)throw Error("Signed approved Runner Task cannot be replayed");
        used=true;
        if(request.request_id!==prepared.request_id||
           request.branch!==BRANCH||request.commit_sha!==featureSha||
           request.repository!==URI||request.profile!=="poc-default"){
          throw Error("CI runner request differs from signed Test Task");
        }
        const received=await realGitea.getBranchMetadata(BRANCH);
        assert.equal(received.commit_sha,featureSha,
          "Real Gitea branch moved before signed Runner task");
        const authorized=await gateway.execute({
          request_id:prepared.request_id,signed_vp:"offline-fixture-verifier"
        });
        assert.equal(authorized.execution.provider,"runner");
        const result=authorized.execution;
        assert.equal(result.status,"pass");
        assert.equal(result.tested_commit_sha,featureSha);
        assert.equal(result.project_tests?.status,"pass");
        assert.equal(result.researcher_acceptance?.status,"pass");
        await registry.confirmTaskCompletion(taskId,{
          source:"trusted_a2a_poll",state:"completed",runtime_task_id:taskId,
          role:"test",artifact:{
            branch:BRANCH,revision:featureSha,commit_sha:featureSha,
            files_modified:[],files_created:[],test_outcome:"pass",
            tested_commit_sha:featureSha,runner_profile:"poc-default",
            project_tests:"pass",researcher_acceptance:"pass"
          }
        });
        completed=true;
        registry.closeSession(sessionId);
        // No second Docker execution is possible after trusted completion.
        assert.throws(()=>gateway.prepare({
          task_id:taskId,agent_role:"test",tool:"run_tests",
          arguments:{branch:BRANCH,profile:"poc-default"}
        }),/active trusted plan|approved plan|completed task|inactive/i);
        // Return the ORIGINAL independently observed Docker result, adding
        // the bound CI request and repository identity; never forge phase PASS.
        return {...result,request_id:request.request_id,repository:URI};
      },
      get completed(){return completed;},
      async close(){
        if(!completed){try{registry.closeSession(sessionId);}catch{}}
        if(server?.listening)await new Promise(resolve=>server.close(resolve));
        await rm(privateRoot,{recursive:true,force:true});
      }
    };
  }catch(error){
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    if(registry){try{registry.closeSession(sessionId);}catch{}}
    await rm(privateRoot,{recursive:true,force:true});
    throw error;
  }
}
