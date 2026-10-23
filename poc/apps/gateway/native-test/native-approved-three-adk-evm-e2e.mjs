/**
 * THREE native Rust-scoped Agent credentials, one Engineer-signed DAG,
 * three real Google ADK runners and A2A HTTP servers, Core Rust VP verification
 * and live OPA policy. Isolated provider effect emulator only: NO Gitea/Docker.
 * Runs in EVM CI after the native Rust Core/Adapter and Anvil are provisioned.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:net";
import {BaseLlm} from "@google/adk";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {SignedEngineerApprovalFileStore} from "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedApprovedExecutionPlans} from "../src/approved-execution-plans.ts";
import {GatewayCorroboratedTaskAttestor} from "../src/trusted-task-observation.ts";
import {GatewayRuntime} from "../src/runtime.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";
import {OpaPolicyClient} from "../src/policy-client.ts";
import {SoftwareEngineerAuthorityBootstrap} from "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {TrustedEngineerAuthoritySession} from "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedApprovedA2ADispatcher} from "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {DeterministicA2AOrchestrator} from "../../../packages/agent-runtime/src/orchestrator.ts";
import {startSpecializedAgentServer} from "../../../packages/agent-runtime/src/server.ts";
import {TrustedAdkReadOnlyPlanner} from "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {TrustedPlanningGatewayReadPort} from "../../../packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts";
import {TrustedPlanningReviewGate} from "../../../packages/orchestrator-runtime/src/trusted-planning-review-gate.ts";
import {signTrustedPlanningCheckpoint,stageVerifiedPlanningCheckpoint}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-checkpoint.ts";
import {TrustedPlanningRevisions} from "../src/planning-revisions.ts";
import {GiteaReadOnlyExecutor} from "../src/gitea-read-executor.ts";
import {InMemoryAuditSink} from "../src/prepare.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const root="gitea://gitea.local/thesis/iam-console-poc";
const branch="feature/approved-native-adk";
const branchUri=root+"/branches/"+encodeURIComponent(branch);
const paths={
  backend:"apps/backend/src/users/user.service.ts",
  frontend:"apps/frontend/src/pages/UserDetailPage.tsx"
};
const agents=["backend","frontend","test"];
const did={};
for(const role of ["engineer",...agents]){
  did[role]=process.env["ADAPTER_ID_"+role.toUpperCase()];
  if(!did[role]?.startsWith("did:"))throw Error("Missing native EVM Agent DID: "+role);
}
for(const role of ["ENGINEER","ORCHESTRATOR",...agents.map(x=>x.toUpperCase())]){
  if(!process.env["ADAPTER_CALLER_"+role])throw Error("Missing native Adapter bearer: "+role);
}
if(process.env.ADAPTER_TRUST_PROFILE!=="evm")
  throw Error("This three-role test requires native EVM trust, never fixture fallback");
const adapter="http://127.0.0.1:8090";
const opa=process.env.OPA_URL??"http://127.0.0.1:8181";
const initial="a".repeat(40);
const revisions=["b".repeat(40),"c".repeat(40)];
function credential(id,index,validity=1200){
  return {credential_id:id,valid_from:new Date(Date.now()-1000).toISOString(),
    validity_seconds:validity,credential_status:{
      type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListIndex:String(index),
      statusListCredential:"https://status.example/lists/three-agent-native-e2e"
    }};
}
/** Scripted LLM *intent* only: the real ADK Planner compiles and validates
 * this into the canonical permission/resource DAG after source inspection. */
function planningSketch(){
  return {tasks:[
    {id:"backend",agent_id:"backend",title:"Scoped backend update",
      description:"Update the exact approved backend service",depends_on:[],
      permissions:[{operation:"update_file",path:paths.backend,
        reason:"Approved backend edit"}]},
    {id:"frontend",agent_id:"frontend",title:"Scoped frontend update",
      description:"Update the exact approved frontend page",
      depends_on:["backend"],permissions:[{operation:"update_file",
        path:paths.frontend,reason:"Approved frontend edit"}]},
    {id:"tests",agent_id:"test",title:"Pinned controlled tests",
      description:"Verify the exact approved branch",depends_on:["frontend"],
      permissions:[{operation:"run_tests",path:null,
        reason:"Approved test profile"}]}
  ],assumptions:[],uncertainties:[]};
}
class NativePlanningModel extends BaseLlm {
  turns=0;requests=[];
  constructor(){super({model:"native-offline-ADK-planner-script"});}
  async *generateContentAsync(request){
    this.requests.push(request);this.turns++;
    if(this.turns===1)yield {content:{role:"model",parts:[{
      functionCall:{id:"pinned-backend-source",name:"read_file",
        args:{branch:"main",path:paths.backend}}
    }]}};
    else yield {content:{role:"model",parts:[{
      text:JSON.stringify(planningSketch())
    }]}};
  }
  connect(){return Promise.reject(Error("External Gemini prohibited in native CI"));}
}
class OfflineAdkModel extends BaseLlm {
  turns=0;requests=[];tool;args;
  constructor(tool,args){super({model:"offline-native-three-adk-script"});
    this.tool=tool;this.args=args;}
  async *generateContentAsync(request){
    this.requests.push(request);this.turns++;
    if(this.turns===1)yield {content:{role:"model",parts:[{
      functionCall:{id:"native-offline-call",name:this.tool,args:this.args}
    }]}};
    else yield {content:{role:"model",parts:[{text:"Provider-confirmed operation."}]}};
  }
  connect(){return Promise.reject(Error("Paid inference disabled"));}
}
async function freePort(){
  const s=createServer();
  await new Promise((ok,fail)=>{
    s.once("error",fail);s.listen(0,"127.0.0.1",ok);
  });
  const n=s.address().port;
  await new Promise(ok=>s.close(ok));
  return n;
}
const response=(x,status=200)=>new Response(JSON.stringify(x),{
  status,headers:{"content-type":"application/json"}
});
async function executeScenario({wrongBackend=false,seed}){
  const session="native-adk-"+randomBytes(7).toString("hex");
  // This plan does not exist yet: only the independently authorized
  // preliminary read-only Planning root may precede the ADK proposal.
  let approved;
  const dir=await mkdtemp(join(tmpdir(),"native-three-adk-"));
  const servers=[];
  let coordinator,phase="initial",effectCount=0,expectedRevision=initial;
  const observations=[];
  try{
    const {privateKey,publicKey}=generateKeyPairSync("ed25519");
    const keyId="native-adk-engineer-key";
    const approvals=new SignedEngineerApprovalFileStore({
      directory:dir,engineerDid:did.engineer,
      trustedKeys:{[keyId]:{engineer_did:did.engineer,
        public_key_pem:publicKey.export({format:"pem",type:"spki"}).toString()}}
    });
    const authorityClient=new SoftwareEngineerAuthorityBootstrap({
      adapterBaseUrl:adapter,bearerToken:process.env.ADAPTER_CALLER_ENGINEER,
      timeoutMs:30_000
    });
    const snapshot={session_id:session,repository:repo,base_revision:initial,
      directories:["","apps","apps/backend","apps/backend/src",
        "apps/backend/src/users","apps/frontend","apps/frontend/src",
        "apps/frontend/src/pages"],
      files:[paths.backend,paths.frontend]
    };
    const pinnedGitea={
      async readRepository(){
        return {full_name:"thesis/iam-console-poc",default_branch:"main",
          revision:initial};
      },
      async readTextFile(name,path,revision){
        assert.equal(name,"main");assert.equal(revision,initial);
        assert.ok(snapshot.files.includes(path));
        const content="export const nativePlanningSource = true;\n";
        return {branch:name,path,revision,content,blob_sha:"f".repeat(40),
          last_commit_sha:initial,size:Buffer.byteLength(content),
          encoding:"utf-8"};
      },
      async listDirectory(name,path,revision){
        assert.equal(name,"main");assert.equal(revision,initial);
        assert.ok(snapshot.directories.includes(path));
        return {branch:name,path,revision,entries:[]};
      }
    };
    const planningRevisions=new TrustedPlanningRevisions(pinnedGitea);
    const gate=new TrustedPlanningReviewGate({
      snapshot,expectedWorkBranch:branch,
      authenticatedEngineerDid:did.engineer,signedApprovals:approvals,
      planningIsActive:()=>coordinator?.phase==="planning"
    });
    const registry=new TrustedApprovedExecutionPlans({
      repository:repo,engineerDid:did.engineer,approvals:gate,
      completionAttestor:new GatewayCorroboratedTaskAttestor()
    });
    const authority=new TrustedEngineerAuthoritySession({
      snapshot,credentials:authorityClient,approvals:gate,
      authenticatedEngineerDid:did.engineer,planningRevisions
    });
    coordinator=new TrustedExecutionCoordinator({
      authority,approvedGatewayPlans:registry,credentials:authorityClient,
      sessionId:session,baseRevision:initial
    });
    const unique=randomBytes(5).toString("hex");
    const planIssued=await coordinator.beginPlanning(credential(
      "urn:native:three-plan-"+unique,seed,180));
    assert.equal(planIssued.phase,"planning");
    const backendFile=paths.backend,frontendFile=paths.frontend;
    const planningAudit=new InMemoryAuditSink();
    const readOnlyExecutor=new GiteaReadOnlyExecutor(pinnedGitea);
    // The provider simulator emits structurally authentic Gitea/Runner
    // results, but DOES NOT perform Gitea or Docker I/O.
    const gateway=new GatewayRuntime({
      bind_host:"127.0.0.1",bind_port:0,
      prepare:{audience:"cloud-access-gateway",request_ttl_ms:600_000,
        repository:repo},
      opa_url:opa,opa_timeout_ms:5000,
      provider_mode:"mock",gitea_timeout_ms:20000
    },{
      approvedPlans:registry,planningRevisions,audit:planningAudit,
      verifier:loadDirectCoreRustVerifier(),
      policy:new OpaPolicyClient({baseUrl:opa,timeoutMs:5000}),
      executor:{
        provider:"gitea",
        providerFor:r=>r.request.tool==="run_tests"?"runner":"gitea",
        async execute(record){
          const {tool,arguments:args}=record.request;
          if(["read_repository","list_directory","read_file"].includes(tool))
            return readOnlyExecutor.execute(record);
          if(args.branch!==branch)throw Error("Provider denied alternate branch");
          let result;
          if(tool==="update_file"&&args.path===backendFile&&
             expectedRevision===initial){
            expectedRevision=revisions[0];
            result={provider:"gitea",performed:true,tool,branch,
              path:args.path,revision:expectedRevision,commit_sha:expectedRevision,
              blob_sha:"d".repeat(40),precondition_blob_sha:"e".repeat(40)};
          }else if(tool==="update_file"&&args.path===frontendFile&&
                   expectedRevision===revisions[0]){
            expectedRevision=revisions[1];
            result={provider:"gitea",performed:true,tool,branch,
              path:args.path,revision:expectedRevision,commit_sha:expectedRevision,
              blob_sha:"d".repeat(40),precondition_blob_sha:"e".repeat(40)};
          }else if(tool==="run_tests"&&expectedRevision===revisions[1]){
            result={provider:"runner",performed:true,tool,branch,
              revision:expectedRevision,tested_commit_sha:expectedRevision,
              runner_profile:"poc-default",status:"pass",phases:[],
              project_tests:{status:"pass",phases:[]},
              researcher_acceptance:{phase:"researcher_acceptance",status:"pass"}};
          }else throw Error("Provider rejected unknown Task or missing dependency");
          effectCount++;
          observations.push({task:record.approved_plan_task_id,tool});
          return result;
        }
      }
    });
    const fetchFn=async(url,options)=>{
      if(String(url).startsWith(adapter+"/"))return fetch(url,options);
      const path=String(url);
      let body=JSON.parse(String(options.body));
      try{
        if(path.endsWith("/v1/authorization/prepare"))
          return response(gateway.prepare(body),201);
        if(path.endsWith("/v1/authorization/execute")){
          const x=await gateway.execute(body);
          assert.equal(x.policy.allow,true);
          if(x.execution.tool==="read_file"&&x.execution.branch==="main"){
            assert.equal(x.verified_delegation.presenter_id,
              process.env.ADAPTER_ID_ORCHESTRATOR);
            return response(x);
          }
          assert.equal(x.policy.policy_version,"phase6-approved-branch-v2");
          assert.equal(x.verified_delegation.presenter_id,
            did[x.execution.tool==="run_tests"?"test":
              x.execution.path===backendFile?"backend":"frontend"]);
          return response(x);
        }
        throw Error("Unknown private Gateway route");
      }catch(error){
        return response({error:"Protected Gateway authorization rejected"},
          error.status??403);
      }
    };
    // The actual production Planning port crosses Gateway Prepare, the
    // Rust Adapter's signed VP, native Core Rust verification and live OPA.
    // Gitea source is pinned but fixture-backed in this native-only job.
    const plannerModel=new NativePlanningModel();
    const readPort=new TrustedPlanningGatewayReadPort({
      coordinator,snapshot,
      gatewayBaseUrl:"http://native-embedded-gateway",
      adapterBaseUrl:adapter,
      adapterToken:process.env.ADAPTER_CALLER_ORCHESTRATOR,
      timeoutMs:30_000,fetchFn
    });
    const draft=await new TrustedAdkReadOnlyPlanner({
      model:plannerModel,snapshot,workBranch:branch,
      requirement:"Complete three approved specialist Tasks with verified Rust DC",
      planId:"native-three-agent-planned",
      agents:Object.fromEntries(agents.map(role=>[role,{
        did:did[role],card_ref:"trusted:"+role
      }])),
      readPort
    }).propose();
    assert.equal(draft.status,"unapproved_proposal");
    assert.equal(draft.verified_source_reads,1);
    assert.equal(plannerModel.requests.length,2);
    assert.equal(planningAudit.events.filter(e=>
      e.event==="authorization_executed").length,1);
    approved=draft.plan;
    assert.deepEqual(approved.tasks.map(t=>t.id),
      ["backend","frontend","tests"]);
    // The Planning backend and Engineer use INDEPENDENT signing keys.
    const planningKeys=generateKeyPairSync("ed25519");
    const checkpointAt=new Date();
    const checkpoint=signTrustedPlanningCheckpoint({
      snapshot,expectedWorkBranch:branch,proposal:draft,
      keyId:"native-planning-backend",
      privateKeyPem:planningKeys.privateKey.export({
        format:"pem",type:"pkcs8"
      }).toString(),
      issuedAt:checkpointAt.toISOString(),
      expiresAt:new Date(checkpointAt.getTime()+600_000).toISOString()
    });
    const staged=stageVerifiedPlanningCheckpoint(gate,checkpoint,{
      trustedKeys:{"native-planning-backend":{
        public_key_pem:planningKeys.publicKey.export({
          format:"pem",type:"spki"
        }).toString()
      }},
      expectedSessionId:session,expectedRepository:repo,
      expectedBaseRevision:initial,expectedWorkBranch:branch
    });
    assert.equal(staged.plan_digest,planDigest(approved));
    assert.equal(staged.status,"awaiting_engineer_signature");
    await assert.rejects(gate.loadAuthenticatedApproval(session));
    const now=new Date(),decision=makeApproval(approved,{
      allowedOperations:new Set(RUST_OPERATIONS),
      decision_id:"native-adk-approval-"+session,
      approved_by:did.engineer,approved_at:now.toISOString(),
      approved_permission_ids:approved.requested_permissions.map(x=>x.id)
    });
    const signed=signEngineerApproval({
      plan:approved,approval:decision,engineerDid:did.engineer,keyId,
      privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}).toString(),
      issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+20*60_000).toISOString()
    });
    await writeFile(join(dir,session+".json"),
      JSON.stringify(signed),{mode:0o600});
    const trusted=await gate.loadAuthenticatedApproval(session);
    assert.equal(planDigest(trusted.plan),draft.digest);
    const operational=await coordinator.beginExecution(credential(
      "urn:native:three-root-"+unique,seed+1,1200));
    assert.equal(operational.plan_digest,draft.digest);
    assert.deepEqual(coordinator.trustedOperationalAuthority().permissions,
      approved.requested_permissions.map(x=>({
        operation:x.operation,resource:x.resource
      })));
    phase="execution";
    const urls={},models={};
    const specs={
      backend:{tool:"update_file",args:{branch,
        path:wrongBackend?frontendFile:backendFile,content:"approved-backend"}},
      frontend:{tool:"update_file",args:{branch,
        path:frontendFile,content:"approved-frontend"}},
      test:{tool:"run_tests",args:{branch,profile:"poc-default"}}
    };
    for(const role of agents){
      models[role]=new OfflineAdkModel(specs[role].tool,specs[role].args);
      const server=await startSpecializedAgentServer({
        role,port:await freePort(),host:"127.0.0.1",
        delegatedAuthorization:true,
        adk:{model:models[role],gatewayBaseUrl:"http://native-embedded-gateway",
          adapterBaseUrl:adapter,
          adapterToken:process.env["ADAPTER_CALLER_"+role.toUpperCase()],
          maxModelTurns:3,maxModelCallMs:30_000,gatewayTimeoutMs:30_000,
          fetchFn}
      });
      servers.push(server);urls[role]=server.baseUrl;
    }
    const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
      approvals:gate,coordinator,sessionId:session,
      expectedEngineerDid:did.engineer,
      expectedPlanDigest:planDigest(approved),baseRevision:initial,
      agentBaseUrls:urls,
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:180_000,initialIntervalMs:50,maxIntervalMs:200
      }),
      adapter:{adapterBaseUrl:adapter,
        bearerToken:process.env.ADAPTER_CALLER_ORCHESTRATOR,timeoutMs:30_000},
      async authorityForTask(id,role){
        assert.equal(id,role==="test"?"tests":role);
        return {
          ...credential("urn:native:three-child-"+unique+"-"+role,
            seed+2+agents.indexOf(role),900),
          parent_credential_id:operational.credential_id
        };
      }
    });
    if(wrongBackend){
      await assert.rejects(dispatcher.executeApprovedDag(),
        /Protected A2A task ended without completion|ADK|failed/);
      assert.deepEqual(dispatcher.completedTaskIds,[]);
      assert.equal(effectCount,0);
      assert.equal(coordinator.phase,"closed");
    }else{
      const result=await dispatcher.executeApprovedDag();
      assert.deepEqual(result.completed_task_ids,["backend","frontend","tests"]);
      assert.deepEqual(result.specialized_results.map(x=>x.role),agents);
      assert.equal(effectCount,3);
      assert.deepEqual(observations.map(x=>x.tool),
        ["update_file","update_file","run_tests"]);
      assert.equal(expectedRevision,revisions[1]);
      assert.equal(coordinator.phase,"closed");
      for(const role of agents){
        assert.equal(models[role].requests.length,2);
        const raw=JSON.stringify(models[role].requests);
        assert.ok(!raw.includes("ADAPTER_CALLER_"));
        assert.ok(!raw.includes("delegation_evidence"));
        assert.ok(!raw.includes("urn:native:three-child-"));
      }
    }
    console.log(JSON.stringify({
      event:"three_native_adk_a2a_dag",
      mode:wrongBackend?"forbidden_backend":"positive",
      roles:agents,native_signed_vp:true,opa_real:true,
      adk_planning:true,checkpoint_ed25519_verified:true,
      planning_read_gitea:"pinned_fixture",
      native_planning_gateway_ops:1,
      a2a_sdk_real:true,provider:"emulated",
      effects:effectCount,session_closed:coordinator.phase==="closed",
      paid_inference:false
    }));
  }finally{
    for(const server of servers.reverse()){
      try{await server.close();}catch{}
    }
    if(coordinator?.phase==="execution")await coordinator.closeExecution();
    await rm(dir,{recursive:true,force:true});
  }
}
await executeScenario({seed:19171});
await executeScenario({wrongBackend:true,seed:19181});
