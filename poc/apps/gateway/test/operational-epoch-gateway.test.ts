import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans} from "../src/approved-execution-plans.ts";
import {TrustedOperationalSessionStore} from "../src/trusted-operational-session-store.ts";
import {TrustedPlanIpcClient,createTrustedPlanIpcServer} from "../src/trusted-plan-ipc.ts";
import {GatewayRuntime} from "../src/runtime.ts";
import {InMemoryAuditSink,InMemoryRequestStore} from "../src/prepare.ts";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedOperationalEpochJournal} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-journal.mjs";
import {TrustedOperationalEpochIntake} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-intake.ts";
import {prepareTrustedRepairFeedback,prepareTrustedRemoteRepairFeedback} from
  "../../../packages/orchestrator-runtime/src/trusted-validation-repair-feedback.ts";
import {TrustedOperationalRepairPlanner} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-repair-planner.ts";
import {armTrustedOwnerOperationalRecovery} from
  "../../../packages/orchestrator-runtime/src/trusted-owner-operational-repair-handoff.ts";
import {TrustedOperationalRepairSourceReader} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-repair-source-reader.ts";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {TrustedApprovedPlanChildAuthorityIssuer} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-child-issuer.ts";
import {TrustedChildIssuanceJournal} from
  "../../../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {issueAdmittedRepairTaskChild} from
  "../../../packages/orchestrator-runtime/src/trusted-admitted-repair-child.ts";
import {dispatchTrustedAdmittedRepairA2A} from
  "../../../packages/orchestrator-runtime/src/trusted-admitted-repair-a2a.ts";
import {TaskState} from "@a2a-js/sdk";
import {TrustedOperationalFeatureHeadReader} from
  "../src/trusted-operational-feature-head.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {TrustedGatewaySignedEpochInspector} from "../src/trusted-gateway-signed-epoch-inspector.ts";
import {TrustedGatewayNativeRootStatusReader}
 from "../src/trusted-gateway-native-root-status.ts";
import {TrustedGatewayRootVpVerifier}
 from "../src/trusted-root-vp-verification.ts";
import {TrustedOrchestratorRootPresenter}
 from "../../../packages/orchestrator-runtime/src/trusted-orchestrator-root-presenter.ts";
import {createTrustedRootVpSignerServer,TrustedRootVpSocketClient}
 from "../../../packages/orchestrator-runtime/src/trusted-root-vp-private-ipc.ts";

const repo={authority:"gitea.local",owner:"sample",repository:"invoice-service"};
const root="gitea://gitea.local/sample/invoice-service";
const branch="feature/invoice-approval",branchURI=root+"/branches/feature%2Finvoice-approval";
const file=branchURI+"/files/src/invoices.ts";
const session="invoice-session",sha="a".repeat(40),engineer="did:example:engineer";
const operations=new Set<string>(RUST_OPERATIONS);
const registry=[
 {agent_id:"backend",did:"did:example:backend",card_ref:"trusted:backend"},
 {agent_id:"test",did:"did:example:test",card_ref:"trusted:test"}
];
const entry=(id:string,role:string,resource:string,operation:string,depends_on:string[]=[])=>
 ({id,role,resource,operation,depends_on});
const initial=()=>{
 const grants=[
  entry("setup","orchestrator",root,"create_branch"),
  entry("backend-original","backend",file,"update_file",["setup"]),
  entry("test-original","test",branchURI,"run_tests",["backend-original"])
 ];
 return plan("original",1,grants);
};
function plan(planId:string,version:number,grants:ReturnType<typeof entry>[]){
 return {
  schema_version:"1.0.0",plan_id:planId,session_id:session,version,
  repository:repo,base_revision:sha,requirement:"Update invoice service and test",
  candidate_agents:registry.filter(a=>grants.some(g=>g.role===a.agent_id)),
  tasks:grants.map(g=>({id:g.id,agent_id:g.role,title:g.id,
   description:"Perform an authorized operation",
   depends_on:g.depends_on,resources:[g.resource]})),
  requested_permissions:grants.map(g=>({
   id:"perm-"+g.id,task_id:g.id,agent_id:g.role,
   resource:g.resource,operation:g.operation,reason:"Scoped operation"
  })),assumptions:[],uncertainties:[]
 };
}
function initialWithReview(withIndependentSibling=false){
 const p=initial();
 p.tasks.push(
  {id:"pr-after-test",agent_id:"orchestrator",title:"Open review",
   description:"PR only after accepted Test",
   depends_on:["test-original"],resources:[root]},
  {id:"post-review",agent_id:"backend",title:"Inspect after review",
   description:"Read after approved PR",
   depends_on:["pr-after-test"],resources:[file]}
 );
 p.requested_permissions.push(
  {id:"perm-pr-after-test",task_id:"pr-after-test",agent_id:"orchestrator",
   resource:root,operation:"create_pull_request",reason:"Human review"},
  {id:"perm-post-review",task_id:"post-review",agent_id:"backend",
   resource:file,operation:"read_file",reason:"Verify review"}
 );
 if(withIndependentSibling){
  p.tasks.push({id:"independent-read",agent_id:"backend",
   title:"Independent work",description:"Must finish despite Test failure",
   depends_on:["setup"],resources:[file]});
  p.requested_permissions.push({id:"perm-independent-read",
   task_id:"independent-read",agent_id:"backend",resource:file,
   operation:"read_file",reason:"Independent work"});
 }
 return p;
}
function initialWithInlineRead(){
 const p=initial();
 p.requested_permissions.push({id:"perm-root-read",
  task_id:"backend-original",agent_id:"backend",
  resource:file,operation:"read_file",reason:"Engineer max read scope"});
 return p;
}
function initialWithTrustedRead(){
 const p=initial();
 p.tasks.push({id:"read-diagnostics",agent_id:"backend",
  title:"Inspect source",description:"Explicit pre-approved diagnostic read",
  depends_on:["backend-original"],resources:[file]});
 p.requested_permissions.push({id:"perm-read-diagnostics",
  task_id:"read-diagnostics",agent_id:"backend",
  resource:file,operation:"read_file",reason:"Scoped diagnostic read"});
 return p;
}
function initialWithTestFileWrite(){
 const p=initial();
 p.tasks.find(t=>t.id==="test-original")!.resources.push(file);
 p.requested_permissions.push({
  id:"perm-test-write",task_id:"test-original",agent_id:"test",
  resource:file,operation:"update_file",reason:"Authorized test fixture edit"
 });
 return p;
}
const repair=()=>plan("repair-2",2,[
 entry("backend-repair","backend",file,"update_file"),
 entry("test-repair","test",branchURI,"run_tests",["backend-repair"])
]);
const phases=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"].map(phase=>({
 phase,status:"pass" as const
}));
async function harness(t:import("node:test").TestContext,
 options:{withReview?:boolean;withIndependentSibling?:boolean;
  withTestWrite?:boolean;withRead?:boolean;withInlineRead?:boolean;
  withDurable?:boolean;withRemoteEpoch?:boolean}={}){
 const parent=options.withReview?
  initialWithReview(options.withIndependentSibling):
  options.withInlineRead?initialWithInlineRead():
  options.withRead?initialWithTrustedRead():
  options.withTestWrite?initialWithTestFileWrite():initial();
 const dir=await mkdtemp(join(tmpdir(),"delegation-gateway-epoch-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const approvalsDir=join(dir,"approvals"),epochsDir=join(dir,"epochs");
 await mkdir(approvalsDir,{mode:0o700});
 await mkdir(epochsDir,{mode:0o700});
 const operationalDir=join(dir,"durable-gateway-operational");
 if(options.withDurable)await mkdir(operationalDir,{mode:0o700});
 const keys=generateKeyPairSync("ed25519");
 const approved=makeApproval(parent,{
  allowedOperations:operations,decision_id:"engineer-approval",
  approved_by:engineer,approved_at:"2026-10-29T08:00:00Z",
  approved_permission_ids:parent.requested_permissions.map(p=>p.id)
 });
 const signed=signEngineerApproval({
  plan:parent,approval:approved,engineerDid:engineer,keyId:"pinned-key",
  privateKeyPem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
  issuedAt:"2026-10-29T08:00:00Z",expiresAt:"2026-10-29T11:00:00Z"
 });
 await writeFile(join(approvalsDir,session+".json"),JSON.stringify(signed),{mode:0o600});
 const signedStore=new SignedEngineerApprovalFileStore({
  directory:approvalsDir,engineerDid:engineer,
  trustedKeys:{"pinned-key":{
   engineer_did:engineer,
   public_key_pem:keys.publicKey.export({format:"pem",type:"spki"}).toString()
  }},
  nowMs:()=>Date.parse("2026-10-29T09:00:00Z")
 });
 const rootAuthority={
  credential_id:"urn:root:invoice-service",
  plan_digest:planDigest(parent),
  permissions:[...new Map(parent.requested_permissions.map(x=>[
   JSON.stringify([x.resource,x.operation]),{
    resource:x.resource,operation:x.operation
   }
  ])).values()]
 };
 let phase="execution";
 let nativeRootRevoked=false;
 let gates:TrustedApprovedExecutionPlans;
 const coordinator={
  get phase(){return phase;},
  trustedOperationalAuthority(){
   if(phase!=="execution")throw Error("root retired");
   return structuredClone(rootAuthority);
  },
  async bindDispatchedTask(taskId:string,id:string,role:any){
   gates.bindTask(session,taskId,id,role);
  },
  async confirmTask(id:string,observation:any){
   await gates.confirmTaskCompletion(id,observation);
  },
  async closeExecution(){
   await gates.retireSession(session);
   phase="closed";
  }
 };
 const journal=new TrustedOperationalEpochJournal({
  directory:epochsDir,sessionId:session,baseRevision:sha,
  rootCredentialId:rootAuthority.credential_id,
  originalPlanDigest:rootAuthority.plan_digest,allowedOperations:operations
 });
 const intake=TrustedOperationalEpochIntake.create({
  coordinator,approvals:signedStore,journal,
  sessionId:session,engineerDid:engineer,pinnedAgentRegistry:registry
 });
 let provider=0,verified=0,policy=0,attested=0;
 let nextRunnerFails=false;
 // Mock native Adapter + VP only in this fixture: production R133 uses
 // R130 Unix HMAC Orchestrator and Rust's genuine verifier on each read.
 const remote=options.withRemoteEpoch?new TrustedGatewaySignedEpochInspector({
  directory:epochsDir,approvals:signedStore,
  trustedOrchestratorDid:"did:example:orchestrator",
  nativeRootStatus:new TrustedGatewayNativeRootStatusReader({
   baseUrl:"http://r133-adapter.internal:8090",gatewayToken:"gateway-bearer",
   fetchFn:(async(url:unknown,init?:RequestInit)=>{
    if(phase!=="execution"||nativeRootRevoked)
     return new Response("{}",{status:403});
    assert.equal(new Headers(init?.headers).get("authorization"),
     "Bearer gateway-bearer");
    assert.deepEqual(JSON.parse(String(init?.body)),
     {credential_id:rootAuthority.credential_id});
    const status={credential_id:rootAuthority.credential_id,
     status_purpose:"revocation",status_set:false,
     source:"evm_anchored_signed_jwt",anchor_version:5};
    if(String(url).endsWith("/v1/credentials/status/inspect"))
     return new Response(JSON.stringify(status),{status:200});
    if(String(url).endsWith("/v1/credentials/root/inspect")){
     const now=BigInt(Date.now())*1_000_000n;
     return new Response(JSON.stringify({
      credential_id:rootAuthority.credential_id,issuer_id:engineer,
      delegatee_id:"did:example:orchestrator",
      iat_ns:(now-1_000_000_000n).toString(),
      exp_ns:(now+60_000_000_000n).toString(),
      permissions:rootAuthority.permissions,status,
      source:"adapter_local_issued_root"
     }),{status:200});
    }
    throw Error("Unexpected native status endpoint");
   }) as typeof fetch
  }),
  rootVpVerifier:new TrustedGatewayRootVpVerifier({
   audience:"urn:thesis:gateway:r133",
   signer:{async present(data){
    if(phase!=="execution"||nativeRootRevoked)
     throw Error("Orchestrator root retired");
    assert.equal(data.credential_id,rootAuthority.credential_id);
    return "r133-root-vp:"+data.challenge;
   }},
   verifier:{
    async verify(){throw Error("require signed multi-grant root VP");},
    async verifyMultiple(data){
     if(phase!=="execution"||nativeRootRevoked)
      throw Error("Rust status revoked");
     assert.equal(data.signed_vp,"r133-root-vp:"+data.challenge);
     return {presenter_id:"did:example:orchestrator",
      issuer_id:engineer,credential_id:rootAuthority.credential_id,
      permissions:data.required_permissions,hierarchy_depth:0,
      expiration:(BigInt(Date.now())*1_000_000n+
       60_000_000_000n).toString()};
    }
   }
  })
 }):undefined;
 gates=new TrustedApprovedExecutionPlans({
  repository:repo,engineerDid:engineer,
  approvals:signedStore,
  ...(options.withRemoteEpoch?{remoteEpochInspector:remote!}:
   {operationalEpochIntake:intake}),
  ...(options.withDurable?{
    operationalSessionStore:new TrustedOperationalSessionStore(operationalDir),
    operationalLeaseMs:120000
  }:{}),
  completionAttestor:{async confirmCompleted(e){
   attested++;
   assert.equal(e.session_id,session);
   assert.equal(e.plan_digest,rootAuthority.plan_digest);
   assert.ok(e.successful_gateway_request_ids.length);
   return true;
  }}
 });
 const prepared=new InMemoryRequestStore();
 const runtime=new GatewayRuntime({
  bind_host:"127.0.0.1",bind_port:0,
  prepare:{audience:"cloud-gateway",request_ttl_ms:120000,repository:repo},
  adapter_url:"http://none",adapter_gateway_token:"test-only",
  opa_url:"http://none",opa_timeout_ms:1000,
  provider_mode:"mock",gitea_timeout_ms:1000
 },{
  store:prepared,approvedPlans:gates,audit:new InMemoryAuditSink(),
  executor:{
   provider:"gitea",
   providerFor(record){return record.request.tool==="run_tests"?"runner":"gitea";},
   async execute(record){
    provider++;
    const req=record.request;
    if(req.tool==="create_branch")return {
     provider:"gitea" as const,performed:true as const,
     tool:"create_branch" as const,
     branch:req.arguments.branch,base_branch:req.arguments.base_branch,
     revision:sha,commit_sha:sha
    };
    if(req.tool==="update_file")return {
     provider:"gitea" as const,performed:true as const,
     tool:"update_file" as const,
     branch:req.arguments.branch,path:req.arguments.path,
     revision:sha,commit_sha:sha,blob_sha:"b",precondition_blob_sha:"a"
    };
    if(req.tool==="read_file"){
     const content="export function invoice(): number { return 42; }\n";
     return {provider:"gitea" as const,performed:true as const,
      tool:"read_file" as const,branch:req.arguments.branch,
      path:req.arguments.path,revision:sha,
      blob_sha:"b".repeat(40),last_commit_sha:sha,
      size:Buffer.byteLength(content,"utf8"),
      encoding:"utf-8" as const,content};
    }
    if(req.tool==="run_tests"){
     const fail=nextRunnerFails;nextRunnerFails=false;
     const measured=fail?phases.map(p=>({
      phase:p.phase,status:(p.phase==="typecheck"?"fail":
       p.phase==="dependency_install"?"pass":"skipped") as "pass"|"fail"|"skipped"
     })):phases;
     return {
      provider:"runner" as const,performed:true as const,
      tool:"run_tests" as const,branch:req.arguments.branch,
      revision:sha,tested_commit_sha:sha,runner_profile:"poc-default" as const,
      status:(fail?"fail":"pass") as "pass"|"fail",
      phases:measured,
      project_tests:{status:(fail?"fail":"pass") as "pass"|"fail"},
      ...(fail?{typecheck_error_codes:["TS2339"]}:{
        researcher_acceptance:{phase:"researcher_acceptance" as const,status:"pass" as const}
      })
     };
    }
    throw Error("unhandled request");
   }
  },
  verifier:{async verify(req){
   verified++;
   return {
    presenter_id:"did:example:"+req.presenter,
    issuer_id:engineer,credential_id:req.signed_vp==="signed.r109.discovery"?
      "urn:child:repair-discovery":"urn:fixture:delegated",
    permissions:[req.required_permission],hierarchy_depth:1,
    expiration:"999999999999999"
   };
  }},
  policy:{async evaluate(input){
   policy++;
   assert.equal(input.approved_plan_digest,rootAuthority.plan_digest);
   return {allow:true,policy_version:"pinned-test"};
  }}
 });
 const invoke=async(task:string,role:"backend"|"test"|"orchestrator",
  tool:string,args:Record<string,unknown>)=>{
   const ticket=runtime.prepare({task_id:task,agent_role:role,tool,arguments:args});
   const response=await runtime.execute({request_id:ticket.request_id,
    signed_vp:"signed.fixture.vp"});
   assert.equal(response.execution.performed,true);
   return ticket;
 };
 async function initialPass(){
  await intake.reserveInitialEpoch();
  await gates.activate(session,sha);
  gates.bindTask(session,"setup","task-setup","orchestrator");
  gates.bindTask(session,"backend-original","task-backend","backend");
  gates.bindTask(session,"test-original","task-test","test");
  await invoke("task-setup","orchestrator","create_branch",
    {branch,base_branch:"main"});
  await gates.confirmTaskCompletion("task-setup");
  await invoke("task-backend","backend","update_file",
    {branch,path:"src/invoices.ts",content:"// initial"});
  await gates.confirmTaskCompletion("task-backend");
  await invoke("task-test","test","run_tests",{branch,profile:"poc-default"});
  await gates.confirmTaskCompletion("task-test");
 }
 return {gates,intake,runtime,prepared,invoke,initialPass,
  coordinator,rootAuthority,dir,signedStore,parent,approved,
  setRunnerFailure:()=>{nextRunnerFails=true;},
  setPhase:(s:string)=>{phase=s;},
  revokeNativeRoot:()=>{nativeRootRevoked=true;},
  get provider(){return provider;},get verified(){return verified;},
  get policy(){return policy;},get attested(){return attested;}
 };
}
const edit=(content:string)=>({branch,path:"src/invoices.ts",content});
const runner={branch,profile:"poc-default"};

test("R103 second plan binds new Backend and Test Tasks under same signed Rust root",async(t)=>{
 const h=await harness(t);
 await h.initialPass();
 await h.intake.reserveRepairEpoch(repair());
 const admitted=await h.gates.admitNextOperationalEpoch(session,2);
 assert.equal(admitted.epoch,2);
 assert.equal(admitted.plan_digest,planDigest(repair()));
 assert.throws(()=>h.runtime.prepare({task_id:"task-backend",
   agent_role:"backend",tool:"update_file",arguments:edit("// stale")}),/Stale operational epoch/);
 h.gates.bindTask(session,"backend-repair","task-backend-2","backend");
 h.gates.bindTask(session,"test-repair","task-test-2","test");
 assert.throws(()=>h.runtime.prepare({task_id:"task-test-2",
   agent_role:"test",tool:"run_tests",arguments:runner}),/dependency/i);
 const oldProvider=h.provider;
 await h.invoke("task-backend-2","backend","update_file",edit("// repair"));
 await h.gates.confirmTaskCompletion("task-backend-2");
 await h.invoke("task-test-2","test","run_tests",runner);
 await h.gates.confirmTaskCompletion("task-test-2");
 assert.equal(h.provider,oldProvider+2);
 assert.equal(h.verified,5);
 assert.equal(h.policy,5);
 assert.equal(h.attested,5);
 // Even when the branch SHA is unchanged, the old Test result does not
 // attest the final epoch. Only the latest independently completed Test does.
 await h.gates.retireSession(session);
 assert.throws(()=>h.gates.readVerifiedRunnerEffect({
   session_id:session,task_id:"test-original",
   branch,tested_commit_sha:sha
 }),/unique attested Test Task|current operational epoch|Test Runner/);
 const accepted=h.gates.readVerifiedRunnerEffect({
   session_id:session,task_id:"test-repair",
   branch,tested_commit_sha:sha
 });
 assert.equal(accepted.status,"pass");
 assert.equal(accepted.phases.length,7);
});

test("R103 rejects old prepared requests and missing new Task grants after transition",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// initial"));
 await h.gates.confirmTaskCompletion("task-backend");
 await h.invoke("task-test","test","run_tests",runner);
 const stale=h.runtime.prepare({
  task_id:"task-test",agent_role:"test",tool:"run_tests",arguments:runner
 });
 await h.gates.confirmTaskCompletion("task-test");
 await h.intake.reserveRepairEpoch(repair());
 await h.gates.admitNextOperationalEpoch(session,2);
 await assert.rejects(h.runtime.execute({
  request_id:stale.request_id,signed_vp:"signed.fixture.vp"
 }),/approved plan|epoch/i);
 h.gates.bindTask(session,"backend-repair","task-backend-2","backend");
 assert.throws(()=>h.runtime.prepare({
  task_id:"task-backend-2",agent_role:"backend",tool:"read_file",
  arguments:{branch,path:"src/invoices.ts"}
 }),/admitted epoch/);
 assert.throws(()=>h.gates.bindTask(session,
  "backend-original","replay-task","backend"),/current admitted epoch/);
 assert.throws(()=>h.gates.bindTask(session,
  "backend-repair","duplicate-new-task","frontend"),/current admitted epoch/);
 assert.equal(h.provider,3);
});

test("R103 admission fails closed for incomplete tasks, wrong version and revoked Coordinator",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 await h.intake.reserveRepairEpoch(repair());
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /unresolved, unbound or in-flight Tasks/);
 assert.equal(h.provider,0);
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,3),
  /advance exactly once/);
 h.setPhase("closed");
 // An incomplete Task is a stronger earlier fence. It must never
 // accidentally enable a new epoch after revocation.
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /unresolved, unbound or in-flight Tasks/);
 assert.equal(h.provider,0);
});

test("R103 independently rejects revoked issued root after all old Tasks complete",async(t)=>{
 const h=await harness(t);
 await h.initialPass();
 await h.intake.reserveRepairEpoch(repair());
 h.setPhase("closed");
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /operational root is not active/);
 assert.equal(h.provider,3);
});

test("R103 cannot register a second operational epoch before it is durably reserved",async(t)=>{
 const h=await harness(t);
 await h.initialPass();
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /epoch changed|signed|record|length/i);
 assert.equal(h.provider,3);
});

test("R103 cannot skip an unbound epoch even if its plan was durably reserved",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 await h.intake.reserveRepairEpoch(repair());
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /unresolved, unbound or in-flight Tasks/);
 assert.equal(h.provider,0);
});
test("R103 cannot advance to epoch three without executing admitted epoch two",async(t)=>{
 const h=await harness(t);
 await h.initialPass();
 await h.intake.reserveRepairEpoch(repair());
 await h.gates.admitNextOperationalEpoch(session,2);
 const third=plan("repair-3",3,[
  entry("backend-third","backend",file,"update_file"),
  entry("test-third","test",branchURI,"run_tests",["backend-third"])
 ]);
 await h.intake.reserveRepairEpoch(third);
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,3),
  /unresolved, unbound or in-flight Tasks/);
 assert.equal(h.provider,3);
});

test("R104 real Gateway-observed failed TypeScript validation triggers contained repair cycle",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",{branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// bug"));
 await h.gates.confirmTaskCompletion("task-backend");
 assert.throws(()=>h.gates.confirmTestValidationFailure("task-test"),
  /No unique verified failed Runner/);
 h.setRunnerFailure();
 await h.invoke("task-test","test","run_tests",runner);
 // R119: the legacy "retry in the SAME signed Test Task" fixture is
 // incompatible with R104/R112. A genuine Runner FAIL immediately fences
 // further provider effects, even BEFORE its failure is finalized by host.
 // Replanning must use a NEW attenuated child and a fresh operational epoch.
 assert.throws(()=>h.runtime.prepare({
  task_id:"task-test",agent_role:"test",tool:"run_tests",arguments:runner
 }),/outside approved plan/);
 const failure=h.gates.confirmTestValidationFailure("task-test");
 assert.equal(failure.status,"validation_failed");
 assert.equal(failure.first_failed_phase,"typecheck");
 assert.deepEqual(failure.typecheck_error_codes,["TS2339"]);
 assert.equal(failure.tested_commit_sha,sha);
 assert.equal(h.gates.readVerifiedTestFailure("task-test").request_id,failure.request_id);
 assert.doesNotMatch(JSON.stringify(failure),/log_reference|source|stderr|credential/i);
 await assert.rejects(h.gates.confirmTaskCompletion("task-test"),
  /No active|outside approved|failed|Cannot complete/i);
 assert.throws(()=>h.runtime.prepare({task_id:"task-test",agent_role:"test",
  tool:"run_tests",arguments:runner}),/outside approved plan/);
 assert.throws(()=>h.gates.confirmTestValidationFailure("task-test"),
  /No unique verified failed Runner/);
 await h.intake.reserveRepairEpoch(repair());
 const admitted=await h.gates.admitNextOperationalEpoch(session,2);
 assert.equal(admitted.epoch,2);
 h.gates.bindTask(session,"backend-repair","backend-fix-2","backend");
 h.gates.bindTask(session,"test-repair","test-rerun-2","test");
 await h.invoke("backend-fix-2","backend","update_file",edit("// fixed"));
 await h.gates.confirmTaskCompletion("backend-fix-2");
 await h.invoke("test-rerun-2","test","run_tests",runner);
 await h.gates.confirmTaskCompletion("test-rerun-2");
 assert.equal(h.provider,5);
 assert.equal(h.verified,5);
 assert.equal(h.policy,5);
 await h.gates.retireSession(session);
 const result=h.gates.readVerifiedRunnerEffect({
  session_id:session,task_id:"test-repair",branch,tested_commit_sha:sha
 });
 assert.equal(result.status,"pass");
 assert.equal(result.phases.length,7);
});
test("R104 a model-supplied failure cannot authorize repair without Gateway Runner evidence",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",{branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// source"));
 await h.gates.confirmTaskCompletion("task-backend");
 await h.intake.reserveRepairEpoch(repair());
 assert.throws(()=>h.gates.confirmTestValidationFailure("task-test"),
  /No unique verified failed Runner/);
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /unresolved/);
 assert.equal(h.provider,2);
});
test("R104 revoked operational root blocks repair even after observed validation failure",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",{branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// bug"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();await h.invoke("task-test","test","run_tests",runner);
 h.gates.confirmTestValidationFailure("task-test");
 await h.intake.reserveRepairEpoch(repair());
 h.setPhase("closed");
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /operational root is not active/);
 assert.equal(h.provider,3);
});

test("R104: a live provider effect fences terminal failure and prevents premature replanning",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",{branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// bug"));
 await h.gates.confirmTaskCompletion("task-backend");
 const pre=h.runtime.prepare({task_id:"task-test",
   agent_role:"test",tool:"run_tests",arguments:runner});
 const prepared=h.prepared.get(pre.request_id);
 assert.ok(prepared);
 const release=h.gates.beginProviderEffect(prepared);
 h.setRunnerFailure();
 // A different authorized provider effect is still outstanding. The
 // Gateway must refuse ambiguous failure evidence; no terminal state yet.
 await assert.rejects(h.invoke("task-test","test","run_tests",runner),
  /Concurrent provider effect makes Runner failure ambiguous/);
 assert.throws(()=>h.gates.confirmTestValidationFailure("task-test"),
  /No unique verified failed Runner/);
 await h.intake.reserveRepairEpoch(repair());
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /unresolved/);
 release();
 h.setRunnerFailure();await h.invoke("task-test","test","run_tests",runner);
 const failure=h.gates.confirmTestValidationFailure("task-test");
 assert.equal(failure.status,"validation_failed");
 const admitted=await h.gates.admitNextOperationalEpoch(session,2);
 assert.equal(admitted.epoch,2);
 await assert.rejects(h.runtime.execute({request_id:pre.request_id,
   signed_vp:"signed.fixture.vp"}),/approved plan|epoch/);
 // The deliberately ambiguous Runner invocation DID reach the provider,
 // but its receipt was rejected: two writes + rejected FAIL + valid FAIL.
 assert.equal(h.provider,4);
});

test("R105: Test FAIL skips only unsigned PR and transitive downstream Task",async(t)=>{
 const h=await harness(t,{withReview:true});
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// bug"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();await h.invoke("task-test","test","run_tests",runner);
 const fail=h.gates.confirmTestValidationFailure("task-test");
 assert.equal(fail.first_failed_phase,"typecheck");
 await h.intake.reserveRepairEpoch(repair());
 const receipt=await h.gates.admitNextOperationalEpoch(session,2);
 assert.deepEqual(receipt.blocked_descendant_task_ids,
  ["post-review","pr-after-test"]);
 assert.equal(h.provider,3);
 assert.throws(()=>h.gates.bindTask(session,"pr-after-test",
  "stale-pr-task","orchestrator"),/current admitted epoch/);
 h.gates.bindTask(session,"backend-repair","backend-fix-2","backend");
 h.gates.bindTask(session,"test-repair","test-rerun-2","test");
 await h.invoke("backend-fix-2","backend","update_file",edit("// fixed"));
 await h.gates.confirmTaskCompletion("backend-fix-2");
 await h.invoke("test-rerun-2","test","run_tests",runner);
 await h.gates.confirmTaskCompletion("test-rerun-2");
 await h.gates.retireSession(session);
 assert.equal(h.gates.readVerifiedRunnerEffect({
  session_id:session,task_id:"test-repair",branch,tested_commit_sha:sha
 }).status,"pass");
});
test("R105: independent unbound Task cannot be discarded as failed Test descendant",async(t)=>{
 const h=await harness(t,{withReview:true,withIndependentSibling:true});
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// bug"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();await h.invoke("task-test","test","run_tests",runner);
 h.gates.confirmTestValidationFailure("task-test");
 await h.intake.reserveRepairEpoch(repair());
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /unresolved, unbound or in-flight/);
 assert.equal(h.provider,3);
});
test("R105: no failed Test means neither PR nor other unbound Tasks can be skipped",async(t)=>{
 const h=await harness(t,{withReview:true});
 await h.initialPass();
 await h.intake.reserveRepairEpoch(repair());
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /unresolved, unbound or in-flight/);
 assert.equal(h.provider,3);
});

test("R105: authorized Test file edit before TypeScript FAIL remains repairable at exact Runner SHA",async(t)=>{
 const h=await harness(t,{withTestWrite:true});
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// buggy"));
 await h.gates.confirmTaskCompletion("task-backend");
 await h.invoke("task-test","test","update_file",edit("// test fixture"));
 h.setRunnerFailure();await h.invoke("task-test","test","run_tests",runner);
 const failure=h.gates.confirmTestValidationFailure("task-test");
 assert.equal(failure.status,"validation_failed");
 await h.intake.reserveRepairEpoch(repair());
 const receipt=await h.gates.admitNextOperationalEpoch(session,2);
 assert.deepEqual(receipt.blocked_descendant_task_ids,[]);
 assert.equal(receipt.epoch,2);
 assert.equal(h.provider,4);
});

test("R105: private handoff obtains a bounded FAIL from Gateway and active Engineer-root epoch",async(t)=>{
 const h=await harness(t,{withReview:true});
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// bug"));
 await h.gates.confirmTaskCompletion("task-backend");
 await assert.rejects(prepareTrustedRepairFeedback({
  gateway:h.gates,intake:h.intake,sessionId:session,runtimeTestTaskId:"task-test"
 }),/No terminal Gateway-confirmed validation failure/);
 h.setRunnerFailure();await h.invoke("task-test","test","run_tests",runner);
 h.gates.confirmTestValidationFailure("task-test");
 const signal=await prepareTrustedRepairFeedback({
  gateway:h.gates,intake:h.intake,sessionId:session,runtimeTestTaskId:"task-test"
 });
 assert.equal(signal.status,"repair_planning_eligible");
 assert.equal(signal.provenance,"gateway_verified_docker_runner");
 assert.equal(signal.session_id,session);
 assert.equal(signal.first_failed_phase,"typecheck");
 assert.deepEqual(signal.typecheck_error_codes,["TS2339"]);
 assert.equal(signal.failed_epoch,1);
 assert.equal(signal.remaining_repair_epochs,2);
 assert.equal(signal.execution_authorized,false);
 assert.equal(signal.permission_granted,false);
 assert.equal(Object.isFrozen(signal),true);
 assert.doesNotMatch(JSON.stringify(signal),/signed_vp|stderr|source_code|log_reference/i);
 await assert.rejects(prepareTrustedRepairFeedback({
  gateway:h.gates,intake:h.intake,sessionId:"foreign-session",
  runtimeTestTaskId:"task-test"
 }),/failed Runner receipt not bound/);
 await h.intake.reserveRepairEpoch(repair());
 // The original failure can no longer be reused as feedback for the
 // newest (second) operational epoch, even before Gateway admission.
 await assert.rejects(prepareTrustedRepairFeedback({
  gateway:h.gates,intake:h.intake,sessionId:session,runtimeTestTaskId:"task-test"
 }),/failed Runner receipt not bound/);
});
test("R105: revoked Engineer-root Coordinator cannot issue a repair planning handoff",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// bug"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();await h.invoke("task-test","test","run_tests",runner);
 h.gates.confirmTestValidationFailure("task-test");
 h.setPhase("closed");
 await assert.rejects(prepareTrustedRepairFeedback({
  gateway:h.gates,intake:h.intake,sessionId:session,runtimeTestTaskId:"task-test"
 }),/operational root is not active/);
});

/** R106 intentionally injects a scripted proposal; NO paid Gemini is called. */
const repairDraft=()=>({tasks:[
 {id:"repair-implementation",agent_id:"backend",title:"Fix invoice logic",
  description:"Correct the implementation that failed typecheck",
  depends_on:[],
  permissions:[{resource:file,operation:"update_file",reason:"Repair within root"}]},
 {id:"repair-validation",agent_id:"test",title:"Rerun verification",
  description:"Test the updated branch in Docker",
  depends_on:["repair-implementation"],
  permissions:[{resource:branchURI,operation:"run_tests",reason:"Check repair"}]}
]});
async function verifiedFailureForR106(t:import("node:test").TestContext){
 const h=await harness(t,{withReview:true});
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// buggy"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();
 await h.invoke("task-test","test","run_tests",runner);
 h.gates.confirmTestValidationFailure("task-test");
 return h;
}
const prepareR106=(h:Awaited<ReturnType<typeof verifiedFailureForR106>>,options:{
 draft?:()=>unknown;
 readHead?:()=>Promise<string>;
 count?:{model:number;head:number};
}={})=>new TrustedOperationalRepairPlanner({
 gateway:h.gates,intake:h.intake,sessionId:session,
 runtimeTestTaskId:"task-test",nextPlanId:"new-repair-epoch-2",
 pinnedAgentRegistry:registry,
 featureHeadReader:new TrustedOperationalFeatureHeadReader({
  intake:h.intake,repository:repo,
  giteaClient:new GiteaClient({
   baseUrl:"http://gitea.local:3000",token:"trusted-private-fixture-only",
   owner:repo.owner,repository:repo.repository,timeoutMs:1000,
   fetchFn:(async (url:unknown)=>{
    const path=String(url);
    if(path.endsWith("/repos/sample/invoice-service"))
     return new Response(JSON.stringify({
      owner:{login:repo.owner},name:repo.repository,
      full_name:repo.owner+"/"+repo.repository,default_branch:"main"
     }),{status:200,headers:{"content-type":"application/json"}});
    if(path.endsWith("/branches/feature%2Finvoice-approval")){
     if(options.count)options.count.head++;
     return new Response(JSON.stringify({
      name:branch,commit:{id:options.readHead?
        await options.readHead():sha}
     }),{status:200,headers:{"content-type":"application/json"}});
    }
    return new Response(JSON.stringify({message:"Not Found"}),{status:404});
   }) as typeof fetch
  })
 }),
 proposeRepairPlan:async(input)=>{
  if(options.count)options.count.model++;
  assert.equal(input.feedback.failed_phase,"typecheck");
  assert.deepEqual(input.feedback.typecheck_error_codes,["TS2339"]);
  assert.equal(input.feedback.tested_commit_sha,sha);
  assert.equal(input.feedback.remaining_repair_epochs,2);
  assert.equal(input.agents.includes("backend"),true);
  assert.ok(input.already_delegated_grants.every(g=>
   ["create_branch","create_pull_request","read_file",
    "update_file","run_tests"].includes(g.operation)));
  return options.draft?options.draft():repairDraft();
 }
});

test("R106 private scripted repair Planner reserves one new DAG without Engineer interaction",async(t)=>{
 const h=await verifiedFailureForR106(t),count={head:0,model:0};
 const planner=prepareR106(h,{count});
 const receipt=await planner.proposeAndReserve();
 assert.equal(receipt.status,"repair_epoch_reserved_no_execution_authority");
 assert.equal(receipt.epoch,2);
 assert.equal(receipt.source_failed_sha,sha);
 assert.equal(receipt.execution_authorized,false);
 assert.equal(receipt.child_credential_issued,false);
 assert.deepEqual(count,{head:2,model:1});
 const history=await h.intake.verifiedEpochHistory();
 assert.equal(history.length,2);
 const second=history[1].plan;
 assert.equal(second.plan_id,"new-repair-epoch-2");
 assert.equal(second.base_revision,sha);
 assert.equal(second.tasks.some(x=>x.agent_id==="orchestrator"),false);
 assert.equal(second.requested_permissions.length,2);
 assert.equal(second.tasks[0].depends_on.length,0);
 assert.deepEqual(second.tasks[1].depends_on,["repair-implementation"]);
 await assert.rejects(planner.proposeAndReserve(),/already attempted/);
 assert.equal(count.model,1);
 const admitted=await h.gates.admitNextOperationalEpoch(session,2);
 assert.deepEqual(admitted.blocked_descendant_task_ids,
  ["post-review","pr-after-test"]);
 h.gates.bindTask(session,"repair-implementation","run-repair-impl","backend");
 h.gates.bindTask(session,"repair-validation","run-repair-test","test");
 await h.invoke("run-repair-impl","backend","update_file",edit("// corrected"));
 await h.gates.confirmTaskCompletion("run-repair-impl");
 await h.invoke("run-repair-test","test","run_tests",runner);
 await h.gates.confirmTaskCompletion("run-repair-test");
 await h.gates.retireSession(session);
 assert.equal(h.gates.readVerifiedRunnerEffect({
  session_id:session,task_id:"repair-validation",branch,
  tested_commit_sha:sha
 }).status,"pass");
});

test("R106 rejects unauthorized code mutation before reserving or calling any provider",async(t)=>{
 const h=await verifiedFailureForR106(t),count={head:0,model:0};
 const malicious=repairDraft();
 malicious.tasks[0].permissions[0].resource=
  root+"/branches/feature%2Finvoice-approval/files/src/secrets.ts";
 const planner=prepareR106(h,{draft:()=>malicious,count});
 await assert.rejects(planner.proposeAndReserve(),
  /outside actually issued root/);
 assert.equal(count.model,1);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
 assert.equal(h.provider,3);
});
test("R106 rejects stale feature branch SHA BEFORE any model is called",async(t)=>{
 const h=await verifiedFailureForR106(t),count={head:0,model:0};
 const planner=prepareR106(h,{readHead:async()=>"b".repeat(40),count});
 await assert.rejects(planner.proposeAndReserve(),
  /branch HEAD differs/);
 assert.equal(count.model,0);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
});
test("R106 rejects feature branch revision drift DURING model inference",async(t)=>{
 const h=await verifiedFailureForR106(t),count={head:0,model:0};
 const planner=prepareR106(h,{readHead:async()=>
  count.head===1?sha:"b".repeat(40),count});
 await assert.rejects(planner.proposeAndReserve(),
  /branch HEAD differs/);
 assert.equal(count.model,1);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
});
test("R106 rejects a Test that does not depend on the repaired write",async(t)=>{
 const h=await verifiedFailureForR106(t);
 const broken=repairDraft();broken.tasks[1].depends_on=[];
 const planner=prepareR106(h,{draft:()=>broken});
 await assert.rejects(planner.proposeAndReserve(),
  /Test must depend on each implementation repair/);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
});
test("R106 revoked operational root blocks even a well-scoped repair proposal",async(t)=>{
 const h=await verifiedFailureForR106(t);
 h.setPhase("closed");
 const planner=prepareR106(h);
 await assert.rejects(planner.proposeAndReserve(),
  /operational root is not active/);
 assert.equal((await h.intake.verifiedEpochHistory().catch(()=>[])).length,0);
});

test("R106 optional PR is a distinct Orchestrator Task after new Test, never an agent privilege",async(t)=>{
 const h=await verifiedFailureForR106(t);
 const plan=repairDraft();
 const tasks=[...plan.tasks,{
  id:"review-repair",agent_id:"orchestrator",title:"Open reviewed PR",
  description:"Create a PR only following verified repair PASS",
  depends_on:["repair-validation"],
  permissions:[{resource:root,operation:"create_pull_request",
   reason:"Original Engineer already granted review authority"}]
 }];
 const planner=prepareR106(h,{draft:()=>({tasks})});
 const result=await planner.proposeAndReserve();
 assert.equal(result.epoch,2);
 const history=await h.intake.verifiedEpochHistory();
 const latest=history.at(-1)!.plan;
 assert.equal(latest.tasks.length,3);
 assert.equal(latest.tasks[2].agent_id,"orchestrator");
 assert.equal(latest.candidate_agents.length,2);
 assert.deepEqual(latest.tasks[2].depends_on,["repair-validation"]);
 assert.equal(latest.requested_permissions.at(-1).operation,"create_pull_request");
 // Runtime admission is still a distinct trusted operation; no PR is
 // executed or authorized just because a proposal and journal exist.
 assert.equal(h.provider,3);
});
test("R106 PR cannot bypass the new Test's positive completion",async(t)=>{
 const h=await verifiedFailureForR106(t);
 const draft=repairDraft();
 const tasks=[...draft.tasks,{
  id:"premature-pr",agent_id:"orchestrator",title:"Open PR early",
  description:"An unapproved early PR",
  depends_on:["repair-implementation"],
  permissions:[{resource:root,operation:"create_pull_request",reason:"Review"}]
 }];
 await assert.rejects(
  prepareR106(h,{draft:()=>({tasks})}).proposeAndReserve(),
  /Optional review PR must depend on passing Test/);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
});
test("R106 model cannot add initial-branch creation as a repair shortcut",async(t)=>{
 const h=await verifiedFailureForR106(t);
 const draft=repairDraft();
 const tasks=[...draft.tasks,{
  id:"new-branch",agent_id:"orchestrator",title:"Unexpected branch",
  description:"Wrongly discard the changed code",
  depends_on:[],
  permissions:[{resource:root,operation:"create_branch",reason:"Reset"}]
 }];
 await assert.rejects(
  prepareR106(h,{draft:()=>({tasks})}).proposeAndReserve(),
  /Orchestrator may only create review PR/);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
});

test("R107 trusted feature HEAD denies a foreign provider repository and malformed SHA",async(t)=>{
 const h=await verifiedFailureForR106(t);
 const makeReader=(fullName:string,commitSha:string)=>new TrustedOperationalFeatureHeadReader({
  intake:h.intake,repository:repo,
  giteaClient:new GiteaClient({
   baseUrl:"http://trusted-gitea.local",token:"private-fixture-only",
   owner:repo.owner,repository:repo.repository,
   fetchFn:(async(url:unknown)=>{
    if(String(url).endsWith("/repos/sample/invoice-service"))
     return new Response(JSON.stringify({
      owner:{login:repo.owner},name:repo.repository,
      full_name:fullName,default_branch:"main"
     }),{status:200});
    return new Response(JSON.stringify({
     name:branch,commit:{id:commitSha}
    }),{status:200});
   }) as typeof fetch
  })
 });
 await assert.rejects(
  makeReader("other/invoice-service",sha).read(repo,branch),
  /provider repository identity differs/);
 await assert.rejects(
  makeReader("sample/invoice-service","deadbeef").read(repo,branch),
  /noncanonical provider branch HEAD/);
 await assert.rejects(
  makeReader("sample/invoice-service",sha).read(
   {...repo,repository:"foreign"},branch),
  /requested repository is not pinned/);
 await assert.rejects(
  makeReader("sample/invoice-service",sha).read(repo,"feature/other"),
  /working branch differs/);
});
test("R107 feature reader cannot be rebound to another Coordinator/root or used after revocation",async(t)=>{
 const h=await verifiedFailureForR106(t);
 const alternate=await harness(t);
 const reader=new TrustedOperationalFeatureHeadReader({
  intake:h.intake,repository:repo,
  giteaClient:new GiteaClient({
   baseUrl:"http://trusted-gitea.local",token:"private",
   owner:repo.owner,repository:repo.repository,
   fetchFn:(async()=>{throw Error("provider must not be contacted");}) as typeof fetch
  })
 });
 assert.throws(()=>reader.assertSameIntake(alternate.intake),
  /another operational root/);
 h.setPhase("closed");
 await assert.rejects(reader.read(repo,branch),
  /operational root is not active/);
});

/** The scripted Gitea metadata port is NOT a general source-read API. */
const trustedFeature=(h:Awaited<ReturnType<typeof harness>>)=>
 new TrustedOperationalFeatureHeadReader({
  intake:h.intake,repository:repo,
  giteaClient:new GiteaClient({
   baseUrl:"http://trusted-gitea.local",token:"private-fixture-only",
   owner:repo.owner,repository:repo.repository,
   fetchFn:(async(url:unknown)=>{
    if(String(url).endsWith("/repos/sample/invoice-service"))
     return new Response(JSON.stringify({owner:{login:repo.owner},
      name:repo.repository,full_name:"sample/invoice-service",
      default_branch:"main"}),{status:200});
    return new Response(JSON.stringify({
     name:branch,commit:{id:sha}
    }),{status:200});
   }) as typeof fetch
  })
 });
test("R108 scoped read after verified FAIL traverses actual Gateway Prepare/VP/OPA/Execute",async(t)=>{
 const h=await harness(t,{withRead:true});
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// buggy"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();await h.invoke("task-test","test","run_tests",runner);
 h.gates.confirmTestValidationFailure("task-test");
 let signed=0;
 const feature=trustedFeature(h);
 const reader=new TrustedOperationalRepairSourceReader({
  gateway:h.runtime,trustedGatewayPlans:h.gates,
  failedRuntimeTestTaskId:"task-test",
  intake:h.intake,featureHeadReader:feature,
  sessionId:session,runtimeTaskId:"source-read-task",
  agentRole:"backend",expectedTestedSha:sha,
  issueSignedVp:async challenge=>{
   signed++;
   assert.equal(challenge.required_permission.resource,file);
   assert.equal(challenge.required_permission.operation,"read_file");
   assert.ok(challenge.challenge.length>20);
   return "signed.fixture.vp";
  }
 });
 await assert.rejects(reader.read("src/invoices.ts"),
  /outside approved plan|Unknown|task/i);
 assert.equal(signed,0);
 assert.equal(h.provider,3);
 h.gates.bindTask(session,"read-diagnostics","source-read-task","backend");
 const source=await reader.read("src/invoices.ts");
 assert.equal(source.status,"gateway_verified_read");
 assert.equal(source.revision,sha);
 assert.equal(source.branch,branch);
 assert.match(source.content,/invoice/);
 assert.ok(source.bytes>0);
 assert.equal(signed,1);
 assert.equal(h.provider,4);
 assert.equal(h.verified,4);
 assert.equal(h.policy,4);
 assert.equal(Object.isFrozen(source),true);
 await h.gates.confirmTaskCompletion("source-read-task");
 await assert.rejects(reader.read("src/invoices.ts"),
  /outside approved plan|completed/);
 assert.equal(signed,1);
});
test("R108 lacking an exact root read grant blocks any Gateway or VP operation",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 let signCalls=0;
 const reader=new TrustedOperationalRepairSourceReader({
  gateway:h.runtime,trustedGatewayPlans:h.gates,
  failedRuntimeTestTaskId:"task-test",
  intake:h.intake,featureHeadReader:trustedFeature(h),
  sessionId:session,runtimeTaskId:"backend-task",
  agentRole:"backend",expectedTestedSha:sha,
  issueSignedVp:async()=>{signCalls++;return "signed.fixture.vp";}
 });
 await assert.rejects(reader.read("src/invoices.ts"),
  /read_file resource absent from issued Rust root/);
 assert.equal(signCalls,0);assert.equal(h.provider,0);
 await assert.rejects(reader.read("../secrets.ts"),/invalid repository relative file path/);
 assert.equal(signCalls,0);
});
test("R108 revoked root denies source read before any VP or provider work",async(t)=>{
 const h=await harness(t,{withRead:true});
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"read-diagnostics","source-read-task","backend");
 h.setPhase("closed");
 const reader=new TrustedOperationalRepairSourceReader({
  gateway:h.runtime,trustedGatewayPlans:h.gates,
  failedRuntimeTestTaskId:"task-test",
  intake:h.intake,featureHeadReader:trustedFeature(h),
  sessionId:session,runtimeTaskId:"source-read-task",
  agentRole:"backend",expectedTestedSha:sha,
  issueSignedVp:async()=>{throw Error("VP must not be created");}
 });
 await assert.rejects(reader.read("src/invoices.ts"),/operational root is not active/);
 assert.equal(h.provider,0);
});

test("R108 source reader rejects Gateway deployments without signed Task-plan enforcement",async(t)=>{
 const h=await harness(t,{withRead:true});
 await h.intake.reserveInitialEpoch();
 assert.equal(h.runtime.hasTrustedOperationalPlanGate(),true);
 const unguarded=new GatewayRuntime({
  bind_host:"127.0.0.1",bind_port:0,
  prepare:{audience:"cloud-gateway",request_ttl_ms:120000,repository:repo},
  adapter_url:"http://none",adapter_gateway_token:"test-only",
  opa_url:"http://none",opa_timeout_ms:1000,
  provider_mode:"mock",gitea_timeout_ms:1000
 },{
  executor:{provider:"gitea",
   async execute(){throw Error("No unauthenticated source read");}},
  verifier:{async verify(){throw Error("No verifier call");}},
  policy:{async evaluate(){throw Error("No OPA call");}}
 });
 assert.equal(unguarded.hasTrustedOperationalPlanGate(),false);
 assert.throws(()=>new TrustedOperationalRepairSourceReader({
  gateway:unguarded,trustedGatewayPlans:h.gates,
  failedRuntimeTestTaskId:"task-test",intake:h.intake,
  featureHeadReader:trustedFeature(h),
  sessionId:session,runtimeTaskId:"not-bound",
  agentRole:"backend",expectedTestedSha:sha,
  issueSignedVp:async()=>{throw Error("No authority");}
 }),/real Gateway, owner intake, provider and VP issuer required/);
});

test("R108 an authorized read Task still cannot expose code to ADK without a corroborated FAIL",async(t)=>{
 const h=await harness(t,{withRead:true});
 await h.intake.reserveInitialEpoch();await h.gates.activate(session,sha);
 h.gates.bindTask(session,"backend-original","runtime-backend","backend");
 h.gates.bindTask(session,"test-original","runtime-test-missing","test");
 h.gates.bindTask(session,"read-diagnostics","runtime-source","backend");
 let vpCalls=0;
 const reader=new TrustedOperationalRepairSourceReader({
  gateway:h.runtime,trustedGatewayPlans:h.gates,
  failedRuntimeTestTaskId:"runtime-test-missing",
  intake:h.intake,featureHeadReader:trustedFeature(h),
  sessionId:session,runtimeTaskId:"runtime-source",
  agentRole:"backend",expectedTestedSha:sha,
  issueSignedVp:async()=>{vpCalls++;return "signed.fixture.vp";}
 });
 await assert.rejects(reader.read("src/invoices.ts"),
  /No terminal Gateway-confirmed validation failure/);
 assert.equal(vpCalls,0);
 assert.equal(h.provider,0);
});


async function r109FailedFixture(t:import("node:test").TestContext){
 const h=await harness(t,{withInlineRead:true});
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// error"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();
 await h.invoke("task-test","test","run_tests",runner);
 h.gates.confirmTestValidationFailure("task-test");
 return h;
}
async function r109IssueChild(h:Awaited<ReturnType<typeof r109FailedFixture>>){
 const journalDir=join(h.dir,"r109-child-issuance");
 await mkdir(journalDir,{mode:0o700});
 const journal=new TrustedChildIssuanceJournal({
  directory:journalDir,sessionId:session,baseRevision:sha,
  planDigest:h.rootAuthority.plan_digest,
  parentCredentialId:h.rootAuthority.credential_id
 });
 const adapterCalls:any[]=[];
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.createForRepairDiscovery({
  intake:h.intake,gateway:h.gates,coordinator:h.coordinator,
  sessionId:session,engineerDid:engineer,
  failedRuntimeTestTaskId:"task-test",
  discoveryTaskId:"new-discovery-r109",role:"backend",resource:file,
  issuanceJournal:journal,
  adapterBaseUrl:"http://127.0.0.1:9999",
  bearerToken:"private-owner-only",
  fetchFn:(async (_url:unknown,request:any)=>{
   const body=JSON.parse(String(request.body));
   adapterCalls.push(body);
   return new Response(JSON.stringify({
    "@context":["https://www.w3.org/ns/credentials/v2"],
    type:["VerifiableCredential","DelegationCredential"],
    id:body.credential_id,issuer:"did:example:orchestrator",
    credentialSubject:{sub:"did:example:backend",per:body.permissions}
   }),{status:201});
  }) as typeof fetch
 });
 const child=await issuer.issueSpecializedChild({
  parent_credential_id:h.rootAuthority.credential_id,
  approved_task_id:"new-discovery-r109",
  selection:{role:"backend"},
  credential_id:"urn:child:repair-discovery",
  valid_from:"2026-10-29T10:00:00Z",validity_seconds:300,
  credential_status:{type:"BitstringStatusListEntry",
   statusPurpose:"revocation",statusListIndex:"9210",
   statusListCredential:"https://status.example/discovery"}
 });
 assert.equal(child.role,"backend");
 assert.equal(child.credential.id,"urn:child:repair-discovery");
 assert.deepEqual(adapterCalls[0].permissions,[{resource:file,operation:"read_file"}]);
 assert.equal(adapterCalls[0].parent_credential_id,
  h.rootAuthority.credential_id);
 assert.equal((await journal.records())[0].observation,
  "adapter_response_verified");
 return {journal,issuer,adapterCalls};
}
test("R109 new Task ID receives only the original Rust root read grant, then VP/Gateway/OPA read",async(t)=>{
 const h=await r109FailedFixture(t);
 assert.throws(()=>h.gates.bindTask(session,"new-discovery-r109",
  "runtime-r109","backend"),/current admitted epoch/);
 const {journal,issuer,adapterCalls}=await r109IssueChild(h);
 assert.equal(adapterCalls.length,1);
 const registered=await h.gates.admitRepairDiscoveryTask({
  sessionId:session,failedRuntimeTestTaskId:"task-test",
  taskId:"new-discovery-r109",agentRole:"backend",
  resource:file,credentialId:"urn:child:repair-discovery",
  childIssuanceJournal:journal
 });
 assert.equal(registered.status,"discovery_read_admitted_not_executed");
 assert.equal(registered.epoch,1);
 await assert.rejects(h.gates.admitRepairDiscoveryTask({
  sessionId:session,failedRuntimeTestTaskId:"task-test",
  taskId:"new-discovery-r109",agentRole:"backend",
  resource:file,credentialId:"urn:child:repair-discovery",
  childIssuanceJournal:journal
 }),/replay|cap exceeded/);
 h.gates.bindTask(session,"new-discovery-r109","runtime-r109","backend");
 assert.throws(()=>h.runtime.prepare({
  task_id:"runtime-r109",agent_role:"backend",
  tool:"update_file",arguments:edit("// must not write")
 }),/Discovery Task can only read/);
 const wrong=h.runtime.prepare({
  task_id:"runtime-r109",agent_role:"backend",
  tool:"read_file",arguments:{branch,path:"src/invoices.ts"}
 });
 await assert.rejects(h.runtime.execute({
  request_id:wrong.request_id,signed_vp:"signed.fixture.vp"
 }),/Trusted approved plan rejected|approved_plan_denied/);
 assert.equal(h.provider,3);
 // The SAME minted child's VP is now used by R108's bounded
 // source reader: no side-channel token, no direct Gitea source access.
 const sourceReader=new TrustedOperationalRepairSourceReader({
  gateway:h.runtime,trustedGatewayPlans:h.gates,
  failedRuntimeTestTaskId:"task-test",
  intake:h.intake,featureHeadReader:trustedFeature(h),
  sessionId:session,runtimeTaskId:"runtime-r109",
  agentRole:"backend",expectedTestedSha:sha,
  issueSignedVp:async challenge=>{
   assert.equal(challenge.required_permission.resource,file);
   assert.equal(challenge.required_permission.operation,"read_file");
   return "signed.r109.discovery";
  }
 });
 const source=await sourceReader.read("src/invoices.ts");
 assert.equal(source.status,"gateway_verified_read");
 assert.equal(source.revision,sha);
 assert.match(source.content,/invoice/);
 assert.equal(h.provider,4);
 assert.equal(h.policy,5);
 await h.gates.confirmTaskCompletion("runtime-r109");
 const next=await h.intake.reserveRepairEpoch(repair());
 assert.equal(next.epoch,2);
 const admitted=await h.gates.admitNextOperationalEpoch(session,2);
 assert.equal(admitted.epoch,2);
 await assert.rejects(issuer.issueSpecializedChild({
  parent_credential_id:h.rootAuthority.credential_id,
  approved_task_id:"new-discovery-r109",
  selection:{role:"backend"},
  credential_id:"urn:child:repair-discovery",
  valid_from:"2026-10-29T10:00:00Z",validity_seconds:300,
  credential_status:{type:"BitstringStatusListEntry",
   statusPurpose:"revocation",statusListIndex:"9210",
   statusListCredential:"https://status.example/discovery"}
 }),/already attempted/);
 assert.equal(adapterCalls.length,1);
});
test("R109 cannot advance repair epoch with an admitted but uncompleted discovery read",async(t)=>{
 const h=await r109FailedFixture(t);
 const {journal}=await r109IssueChild(h);
 await h.gates.admitRepairDiscoveryTask({
  sessionId:session,failedRuntimeTestTaskId:"task-test",
  taskId:"new-discovery-r109",agentRole:"backend",
  resource:file,credentialId:"urn:child:repair-discovery",
  childIssuanceJournal:journal
 });
 await h.intake.reserveRepairEpoch(repair());
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /Unresolved dynamically delegated discovery/);
 assert.equal(h.provider,3);
});
test("R109 denies discovery Task admission without a matching durable Adapter ACK",async(t)=>{
 const h=await r109FailedFixture(t);
 const dir=join(h.dir,"unissued-r109-child");
 await mkdir(dir,{mode:0o700});
 const journal=new TrustedChildIssuanceJournal({
  directory:dir,sessionId:session,baseRevision:sha,
  planDigest:h.rootAuthority.plan_digest,
  parentCredentialId:h.rootAuthority.credential_id
 });
 await assert.rejects(h.gates.admitRepairDiscoveryTask({
  sessionId:session,failedRuntimeTestTaskId:"task-test",
  taskId:"new-discovery-r109",agentRole:"backend",
  resource:file,credentialId:"urn:child:repair-discovery",
  childIssuanceJournal:journal
 }),/No matching one-use Adapter-issued/);
 const proof=await h.intake.preflightRepairDiscovery({
  sessionId:session,taskId:"new-discovery-r109",
  agentId:"backend",resource:file
 });
 assert.equal(proof.execution_authorized,false);
 assert.equal(h.provider,3);
});


/** R112: the host owns the signed root and the SAME Gateway that witnessed
 * Docker, not an A2A "failed" string or a model-generated claim. */
async function r112Dispatcher(t:import("node:test").TestContext,
 options:{testFail:boolean;message?:string;optIn?:boolean;remote?:boolean}){
 const h=await harness(t,{withReview:true,withDurable:options.remote});
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 let remoteClient:TrustedPlanIpcClient|undefined;
 if(options.remote){
  const secretFile=join(h.dir,"r117-hmac-secret.hex");
  const socketPath=join(h.dir,"r117-control.sock");
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
  const server=await createTrustedPlanIpcServer({
   socketPath,secretFile,plans:h.gates
  });
  await server.start();t.after(()=>server.close());
  remoteClient=await TrustedPlanIpcClient.connect({socketPath,secretFile});
  assert.equal(remoteClient.operationalLeaseConfigured(),true);
  assert.equal(remoteClient.operationalSessionDurableConfigured(),true);
 }
 let failedRuntimeId:string|undefined;
 const dispatcher=await TrustedApprovedA2ADispatcher.load({
  approvals:h.signedStore,
  coordinator:h.coordinator as any,
  sessionId:session,expectedPlanDigest:planDigest(h.parent),
  baseRevision:sha,expectedEngineerDid:engineer,
  agentBaseUrls:{backend:"http://trusted.backend",frontend:"http://trusted.frontend",
   test:"http://trusted.test"},
  ...(options.remote?{verifiedTestFailureRecovery:{
   gateway:remoteClient!,intake:h.intake
  }}:options.optIn?{verifiedTestFailureRecovery:{
   gateway:h.gates,intake:h.intake
  }}:{}),
  async authorityForTask(id:string,role){
   return {parent_credential_id:h.rootAuthority.credential_id,
    credential_id:"urn:test:"+id,valid_from:"2026-10-29T09:00:00Z",
    validity_seconds:300,credential_status:{
     type:"BitstringStatusListEntry",statusPurpose:"revocation",
     statusListIndex:role==="test"?"14002":"14001",
     statusListCredential:"https://status.example/a2a"}
   };
  },
  roleRunner:{
   async issueAndRun(input){
    if(input.role==="backend"){
     await h.invoke(input.trusted_gateway_task_id,"backend",
      "update_file",edit("// original change"));
     return {role:"backend",task_id:"remote-backend",
      artifact:{role:"backend",branch,revision:sha,commit_sha:sha,
       files_modified:[],files_created:[],test_outcome:"not_run",
       summary:"Gateway-confirmed backend operation",errors:[]}};
    }
    if(input.role==="test"){
     failedRuntimeId=input.trusted_gateway_task_id;
     if(options.testFail)h.setRunnerFailure();
     await h.invoke(input.trusted_gateway_task_id,"test","run_tests",runner);
     throw Error(options.message??"Protected A2A task ended without completion");
    }
    throw Error("Unexpected specialist dispatch");
   }
  }
 } as any);
 const result=dispatcher.executeApprovedDag({
  async invokeOrchestratorTask(taskId,runtimeTaskId){
   assert.equal(taskId,"setup");
   await h.invoke(runtimeTaskId,"orchestrator","create_branch",
    {branch,base_branch:"main"});
  }
 });
 return {h,dispatcher,result,get failedRuntimeId(){return failedRuntimeId;}};
}
test("R112 a corroborated terminal Test FAIL suspends only old A2A DAG; new root-scoped epoch may begin",async(t)=>{
 const x=await r112Dispatcher(t,{testFail:true,optIn:true});
 const outcome=await x.result;
 assert.equal(outcome.status,"verified_test_failure_suspended");
 assert.equal(outcome.verified_test_failure?.status,"repair_planning_eligible");
 assert.equal(outcome.verified_test_failure?.provenance,
  "gateway_verified_docker_runner");
 assert.equal(outcome.verified_test_failure?.failed_task_id,"test-original");
 assert.equal(outcome.verified_test_failure?.failed_runtime_task_id,x.failedRuntimeId);
 assert.deepEqual(outcome.completed_task_ids,["setup","backend-original"]);
 assert.equal(x.h.coordinator.phase,"execution");
 assert.equal(x.h.provider,3);
 await assert.rejects(x.dispatcher.dispatch("test-original"),
  /inactive|already running/);
 const planned=await x.h.intake.reserveRepairEpoch(repair());
 assert.equal(planned.epoch,2);
 const admitted=await x.h.gates.admitNextOperationalEpoch(session,2);
 assert.equal(admitted.epoch,2);
 assert.deepEqual(admitted.blocked_descendant_task_ids,["post-review","pr-after-test"]);
 assert.equal(x.h.coordinator.phase,"execution");
});
test("R112 no actual failed Runner denies suspension and retires the root",async(t)=>{
 const x=await r112Dispatcher(t,{testFail:false,optIn:true});
 await assert.rejects(x.result,/Protected A2A task ended without completion/);
 assert.equal(x.h.coordinator.phase,"closed");
 await assert.rejects(x.h.intake.verifiedEpochHistory(),
  /operational root is not active/);
});
test("R112 transport error still retires root despite a real Runner FAIL",async(t)=>{
 const x=await r112Dispatcher(t,{testFail:true,optIn:true,
  message:"Connection reset during A2A transport"});
 await assert.rejects(x.result,/Connection reset during A2A transport/);
 assert.equal(x.h.coordinator.phase,"closed");
});

test("R117 authenticated Gateway IPC confirms failed Test in A2A dispatcher without retiring Rust root",async(t)=>{
 const x=await r112Dispatcher(t,{testFail:true,remote:true});
 const status=await x.result;
 assert.equal(status.status,"verified_test_failure_suspended");
 assert.equal(status.verified_test_failure.provenance,"gateway_verified_docker_runner");
 assert.equal(status.verified_test_failure.failed_runtime_task_id,x.failedRuntimeId);
 assert.equal(status.verified_test_failure.first_failed_phase,"typecheck");
 assert.equal(status.verified_test_failure.execution_authorized,false);
 assert.equal(status.verified_test_failure.permission_granted,false);
 assert.equal(x.h.coordinator.phase,"execution");
 assert.deepEqual(status.completed_task_ids,["setup","backend-original"]);
 await assert.rejects(x.dispatcher.dispatch("test-original"),
  /inactive or already running/);
 const next=await x.h.intake.reserveRepairEpoch(repair());
 assert.equal(next.epoch,2);
 const admitted=await x.h.gates.admitNextOperationalEpoch(session,2);
 assert.equal(admitted.epoch,2);
 assert.equal(x.h.coordinator.phase,"execution");
});
test("R117 IPC cannot turn an A2A failure with no Docker FAIL into repair eligibility",async(t)=>{
 const x=await r112Dispatcher(t,{testFail:false,remote:true});
 await assert.rejects(x.result,/Protected A2A task ended without completion/);
 assert.equal(x.h.coordinator.phase,"closed");
 assert.equal(x.h.provider,3);
});
test("R117 transport uncertainty despite genuine Docker FAIL always revokes the root",async(t)=>{
 const x=await r112Dispatcher(t,{testFail:true,remote:true,
  message:"Connection reset during protected A2A poll"});
 await assert.rejects(x.result,/Connection reset during protected A2A poll/);
 assert.equal(x.h.coordinator.phase,"closed");
});

test("R112 legacy dispatcher without trusted recovery opts out and remains terminal",async(t)=>{
 const x=await r112Dispatcher(t,{testFail:true,optIn:false});
 await assert.rejects(x.result,/Protected A2A task ended without completion/);
 assert.equal(x.h.coordinator.phase,"closed");
});

test("R114 real Gateway pins original root before terminal Test FAIL finalization",async(t)=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// bug"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();
 await h.invoke("task-test","test","run_tests",runner);
 const rootPlan=planDigest(h.parent);
 assert.throws(()=>h.gates.confirmTestValidationFailure("task-test",{
  session_id:"foreign-session",root_plan_digest:rootPlan
 }),/different signed root/);
 assert.throws(()=>h.gates.confirmTestValidationFailure("task-test",{
  session_id:session,root_plan_digest:"b".repeat(64)
 }),/different signed root/);
 // Wrong bindings do not consume the Gateway's one terminal FAIL.
 const verified=h.gates.confirmTestValidationFailure("task-test",{
  session_id:session,root_plan_digest:rootPlan
 });
 assert.equal(verified.status,"validation_failed");
 assert.equal(verified.session_id,session);
 assert.equal(verified.root_plan_digest,rootPlan);
 assert.throws(()=>h.gates.confirmTestValidationFailure("task-test",{
  session_id:session,root_plan_digest:rootPlan
 }),/No unique verified failed Runner/);
});

/** R115: the same REAL Gateway plan registry serves both HTTP-authorized
 * scripted provider receipts and the HMAC IPC; the original signed-root
 * intake is independently persisted and held by the Engineer owner.
 * No paid models, container engine, or external service are invoked here. */
async function r115RemoteFixture(t:import("node:test").TestContext,
 options:{withDurable?:boolean;withRemoteEpoch?:boolean}={}){
 const h=await harness(t,options);
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// source fails"));
 await h.gates.confirmTaskCompletion("task-backend");
 h.setRunnerFailure();
 await h.invoke("task-test","test","run_tests",runner);
 const secretFile=join(h.dir,"r115-ipc-secret.hex");
 const socketPath=join(h.dir,"r115-control.sock");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 const server=await createTrustedPlanIpcServer({
  socketPath,secretFile,plans:h.gates
 });
 await server.start();
 t.after(()=>server.close());
 const client=await TrustedPlanIpcClient.connect({socketPath,secretFile});
 const request=()=>({
  gateway:client,intake:h.intake,coordinator:h.coordinator,
  sessionId:session,runtimeTestTaskId:"task-test"
 });
 return {h,client,request};
}

test("R115 verified remote IPC FAIL joins the signed original root and durable epoch",async t=>{
 const {h,request}=await r115RemoteFixture(t);
 const result=await prepareTrustedRemoteRepairFeedback(request());
 assert.equal(result.status,"repair_planning_eligible");
 assert.equal(result.provenance,"gateway_verified_docker_runner");
 assert.equal(result.authority_kind,"existing_rust_operational_root");
 assert.equal(result.session_id,session);
 assert.equal(result.root_plan_digest,planDigest(h.parent));
 assert.equal(result.failed_plan_digest,planDigest(h.parent));
 assert.equal(result.failed_runtime_task_id,"task-test");
 assert.equal(result.failed_task_id,"test-original");
 assert.equal(result.first_failed_phase,"typecheck");
 assert.deepEqual(result.typecheck_error_codes,["TS2339"]);
 assert.equal(result.work_branch,branch);
 assert.equal(result.failed_epoch,1);
 assert.equal(result.remaining_repair_epochs,2);
 assert.equal(result.permission_granted,false);
 assert.equal(result.execution_authorized,false);
 assert.equal(Object.isFrozen(result),true);
 assert.equal(h.coordinator.phase,"execution");
 // The exact Test acknowledgment is one-use, not replayable for a new DAG.
 await assert.rejects(prepareTrustedRemoteRepairFeedback(request()),
  /Gateway trusted control denied/);
});

test("R115 wrong session, Task or Coordinator cannot finalize another root's failure",async t=>{
 const {h,request}=await r115RemoteFixture(t);
 const correct=request();
 await assert.rejects(prepareTrustedRemoteRepairFeedback({
  ...correct,coordinator:{
   phase:"execution" as const,
   trustedOperationalAuthority:()=>h.coordinator.trustedOperationalAuthority()
  }
 }),/Coordinator instance differs from epoch owner/);
 await assert.rejects(prepareTrustedRemoteRepairFeedback({
  ...correct,sessionId:"other-signed-session"
 }),/Gateway trusted control denied/);
 await assert.rejects(prepareTrustedRemoteRepairFeedback({
  ...correct,runtimeTestTaskId:"different-test"
 }),/Gateway trusted control denied/);
 // Failed attempts did not consume the true Test receipt.
 const accepted=await prepareTrustedRemoteRepairFeedback(correct);
 assert.equal(accepted.failed_runtime_task_id,"task-test");
});

test("R115 revoked root after remote IPC response cannot yield repair eligibility",async t=>{
 const {h,client,request}=await r115RemoteFixture(t);
 const original=client.confirmVerifiedTestFailure.bind(client);
 client.confirmVerifiedTestFailure=async pins=>{
  const verified=await original(pins);
  // Simulate SIGTERM racing the awaited HMAC Unix-socket response.
  h.setPhase("closed");
  return verified;
 };
 await assert.rejects(prepareTrustedRemoteRepairFeedback(request()),
  /operational root is not active/);
 assert.equal(h.coordinator.phase,"closed");
});

test("R115 missing real Docker FAIL cannot be converted from model or A2A text",async t=>{
 const h=await harness(t);
 await h.intake.reserveInitialEpoch();
 await h.gates.activate(session,sha);
 h.gates.bindTask(session,"setup","task-setup","orchestrator");
 h.gates.bindTask(session,"backend-original","task-backend","backend");
 h.gates.bindTask(session,"test-original","task-test","test");
 await h.invoke("task-setup","orchestrator","create_branch",
  {branch,base_branch:"main"});
 await h.gates.confirmTaskCompletion("task-setup");
 await h.invoke("task-backend","backend","update_file",edit("// code"));
 await h.gates.confirmTaskCompletion("task-backend");
 const secretFile=join(h.dir,"r115-no-fail.secret.hex");
 const socketPath=join(h.dir,"r115-no-fail.sock");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 const server=await createTrustedPlanIpcServer({
  socketPath,secretFile,plans:h.gates
 });
 await server.start();
 t.after(()=>server.close());
 const client=await TrustedPlanIpcClient.connect({socketPath,secretFile});
 await assert.rejects(prepareTrustedRemoteRepairFeedback({
  gateway:client,intake:h.intake,coordinator:h.coordinator,
  sessionId:session,runtimeTestTaskId:"task-test"
 }),/Gateway trusted control denied/);
 assert.equal(h.provider,2,"No fake Test or model claim reached Runner");
});

function r121RemotePlanner(h:Awaited<ReturnType<typeof harness>>,
 gateway:TrustedPlanIpcClient,options:{
  propose?:()=>Promise<unknown>|unknown;
  observedSha?:()=>Promise<string>|string;
  counters?:{model:number;head:number};
  alreadyFinalized?:boolean;
 }={}){
 const reader=new GiteaClient({
  baseUrl:"http://gitea.local:3000",token:"private-r121-fixture",
  owner:repo.owner,repository:repo.repository,timeoutMs:1000,
  fetchFn:(async (url:unknown)=>{
   const request=String(url);
   if(request.endsWith("/repos/sample/invoice-service"))
    return new Response(JSON.stringify({
     owner:{login:repo.owner},name:repo.repository,
     full_name:repo.owner+"/"+repo.repository,default_branch:"main"
    }),{status:200,headers:{"content-type":"application/json"}});
   if(request.endsWith("/branches/feature%2Finvoice-approval")){
    if(options.counters)options.counters.head++;
    return new Response(JSON.stringify({name:branch,
     commit:{id:options.observedSha?await options.observedSha():sha}
    }),{status:200,headers:{"content-type":"application/json"}});
   }
   return new Response("{}",{status:404});
  }) as typeof fetch
 });
 return new TrustedOperationalRepairPlanner({
  gateway,coordinator:h.coordinator,intake:h.intake,sessionId:session,
  ...(options.alreadyFinalized?{failedTestAlreadyFinalized:true}:{}),
  runtimeTestTaskId:"task-test",nextPlanId:"r121-remote-repair-2",
  pinnedAgentRegistry:registry,
  featureHeadReader:new TrustedOperationalFeatureHeadReader({
   giteaClient:reader,intake:h.intake,repository:repo
  }),
  proposeRepairPlan:async()=>{
   if(options.counters)options.counters.model++;
   return options.propose?await options.propose():repairDraft();
  }
 });
}

test("R121 one-use authenticated IPC FAIL reserves a NEW signed repair epoch",async t=>{
 const {h,client}=await r115RemoteFixture(t,{withDurable:true});
 const counts={model:0,head:0};
 const planner=r121RemotePlanner(h,client,{counters:counts});
 const done=await planner.proposeAndReserve();
 assert.equal(done.status,"repair_epoch_reserved_no_execution_authority");
 assert.equal(done.epoch,2);
 assert.equal(done.source_failed_sha,sha);
 assert.equal(done.execution_authorized,false);
 assert.equal(done.child_credential_issued,false);
 assert.deepEqual(counts,{model:1,head:2});
 const rows=await h.intake.verifiedEpochHistory();
 assert.equal(rows.length,2);
 assert.equal(rows[1].plan.plan_id,"r121-remote-repair-2");
 assert.deepEqual(rows[1].plan.tasks.map(t=>t.id),
  ["repair-implementation","repair-validation"]);
 assert.ok(rows[1].plan.tasks.every(task=>
  !h.parent.tasks.some(previous=>previous.id===task.id)));
 await assert.rejects(client.confirmVerifiedTestFailure({
  session_id:session,root_plan_digest:planDigest(h.parent),
  runtime_task_id:"task-test"
 }),/Gateway trusted control denied/);
 await assert.rejects(planner.proposeAndReserve(),/already attempted/);
 assert.equal(h.provider,3,"No unauthorized repair provider effect");
});

test("R121 remote planner root revoked during proposal cannot reserve epoch",async t=>{
 const {h,client}=await r115RemoteFixture(t,{withDurable:true});
 const counts={model:0,head:0};
 const planner=r121RemotePlanner(h,client,{counters:counts,
  propose(){h.setPhase("closed");return repairDraft();}
 });
 await assert.rejects(planner.proposeAndReserve(),
  /operational root is not active/);
 assert.equal(counts.model,1);
 assert.equal(h.provider,3);
});

test("R121 remote planner rejects stale Gitea SHA before inference",async t=>{
 const {h,client}=await r115RemoteFixture(t,{withDurable:true});
 const counts={model:0,head:0};
 await assert.rejects(r121RemotePlanner(h,client,{counters:counts,
  observedSha:()=>"b".repeat(40)
 }).proposeAndReserve(),/branch HEAD differs/);
 assert.equal(counts.model,0);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
});

test("R121 remote planner rejects feature SHA drift after model",async t=>{
 const {h,client}=await r115RemoteFixture(t,{withDurable:true});
 const counts={model:0,head:0};
 await assert.rejects(r121RemotePlanner(h,client,{counters:counts,
  observedSha:()=>counts.head===1?sha:"c".repeat(40)
 }).proposeAndReserve(),/branch HEAD differs/);
 assert.deepEqual(counts,{model:1,head:2});
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
});

test("R121 remote planner denies proposed permissions outside signed Rust root",async t=>{
 const {h,client}=await r115RemoteFixture(t,{withDurable:true});
 const rogue=repairDraft();
 rogue.tasks[0].permissions[0].resource=
  root+"/branches/feature%2Finvoice-approval/files/private/secret.ts";
 await assert.rejects(r121RemotePlanner(h,client,{
  propose:()=>rogue
 }).proposeAndReserve(),/outside actually issued root/);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
 assert.equal(h.provider,3);
});

test("R121 remote planner requires durable IPC Gateway and identical Coordinator",async t=>{
 const {h,client}=await r115RemoteFixture(t);
 assert.throws(()=>r121RemotePlanner(h,client),/durable Gateway fences/);
 const d=await r115RemoteFixture(t,{withDurable:true});
 // A factory-like Coordinator is NOT the exact owner bound to the intake.
 d.h.intake.assertSameCoordinator(d.h.coordinator);
 const originalReader=new TrustedOperationalFeatureHeadReader({
  intake:d.h.intake,repository:repo,
  giteaClient:new GiteaClient({baseUrl:"http://gitea.local:3000",
   token:"private-test",owner:repo.owner,repository:repo.repository})
 });
 assert.throws(()=>new TrustedOperationalRepairPlanner({
  gateway:d.client,coordinator:{
   phase:"execution" as const,
   trustedOperationalAuthority:()=>d.h.coordinator.trustedOperationalAuthority()
  },intake:d.h.intake,sessionId:session,runtimeTestTaskId:"task-test",
  nextPlanId:"r121-wrong-owner",pinnedAgentRegistry:registry,
  featureHeadReader:originalReader,proposeRepairPlan:async()=>repairDraft()
 }),/Coordinator instance differs/);
 assert.equal((await d.h.intake.verifiedEpochHistory()).length,1);
});

test("R122 finalized-only IPC reads are independently pinned and do not retry Docker",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{withDurable:true});
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  runtime_task_id:"task-test"};
 await assert.rejects(client.readConfirmedTestFailure(pins),
  /Gateway trusted control denied/);
 const initial=await prepareTrustedRemoteRepairFeedback(request());
 const read1=await client.readConfirmedTestFailure(pins);
 const read2=await client.readConfirmedTestFailure(pins);
 assert.deepEqual(read1,read2);
 assert.equal(read1.status,"validation_failed");
 assert.deepEqual(await prepareTrustedRemoteRepairFeedback({
  ...request(),alreadyFinalized:true
 }),initial);
 for(const wrong of [
  {...pins,session_id:"r122-wrong-session"},
  {...pins,root_plan_digest:"b".repeat(64)},
  {...pins,runtime_task_id:"r122-wrong-task"}
 ])await assert.rejects(client.readConfirmedTestFailure(wrong),
   /Gateway trusted control denied/);
 await assert.rejects(client.confirmVerifiedTestFailure(pins),
  /Gateway trusted control denied/);
 assert.equal(h.provider,3);
 await h.gates.retireSession(session);
 await assert.rejects(client.readConfirmedTestFailure(pins),
  /Gateway trusted control denied/);
});

test("R122 one-use dispatcher FAIL can enter the R121 planner without replay",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{withDurable:true});
 const counters={model:0,head:0};
 await assert.rejects(r121RemotePlanner(h,client,{
  counters,alreadyFinalized:true
 }).proposeAndReserve(),/Gateway trusted control denied/);
 assert.deepEqual(counters,{model:0,head:0});
 const feedback=await prepareTrustedRemoteRepairFeedback(request());
 assert.equal(feedback.status,"repair_planning_eligible");
 const result=await r121RemotePlanner(h,client,{
  counters,alreadyFinalized:true
 }).proposeAndReserve();
 assert.equal(result.epoch,2);
 assert.equal(result.child_credential_issued,false);
 assert.equal(result.execution_authorized,false);
 assert.deepEqual(counters,{model:1,head:2});
 assert.equal((await h.intake.verifiedEpochHistory()).length,2);
 assert.equal(h.provider,3);
});

test("R123 owner recovery arms original signed Rust root and permits one verified IPC handoff",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{withDurable:true});
 const epochDirectory=join(h.dir,"r123-owner-epochs");
 await mkdir(epochDirectory,{mode:0o700});
 let delivered=0;
 const armed=await armTrustedOwnerOperationalRecovery({
  gateway:client,coordinator:h.coordinator,
  signedApprovals:h.signedStore,epochDirectory,
  running:{readiness:{
   session_id:session,base_revision:sha,
   plan_digest:planDigest(h.parent),
   authenticated_engineer_did:engineer
  },operational_root_id:h.rootAuthority.credential_id},
  async continueWithinActiveRoot(proof,intake){
   delivered++;
   assert.equal(proof.status,"repair_planning_eligible");
   assert.equal(proof.failed_runtime_task_id,"task-test");
   assert.equal((await intake.verifiedEpochHistory()).length,1);
  }
 });
 assert.equal((await armed.intake.verifiedEpochHistory()).length,1);
 const verified=await prepareTrustedRemoteRepairFeedback(request());
 await armed.continueWithinActiveRoot(verified);
 assert.equal(delivered,1);
 await assert.rejects(armed.continueWithinActiveRoot(verified),/one-use/);
 assert.equal(h.coordinator.phase,"execution");
 assert.equal(h.provider,3);
});
test("R123 forged owner feedback and changed root are denied before callback",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{withDurable:true});
 const epochDirectory=join(h.dir,"r123-forgery-epochs");
 await mkdir(epochDirectory,{mode:0o700});
 let delivered=0;
 const armed=await armTrustedOwnerOperationalRecovery({
  gateway:client,coordinator:h.coordinator,
  signedApprovals:h.signedStore,epochDirectory,
  running:{readiness:{
   session_id:session,base_revision:sha,
   plan_digest:planDigest(h.parent),
   authenticated_engineer_did:engineer
  },operational_root_id:h.rootAuthority.credential_id},
  async continueWithinActiveRoot(){delivered++;}
 });
 const verified=await prepareTrustedRemoteRepairFeedback(request());
 await assert.rejects(armed.continueWithinActiveRoot({
  ...verified,tested_commit_sha:"b".repeat(40)
 }),/Gateway proof changed/);
 assert.equal(delivered,0);
 // The one-use callback is fenced even if the first signal was forged.
 await assert.rejects(armed.continueWithinActiveRoot(verified),/one-use/);
 h.setPhase("closed");
 await assert.rejects(armTrustedOwnerOperationalRecovery({
  gateway:client,coordinator:h.coordinator,
  signedApprovals:h.signedStore,epochDirectory,
  running:{readiness:{
   session_id:session,base_revision:sha,
   plan_digest:planDigest(h.parent),
   authenticated_engineer_did:engineer
  },operational_root_id:h.rootAuthority.credential_id},
  async continueWithinActiveRoot(){delivered++;}
 }),/original approved Coordinator/);
});

/** R124: true owner continuation takes the signed root's candidate list,
 * Gitea read-only HEAD and an in-process scripted proposal. It does not
 * issue credentials or execute another Runner. */
function r124HeadClient(observed?:()=>string|Promise<string>){
 return new GiteaClient({
  baseUrl:"http://gitea.local:3000",token:"r124-owner-fixture-only",
  owner:repo.owner,repository:repo.repository,timeoutMs:1000,
  fetchFn:(async (url:unknown)=>{
   const request=String(url);
   if(request.endsWith("/repos/sample/invoice-service"))
    return new Response(JSON.stringify({
     owner:{login:repo.owner},name:repo.repository,
     full_name:repo.owner+"/"+repo.repository,default_branch:"main"
    }),{status:200,headers:{"content-type":"application/json"}});
   if(request.endsWith("/branches/feature%2Finvoice-approval"))
    return new Response(JSON.stringify({
     name:branch,commit:{id:observed?await observed():sha}
    }),{status:200,headers:{"content-type":"application/json"}});
   return new Response("{}",{status:404});
  }) as typeof fetch
 });
}
async function r124Armed(t:import("node:test").TestContext,options:{
 propose?:()=>Promise<unknown>|unknown;
 observedSha?:()=>string|Promise<string>;
 admitReservedEpoch?:boolean;
}={}){
 const fixture=await r115RemoteFixture(t,{withDurable:true});
 const {h,client}=fixture;
 const epochDirectory=join(h.dir,"r124-owner-"+randomBytes(5).toString("hex"));
 await mkdir(epochDirectory,{mode:0o700});
 let proposals=0;
 const armed=await armTrustedOwnerOperationalRecovery({
  gateway:client,coordinator:h.coordinator,
  signedApprovals:h.signedStore,epochDirectory,
  running:{readiness:{
   session_id:session,base_revision:sha,plan_digest:planDigest(h.parent),
   authenticated_engineer_did:engineer
  },operational_root_id:h.rootAuthority.credential_id},
  planRepairEpoch:{
   giteaClient:r124HeadClient(options.observedSha),
   ...(options.admitReservedEpoch?{admitReservedEpoch:true}:{}),
   proposeRepairPlan:async input=>{
    proposals++;
    assert.equal(input.feedback.tested_commit_sha,sha);
    assert.equal(input.feedback.remaining_repair_epochs,2);
    assert.ok(input.already_delegated_grants.some(g=>
     g.resource===file&&g.operation==="update_file"));
    return options.propose?await options.propose():repairDraft();
   }
  }
 });
 return {...fixture,armed,get proposals(){return proposals;}};
}

test("R124 live Engineer owner reserves fresh DAG after authentic finalized HMAC Test FAIL",async t=>{
 const fixture=await r124Armed(t);
 const {h,request,armed}=fixture;
 const feedback=await prepareTrustedRemoteRepairFeedback(request());
 await armed.continueWithinActiveRoot(feedback);
 const rows=await armed.intake.verifiedEpochHistory();
 assert.equal(rows.length,2);
 assert.equal(rows[1].plan.version,2);
 assert.match(rows[1].plan.plan_id,/^repair-[a-f0-9]{24}$/);
 assert.deepEqual(rows[1].plan.tasks.map(x=>x.id),
  ["repair-implementation","repair-validation"]);
 assert.equal(fixture.proposals,1);
 assert.equal(h.coordinator.phase,"execution");
 assert.equal(h.provider,3,"No new child or provider effect on planning");
 await assert.rejects(armed.continueWithinActiveRoot(feedback),/one-use/);
});

test("R124 stale trusted Gitea SHA blocks model proposal and epoch reservation",async t=>{
 const fixture=await r124Armed(t,{observedSha:()=> "b".repeat(40)});
 const feedback=await prepareTrustedRemoteRepairFeedback(fixture.request());
 await assert.rejects(fixture.armed.continueWithinActiveRoot(feedback),
  /branch HEAD differs/);
 assert.equal(fixture.proposals,0);
 assert.equal((await fixture.armed.intake.verifiedEpochHistory()).length,1);
 assert.equal(fixture.h.provider,3);
});

test("R124 malicious model grant never reaches durable repair epoch",async t=>{
 const rogue=repairDraft();
 rogue.tasks[0].permissions[0].resource=
  root+"/branches/feature%2Finvoice-approval/files/private/secret.ts";
 const fixture=await r124Armed(t,{propose:()=>rogue});
 const feedback=await prepareTrustedRemoteRepairFeedback(fixture.request());
 await assert.rejects(fixture.armed.continueWithinActiveRoot(feedback),
  /outside actually issued root/);
 assert.equal(fixture.proposals,1);
 assert.equal((await fixture.armed.intake.verifiedEpochHistory()).length,1);
 assert.equal(fixture.h.provider,3);
});

test("R124 root revoked mid-proposal cannot reserve and cannot retry",async t=>{
 let closed:()=>void=()=>{};
 const fixture=await r124Armed(t,{propose:()=>{closed();return repairDraft();}});
 closed=()=>fixture.h.setPhase("closed");
 const feedback=await prepareTrustedRemoteRepairFeedback(fixture.request());
 await assert.rejects(fixture.armed.continueWithinActiveRoot(feedback),
  /operational root is not active/);
 assert.equal(fixture.proposals,1);
 await assert.rejects(fixture.armed.continueWithinActiveRoot(feedback),/one-use/);
 assert.equal(fixture.h.provider,3);
});

test("R124 owner refuses custom callback together with built-in repair planner",async t=>{
 const fixture=await r115RemoteFixture(t,{withDurable:true});
 const {h,client}=fixture;
 const directory=join(h.dir,"r124-conflict");
 await mkdir(directory,{mode:0o700});
 await assert.rejects(armTrustedOwnerOperationalRecovery({
  gateway:client,coordinator:h.coordinator,
  signedApprovals:h.signedStore,epochDirectory:directory,
  running:{readiness:{
   session_id:session,base_revision:sha,
   plan_digest:planDigest(h.parent),authenticated_engineer_did:engineer
  },operational_root_id:h.rootAuthority.credential_id},
  async continueWithinActiveRoot(){},
  planRepairEpoch:{
   giteaClient:r124HeadClient(),
   proposeRepairPlan:async()=>repairDraft()
  }
 }),/exactly one trusted owner continuation/);
 assert.equal(h.provider,3);
});

test("R125 remote Gateway rejects owner-only epoch journal it cannot independently verify",async t=>{
 const fixture=await r124Armed(t,{admitReservedEpoch:true});
 const {h,request,armed}=fixture;
 const verified=await prepareTrustedRemoteRepairFeedback(request());
 // R124's owner-only journal is intentionally distinct from Gateway's
 // independently rooted epoch intake in this fixture. HMAC authentication
 // does NOT make serialized or separately held plans authoritative.
 await assert.rejects(armed.continueWithinActiveRoot(verified),
  /Gateway trusted control denied/);
 assert.equal(fixture.proposals,1);
 assert.equal((await armed.intake.verifiedEpochHistory()).length,2);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
 assert.throws(()=>h.gates.bindTask(
  session,"repair-implementation","r125-foreign-dag","backend"
 ),/current admitted epoch/);
 assert.equal(h.provider,3);
});

test("R125 Gateway with SAME original-root-bound epoch intake admits new Task IDs through HMAC",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{withDurable:true});
 const proof=await prepareTrustedRemoteRepairFeedback(request());
 assert.equal(proof.status,"repair_planning_eligible");
 const next=await h.intake.reserveRepairEpoch(repair());
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:next.plan_digest,epoch:2};
 const receipt=await client.admitVerifiedOperationalEpoch(pins);
 assert.equal(receipt.status,"gateway_epoch_admitted");
 assert.equal(receipt.plan_digest,next.plan_digest);
 assert.deepEqual(receipt.blocked_descendant_task_ids,[]);
 await assert.rejects(client.admitVerifiedOperationalEpoch(pins),
  /Gateway trusted control denied/);
 assert.throws(()=>h.runtime.prepare({
  task_id:"task-backend",agent_role:"backend",tool:"update_file",
  arguments:edit("// old authority")
 }),/Stale operational epoch/);
 h.gates.bindTask(session,"backend-repair","r125-implementation","backend");
 h.gates.bindTask(session,"test-repair","r125-validation","test");
 assert.throws(()=>h.runtime.prepare({
  task_id:"r125-validation",agent_role:"test",tool:"run_tests",
  arguments:runner
 }),/dependency/i);
 await h.invoke("r125-implementation","backend","update_file",edit("// repaired"));
 await h.gates.confirmTaskCompletion("r125-implementation");
 await h.invoke("r125-validation","test","run_tests",runner);
 await h.gates.confirmTaskCompletion("r125-validation");
 assert.equal(h.provider,5,"Two new protected provider effects, not retry");
 assert.equal(h.coordinator.phase,"execution");
});

test("R125 IPC refuses wrong root, version and digest without moving Gateway epoch",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{withDurable:true});
 await prepareTrustedRemoteRepairFeedback(request());
 const reserved=await h.intake.reserveRepairEpoch(repair());
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:reserved.plan_digest,epoch:2};
 for(const bad of [
  {...pins,root_plan_digest:"b".repeat(64)},
  {...pins,plan_digest:"c".repeat(64)},
  {...pins,epoch:3}
 ])await assert.rejects(client.admitVerifiedOperationalEpoch(bad),
  /Gateway trusted control denied/);
 const admitted=await client.admitVerifiedOperationalEpoch(pins);
 assert.equal(admitted.status,"gateway_epoch_admitted");
 assert.equal(admitted.plan_digest,pins.plan_digest);
 assert.deepEqual(admitted.blocked_descendant_task_ids,[]);
 assert.equal(h.provider,3);
});

test("R125 IPC refuses missing durable reserved epoch and unfinished Test failure",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{withDurable:true});
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:planDigest(repair()),epoch:2};
 await assert.rejects(client.admitVerifiedOperationalEpoch(pins),
  /Gateway trusted control denied/);
 await h.intake.reserveRepairEpoch(repair());
 // A Gateway-recorded FAIL, before the trusted owner finalizes it, is NOT
 // quiescent; a model cannot skip finalization to enter repair.
 await assert.rejects(client.admitVerifiedOperationalEpoch(pins),
  /Gateway trusted control denied/);
 // Signed owner ordinarily finalizes and verifies BEFORE reserving.
 // Here the lower-level Gateway regression deliberately tests a
 // finalized transition after a durably reserved but previously
 // non-quiescent epoch. The finalization is still the REAL one-use IPC.
 const p=await client.confirmVerifiedTestFailure({
  session_id:session,root_plan_digest:planDigest(h.parent),
  runtime_task_id:"task-test"
 });
 assert.equal(p.status,"validation_failed");
 assert.equal((await client.admitVerifiedOperationalEpoch(pins)).epoch,2);
 assert.equal(h.provider,3);
});

test("R125 remote epoch admission refuses retired root and wrong session",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{withDurable:true});
 await prepareTrustedRemoteRepairFeedback(request());
 const reserve=await h.intake.reserveRepairEpoch(repair());
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:reserve.plan_digest,epoch:2};
 await assert.rejects(client.admitVerifiedOperationalEpoch({
  ...pins,session_id:"other-session"
 }),/Gateway trusted control denied/);
 await h.gates.retireSession(session);
 await assert.rejects(client.admitVerifiedOperationalEpoch(pins),
  /Gateway trusted control denied/);
 assert.equal(h.provider,3);
});

async function r126InspectFixture(t:import("node:test").TestContext){
 const base=await r115RemoteFixture(t,{withDurable:true});
 const {h}=base;
 const socketPath=join(h.dir,"r126-inspect.sock");
 const secretFile=join(h.dir,"r126-inspect.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 const inspector=new TrustedGatewaySignedEpochInspector({
  directory:join(h.dir,"epochs"),approvals:h.signedStore
 });
 const server=await createTrustedPlanIpcServer({
  socketPath,secretFile,plans:h.gates,signedEpochInspector:inspector
 });
 await server.start();t.after(()=>server.close());
 return {...base,inspector,client:await TrustedPlanIpcClient.connect({
  socketPath,secretFile
 })};
}

test("R126 IPC independently inspects Ed25519 signed original and next durable epochs",async t=>{
 const {h,client,request}=await r126InspectFixture(t);
 assert.equal(client.signedEpochInspectionConfigured(),true);
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:planDigest(h.parent),epoch:1};
 const first=await client.inspectSignedEpoch(pins);
 assert.equal(first.status,"signed_epoch_ledger_consistent_not_native_root_verified");
 assert.equal(first.execution_authorized,false);
 assert.equal(first.gateway_epoch_admitted,false);
 const proof=await prepareTrustedRemoteRepairFeedback(request());
 assert.equal(proof.status,"repair_planning_eligible");
 const reserved=await h.intake.reserveRepairEpoch(repair());
 const next=await client.inspectSignedEpoch({
  ...pins,epoch:2,plan_digest:reserved.plan_digest
 });
 assert.equal(next.epoch,2);
 assert.equal(next.child_credential_issued,false);
 assert.equal(h.provider,3);
});

test("R126 wrong root/digest/session, nonexistent epoch cannot become signed Gateway evidence",async t=>{
 const {h,client}=await r126InspectFixture(t);
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:planDigest(h.parent),epoch:1};
 for(const forged of [
  {...pins,session_id:"wrong-session"},
  {...pins,root_plan_digest:"b".repeat(64)},
  {...pins,plan_digest:"c".repeat(64)},
  {...pins,epoch:2}
 ])await assert.rejects(client.inspectSignedEpoch(forged),
  /Gateway trusted control denied/);
 assert.equal(h.provider,3);
});

test("R126 tampered fsynced journal is rejected despite valid signed Engineer receipt",async t=>{
 const {h,client}=await r126InspectFixture(t);
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:planDigest(h.parent),epoch:1};
 assert.equal((await client.inspectSignedEpoch(pins)).epoch,1);
 const path=join(h.dir,"epochs","epoch-001.json");
 const corrupt=JSON.parse(await readFile(path,"utf8"));
 corrupt.plan_digest="b".repeat(64);
 await writeFile(path,JSON.stringify(corrupt)+"\n",{mode:0o600});
 await assert.rejects(client.inspectSignedEpoch(pins),
  /Gateway trusted control denied/);
 assert.equal(h.provider,3);
});

test("R126 signed ledger inspection NEVER admits a different owner-only epoch",async t=>{
 const {h,client,request}=await r126InspectFixture(t);
 await prepareTrustedRemoteRepairFeedback(request());
 const dirname=join(h.dir,"r126-not-gateway-epoch");
 await mkdir(dirname,{mode:0o700});
 const ledger=new TrustedOperationalEpochJournal({
  directory:dirname,sessionId:session,baseRevision:sha,
  rootCredentialId:h.rootAuthority.credential_id,
  originalPlanDigest:planDigest(h.parent),allowedOperations:operations
 });
 await ledger.reserveInitial(h.parent);
 const repairPlan=repair();
 const reserved=await ledger.reserveNext(repairPlan,h.rootAuthority,registry);
 const independent=new TrustedGatewaySignedEpochInspector({
  directory:dirname,approvals:h.signedStore
 });
 const inspected=await independent.inspect({
  session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:reserved.plan_digest,epoch:2
 });
 assert.equal(inspected.gateway_epoch_admitted,false);
 await assert.rejects(client.admitVerifiedOperationalEpoch({
  session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:reserved.plan_digest,epoch:2
 }),/Gateway trusted control denied/);
 assert.equal((await h.intake.verifiedEpochHistory()).length,1);
 assert.equal(h.provider,3);
});

function r127NativeStatusFixture(t:import("node:test").TestContext,
 responder:(id:string)=>unknown|Promise<unknown>){
 let calls=0;
 const status=new TrustedGatewayNativeRootStatusReader({
  baseUrl:"http://adapter.internal:8090",gatewayToken:"private-gateway-only",
  fetchFn:(async (url:unknown,init?:RequestInit)=>{
   calls++;
   assert.equal(String(url),
    "http://adapter.internal:8090/v1/credentials/status/inspect");
   assert.equal(new Headers(init?.headers).get("authorization"),
    "Bearer private-gateway-only");
   assert.equal(init?.method,"POST");
   const body=JSON.parse(String(init?.body));
   assert.deepEqual(Object.keys(body),["credential_id"]);
   return new Response(JSON.stringify(await responder(body.credential_id)),{
    status:200,headers:{"content-type":"application/json"}
   });
  }) as typeof fetch
 });
 return {status,get calls(){return calls;}};
}
async function r127Fixture(t:import("node:test").TestContext,
 responder:(id:string)=>unknown|Promise<unknown>){
 const base=await r115RemoteFixture(t,{withDurable:true});
 const native=r127NativeStatusFixture(t,responder);
 const socketPath=join(base.h.dir,"r127-native.sock");
 const secretFile=join(base.h.dir,"r127-native.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 const inspector=new TrustedGatewaySignedEpochInspector({
  directory:join(base.h.dir,"epochs"),approvals:base.h.signedStore,
  nativeRootStatus:native.status
 });
 const server=await createTrustedPlanIpcServer({
  socketPath,secretFile,plans:base.h.gates,
  signedEpochInspector:inspector
 });
 await server.start();t.after(()=>server.close());
 return {...base,native,client:await TrustedPlanIpcClient.connect({
  socketPath,secretFile
 })};
}
function r127Anchored(id:string, overrides:Record<string,unknown>={}){
 return {credential_id:id,status_purpose:"revocation",
  status_set:false,source:"evm_anchored_signed_jwt",anchor_version:12,
  ...overrides};
}
test("R127 Gateway correlates independent EVM-anchored native Rust root status without granting Tasks",async t=>{
 const f=await r127Fixture(t,id=>r127Anchored(id));
 const pins={session_id:session,root_plan_digest:planDigest(f.h.parent),
  plan_digest:planDigest(f.h.parent),epoch:1};
 assert.equal(f.client.nativeRootInspectionConfigured(),true);
 const status=await f.client.inspectNativeRootStatus(pins);
 assert.equal(status.status,"native_root_status_correlated_not_permission_authority");
 assert.equal(status.native_source,"evm_anchored_signed_jwt");
 assert.equal(status.execution_authorized,false);
 assert.equal(status.gateway_epoch_admitted,false);
 assert.equal(status.root_permissions_verified,false);
 assert.equal(f.native.calls,1);
 assert.equal(f.h.provider,3);
 const later=await prepareTrustedRemoteRepairFeedback(f.request());
 const newEpoch=await f.h.intake.reserveRepairEpoch(repair());
 const followup=await f.client.inspectNativeRootStatus({
  ...pins,epoch:2,plan_digest:newEpoch.plan_digest
 });
 assert.equal(followup.epoch,2);
 assert.equal(later.status,"repair_planning_eligible");
 assert.equal(f.h.provider,3);
});
test("R127 revoked or memory-only Rust status fails closed",async t=>{
 for(const changed of [
  {status_set:true},
  {source:"adapter_memory_only",anchor_version:null},
  {status_purpose:"suspension"},
  {anchor_version:-1},
  {credential_id:"urn:other-issued-root"}
 ]){
  const f=await r127Fixture(t,id=>r127Anchored(id,changed));
  const pins={session_id:session,root_plan_digest:planDigest(f.h.parent),
   plan_digest:planDigest(f.h.parent),epoch:1};
  await assert.rejects(f.client.inspectNativeRootStatus(pins),
   /Gateway trusted control denied/);
  assert.equal(f.native.calls,1);
  assert.equal(f.h.provider,3);
 }
});
test("R127 status read cannot bypass signed epoch or create Gateway admission",async t=>{
 const f=await r127Fixture(t,id=>r127Anchored(id));
 const pins={session_id:session,root_plan_digest:planDigest(f.h.parent),
  plan_digest:planDigest(f.h.parent),epoch:1};
 for(const invalid of [
  {...pins,plan_digest:"b".repeat(64)},
  {...pins,root_plan_digest:"c".repeat(64)},
  {...pins,session_id:"unbound"},
  {...pins,epoch:2}
 ])await assert.rejects(f.client.inspectNativeRootStatus(invalid),
  /Gateway trusted control denied/);
 assert.equal(f.native.calls,0);
 await assert.rejects(f.client.admitVerifiedOperationalEpoch({
  ...pins,epoch:2
 }),/Gateway trusted control denied/);
 assert.equal(f.h.provider,3);
});
test("R127 original root journal race during Adapter lookup is denied",async t=>{
 let f:Awaited<ReturnType<typeof r127Fixture>>;
 f=await r127Fixture(t,async id=>{
  const target=join(f.h.dir,"epochs","epoch-001.json");
  const r=JSON.parse(await readFile(target,"utf8"));
  r.root_credential_id="urn:r127:substituted";
  await writeFile(target,JSON.stringify(r)+"\n",{mode:0o600});
  return r127Anchored(id);
 });
 const pins={session_id:session,root_plan_digest:planDigest(f.h.parent),
  plan_digest:planDigest(f.h.parent),epoch:1};
 await assert.rejects(f.client.inspectNativeRootStatus(pins),
  /Gateway trusted control denied/);
 assert.equal(f.native.calls,1);
 assert.equal(f.h.provider,3);
});

async function r128Fixture(t:import("node:test").TestContext,options:{
 grants?:(grants:Array<{resource:string;operation:string}>)=>
  Array<{resource:string;operation:string}>;
 issued?:Record<string,unknown>; status?:Record<string,unknown>;
 onIssued?:()=>Promise<void>;
 withVp?:boolean; vpMutate?:Record<string,unknown>;
 onVpVerification?:(revokeAdapterRoot:()=>void)=>Promise<void>;
}={}){
 const base=await r115RemoteFixture(t,{withDurable:true});
 let nativeCalls=0,issuedCalls=0;
 let adapterRootRevoked=false;
 const now=BigInt(Date.now())*1_000_000n;
 const reader=new TrustedGatewayNativeRootStatusReader({
  baseUrl:"http://rust-adapter.local:8090",gatewayToken:"r128-gateway-private",
  fetchFn:(async (url:unknown,init?:RequestInit)=>{
   assert.equal(init?.method,"POST");
   assert.equal(new Headers(init.headers).get("authorization"),
    "Bearer r128-gateway-private");
   const json=JSON.parse(String(init.body));
   assert.deepEqual(Object.keys(json),["credential_id"]);
   const rootId=base.h.rootAuthority.credential_id;
   assert.equal(json.credential_id,rootId);
   if(String(url).endsWith("/v1/credentials/status/inspect")){
    nativeCalls++;
    return new Response(JSON.stringify({
     ...r127Anchored(rootId),...options.status,
     ...(adapterRootRevoked?{status_set:true}:{})
    }),{status:200,headers:{"content-type":"application/json"}});
   }
   if(String(url).endsWith("/v1/credentials/root/inspect")){
    issuedCalls++;
    await options.onIssued?.();
    const grants=base.h.rootAuthority.permissions.map(x=>({
     resource:x.resource,operation:x.operation
    }));
    const record={
     credential_id:rootId,issuer_id:engineer,
     delegatee_id:"did:example:orchestrator",
     iat_ns:(now-1_000_000_000n).toString(),
     exp_ns:(now+3_600_000_000_000n).toString(),
     permissions:options.grants?options.grants(grants):grants,
     status:r127Anchored(rootId,
      adapterRootRevoked?{status_set:true}:{}),
     source:"adapter_local_issued_root",
     ...options.issued
    };
    return new Response(JSON.stringify(record),
     {status:200,headers:{"content-type":"application/json"}});
   }
   throw Error("Unexpected Rust Adapter read endpoint");
  }) as typeof fetch
 });
 const socketPath=join(base.h.dir,"r128-issued.sock");
 const secretFile=join(base.h.dir,"r128-issued.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 let signedVpCalls=0,verifiedVpCalls=0;
 let rootVpVerifier:TrustedGatewayRootVpVerifier|undefined;
 if(options.withVp){
  const privateSocket=join(base.h.dir,"r132-root-vp.sock");
  const privateSecret=join(base.h.dir,"r132-root-vp.hex");
  await writeFile(privateSecret,randomBytes(32).toString("hex")+"\n",{mode:0o600});
  const presenter=new TrustedOrchestratorRootPresenter({
   adapterBaseUrl:"http://orchestrator-adapter.local:8090",
   orchestratorToken:"r132-private-orchestrator-only",
   rootCredentialId:base.h.rootAuthority.credential_id,
   rootPermissions:base.h.rootAuthority.permissions,
   fetchFn:(async(url:unknown,init?:RequestInit)=>{
    signedVpCalls++;
    assert.equal(String(url),
     "http://orchestrator-adapter.local:8090/v1/presentations");
    assert.equal(new Headers(init?.headers).get("authorization"),
     "Bearer r132-private-orchestrator-only");
    const data=JSON.parse(String(init?.body));
    assert.equal(data.credential_id,base.h.rootAuthority.credential_id);
    assert.match(data.challenge,/^[a-f0-9]{64}$/);
    return new Response(JSON.stringify({
     signed_vp:"r132-signed-root:"+data.challenge
    }),{status:200});
   }) as typeof fetch
  });
  const server=await createTrustedRootVpSignerServer({
   socketPath:privateSocket,secretFile:privateSecret,
   presenter,rootCredentialId:base.h.rootAuthority.credential_id,
   rootPermissions:base.h.rootAuthority.permissions,
   audience:"urn:thesis:gateway:r132",
   liveRoot:{
    coordinator:base.h.coordinator,
    originalPlanDigest:planDigest(base.h.parent),
    ownerRunActive:()=>base.h.coordinator.phase==="execution"
   }
  });
  await server.start();t.after(()=>server.close());
  rootVpVerifier=new TrustedGatewayRootVpVerifier({
   audience:"urn:thesis:gateway:r132",
   signer:await TrustedRootVpSocketClient.connect({
    socketPath:privateSocket,secretFile:privateSecret
   }),
   verifier:{
    async verify(){throw Error("Single permission verification not allowed");},
    async verifyMultiple(request){
     verifiedVpCalls++;
     await options.onVpVerification?.(()=>{adapterRootRevoked=true;});
     assert.equal(request.presenter,"orchestrator");
     assert.equal(request.audience,"urn:thesis:gateway:r132");
     assert.equal(request.signed_vp,"r132-signed-root:"+request.challenge);
     const now=BigInt(Date.now())*1_000_000n;
     return {
      credential_id:base.h.rootAuthority.credential_id,
      issuer_id:engineer,presenter_id:"did:example:orchestrator",
      hierarchy_depth:0,
      permissions:request.required_permissions,
      expiration:(now+3_600_000_000_000n).toString(),
      ...options.vpMutate
     };
    }
   }
  });
 }
 const inspector=new TrustedGatewaySignedEpochInspector({
  directory:join(base.h.dir,"epochs"),approvals:base.h.signedStore,
  nativeRootStatus:reader,trustedOrchestratorDid:"did:example:orchestrator",
  ...(rootVpVerifier?{rootVpVerifier}:{})
 });
 const control=await createTrustedPlanIpcServer({
  socketPath,secretFile,plans:base.h.gates,signedEpochInspector:inspector
 });
 await control.start();t.after(()=>control.close());
 return {...base,reader,inspector,
  get nativeCalls(){return nativeCalls;},
  get issuedCalls(){return issuedCalls;},
  get signedVpCalls(){return signedVpCalls;},
  get verifiedVpCalls(){return verifiedVpCalls;},
  client:await TrustedPlanIpcClient.connect({socketPath,secretFile})
 };
}
function r128Pins(h:Awaited<ReturnType<typeof r115RemoteFixture>>["h"]){
 return {session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:planDigest(h.parent),epoch:1};
}
test("R128 independent issuer-record grant comparison correlates signed approval, root, lifetime and new epoch",async t=>{
 const f=await r128Fixture(t);
 assert.equal(f.client.nativeIssuedRootInspectionConfigured(),true);
 const pins=r128Pins(f.h);
 const read=await f.client.inspectNativeIssuedRootScope(pins);
 assert.equal(read.status,"native_issued_root_scope_correlated_no_vp_authority");
 assert.equal(read.native_issued_grants_checked,true);
 assert.equal(read.cryptographic_presentation_verified,false);
 assert.equal(read.execution_authorized,false);
 assert.equal(read.gateway_epoch_admitted,false);
 assert.equal(f.issuedCalls,1);
 assert.equal(f.nativeCalls,2);
 const feedback=await prepareTrustedRemoteRepairFeedback(f.request());
 assert.equal(feedback.status,"repair_planning_eligible");
 const reserved=await f.h.intake.reserveRepairEpoch(repair());
 const repairRead=await f.client.inspectNativeIssuedRootScope({
  ...pins,epoch:2,plan_digest:reserved.plan_digest
 });
 assert.equal(repairRead.epoch,2);
 assert.equal(f.issuedCalls,2);
 assert.equal(f.h.provider,3);
});
test("R128 missing, extra or duplicated native issued permissions are rejected",async t=>{
 const bad=[
  (gs:Array<{resource:string;operation:string}>)=>gs.slice(0,1),
  (gs:Array<{resource:string;operation:string}>)=>[...gs,{
   resource:root+"/branches/feature%2Finvoice-approval/files/secret.ts",
   operation:"read_file"
  }],
  (gs:Array<{resource:string;operation:string}>)=>[...gs,gs[0]]
 ];
 for(const grants of bad){
  const f=await r128Fixture(t,{grants});
  await assert.rejects(f.client.inspectNativeIssuedRootScope(r128Pins(f.h)),
   /Gateway trusted control denied/);
  assert.equal(f.h.provider,3);
 }
});
test("R128 issuer, delegatee, expiry, native anchored status and epoch forgery fail closed",async t=>{
 const now=BigInt(Date.now())*1_000_000n;
 for(const opts of [
  {issued:{issuer_id:"did:example:malicious"}},
  {issued:{delegatee_id:"did:example:unknown"}},
  {issued:{exp_ns:(now-1n).toString()}},
  {issued:{status:r127Anchored("urn:root:invoice-service",{
   source:"adapter_memory_only",anchor_version:null})}},
  {status:{status_set:true}}
 ]){
  const f=await r128Fixture(t,opts);
  await assert.rejects(f.client.inspectNativeIssuedRootScope(r128Pins(f.h)),
   /Gateway trusted control denied/);
 }
 const f=await r128Fixture(t);
 await assert.rejects(f.client.inspectNativeIssuedRootScope({
  ...r128Pins(f.h),epoch:2
 }),/Gateway trusted control denied/);
 assert.equal(f.issuedCalls,0);
});
test("R128 original root change while reading real issued claims is denied",async t=>{
 let f:Awaited<ReturnType<typeof r128Fixture>>;
 f=await r128Fixture(t,{onIssued:async()=>{
  const path=join(f.h.dir,"epochs","epoch-001.json");
  const modified=JSON.parse(await readFile(path,"utf8"));
  modified.root_credential_id="urn:r128:race";
  await writeFile(path,JSON.stringify(modified)+"\n",{mode:0o600});
 }});
 await assert.rejects(f.client.inspectNativeIssuedRootScope(r128Pins(f.h)),
  /Gateway trusted control denied/);
 assert.equal(f.issuedCalls,1);
 assert.equal(f.h.provider,3);
});

test("R132 private Gateway correlates signed epoch, EVM status, actual root grants, fresh signed VP",async t=>{
 const f=await r128Fixture(t,{withVp:true});
 const pins=r128Pins(f.h);
 assert.equal(f.client.nativeRootVpInspectionConfigured(),true);
 const proof=await f.client.inspectVerifiedRootVp(pins);
 assert.equal(proof.status,"rust_root_vp_correlated_signed_epoch_no_admission");
 assert.equal(proof.cryptographic_presentation_verified,true);
 assert.equal(proof.native_issued_grants_checked,true);
 assert.equal(proof.gateway_epoch_admitted,false);
 assert.equal(proof.execution_authorized,false);
 assert.equal(proof.child_credential_issued,false);
 assert.equal(f.signedVpCalls,1);
 assert.equal(f.verifiedVpCalls,1);
 await prepareTrustedRemoteRepairFeedback(f.request());
 const epoch=await f.h.intake.reserveRepairEpoch(repair());
 const next=await f.client.inspectVerifiedRootVp({
  ...pins,epoch:2,plan_digest:epoch.plan_digest
 });
 assert.equal(next.epoch,2);
 assert.equal(f.signedVpCalls,2);
 assert.equal(f.verifiedVpCalls,2);
 assert.equal(f.h.provider,3,"reading cryptographic root cannot trigger provider");
 assert.throws(()=>f.h.gates.bindTask(
  session,"backend-repair","r132-unadmitted-new-task","backend"
 ),/current admitted epoch/,
 "Inspecting a signed VP must NOT activate the next operational epoch");
});

test("R132 corrupt Rust presenter, issuer, root identity or extra permissions deny VP",async t=>{
 const bad=[
  {credential_id:"urn:credential:r132-other"},
  {issuer_id:"did:example:untrusted"},
  {presenter_id:"did:example:backend"},
  {hierarchy_depth:1},
  {permissions:[{resource:file,operation:"create_pull_request"}]}
 ];
 for(const vpMutate of bad){
  const f=await r128Fixture(t,{withVp:true,vpMutate});
  await assert.rejects(f.client.inspectVerifiedRootVp(r128Pins(f.h)),
   /Gateway trusted control denied/);
  assert.equal(f.signedVpCalls,1);
  assert.equal(f.h.provider,3);
 }
});

test("R132 invalid signed epoch does not even request a root VP",async t=>{
 const f=await r128Fixture(t,{withVp:true});
 for(const invalid of [
  {...r128Pins(f.h),plan_digest:"b".repeat(64)},
  {...r128Pins(f.h),session_id:"r132-other-session"},
  {...r128Pins(f.h),epoch:2}
 ]){
  await assert.rejects(f.client.inspectVerifiedRootVp(invalid),
   /Gateway trusted control denied/);
 }
 assert.equal(f.signedVpCalls,0);
 assert.equal(f.verifiedVpCalls,0);
 assert.equal(f.h.provider,3);
});

test("R132 revoke live original root DURING VP verification, no stale attestation returned",async t=>{
 let f:Awaited<ReturnType<typeof r128Fixture>>;
 f=await r128Fixture(t,{withVp:true,onVpVerification:async revoke=>{
  revoke(); // Real Adapter revocation becomes visible to a fresh status read
  f.h.setPhase("closed");
 }});
 await assert.rejects(f.client.inspectVerifiedRootVp(r128Pins(f.h)),
  /Gateway trusted control denied/);
 assert.equal(f.signedVpCalls,1);
 assert.equal(f.verifiedVpCalls,1);
 assert.equal(f.h.provider,3);
});

test("R133 HMAC IPC admits remote repair DAG only after finalized Docker Test FAIL",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{
  withDurable:true,withRemoteEpoch:true
 });
 const confirmed=await prepareTrustedRemoteRepairFeedback(request());
 assert.equal(confirmed.status,"repair_planning_eligible");
 const reserved=await h.intake.reserveRepairEpoch(repair());
 const pins={session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:reserved.plan_digest,epoch:2};
 const receipt=await client.admitVerifiedOperationalEpoch(pins);
 assert.equal(receipt.status,"gateway_epoch_admitted");
 assert.equal(receipt.plan_digest,reserved.plan_digest);
 assert.throws(()=>h.runtime.prepare({
  task_id:"task-backend",agent_role:"backend",tool:"update_file",
  arguments:edit("// stale")}),/Stale operational epoch/);
 h.gates.bindTask(session,"backend-repair","r133-backend","backend");
 h.gates.bindTask(session,"test-repair","r133-test","test");
 assert.throws(()=>h.runtime.prepare({
  task_id:"r133-test",agent_role:"test",tool:"run_tests",arguments:runner
 }),/dependency/i);
 await h.invoke("r133-backend","backend","update_file",edit("// repaired"));
 await h.gates.confirmTaskCompletion("r133-backend");
 await h.invoke("r133-test","test","run_tests",runner);
 await h.gates.confirmTaskCompletion("r133-test");
 assert.equal(h.provider,5);
 await assert.rejects(client.admitVerifiedOperationalEpoch(pins),
  /Gateway trusted control denied/);
});

test("R133 unfinalized original Test FAIL cannot admit remote repair",async t=>{
 const {h,client}=await r115RemoteFixture(t,{
  withDurable:true,withRemoteEpoch:true
 });
 const next=await h.intake.reserveRepairEpoch(repair());
 await assert.rejects(client.admitVerifiedOperationalEpoch({
  session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:next.plan_digest,epoch:2
 }),/Gateway trusted control denied/);
 assert.throws(()=>h.gates.bindTask(session,"backend-repair","r133-bad","backend"),
  /current admitted epoch/);
 assert.equal(h.provider,3);
});

test("R133 independently revoked Rust root blocks admission despite signed repair DAG",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{
  withDurable:true,withRemoteEpoch:true
 });
 await prepareTrustedRemoteRepairFeedback(request());
 const next=await h.intake.reserveRepairEpoch(repair());
 h.revokeNativeRoot();
 await assert.rejects(client.admitVerifiedOperationalEpoch({
  session_id:session,root_plan_digest:planDigest(h.parent),
  plan_digest:next.plan_digest,epoch:2
 }),/Gateway trusted control denied/);
 assert.equal(h.provider,3);
});

test("R133 remote Gateway denies missing pins and wrong original Engineer digest",async t=>{
 const {h,client,request}=await r115RemoteFixture(t,{
  withDurable:true,withRemoteEpoch:true
 });
 await prepareTrustedRemoteRepairFeedback(request());
 const next=await h.intake.reserveRepairEpoch(repair());
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /Missing trusted epoch intake/);
 for(const bad of [
  {root_plan_digest:"b".repeat(64),plan_digest:next.plan_digest},
  {root_plan_digest:planDigest(h.parent),plan_digest:"c".repeat(64)}
 ]){
  await assert.rejects(client.admitVerifiedOperationalEpoch({
   session_id:session,epoch:2,...bad
  }),/Gateway trusted control denied/);
 }
 assert.equal(h.provider,3);
});

test("R133.2 a valid Rust VP and fully passing original DAG cannot invent a repair trigger",async t=>{
 const h=await harness(t,{withDurable:true,withRemoteEpoch:true});
 await h.initialPass(); // genuinely passed Test task, NOT terminal FAIL
 const reserved=await h.intake.reserveRepairEpoch(repair());
 assert.equal(reserved.epoch,2);
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2,{
  root_plan_digest:planDigest(h.parent),
  plan_digest:reserved.plan_digest
 }),/Remote repair epoch requires an independently finalized failed Test/);
 assert.throws(()=>h.gates.bindTask(
  session,"backend-repair","r1332-untriggered-backend","backend"
 ),/current admitted epoch/);
 assert.equal(h.provider,3,"Passing original DAG cannot authorize a repair provider effect");
});


/** R134 uses real signed-owner+HMAC Gateway fixtures, but scripted native
 * credential issuance. The resulting DC has no execution/VP authority. */
async function r134Fixture(t:import("node:test").TestContext){
 const {h,client,request}=await r115RemoteFixture(t,{
  withDurable:true,withRemoteEpoch:true
 });
 await prepareTrustedRemoteRepairFeedback(request());
 const reserved=await h.intake.reserveRepairEpoch(repair());
 const dir=join(h.dir,"r134-child-journal");
 await mkdir(dir,{mode:0o700});
 const journal=new TrustedChildIssuanceJournal({
  directory:dir,sessionId:session,baseRevision:sha,
  planDigest:h.rootAuthority.plan_digest,
  parentCredentialId:h.rootAuthority.credential_id
 });
 const calls:{path:string;headers:Headers;body:any}[]=[];
 let revokedOnNativeReturn=false;
 const fetchFn:typeof fetch=async(url,init)=>{
  const body=JSON.parse(String(init?.body));
  calls.push({path:String(url),headers:new Headers(init?.headers),body});
  if(revokedOnNativeReturn)h.setPhase("closed");
  return new Response(JSON.stringify({
   "@context":["https://www.w3.org/ns/credentials/v2"],
   type:["VerifiableCredential","DelegationCredential"],
   id:body.credential_id,issuer:"did:example:orchestrator",
   credentialSubject:{sub:"did:example:"+body.delegatee,per:body.permissions}
  }),{status:201});
 };
 const credential={
  credential_id:"urn:r134:repair-backend-child",
  valid_from:"2026-10-30T16:00:00Z",
  validity_seconds:300,
  credential_status:{
   type:"BitstringStatusListEntry" as const,
   statusPurpose:"revocation" as const,
   statusListIndex:"19031",
   statusListCredential:"https://status.example/repair-r134"
  }
 };
 const args={
  sessionId:session,epoch:2,planDigest:reserved.plan_digest,
  taskId:"backend-repair",role:"backend" as const,
  runtimeTaskId:"r134-runtime-backend",
  coordinator:h.coordinator,intake:h.intake,gateway:client,
  journal,engineerDid:engineer,
  adapterBaseUrl:"http://r134-adapter.local:8090",
  orchestratorToken:"r134-private-owner-bearer",
  credential,fetchFn
 };
 return {h,client,journal,reserved,calls,args,
  revokeOnResponse(){revokedOnNativeReturn=true;},
  async admit(){
   return client.admitVerifiedOperationalEpoch({
    session_id:session,root_plan_digest:planDigest(h.parent),
    plan_digest:reserved.plan_digest,epoch:2
   });
  }
 };
}
test("R134 remote R133 Gateway admission precedes exact Rust repair Child DC; no A2A or provider",async t=>{
 const f=await r134Fixture(t);
 await assert.rejects(issueAdmittedRepairTaskChild(f.args),
  /Gateway trusted control denied/);
 assert.equal(f.calls.length,0,
  "No Rust side effects before independently admitted Gateway repair epoch");
 assert.equal((await f.journal.records()).length,0);
 assert.equal((await f.admit()).status,"gateway_epoch_admitted");
 const result=await issueAdmittedRepairTaskChild(f.args);
 assert.equal(result.status,"repair_child_issued_not_dispatched");
 assert.equal(result.gateway_task_bound,true);
 assert.equal(result.child_credential_issued,true);
 assert.equal(result.a2a_dispatched,false);
 assert.equal(result.provider_executed,false);
 assert.equal(result.credential_id,f.args.credential.credential_id);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].path,
  "http://r134-adapter.local:8090/v1/credentials/child");
 assert.equal(f.calls[0].headers.get("authorization"),
  "Bearer r134-private-owner-bearer");
 assert.equal(f.calls[0].body.parent_credential_id,
  f.h.rootAuthority.credential_id);
 assert.equal(f.calls[0].body.delegatee,"backend");
 assert.deepEqual(f.calls[0].body.permissions,
  [{resource:file,operation:"update_file"}]);
 assert.deepEqual(result.credential.credentialSubject.per,
  f.calls[0].body.permissions);
 assert.equal((await f.journal.records())[0].observation,
  "adapter_response_verified");
 assert.equal(f.h.provider,3,"Issuing a credential does not edit code");
 assert.throws(()=>f.h.gates.bindTask(session,
  "backend-repair","r134-rebound","backend"),/duplicate|assigned/i);
 assert.throws(()=>f.h.runtime.prepare({
  task_id:"task-backend",agent_role:"backend",tool:"update_file",
  arguments:edit("// old credential must not work")
 }),/Stale operational epoch/);
});
test("R134 foreign role and unadmitted Task deny before Rust child issuance",async t=>{
 const f=await r134Fixture(t);
 await f.admit();
 await assert.rejects(issueAdmittedRepairTaskChild({
  ...f.args,role:"test" as const
 }),/Task role or grants not found/);
 assert.equal(f.calls.length,0);
 await assert.rejects(issueAdmittedRepairTaskChild({
  ...f.args,taskId:"not-in-epoch"
 }),/Task role or grants not found/);
 assert.equal(f.calls.length,0);
 assert.equal((await f.journal.records()).length,0);
});
test("R134 no second credential after Task binding, even with a fresh credential ID",async t=>{
 const f=await r134Fixture(t);
 await f.admit();
 await issueAdmittedRepairTaskChild(f.args);
 await assert.rejects(issueAdmittedRepairTaskChild({
  ...f.args,runtimeTaskId:"r134-retry-runtime",
  credential:{...f.args.credential,credential_id:"urn:r134:retry-child"}
 }),/Gateway trusted control denied/);
 assert.equal(f.calls.length,1,"Cannot mint new child by retrying bound Task");
 assert.equal((await f.journal.records()).length,1);
});
test("R134 revocation during native child issuance leaves no dispatch authority",async t=>{
 const f=await r134Fixture(t);
 await f.admit();
 f.revokeOnResponse();
 await assert.rejects(issueAdmittedRepairTaskChild(f.args),
  /operational parent is no longer active/);
 assert.equal(f.calls.length,1);
 assert.equal((await f.journal.records()).length,1,
  "External issuance must stay in durable audit, not silently be retried");
 assert.equal(f.h.provider,3);
});


function r135A2AArtifact(){
 return {
  id:"sdk-r135-repair",
  contextId:"context-r135",
  status:{state:TaskState.TASK_STATE_COMPLETED,
   timestamp:"2026-10-30T16:00:00Z",message:undefined},
  artifacts:[{artifactId:"artifact-r135",name:"Backend repair",
   description:"",parts:[{content:{$case:"data" as const,value:{
    role:"backend",summary:"Completed authorized repair",
    branch,revision:sha,commit_sha:sha,files_modified:[],
    files_created:[],test_outcome:"not_run",errors:[]
   }},metadata:undefined,filename:"",mediaType:"application/json"}],
   metadata:undefined,extensions:[]}],
  history:[],metadata:undefined
 };
}
test("R135 signed repair grants + original Agent Card -> exactly one Rust DC -> protected A2A",async t=>{
 const f=await r134Fixture(t);
 await f.admit();
 const seen:any[]=[];
 const result=await dispatchTrustedAdmittedRepairA2A({
  ...f.args,
  agentBaseUrls:{backend:"http://backend.local:8080",
   frontend:"http://frontend.local:8081",
   test:"http://test.local:8082"},
  a2a:{async sendProtectedTask(request){
   seen.push(structuredClone(request));
   return {card:{name:"Pinned Backend Agent"},
    task:r135A2AArtifact() as never};
  }}
 });
 assert.equal(result.status,"a2a_artifact_unconfirmed");
 assert.equal(result.epoch,2);
 assert.equal(result.task_id,"backend-repair");
 assert.match(result.runtime_task_id,/^dispatch_[A-Za-z0-9_-]{22}$/);
 assert.equal(result.credential_id,f.args.credential.credential_id);
 assert.equal(result.gateway_task_completed,false);
 assert.equal(result.docker_pass_verified,false);
 assert.equal(seen.length,1);
 assert.equal(f.calls.length,1,"A2A must NOT issue another Rust child");
 assert.equal(f.h.provider,3,"An A2A Artifact is not Gitea/Docker confirmation");
 assert.equal(seen[0].trusted_gateway_task_id,result.runtime_task_id);
 assert.equal(seen[0].agent_base_url,"http://backend.local:8080");
 assert.deepEqual(seen[0].subtask.approved_file_permissions,
  [{operation:"update_file",path:"src/invoices.ts"}]);
 assert.deepEqual(seen[0].subtask.relevant_paths,["src/invoices.ts"]);
 assert.equal(seen[0].subtask.branch,branch);
 assert.equal(seen[0].delegation_evidence.credential_id,
  f.args.credential.credential_id);
 assert.deepEqual(JSON.parse(seen[0].delegation_evidence.credential)
  .credentialSubject.per,[{resource:file,operation:"update_file"}]);
 // A2A completion cannot turn into trusted Gateway Task completion.
 assert.throws(()=>f.h.runtime.prepare({
  task_id:"task-backend",agent_role:"backend",tool:"update_file",
  arguments:edit("// stale")
 }),/Stale operational epoch/);
 assert.equal((await f.journal.records()).length,1);
});
test("R135 a repair A2A Task cannot be sent before independent Gateway admission",async t=>{
 const f=await r134Fixture(t),sent:string[]=[];
 await assert.rejects(dispatchTrustedAdmittedRepairA2A({
  ...f.args,
  agentBaseUrls:{backend:"http://backend.local",
   frontend:"http://frontend.local",test:"http://test.local"},
  a2a:{async sendProtectedTask(){sent.push("unsafe");
   throw Error("A2A must not be reached");}}
 }),/Gateway trusted control denied/);
 assert.equal(sent.length,0);
 assert.equal(f.calls.length,0);
 assert.equal((await f.journal.records()).length,0);
});
test("R135 revoked root during protected A2A blocks a completion receipt",async t=>{
 const f=await r134Fixture(t);
 await f.admit();let sent=0;
 await assert.rejects(dispatchTrustedAdmittedRepairA2A({
  ...f.args,
  agentBaseUrls:{backend:"http://backend.local",
   frontend:"http://frontend.local",test:"http://test.local"},
  a2a:{async sendProtectedTask(){
   sent++;f.h.setPhase("closed");
   return {card:{name:"Backend"},task:r135A2AArtifact() as never};
  }}
 }),/operational root revoked before protected A2A/);
 assert.equal(sent,1);
 assert.equal(f.calls.length,1);
 assert.equal(f.h.provider,3);
});
