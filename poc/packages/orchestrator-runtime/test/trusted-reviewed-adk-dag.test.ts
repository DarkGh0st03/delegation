/**
 * R2 composition gate: actual ADK planner -> backend Ed25519 checkpoint ->
 * independently signed Engineer subset -> real trusted Coordinator +
 * approved Gateway -> all three signed-plan DAG roles.
 *
 * This suite intentionally scripts MODEL DECISIONS ONLY. The child DC issuer,
 * Rust VP verifier, OPA service and Gitea/Docker effects are bounded fixtures.
 * It is not the final real-infrastructure R3 end-to-end test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomInt} from "node:crypto";
import {mkdtemp,mkdir,readdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {
  BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection
} from "@google/adk";
import {makeApproval,planDigest} from "../../plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans}
  from "../../../apps/gateway/src/approved-execution-plans.ts";
import {GatewayRuntime} from "../../../apps/gateway/src/runtime.ts";
import {InMemoryAuditSink} from "../../../apps/gateway/src/prepare.ts";
import {TrustedAdkReadOnlyPlanner} from "../src/trusted-adk-planner.ts";
import {TrustedPlanningReviewGate} from "../src/trusted-planning-review-gate.ts";
import {SignedEngineerApprovalFileStore}
  from "../src/signed-approval-store.ts";
import {
  signTrustedPlanningCheckpoint,stageVerifiedPlanningCheckpoint
} from "../src/trusted-planning-checkpoint.ts";
import {TrustedEngineerAuthoritySession} from "../src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "../src/trusted-execution-coordinator.ts";
import {TrustedApprovedA2ADispatcher}
  from "../src/trusted-approved-a2a-dispatcher.ts";
import {createTrustedReviewedHandoffLifecycle}
  from "../../../apps/orchestrator/src/trusted-reviewed-handoff-lifecycle.mjs";
import {createTrustedApprovedBranchGateway}
  from "../src/trusted-approved-branch-gateway.ts";
import {createTrustedApprovedTaskAuthorityAllocator}
  from "../src/trusted-approved-task-authority.ts";
import {DelegatedA2ARoleRunner}
  from "../src/a2a-workflow.ts";
import {startSpecializedAgentServer}
  from "../../agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator}
  from "../../agent-runtime/src/orchestrator.ts";

const SHA="a".repeat(40),ENGINEER="did:thesis:engineer";
const REPO={authority:"gitea.local",owner:"thesis",repository:"projects"};
const AGENTS={
  backend:{did:"did:thesis:backend",card_ref:"trusted:backend"},
  frontend:{did:"did:thesis:frontend",card_ref:"trusted:frontend"},
  test:{did:"did:thesis:test",card_ref:"trusted:test"}
};
function keypair(){
  const p=generateKeyPairSync("ed25519");
  return {
    privateKey:p.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:p.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
function root(id:string,index:string){
  return {credential_id:id,valid_from:new Date().toISOString(),
    validity_seconds:300,credential_status:{
      type:"BitstringStatusListEntry" as const,
      statusPurpose:"revocation" as const,
      statusListIndex:index,
      statusListCredential:"https://example.test/status/r2"
    }};
}
type Scenario={name:string;branch:string;requirement:string;
  backend:string;frontend:string;created:string};
const SCENARIOS:Scenario[]=[
  {name:"invoice",branch:"feature/invoice-sort",
    requirement:"Sort invoices by due date and display sorted totals",
    backend:"src/invoice.ts",frontend:"src/invoice-ui.ts",
    created:"src/invoice.test.ts"},
  {name:"audit",branch:"feature/audit-dashboard",
    requirement:"Summarize audit events and render a dashboard counter",
    backend:"src/audit.ts",frontend:"src/audit-ui.ts",
    created:"src/audit.test.ts"}
];
function sketch(x:Scenario,withPullRequest=false){
  return {tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Isolate implementation",
      description:"Create the exact approved feature branch from main",
      depends_on:[],permissions:[{operation:"create_branch",path:null,
        reason:"Protect the main branch"}]},
    {id:"backend",agent_id:"backend",title:"Implement service",
      description:"Implement the requested backend calculation",
      depends_on:["branch"],permissions:[
        {operation:"read_file",path:x.backend,reason:"Understand the existing service"},
        {operation:"update_file",path:x.backend,reason:"Implement the change"}]},
    {id:"frontend",agent_id:"frontend",title:"Update display",
      description:"Show the changed service output in the UI",
      depends_on:["backend"],permissions:[
        {operation:"update_file",path:x.frontend,reason:"Update the UI"}]},
    {id:"tests",agent_id:"test",title:"Verify the change",
      description:"Create an exact regression and run the controlled test profile",
      depends_on:["frontend"],permissions:[
        {operation:"create_file",path:x.created,reason:"Add requested regression"},
        {operation:"run_tests",path:null,reason:"Confirm implementation"}]},
    ...(withPullRequest?[{
      id:"pr",agent_id:"orchestrator",title:"Request human review",
      description:"Open a Pull Request only after successful trusted tests",
      depends_on:["tests"],
      permissions:[{
        operation:"create_pull_request",path:null,
        reason:"Submit the signed, acceptance-tested feature for review"
      }]
    }]:[])
  ],assumptions:[],uncertainties:[]};
}
class ScriptedPlanningModel extends BaseLlm{
  turns=0;
  readonly x:Scenario;
  readonly withPullRequest:boolean;
  readonly readSteps:number;
  constructor(x:Scenario,withPullRequest=false,readSteps=1){
    super({model:"scripted-r2-planning-only"});
    this.x=x;
    this.withPullRequest=withPullRequest;
    this.readSteps=readSteps;
  }
  override async *generateContentAsync(_req:LlmRequest):
    AsyncGenerator<LlmResponse,void>{
    this.turns++;
    if(this.turns<=this.readSteps){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"read-approved-source-"+this.turns,name:"read_file",
        args:{branch:"main",path:this.turns===1?this.x.backend:
          this.turns===2?this.x.frontend:"src/planning-context-"+this.turns+".ts"}
      }}]}};
      return;
    }
    yield {content:{role:"model",parts:[{text:JSON.stringify(sketch(this.x,this.withPullRequest))}]}};
  }
  override connect(_req:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(Error("No Gemini or provider model calls in R2"));
  }
}
async function exercise(
  x:Scenario,partial=false,cancelBeforeFrontend=false,
  ownerLifecycle=false,realHttpA2A=false,withPullRequest=false,
  missingRunnerAcceptance=false,planningReads=1,
  cancelDuringBackend=false
){
  const directory=await mkdtemp(join(tmpdir(),"trusted-r2-engineer-"));
  const servers:Array<{role:string;baseUrl:string;close:()=>Promise<void>;executor:any}>=[];
  try{
    const discoveryPaths=[
      x.backend,x.frontend,
      ...Array.from({length:Math.max(0,planningReads-2)},
        (_,i)=>"src/planning-context-"+(i+3)+".ts")
    ];
    const snapshot={session_id:"r2-"+x.name+(partial?"-partial":""),
      repository:REPO,base_revision:SHA,
      directories:["","src"],files:discoveryPaths};
    const engineerKeys=keypair(),backendKeys=keypair();
    const engineerStore=new SignedEngineerApprovalFileStore({
      directory,engineerDid:ENGINEER,
      trustedKeys:{"engineer-1":{
        engineer_did:ENGINEER,public_key_pem:engineerKeys.publicKey
      }}
    });
    const issued:string[]=[],revoked:string[]=[],events:string[]=[];
    const credentials={
      async issueScopedOrchestratorRoot(input:any){
        issued.push(input.credential_id);
        return {id:input.credential_id,credentialSubject:{
          per:structuredClone(input.permissions)
        }};
      },
      async revokeRoot(id:string){revoked.push(id);}
    };
    let coordinator!:TrustedExecutionCoordinator;
    const gate=new TrustedPlanningReviewGate({
      snapshot,expectedWorkBranch:x.branch,
      authenticatedEngineerDid:ENGINEER,signedApprovals:engineerStore,
      planningIsActive:()=>coordinator?.phase==="planning"
    });
    const authority=new TrustedEngineerAuthoritySession({
      snapshot,credentials,approvals:gate,
      authenticatedEngineerDid:ENGINEER
    });
    const approved=new TrustedApprovedExecutionPlans({
      repository:REPO,engineerDid:ENGINEER,approvals:gate,
      operationalLeaseMs:90_000,
      completionAttestor:{async confirmCompleted(proof){
        assert.ok(proof.successful_gateway_request_ids.length>0);
        assert.equal(proof.plan_digest,gate.reviewPacket().plan_digest);
        events.push("attest:"+proof.plan_task_id);
        return true;
      }}
    });
    coordinator=new TrustedExecutionCoordinator({
      authority,approvedGatewayPlans:approved,credentials,
      sessionId:snapshot.session_id,baseRevision:SHA
    });
    // Before Planning, neither model nor A2A can activate authority.
    assert.throws(()=>gate.reviewPacket(),/no staged proposal/);
    await coordinator.beginPlanning(root("urn:planning:"+x.name,"701"));
    const model=new ScriptedPlanningModel(x,withPullRequest,planningReads);
    const proposal=await new TrustedAdkReadOnlyPlanner({
      model,snapshot,requirement:x.requirement,
      planId:"plan-"+x.name,workBranch:x.branch,agents:AGENTS,
      maxModelTurns:96,maxOutputTokens:16384,maxPlanningMs:900000,
      thinkingLevel:"MEDIUM",
      readPort:{
        async invoke(tool,args){
          assert.equal(tool,"read_file");
          assert.equal(args.branch,"main");
          assert.equal(args.path,discoveryPaths[events.filter(e=>
            e.startsWith("planning-read:")).length]);
          events.push("planning-read:"+args.path);
          return {provider:"gitea",performed:true,tool,
            path:args.path,branch:"main",revision:SHA,
            content:"export const state = [];"};
        }
      }
    }).propose();
    assert.equal(proposal.verified_source_reads,planningReads);
    assert.equal(model.turns,planningReads+1);
    const pathsRead=events.filter(e=>e.startsWith("planning-read:"));
    assert.equal(pathsRead.length,planningReads);
    assert.equal(new Set(pathsRead).size,planningReads);
    assert.equal(proposal.plan.tasks.length,withPullRequest?5:4);
    assert.equal(proposal.plan.requirement,x.requirement);

    // Checkpoint signature is created by the trusted Planning backend key.
    const now=new Date();
    const checkpoint=signTrustedPlanningCheckpoint({
      snapshot,expectedWorkBranch:x.branch,proposal,
      keyId:"backend-1",privateKeyPem:backendKeys.privateKey,
      issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+600_000).toISOString()
    });
    const pinned={
      trustedKeys:{"backend-1":{public_key_pem:backendKeys.publicKey}},
      expectedSessionId:snapshot.session_id,
      expectedRepository:REPO,expectedBaseRevision:SHA,
      expectedWorkBranch:x.branch
    };
    const stage=stageVerifiedPlanningCheckpoint(gate,checkpoint,pinned);
    assert.equal(stage.plan_digest,proposal.digest);
    assert.equal(stage.status,"awaiting_engineer_signature");
    assert.throws(()=>stageVerifiedPlanningCheckpoint(gate,
      {...checkpoint,expected_work_branch:"feature/attacker"},pinned));
    await assert.rejects(gate.loadAuthenticatedApproval(snapshot.session_id));
    // The independent Engineer signs AFTER inspecting the exact staged plan.
    const allIds=proposal.plan.requested_permissions.map(p=>p.id);
    const subset=partial?allIds.filter(id=>!proposal.plan.requested_permissions.some(p=>
      p.id===id&&p.task_id==="tests")):allIds;
    const approvedAt=new Date();
    const decision=makeApproval(proposal.plan,{
      allowedOperations:new Set(RUST_OPERATIONS),
      decision_id:"decision-"+x.name+(partial?"-partial":""),
      approved_by:ENGINEER,approved_at:approvedAt.toISOString(),
      approved_permission_ids:subset
    });
    const receipt=signEngineerApproval({
      plan:proposal.plan,approval:decision,engineerDid:ENGINEER,
      keyId:"engineer-1",privateKeyPem:engineerKeys.privateKey,
      issuedAt:approvedAt.toISOString(),
      expiresAt:new Date(approvedAt.getTime()+600_000).toISOString()
    });
    await writeFile(join(directory,snapshot.session_id+".json"),
      JSON.stringify(receipt),{mode:0o600});
    const authenticated=await gate.loadAuthenticatedApproval(snapshot.session_id);
    assert.deepEqual(authenticated.approval.approved_permission_ids,subset);
    assert.deepEqual(issued,["urn:planning:"+x.name]);

    const activated=await coordinator.beginExecution(
      root("urn:execution:"+x.name,"702")
    );
    assert.equal(activated.plan_digest,proposal.digest);
    assert.deepEqual(issued,["urn:planning:"+x.name,"urn:execution:"+x.name]);
    assert.deepEqual(revoked,["urn:planning:"+x.name]);

    let providerCalls=0,opaCalls=0;
    const runtime=new GatewayRuntime({
      bind_host:"127.0.0.1",bind_port:0,
      prepare:{audience:"cloud-access-gateway",request_ttl_ms:120_000,
        repository:REPO},
      adapter_url:"http://unused",adapter_gateway_token:"unused",
      opa_url:"http://unused",opa_timeout_ms:1000,
      provider_mode:"mock",gitea_timeout_ms:1000
    },{
      approvedPlans:approved,audit:new InMemoryAuditSink(),
      executor:{
        provider:"gitea",
        providerFor(rec:any){
          return rec.request.tool==="run_tests"?"runner":"gitea";
        },
        async execute(rec:any){
          providerCalls++;
          const tool=rec.request.tool;
          events.push("provider:"+tool+":"+rec.task_id);
          if(tool==="run_tests")return {
            provider:"runner",performed:true,tool,branch:x.branch,
            revision:SHA,tested_commit_sha:SHA,runner_profile:"poc-default",
            status:"pass",phases:[],
            ...(withPullRequest&&!missingRunnerAcceptance?{
              project_tests:{status:"pass",phases:[]},
              researcher_acceptance:{
                status:"pass",phase:"researcher_acceptance"
              }
            }:{})
          };
          if(tool==="create_branch")return {
            provider:"gitea",performed:true,tool,branch:x.branch,
            base_branch:"main",revision:SHA,commit_sha:SHA
          };
          if(tool==="create_pull_request"){
            assert.equal(rec.request.arguments.head_branch,x.branch);
            assert.equal(rec.request.arguments.base_branch,"main");
            assert.match(rec.request.arguments.title,/^Approved software changes:/);
            events.push("trusted-pr-created");
            return {
              provider:"gitea",performed:true,tool,
              head_branch:x.branch,base_branch:"main",revision:SHA,
              pull_request_id:17,pull_request_number:23,
              url:"http://gitea.local/thesis/projects/pulls/23"
            };
          }
          return {
            provider:"gitea",performed:true,tool,
            branch:x.branch,path:rec.request.arguments.path,
            revision:SHA,commit_sha:SHA,
            blob_sha:"b".repeat(40),precondition_blob_sha:"c".repeat(40)
          };
        }
      } as any,
      verifier:{async verify(request){
        return {presenter_id:"did:thesis:"+request.presenter,
          issuer_id:ENGINEER,credential_id:"urn:mock:child",
          permissions:[request.required_permission],
          hierarchy_depth:1,expiration:"999999999999999999"};
      }},
      policy:{async evaluate(input){
        opaCalls++;
        assert.equal(input.approved_plan_digest,proposal.digest);
        return {allow:true,policy_version:"offline-r2"};
      }}
    });
    // Each provider effect uses normal Gateway Prepare + VP + OPA + Execute.
    async function invoke(runtimeId:string,role:any,tool:any,args:Record<string,unknown>){
      const prepared=runtime.prepare({
        task_id:runtimeId,agent_role:role,tool,arguments:args
      });
      const result=await runtime.execute({
        request_id:prepared.request_id,signed_vp:"offline-r2-vp"
      });
      assert.equal(result.execution.performed,true);
    }
    // Owner-only execution reserves real, durable Task Status List indices
    // BEFORE attempting child issuance or protected A2A. This exercises the
    // same authenticated allocator now wired into the trusted Engineer Host.
    const statusDir=join(directory,"r5-status");
    if(ownerLifecycle)await mkdir(statusDir,{mode:0o700});
    const children=ownerLifecycle
      ?await createTrustedApprovedTaskAuthorityAllocator({
        coordinator,reviewGate:gate,sessionId:snapshot.session_id,
        engineerDid:ENGINEER,reservationDirectory:statusDir,
        statusListCredential:"https://example.test/status/r5",
        excludedIndices:["701","702"],
        indexByTask:{backend:"8101",frontend:"8102",tests:"8103"},
        validitySeconds:300
      }):undefined;
    if(realHttpA2A){
      // Genuine A2A HTTP+JSON / agent-card + protected REST endpoints:
      // scripted PROVIDER effects only, no external Gemini or Gitea calls.
      const roles=["backend","frontend","test"] as const;
      const firstPort=43000+randomInt(100,3000)*3;
      for(let i=0;i<roles.length;i++){
        const role=roles[i]!;
        servers.push(await startSpecializedAgentServer({
          role,host:"127.0.0.1",port:firstPort+i,
          delegatedAuthorization:true,
          capabilityProfile:"approved-plan",
          taskHandler:async context=>{
            const sub=context.subtask;
            assert.equal(context.role,role);
            assert.equal(sub.branch,x.branch);
            assert.match(context.trusted_gateway_task_id??"",
              /^dispatch_[A-Za-z0-9_-]{22}$/u);
            assert.equal(context.delegation_evidence.credential_id.startsWith(
              "urn:task-child:"),true);
            events.push("a2a:"+role+":"+sub.subtask_id);
            if(cancelDuringBackend&&role==="backend"){
              // The operational DC is already issued and Backend has
              // received its real signed HTTP A2A request. The trusted
              // owner now terminates Gateway authority mid-flight.
              events.push("owner-shutdown:backend-in-flight");
              await coordinator.closeExecution();
              events.push("native-operational-root-retired");
              throw Error("trusted Engineer interrupted Backend A2A");
            }
            for(const grant of sub.approved_file_permissions??[]){
              if(grant.operation==="update_file"||grant.operation==="create_file"){
                await invoke(context.trusted_gateway_task_id!,role,
                  grant.operation,{
                    branch:x.branch,path:grant.path,
                    content:"export const r5_"+x.name+" = true;"
                  });
              }
            }
            if(role==="test"){
              await invoke(context.trusted_gateway_task_id!,"test","run_tests",{
                branch:x.branch,profile:"poc-default"
              });
            }
            return {
              role,branch:x.branch,revision:SHA,commit_sha:SHA,
              summary:"Offline A2A HTTP Task validated by Gateway",
              files_modified:role==="test"?[]:sub.relevant_paths,
              files_created:role==="test"?[x.created]:[],
              test_outcome:role==="test"?"pass":"not_run",
              errors:[],
              ...(role==="test"?{
                tested_commit_sha:SHA,runner_profile:"poc-default" as const,
                project_tests:"pass" as const,
                researcher_acceptance:"pass" as const
              }:{})
            };
          }
        }));
      }
    }
    const realRoleRunner=realHttpA2A
      ?new DelegatedA2ARoleRunner({
        authorityIssuer:{
          assertActiveBeforeA2ASend(){
            if(coordinator.phase!=="execution")
              throw Error("Operational root revoked before A2A");
          },
          async issueSpecializedChild(input){
            if(coordinator.phase!=="execution")
              throw Error("No approved root for A2A Task");
            // Offline VC fixture: the real Adapter/Rust crypto and
            // attenuation are independently checked in other CI jobs.
            return {
              role:input.selection.role,
              credential:{
                id:input.credential_id,
                credentialSubject:{
                  sub:"did:thesis:"+input.selection.role,
                  per:[]
                }
              } as any
            };
          }
        },
        a2a:{
          async sendProtectedTask(request){
            const client=new DeterministicA2AOrchestrator({
              deadlineMs:7000,initialIntervalMs:20,maxIntervalMs:80
            });
            const response=await client.sendProtectedTask(request);
            // Credential evidence and private preallocated Gateway IDs
            // stay server-side. The returned SDK Task must not carry them
            // in history, artifacts or A2A metadata.
            const serialized=JSON.stringify(response.task);
            assert.equal(serialized.includes(
              request.delegation_evidence.credential_id),false);
            assert.equal(serialized.includes(
              request.delegation_evidence.credential),false);
            assert.equal(serialized.includes(
              request.trusted_gateway_task_id??"must-not-occur"),false);
            assert.deepEqual(response.task.history,[]);
            return response;
          }
        }
      }):undefined;
    const dispatcher=await TrustedApprovedA2ADispatcher.load({
      approvals:gate,coordinator,sessionId:snapshot.session_id,
      expectedPlanDigest:proposal.digest,baseRevision:SHA,
      expectedEngineerDid:ENGINEER,
      agentBaseUrls:realHttpA2A
        ?{
          backend:servers.find(s=>s.role==="backend")!.baseUrl,
          frontend:servers.find(s=>s.role==="frontend")!.baseUrl,
          test:servers.find(s=>s.role==="test")!.baseUrl
        }:{
          backend:"http://127.0.0.1:11001",
          frontend:"http://127.0.0.1:11002",
          test:"http://127.0.0.1:11003"
        },
      async authorityForTask(id:string,role:any){
        events.push("child-issue:"+id+":"+role);
        if(children){
          const request=await children.authorityForTask(id,role);
          assert.equal(request.parent_credential_id,"urn:execution:"+x.name);
          assert.equal(request.credential_status.statusPurpose,"revocation");
          return request;
        }
        return root("urn:child:"+x.name+":"+id,
          String(800+events.length));
      },
      roleRunner:realRoleRunner??{async issueAndRun(input:any){
        const sub=input.subtask,role=input.role;
        events.push("a2a:"+role+":"+sub.subtask_id);
        assert.equal(sub.branch,x.branch);
        assert.match(input.trusted_gateway_task_id,/^dispatch_/);
        for(const grant of sub.approved_file_permissions){
          if(grant.operation==="update_file"||
             grant.operation==="create_file"){
            await invoke(input.trusted_gateway_task_id,role,grant.operation,{
              branch:x.branch,path:grant.path,
              content:"export const r2_" +x.name+" = true;"
            });
          }
        }
        if(role==="test")
          await invoke(input.trusted_gateway_task_id,"test","run_tests",{
            branch:x.branch,profile:"poc-default"
          });
        return {role,task_id:"sdk-"+x.name+"-"+role,
          artifact:{
            role,branch:x.branch,revision:SHA,commit_sha:SHA,
            files_modified:role==="test"?[]:sub.relevant_paths,
            files_created:role==="test"?[x.created]:[],
            test_outcome:role==="test"?"pass":"not_run",
            ...(role==="test"?{tested_commit_sha:SHA,runner_profile:"poc-default"}:{})
          }
        };
      }}
    });
    if(partial){
      await assert.rejects(dispatcher.executeApprovedDag({
        async invokeOrchestratorTask(){throw Error("should not run");}
      }),/Task without Engineer-granted permissions/);
      assert.equal(providerCalls,0);
      assert.equal(coordinator.phase,"execution");
      await coordinator.closeExecution();
      assert.equal(coordinator.phase,"closed");
      assert.equal(revoked.at(-1),"urn:execution:"+x.name);
      return;
    }
    const checkedTaskIds:string[]=[];
    // This owner-only path deliberately reuses the ACTUAL signed-plan
    // dispatcher and Gateway from above, rather than faking successful
    // software effects or constructing an unsigned plan at dispatch time.
    const owner=ownerLifecycle?createTrustedReviewedHandoffLifecycle(async input=>{
      assert.equal(input.session_id,snapshot.session_id);
      return {
        approvedDag:{
          executeApprovedDag:async (execution:any)=>
            dispatcher.executeApprovedDag({
              beforeTask:async id=>{
                checkedTaskIds.push(id);
                if(cancelBeforeFrontend&&id==="frontend")
                  throw Error("offline GitHub run canceled before Frontend");
              },
              invokeOrchestratorTask:execution.invokeOrchestratorTask
            })
        },
        close:()=>coordinator.closeExecution()
      };
    }):undefined;
    // Production-style branch write: derive the branch from the signed
    // review store, issue a scoped VP through the private Adapter transport,
    // then cross the ACTUAL Gateway prepare/OPA/execute boundary.
    // Only HTTP transport and cryptographic services are scripted here.
    let branchVpRequests=0;
    const branchProvider=owner?await createTrustedApprovedBranchGateway({
      coordinator,reviewGate:gate,sessionId:snapshot.session_id,
      baseRevision:SHA,engineerDid:ENGINEER,
      transport:{
        gatewayBaseUrl:"http://127.0.0.1:8080",
        adapterBaseUrl:"http://127.0.0.1:8090",
        adapterToken:"owner-offline-r2",timeoutMs:1000,
        fetchFn:async(request,options)=>{
          const url=String(request);
          const body=JSON.parse(String(options?.body));
          if(url.endsWith("/v1/authorization/prepare")){
            const p=runtime.prepare(body);
            return new Response(JSON.stringify(p),{status:200});
          }
          if(url.endsWith("/v1/presentations")){
            branchVpRequests++;
            assert.equal(options?.headers?.authorization,
              "Bearer owner-offline-r2");
            assert.equal(body.credential_id,"urn:execution:"+x.name);
            assert.ok(["create_branch","create_pull_request"].includes(
              body.disclosed_permissions[0]?.operation));
            return new Response(JSON.stringify({signed_vp:"offline-r2-vp"}),
              {status:200});
          }
          if(url.endsWith("/v1/authorization/execute")){
            const result=await runtime.execute(body);
            return new Response(JSON.stringify(result),{status:200});
          }
          throw Error("unapproved offline Gateway endpoint");
        }
      }
    }):undefined;
    const ownerInput={session_id:snapshot.session_id};
    const ownerExec={
      a2a:{},adapter:{},
      async authorityForTask(){throw Error("owner-only scoped issuer controls children");},
      invokeOrchestratorTask:branchProvider
        ?branchProvider.invokeOrchestratorTask
        :async (_task:string,id:string)=>{
          await invoke(id,"orchestrator","create_branch",{
            base_branch:"main",branch:x.branch
          });
        }
    };
    if(owner){
      // An unapproved Task ID or a fabricated SDK Task ID cannot force the
      // private Adapter to mint a VP or reach Gateway prepare.
      await assert.rejects(ownerExec.invokeOrchestratorTask(
        "frontend","dispatch_"+"a".repeat(22)
      ),/unapproved branch Task or Gateway binding/);
      await assert.rejects(ownerExec.invokeOrchestratorTask(
        "branch","attacker_sdk_task_1"
      ),/unapproved branch Task or Gateway binding/);
      assert.equal(branchVpRequests,0);
      assert.equal(providerCalls,0);
    }
    if(cancelDuringBackend){
      assert.ok(owner&&realHttpA2A);
      await assert.rejects(owner!.runApprovedDag(ownerInput,ownerExec));
      assert.equal(owner!.status,"closed");
      assert.equal(owner!.verifiedOutcome,"failed");
      assert.equal(coordinator.phase,"closed");
      await coordinator.assertOperationalClosureConfirmed();
      assert.deepEqual(revoked.slice(-2),[
        "urn:planning:"+x.name,"urn:execution:"+x.name
      ]);
      // Only creation of the approved feature branch succeeded before
      // Backend was interrupted; Frontend/Test/PR never reach Gateway.
      assert.equal(providerCalls,1);
      assert.equal(opaCalls,1);
      assert.equal(branchVpRequests,1);
      assert.deepEqual(servers.map(server=>server.executor.executionCount),
        [1,0,0]);
      assert.ok(events.includes("owner-shutdown:backend-in-flight"));
      assert.ok(events.includes("native-operational-root-retired"));
      assert.ok(!events.includes("trusted-pr-created"));
      assert.ok(!events.some(event=>event.startsWith("a2a:frontend")||
        event.startsWith("a2a:test")));
      await assert.rejects(owner!.runApprovedDag(ownerInput,ownerExec),
        /already attempted/);
      return;
    }
    if(cancelBeforeFrontend){
      if(owner){
        await assert.rejects(owner.runApprovedDag(ownerInput,ownerExec),
          /offline GitHub run canceled before Frontend/);
        assert.equal(owner.status,"closed");
        assert.equal(owner.verifiedOutcome,"failed");
        await assert.rejects(owner.runApprovedDag(ownerInput,ownerExec),
          /already attempted/);
      }else{
        await assert.rejects(dispatcher.executeApprovedDag({
          async beforeTask(id){
            checkedTaskIds.push(id);
            if(id==="frontend")throw Error("offline GitHub run canceled before Frontend");
          },
          invokeOrchestratorTask:ownerExec.invokeOrchestratorTask
        }),/offline GitHub run canceled before Frontend/);
      }
      assert.deepEqual(checkedTaskIds,["branch","backend","frontend"]);
      if(owner){
        assert.equal(branchProvider?.approvedBranch,x.branch);
        assert.equal(branchVpRequests,1);
        assert.equal((await readdir(statusDir)).length,1);
        await assert.rejects(ownerExec.invokeOrchestratorTask(
          "branch","dispatch_"+"a".repeat(22)
        ),/one-shot/);
      }
      // Only branch and Backend may have touched the real Gateway fixture.
      assert.equal(providerCalls,2);
      assert.equal(opaCalls,2);
      assert.equal(coordinator.phase,"closed");
      assert.deepEqual(revoked.slice(-2),[
        "urn:planning:"+x.name,"urn:execution:"+x.name
      ]);
      assert.ok(!events.some(event=>
        event.startsWith("a2a:frontend")||event.startsWith("a2a:test")));
      if(realHttpA2A){
        // Real HTTP Agent servers exist, but neither the Frontend nor
        // the Test Agent may receive a protected A2A request.
        assert.deepEqual(servers.map(s=>s.executor.executionCount),[1,0,0]);
        const trace=events.filter(event=>event.startsWith("a2a:"));
        assert.deepEqual(trace,["a2a:backend:backend"]);
      }
      return;
    }
    if(withPullRequest&&missingRunnerAcceptance){
      await assert.rejects(owner!.runApprovedDag(ownerInput,ownerExec),
        /PR requires a trusted|Gateway prepare is unavailable/i);
      assert.equal(owner!.verifiedOutcome,"failed");
      assert.equal(owner!.status,"closed");
      assert.equal(coordinator.phase,"closed");
      assert.deepEqual(revoked.slice(-2),[
        "urn:planning:"+x.name,"urn:execution:"+x.name
      ]);
      assert.equal(providerCalls,5);
      assert.equal(opaCalls,5);
      assert.equal(branchVpRequests,1); // PR rejected BEFORE signing its VP
      assert.equal((await readdir(statusDir)).length,3);
      assert.ok(!events.includes("trusted-pr-created"));
      assert.deepEqual(servers.map(s=>s.executor.executionCount),[1,1,1]);
      await assert.rejects(owner!.runApprovedDag(ownerInput,ownerExec),
        /already attempted/);
      return;
    }
    const done=owner
      ?await owner.runApprovedDag(ownerInput,ownerExec)
      :await dispatcher.executeApprovedDag({
        async beforeTask(id){checkedTaskIds.push(id);},
        invokeOrchestratorTask:ownerExec.invokeOrchestratorTask
      });
    if(owner){
      assert.equal(owner.status,"closed");
      assert.equal(owner.verifiedOutcome,"verified_complete");
      assert.equal(branchProvider?.approvedTaskId,"branch");
      assert.equal(branchProvider.approvedBranch,x.branch);
      assert.equal(branchVpRequests,withPullRequest?2:1);
      if(withPullRequest)
        assert.equal(branchProvider.approvedPullRequestTaskId,"pr");
      assert.equal((await readdir(statusDir)).length,3);
      await assert.rejects(owner.runApprovedDag(ownerInput,ownerExec),
        /already attempted/);
      await assert.rejects(ownerExec.invokeOrchestratorTask(
        "branch","dispatch_"+"a".repeat(22)
      ),/one-shot/);
    }
    assert.deepEqual(done.completed_task_ids,
      ["branch","backend","frontend","tests",...(withPullRequest?["pr"]:[])]);
    assert.deepEqual(checkedTaskIds,done.completed_task_ids);
    assert.deepEqual(done.specialized_results.map(x=>x.role),
      ["backend","frontend","test"]);
    assert.equal(done.plan_digest,proposal.digest);
    assert.equal(providerCalls,withPullRequest?6:5);
    assert.equal(opaCalls,withPullRequest?6:5);
    if(withPullRequest){
      assert.ok(events.indexOf("trusted-pr-created")>
        events.lastIndexOf("attest:tests"));
      await assert.rejects(ownerExec.invokeOrchestratorTask(
        "pr","dispatch_"+"a".repeat(22)
      ),/one-shot/);
    }
    assert.equal(coordinator.phase,"closed");
    assert.equal(revoked.at(-1),"urn:execution:"+x.name);
    if(realHttpA2A){
      assert.deepEqual(servers.map(s=>s.executor.executionCount),[1,1,1]);
      assert.equal(done.specialized_results.length,3);
      for(const server of servers){
        const taskId=done.specialized_results.find(r=>r.role===server.role)?.task_id;
        assert.ok(taskId);
        const context=server.executor.taskContexts.get(taskId);
        assert.ok(context);
        assert.match(context.trusted_gateway_task_id,
          /^dispatch_[A-Za-z0-9_-]{22}$/u);
        assert.equal(context.role,server.role);
        // The A2A client must not leak DC evidence into the Task artifact.
        assert.notEqual(context.task_id,context.trusted_gateway_task_id);
      }
    }
    assert.ok(events.indexOf("provider:create_branch:"+(
      events.find(v=>v.startsWith("provider:create_branch:"))?.split(":").at(-1)
    )) < events.findIndex(v=>v.startsWith("a2a:backend")));
  }finally{
    await Promise.allSettled(servers.map(s=>s.close()));
    await rm(directory,{recursive:true,force:true});
  }
}
for(const x of SCENARIOS){
  test("R2 full ADK Planning -> signatures -> approved Gateway DAG: "+x.name,
    async()=>exercise(x));
}
test("R2 denied Engineer subset never starts any provider Task",async()=>{
  await exercise(SCENARIOS[0]!,true);
});
test("R2 canceled GitHub run prevents Frontend and Test Gateway effects",async()=>{
  await exercise(SCENARIOS[0]!,false,true);
});
test("R5 owner-only lifecycle executes signed Engineer DAG with actual Gateway corroboration",async()=>{
  await exercise(SCENARIOS[0]!,false,false,true);
});
test("R5 owner-only lifecycle denies canceled run and revokes native root before rerun",async()=>{
  await exercise(SCENARIOS[1]!,false,true,true);
});

test("R5 real HTTP A2A servers execute the signed three-role DAG without model calls",async()=>{
  await exercise(SCENARIOS[0]!,false,false,true,true);
});

test("R5 real HTTP A2A cancels after Backend without contacting Frontend/Test",async()=>{
  await exercise(SCENARIOS[1]!,false,true,true,true);
});

test("R5 approved full HTTP A2A workflow creates signed PR only AFTER Gateway-correlated Runner acceptance",async()=>{
  await exercise(SCENARIOS[0]!,false,false,true,true,true);
});

test("R5 signed PR is denied without independently accepted exact-SHA Runner output",async()=>{
  await exercise(SCENARIOS[1]!,false,false,true,true,true,true);
});

test("R5 long-horizon offline Gemini-style ADK reads 11 distinct files then authentic Ed25519 review, scoped three-role HTTP A2A, Gateway and signed PR",async()=>{
  // Mirror the successful paid isolated Planner's eleven read steps, but
  // deliberately NEVER contact a model provider or authorize paid billing.
  // The normal completion criterion is the fully validated final proposal
  // (model turn 12), not exhausting a 96-turn emergency ceiling.
  await exercise(SCENARIOS[0]!,false,false,true,true,true,false,11);
});

test("R5 owner interrupts an in-flight signed Backend HTTP A2A after operational root issuance; Gateway/Rust close and block Frontend, Test and PR",async()=>{
  await exercise(SCENARIOS[0]!,false,false,true,true,true,false,11,true);
});
