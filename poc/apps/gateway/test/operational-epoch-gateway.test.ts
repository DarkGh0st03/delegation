import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans} from "../src/approved-execution-plans.ts";
import {GatewayRuntime} from "../src/runtime.ts";
import {InMemoryAuditSink,InMemoryRequestStore} from "../src/prepare.ts";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedOperationalEpochJournal} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-journal.mjs";
import {TrustedOperationalEpochIntake} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-intake.ts";

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
const repair=()=>plan("repair-2",2,[
 entry("backend-repair","backend",file,"update_file"),
 entry("test-repair","test",branchURI,"run_tests",["backend-repair"])
]);
const phases=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"].map(phase=>({
 phase,status:"pass" as const
}));
async function harness(t:import("node:test").TestContext){
 const parent=initial();
 const dir=await mkdtemp(join(tmpdir(),"delegation-gateway-epoch-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const approvalsDir=join(dir,"approvals"),epochsDir=join(dir,"epochs");
 await mkdir(approvalsDir,{mode:0o700});
 await mkdir(epochsDir,{mode:0o700});
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
  permissions:parent.requested_permissions.map(x=>({
   resource:x.resource,operation:x.operation
  }))
 };
 let phase="execution";
 const coordinator={
  get phase(){return phase;},
  trustedOperationalAuthority(){
   if(phase!=="execution")throw Error("root retired");
   return structuredClone(rootAuthority);
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
 const gates=new TrustedApprovedExecutionPlans({
  repository:repo,engineerDid:engineer,
  approvals:signedStore,operationalEpochIntake:intake,
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
    if(req.tool==="run_tests")return {
     provider:"runner" as const,performed:true as const,
     tool:"run_tests" as const,branch:req.arguments.branch,
     revision:sha,tested_commit_sha:sha,runner_profile:"poc-default",
     status:"pass" as const,phases,
     project_tests:{status:"pass" as const},
     researcher_acceptance:{status:"pass" as const}
    };
    throw Error("unhandled request");
   }
  },
  verifier:{async verify(req){
   verified++;
   return {
    presenter_id:"did:example:"+req.presenter,
    issuer_id:engineer,credential_id:"urn:fixture:delegated",
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
  setPhase:(s:string)=>{phase=s;},
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
  /unresolved or in-flight Tasks/);
 assert.equal(h.provider,0);
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,3),
  /advance exactly once/);
 h.setPhase("closed");
 // An incomplete Task is a stronger earlier fence. It must never
 // accidentally enable a new epoch after revocation.
 await assert.rejects(h.gates.admitNextOperationalEpoch(session,2),
  /unresolved or in-flight Tasks/);
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
