/**
 * Real disposable Gitea + HTTP Docker Runner + signed Engineer Plan:
 * the Test Task goes through Gateway Prepare -> verifier/policy ->
 * real GiteaExecutor -> RunnerClient -> Runner HTTP -> real Docker phases,
 * and the Gateway independently checks the exact tested SHA when accepting
 * a trusted Task-completion observation.
 *
 * Two explicit modes: fixture VP verifier with real OPA (default), or
 * opt-in native EVM Adapter + Core Rust verifier + real OPA (EVM CI only).
 * No verifier downgrade is permitted after native-mode selection.
 * The trusted signed plan and its Gateway enforcement are NOT stubbed.
 * No AI model is contacted; no authorization/merge endpoint is published.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer as createPortProbe} from "node:net";
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
import {loadDirectCoreRustVerifier} from "../../gateway/src/direct-core-loader.ts";
import {SoftwareEngineerAuthorityBootstrap} from
  "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {TrustedEngineerAuthoritySession} from
  "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from
  "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedApprovedPlanChildAuthorityIssuer} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-child-issuer.ts";
import {OpaPolicyClient} from "../../gateway/src/policy-client.ts";
import {GiteaClient} from "../../gateway/src/gitea-client.ts";
import {GiteaExecutor} from "../../gateway/src/gitea-executor.ts";
import {RunnerClient} from "../../gateway/src/runner-client.ts";
import {createRunnerHttpServer} from "../src/http.ts";
import {DelegatedA2ARoleRunner} from
  "../../../packages/orchestrator-runtime/src/a2a-workflow.ts";
import {observedA2ACompletion} from
  "../../../packages/orchestrator-runtime/src/trusted-a2a-observer.ts";
import {DeterministicA2AOrchestrator} from
  "../../../packages/agent-runtime/src/orchestrator.ts";
import {startSpecializedAgentServer} from
  "../../../packages/agent-runtime/src/server.ts";

const URI="gitea://gitea.local/thesis/iam-console-poc";
// Opt-in only in the EVM CI job. The default standalone smoke remains
// explicitly fixture-verifier mode and requires no Rust/chain environment.
const native=process.env.APPROVED_RUNNER_NATIVE_EVM==="1";
function nativeEnv(key){
  const v=process.env[key];
  if(!v||!v.trim())throw Error("Native positive E2E missing trusted "+key);
  return v;
}
const DID=native?nativeEnv("ADAPTER_ID_ENGINEER"):"did:thesis:engineer";
const TEST_DID=native?nativeEnv("ADAPTER_ID_TEST"):"did:thesis:test";
const ADAPTER_BASE="http://127.0.0.1:8090";
function nativeCredential(id,index,validity_seconds=1500){
  return {credential_id:id,valid_from:new Date(Date.now()-1000).toISOString(),
    validity_seconds,credential_status:{
      type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListIndex:String(index),
      statusListCredential:"https://status.example/lists/scoped-native-evm"
    }
  };
}
async function adapterPresentation(credentialId,required,prepared){
  const response=await fetch(ADAPTER_BASE+"/v1/presentations",{
    method:"POST",headers:{
      authorization:"Bearer "+nativeEnv("ADAPTER_CALLER_TEST"),
      "content-type":"application/json"
    },
    body:JSON.stringify({
      credential_id:credentialId,disclosed_permissions:[required],
      audience:prepared.audience,challenge:prepared.challenge
    }),
    signal:AbortSignal.timeout(30000)
  });
  if(!response.ok)throw Error("Rust Adapter refused signed Test VP");
  const result=await response.json();
  if(typeof result.signed_vp!=="string"||!result.signed_vp){
    throw Error("Rust Adapter did not produce a signed VP");
  }
  return result.signed_vp;
}
const REPOSITORY={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const BRANCH="feature/account-suspension";
const SHA=/^[a-f0-9]{40}$/u;

export async function beginApprovedRealRunnerSession({
  giteaBaseUrl,giteaGatewayToken,giteaReadToken,executor,mainSha,featureSha,
  opaBaseUrl
}){
  if(typeof opaBaseUrl!=="string"||
     !/^http:\/\/127\.0\.0\.1:\d+$/u.test(opaBaseUrl)){
    throw Error("Isolated real OPA endpoint is required for approved Runner test");
  }
  if(!SHA.test(mainSha)||!SHA.test(featureSha)||mainSha===featureSha){
    throw Error("Approved Test Task requires distinct observed immutable Git SHAs");
  }
  const sessionId="signed-runner-"+randomBytes(8).toString("hex");
  const privateRoot=await mkdtemp(join(tmpdir(),"delegation-approved-runner-"));
  let server;
  let registry;
  let coordinator;
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
    // Either signed fixture authority or REAL Anvil/Rust authority.
    // Native mode proves Planning revocation and independently issued
    // operational root before the Gateway Task is bound.
    let activeRootId="urn:fixture:operational-root";
    const unique=randomBytes(7).toString("hex");
    if(native){
      const credentials=new SoftwareEngineerAuthorityBootstrap({
        adapterBaseUrl:ADAPTER_BASE,
        bearerToken:nativeEnv("ADAPTER_CALLER_ENGINEER"),
        timeoutMs:30000
      });
      const trustedAuthority=new TrustedEngineerAuthoritySession({
        snapshot:{session_id:sessionId,repository:REPOSITORY,
          base_revision:mainSha,directories:[""],files:[]},
        credentials,approvals,authenticatedEngineerDid:DID
      });
      coordinator=new TrustedExecutionCoordinator({
        authority:trustedAuthority,approvedGatewayPlans:registry,
        credentials,sessionId,baseRevision:mainSha
      });
      const planning=await coordinator.beginPlanning(
        nativeCredential("urn:native:positive-plan-"+unique,18071,180));
      assert.equal(planning.phase,"planning");
      assert(planning.permissions.every(p=>
        ["read_repository","list_directory","read_file"].includes(p.operation)));
      const active=await coordinator.beginExecution(nativeCredential(
        "urn:native:positive-operational-"+unique,18072,1500));
      assert.equal(active.plan_digest,planDigest(plan));
      assert.deepEqual(coordinator.trustedOperationalAuthority().permissions,
        [{operation:"run_tests",resource:branchUri}]);
      activeRootId=active.credential_id;
    }else{
      assert.equal(await registry.activate(sessionId,mainSha),planDigest(plan));
    }
    const taskId="dispatch_"+randomBytes(16).toString("base64url");
    if(coordinator)await coordinator.bindDispatchedTask("verify",taskId,"test");
    else registry.bindTask(sessionId,"verify",taskId,"test");
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
      verifier:native?loadDirectCoreRustVerifier():{
        async verify(request){
          assert.equal(request.presenter,"test");
          return {
            presenter_id:TEST_DID,issuer_id:"did:thesis:orchestrator",
            credential_id:"urn:scoped:runner-fixture",
            permissions:[request.required_permission],hierarchy_depth:1,
            expiration:new Date(Date.now()+30*60*1000).toISOString()
          };
        }
      },
      // Real Rego evaluation in an isolated OPA Docker service.
      // The immutable plan digest/branch are injected by Gateway, NOT A2A.
      policy:new OpaPolicyClient({baseUrl:opaBaseUrl,timeoutMs:5000})
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
    const childId=native?"urn:native:positive-test-"+unique:
      "urn:fixture:scoped-test-child";
    const childInput=nativeCredential(childId,18073,1200);
    const scopedIssuer=native?
      await TrustedApprovedPlanChildAuthorityIssuer.create({
        approvals,coordinator,sessionId,engineerDid:DID,
        adapterBaseUrl:ADAPTER_BASE,
        bearerToken:nativeEnv("ADAPTER_CALLER_ORCHESTRATOR"),
        timeoutMs:30000
      }):null;
    let used=false,completed=false,observedA2ATaskId=null,
      observedPolicyVersion=null,observedNativeVerifier=false;
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
        // A real A2A SDK client sends a protected Test Task to a local
        // dedicated Agent server; ONLY its taskHandler may invoke Gateway.
        // The issuer below is a TEST FIXTURE: this suite does not claim a
        // Rust-signed child. The native EVM suite covers that separately.
        const probe=createPortProbe();
        await new Promise((resolve,reject)=>{
          probe.once("error",reject);
          probe.listen(0,"127.0.0.1",resolve);
        });
        const a2aPort=probe.address().port;
        await new Promise(resolve=>probe.close(resolve));
        let a2aServer;
        let observedExecution;
        try{
          a2aServer=await startSpecializedAgentServer({
            role:"test",port:a2aPort,host:"127.0.0.1",
            delegatedAuthorization:true,
            taskHandler:async context=>{
              assert.equal(context.role,"test");
              assert.equal(context.trusted_gateway_task_id,taskId);
              assert.equal(context.subtask.subtask_id,"verify");
              assert.equal(context.subtask.branch,BRANCH);
              assert.deepEqual(context.subtask.relevant_paths,[]);
              assert.equal(context.delegation_evidence.presenter_id,TEST_DID);
              assert.equal(context.delegation_evidence.credential_id,childId);
              const credential=JSON.parse(context.delegation_evidence.credential);
              assert.deepEqual(credential.credentialSubject.per,[{
                operation:"run_tests",resource:branchUri
              }]);
              const signedVp=native?await adapterPresentation(
                childId,{operation:"run_tests",resource:branchUri},prepared
              ):"offline-fixture-verifier";
              const authorized=await gateway.execute({
                request_id:prepared.request_id,signed_vp:signedVp
              });
              if(native){
                assert.equal(authorized.verified_delegation.presenter_id,TEST_DID);
                assert.equal(authorized.verified_delegation.credential_id,childId);
                assert.deepEqual(authorized.verified_delegation.permissions,
                  [{operation:"run_tests",resource:branchUri}]);
                observedNativeVerifier=true;
              }
              assert.equal(authorized.policy.allow,true);
              assert.equal(authorized.policy.policy_version,
                "phase6-approved-branch-v2");
              assert.equal(authorized.execution.provider,"runner");
              const effect=authorized.execution;
              assert.equal(effect.status,"pass");
              assert.equal(effect.tested_commit_sha,featureSha);
              assert.equal(effect.project_tests?.status,"pass");
              assert.equal(effect.researcher_acceptance?.status,"pass");
              observedExecution=effect;
              observedPolicyVersion=authorized.policy.policy_version;
              return {
                role:"test",
                summary:"Observed real Docker Runner and researcher acceptance",
                files_modified:[],files_created:[],branch:BRANCH,
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
          const roleRunner=new DelegatedA2ARoleRunner({
            authorityIssuer:scopedIssuer??{
              async issueSpecializedChild(input){
                assert.equal(input.parent_credential_id,
                  "urn:fixture:operational-root");
                assert.equal(input.credential_id,"urn:fixture:scoped-test-child");
                assert.equal(input.selection.role,"test");
                assert.equal(input.approved_task_id,"verify");
                return {role:"test",credential:{
                  "@context":["https://www.w3.org/ns/credentials/v2"],
                  id:input.credential_id,
                  type:["VerifiableCredential","DelegationCredential"],
                  issuer:"did:thesis:orchestrator",
                  validFrom:input.valid_from,
                  credentialSubject:{sub:TEST_DID,per:[
                    {operation:"run_tests",resource:branchUri}
                  ]}
                }};
              }
            },
            a2a:new DeterministicA2AOrchestrator({
              deadlineMs:24*60*1000,initialIntervalMs:50,
              maxIntervalMs:250
            })
          });
          const outcome=await roleRunner.issueAndRun({
            role:"test",
            ...childInput,
            parent_credential_id:activeRootId,
            agent_base_url:a2aServer.baseUrl,
            trusted_gateway_task_id:taskId,
            approved_task_id:"verify",
            subtask:{
              subtask_id:"verify",
              instruction:"Run pinned approved Test Task and independent acceptance",
              branch:BRANCH,relevant_paths:[]
            }
          });
          observedA2ATaskId=outcome.task_id;
          assert.notEqual(outcome.task_id,taskId);
          assert.equal(outcome.artifact.tested_commit_sha,featureSha);
          assert.deepEqual(outcome.artifact.files_created,[]);
          const observation=observedA2ACompletion(outcome,taskId);
          if(coordinator)await coordinator.confirmTask(taskId,observation);
          else await registry.confirmTaskCompletion(taskId,observation);
        }finally{
          if(a2aServer)await a2aServer.close();
        }
        if(!observedExecution)throw Error("No corroborated Runner provider effect");
        const result=observedExecution;
        completed=true;
        if(coordinator)await coordinator.closeExecution();
        else registry.closeSession(sessionId);
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
      get observedA2ATaskId(){return observedA2ATaskId;},
      get observedPolicyVersion(){return observedPolicyVersion;},
      get nativeCredentialVerified(){return observedNativeVerifier;},
      async close(){
        if(!completed){
          if(coordinator?.phase==="execution"){
            // Never swallow uncertain revocation of a real operational root.
            await coordinator.closeExecution();
          }else{
            try{registry.closeSession(sessionId);}catch{}
          }
        }
        if(server?.listening)await new Promise(resolve=>server.close(resolve));
        await rm(privateRoot,{recursive:true,force:true});
      }
    };
  }catch(error){
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    if(coordinator?.phase==="execution")await coordinator.closeExecution();
    else if(registry){try{registry.closeSession(sessionId);}catch{}}
    await rm(privateRoot,{recursive:true,force:true});
    throw error;
  }
}
