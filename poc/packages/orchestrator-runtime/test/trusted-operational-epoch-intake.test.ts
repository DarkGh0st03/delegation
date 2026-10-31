import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,mkdir,chmod,writeFile,readFile,readdir,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {makeApproval,planDigest} from "../../plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {canonicalFileUri,canonicalRepositoryUri} from "../../../apps/gateway/src/canonical.ts";
import {SignedEngineerApprovalFileStore} from "../src/signed-approval-store.ts";
import {TrustedOperationalEpochJournal} from "../src/trusted-operational-epoch-journal.mjs";
import {TrustedOperationalEpochIntake} from "../src/trusted-operational-epoch-intake.ts";
import {TrustedApprovedPlanChildAuthorityIssuer} from "../src/trusted-approved-child-issuer.ts";
import {TrustedChildIssuanceJournal} from "../src/trusted-child-issuance-journal.mjs";

const OPS=new Set<string>(RUST_OPERATIONS);
const REPO={authority:"gitea.local",owner:"sample",repository:"invoice-service"};
const URI="gitea://gitea.local/sample/invoice-service";
const BRANCH=URI+"/branches/feature%2Finvoice-review";
const FILE=BRANCH+"/files/src/invoice.ts";
const ENGINEER="did:example:engineer",SHA="a".repeat(40),SESSION="session-invoice";
const AGENTS=[
 {agent_id:"backend",did:"did:example:backend",card_ref:"trusted:backend"},
 {agent_id:"frontend",did:"did:example:frontend",card_ref:"trusted:frontend"},
 {agent_id:"test",did:"did:example:test",card_ref:"trusted:test"}
];
function initial(){
 return {
  schema_version:"1.0.0",plan_id:"invoice-plan-initial",
  session_id:SESSION,version:1,repository:REPO,base_revision:SHA,
  requirement:"Invoice order management workflow",
  candidate_agents:[AGENTS[0],AGENTS[2]],tasks:[
   {id:"create-branch",agent_id:"orchestrator",title:"Create branch",
    description:"Prepare isolated branch",depends_on:[],resources:[URI]},
   {id:"initial-backend",agent_id:"backend",title:"Implement backend",
    description:"Update invoice logic",depends_on:["create-branch"],resources:[FILE]},
   {id:"initial-test",agent_id:"test",title:"Validate results",
    description:"Run independent checks",depends_on:["initial-backend"],resources:[BRANCH]}
  ],
  requested_permissions:[
   {id:"p-branch",task_id:"create-branch",agent_id:"orchestrator",
    resource:URI,operation:"create_branch",reason:"Prepare work branch"},
   {id:"p-backend",task_id:"initial-backend",agent_id:"backend",
    resource:FILE,operation:"update_file",reason:"Implement invoice API"},
   {id:"p-test",task_id:"initial-test",agent_id:"test",
    resource:BRANCH,operation:"run_tests",reason:"Validate branch"}
  ],
  assumptions:[],uncertainties:[]
 };
}
function nextPlan(n:number,role:"backend"|"frontend"|"test",id:string){
 const resource=role==="test"?BRANCH:FILE;
 const operation=role==="test"?"run_tests":"update_file";
 const agent=AGENTS.find(a=>a.agent_id===role)!;
 return {
  schema_version:"1.0.0",plan_id:"invoice-epoch-"+n,
  session_id:SESSION,version:n,repository:REPO,base_revision:SHA,
  requirement:"Correct invoice logic after Runner feedback",
  candidate_agents:[agent],
  tasks:[{id,agent_id:role,title:"Repair/validate",
   description:"Do only a task in issued root scope",depends_on:[],resources:[resource]}],
  requested_permissions:[{id:"p-"+id,task_id:id,agent_id:role,resource,
    operation,reason:"Fix or test"}],assumptions:[],uncertainties:[]
 };
}
async function env(t:import("node:test").TestContext,withRootRead=false,
 encodedOwner=false){
 const dir=await mkdtemp(join(tmpdir(),"delegation-r101-"));
 const approvals=join(dir,"approvals"),journalDir=join(dir,"epochs");
 await mkdir(approvals,{mode:0o700});await mkdir(journalDir,{mode:0o700});
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const keys=generateKeyPairSync("ed25519");
 const keyId="local-trusted-engineer";
 const plan=initial();
 // R151.22: use a valid exact-URI grant even when the owner component
 // requires percent-encoding. No unsigned test resource may authorize it.
 const scopedRepo=encodedOwner?
  {...REPO,owner:"sample+east"}:REPO;
 const prefix=canonicalRepositoryUri(scopedRepo);
 const scoped=(resource:string)=>encodedOwner?
  resource.replace(URI,prefix):resource;
 if(encodedOwner){
  plan.repository=scopedRepo;
  for(const task of plan.tasks)task.resources=task.resources.map(scoped);
  for(const grant of plan.requested_permissions)grant.resource=scoped(grant.resource);
 }
 if(withRootRead)plan.requested_permissions.push({
  id:"p-root-read",task_id:"initial-backend",agent_id:"backend",
  resource:scoped(FILE),operation:"read_file",reason:"Authorized read for debugging"
 });
 const approved=makeApproval(plan,{
  allowedOperations:OPS,decision_id:"engineer-approval-invoices",
  approved_by:ENGINEER,approved_at:"2026-10-29T09:00:00Z",
  approved_permission_ids:plan.requested_permissions.map(p=>p.id)
 });
 const signed=signEngineerApproval({
  plan,approval:approved,engineerDid:ENGINEER,keyId,
  privateKeyPem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
  issuedAt:"2026-10-29T09:00:00Z",expiresAt:"2026-10-29T12:00:00Z"
 });
 await writeFile(join(approvals,SESSION+".json"),JSON.stringify(signed),{mode:0o600});
 const store=new SignedEngineerApprovalFileStore({
  directory:approvals,engineerDid:ENGINEER,
  trustedKeys:{[keyId]:{engineer_did:ENGINEER,public_key_pem:
    keys.publicKey.export({format:"pem",type:"spki"}).toString()}},
  nowMs:()=>Date.parse("2026-10-29T10:00:00Z")
 });
 const parent={
  credential_id:"urn:root:invoice",
  plan_digest:planDigest(plan),
  permissions:[
   {resource:scoped(URI),operation:"create_branch"},
   {resource:scoped(FILE),operation:"update_file"},
   {resource:scoped(BRANCH),operation:"run_tests"},
   ...(withRootRead?[{resource:scoped(FILE),operation:"read_file"}]:[])
  ]
 };
 let phase="execution";
 const coordinator={get phase(){return phase;},trustedOperationalAuthority(){
  if(phase!=="execution")throw Error("no active operational root");
  return structuredClone(parent);
 }};
 const newJournal=()=>new TrustedOperationalEpochJournal({
  directory:journalDir,sessionId:SESSION,baseRevision:SHA,
  rootCredentialId:parent.credential_id,
  originalPlanDigest:parent.plan_digest,allowedOperations:OPS
 });
 const makeOwner=()=>TrustedOperationalEpochIntake.create({
  approvals:store,coordinator,journal:newJournal(),
  engineerDid:ENGINEER,sessionId:SESSION,
  pinnedAgentRegistry:AGENTS
 });
 return {dir,approvals,journalDir,store,parent,plan,coordinator,
  newJournal,makeOwner,setPhase:(p:string)=>{phase=p;}};
}

test("R101 signed Engineer plan + Coordinator root reserve 3 distinct epochs, no new approval",async(t)=>{
 const e=await env(t),owner=e.makeOwner();
 const first=await owner.reserveInitialEpoch();
 assert.equal(first.epoch,1);
 const repair=await owner.reserveRepairEpoch(nextPlan(2,"backend","repair-backend-2"));
 assert.equal(repair.epoch,2);
 assert.equal(repair.execution_authorized,false);
 const rerun=await owner.reserveRepairEpoch(nextPlan(3,"test","rerun-tests-3"));
 assert.equal(rerun.epoch,3);
 assert.equal(rerun.execution_authorized,false);
 const records=await e.newJournal().records();
 assert.deepEqual(records.map(x=>x.epoch),[1,2,3]);
 assert.equal(records[0].plan_digest,e.parent.plan_digest);
 // No new Engineer approval record, and no new root is issued by this component.
 assert.deepEqual(await readdir(e.approvals),[SESSION+".json"]);
 assert.equal(records[1].plan.tasks[0].agent_id,"backend");
 assert.equal(records[2].plan.tasks[0].agent_id,"test");
});
test("R101 replay/permission escalation/branch or repo switch cannot reserve a new epoch",async(t)=>{
 const e=await env(t),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 const repair=nextPlan(2,"frontend","fix-invoices-2");
 const bad=structuredClone(repair);
 bad.requested_permissions[0].operation="delete_file";
 await assert.rejects(owner.reserveRepairEpoch(bad),/outside actually issued root/);
 const foreign=structuredClone(repair);
 foreign.repository.repository="other";
 await assert.rejects(owner.reserveRepairEpoch(foreign),/repository changed/);
 const otherBranch=structuredClone(repair);
 otherBranch.tasks[0].resources=[URI+"/branches/feature%2Fother/files/src/invoice.ts"];
 otherBranch.requested_permissions[0].resource=otherBranch.tasks[0].resources[0];
 await assert.rejects(owner.reserveRepairEpoch(otherBranch),/working branch changed/);
 const wrongAgent=structuredClone(repair);
 wrongAgent.candidate_agents[0].did="did:example:attacker";
 await assert.rejects(owner.reserveRepairEpoch(wrongAgent),/Agent identity/);
 assert.equal((await owner.verifiedEpochHistory()).length,1);
 await owner.reserveRepairEpoch(repair);
 await assert.rejects(owner.reserveRepairEpoch(repair),/version|advance|replay/);
 assert.equal((await owner.verifiedEpochHistory()).length,2);
});
test("R101 concurrent same-epoch reservations are one-shot and survive process restart",async(t)=>{
 const e=await env(t);
 await e.makeOwner().reserveInitialEpoch();
 const proposal=nextPlan(2,"backend","repair-2");
 const [a,b]=await Promise.allSettled([
  e.makeOwner().reserveRepairEpoch(proposal),
  e.makeOwner().reserveRepairEpoch(proposal)
 ]);
 assert.deepEqual([a.status,b.status].sort(),["fulfilled","rejected"]);
 assert.equal((await e.newJournal().records()).length,2);
 await assert.rejects(e.makeOwner().reserveRepairEpoch(proposal),/version|replay|advance/);
});
test("R101 fail closed on missing root or wrong issued parent, revoked Coordinator, corrupt journal",async(t)=>{
 const e=await env(t),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 e.parent.permissions.push({resource:FILE,operation:"read_file"});
 await assert.rejects(owner.reserveRepairEpoch(nextPlan(2,"backend","repair-2")),
  /issued parent privileges differ/);
 e.parent.permissions.pop();
 e.setPhase("closed");
 await assert.rejects(owner.reserveRepairEpoch(nextPlan(2,"backend","repair-2")),
  /operational root is not active/);
 e.setPhase("execution");
 await writeFile(join(e.journalDir,"epoch-001.json"),"{oops");
 await assert.rejects(owner.reserveRepairEpoch(nextPlan(2,"backend","repair-2")),
  /unreadable|incomplete/);
});
test("R101 private owner-only directory and forbidden entries are rejected",async(t)=>{
 const e=await env(t);
 await chmod(e.journalDir,0o755);
 await assert.rejects(e.makeOwner().reserveInitialEpoch(),/owner-only/);
 await chmod(e.journalDir,0o700);
 await writeFile(join(e.journalDir,"unexpected.txt"),"x");
 await assert.rejects(e.makeOwner().reserveInitialEpoch(),/unexpected|out-of-order/);
});

test("R102: reserved repair Task issues exact child via existing Adapter route; replay denied",async(t)=>{
 const e=await env(t),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 await owner.reserveRepairEpoch(nextPlan(2,"backend","backend-fix-2"));
 const childDir=join(e.dir,"child-requests");
 await mkdir(childDir,{mode:0o700});
 const journal=new TrustedChildIssuanceJournal({
  directory:childDir,sessionId:SESSION,baseRevision:SHA,
  planDigest:e.parent.plan_digest,parentCredentialId:e.parent.credential_id
 });
 const observed:any[]=[];
 const config={
  intake:owner,epochVersion:2,coordinator:e.coordinator,
  issuanceJournal:journal,sessionId:SESSION,engineerDid:ENGINEER,
  adapterBaseUrl:"http://127.0.0.1:8999",bearerToken:"fixture-only",
  fetchFn:(async (url:unknown,req:any)=>{
   const body=JSON.parse(String(req.body));
   observed.push({url:String(url),body});
   return new Response(JSON.stringify({
    "@context":["https://www.w3.org/ns/credentials/v2"],
    type:["VerifiableCredential","DelegationCredential"],
    id:body.credential_id,issuer:"did:example:orchestrator",
    credentialSubject:{sub:"did:example:backend",per:body.permissions}
   }),{status:201,headers:{"content-type":"application/json"}});
  }) as typeof fetch
 };
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.createForOperationalEpoch(config);
 const input={
  parent_credential_id:e.parent.credential_id,
  approved_task_id:"backend-fix-2",
  selection:{role:"backend" as const},
  credential_id:"urn:child:invoice-fix-2",
  valid_from:"2026-10-29T10:00:00Z",validity_seconds:300,
  credential_status:{
   type:"BitstringStatusListEntry" as const,
   statusPurpose:"revocation" as const,
   statusListIndex:"1772",
   statusListCredential:"https://status.example/repair"
  }
 };
 const result=await issuer.issueSpecializedChild(input);
 assert.equal(result.role,"backend");
 assert.deepEqual(observed[0].body.permissions,[{resource:FILE,operation:"update_file"}]);
 assert.equal(observed[0].body.parent_credential_id,e.parent.credential_id);
 assert.equal(observed[0].url,"http://127.0.0.1:8999/v1/credentials/child");
 assert.equal((await journal.records())[0].observation,"adapter_response_verified");
 await assert.rejects(issuer.issueSpecializedChild(input),/already attempted/);
 const another=await TrustedApprovedPlanChildAuthorityIssuer.createForOperationalEpoch(config);
 await assert.rejects(another.issueSpecializedChild(input),/already reserved/);
 assert.equal(observed.length,1);
});
test("R102: stale epoch, different Coordinator and revoked root fail before child issuance",async(t)=>{
 const e=await env(t),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 await owner.reserveRepairEpoch(nextPlan(2,"backend","backend-fix-2"));
 const childDir=join(e.dir,"child-requests");
 await mkdir(childDir,{mode:0o700});
 const config={
  intake:owner,epochVersion:3,coordinator:e.coordinator,
  issuanceJournal:new TrustedChildIssuanceJournal({
   directory:childDir,sessionId:SESSION,baseRevision:SHA,
   planDigest:e.parent.plan_digest,parentCredentialId:e.parent.credential_id
  }),
  sessionId:SESSION,engineerDid:ENGINEER,
  adapterBaseUrl:"http://127.0.0.1:8999",bearerToken:"fixture-only"
 };
 await assert.rejects(
  TrustedApprovedPlanChildAuthorityIssuer.createForOperationalEpoch(config),
  /stale, missing or foreign operational epoch/);
 await assert.rejects(
  TrustedApprovedPlanChildAuthorityIssuer.createForOperationalEpoch({
   ...config,epochVersion:2,
   coordinator:{get phase(){return "execution" as const;},
    trustedOperationalAuthority(){return structuredClone(e.parent);}}
  }),/Coordinator instance differs/);
 e.setPhase("closed");
 await assert.rejects(
  TrustedApprovedPlanChildAuthorityIssuer.createForOperationalEpoch({
   ...config,epochVersion:2
  }),/trusted current epoch and durable child-issuance journal required/);
});

test("R104: hard internal maximum is three cycles, independent of Engineer permissions",async(t)=>{
 const e=await env(t),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 await owner.reserveRepairEpoch(nextPlan(2,"backend","backend-repair-two"));
 await owner.reserveRepairEpoch(nextPlan(3,"test","test-cycle-three"));
 assert.equal((await owner.verifiedEpochHistory()).length,3);
 await assert.rejects(
  owner.reserveRepairEpoch(nextPlan(4,"backend","backend-cycle-four")),
  /epoch limit reached/);
 assert.equal((await owner.verifiedEpochHistory()).length,3);
});

test("R109 root read pair may authorize a NEW Task ID without the old DAG naming that Task",async(t)=>{
 const e=await env(t,true),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 const proof=await owner.preflightRepairDiscovery({
  sessionId:SESSION,taskId:"discovery-invoice-2",agentId:"frontend",
  resource:FILE
 });
 assert.equal(proof.session_id,SESSION);
 assert.equal(proof.task_id,"discovery-invoice-2");
 assert.equal(proof.resource,FILE);
 assert.equal(proof.operation,"read_file");
 assert.equal(proof.agent_id,"frontend");
 assert.equal(proof.root_credential_id,e.parent.credential_id);
 assert.equal(proof.root_plan_digest,e.parent.plan_digest);
 assert.equal(proof.epoch,1);
 assert.equal(proof.work_branch,"feature/invoice-review");
 assert.equal(proof.execution_authorized,false);
 assert.equal((await owner.verifiedEpochHistory()).length,1);
 assert.deepEqual(await readdir(e.approvals),[SESSION+".json"]);
});
test("R151.22 signed discovery uses Gateway canonical encoding of repository owner",async(t)=>{
 const e=await env(t,true,true),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 const encodedFile=canonicalFileUri(e.plan.repository,
  "feature/invoice-review","src/invoice.ts");
 assert.match(encodedFile,/sample%2Beast/);
 const proof=await owner.preflightRepairDiscovery({
  sessionId:SESSION,taskId:"discovery-encoded-owner",
  agentId:"backend",resource:encodedFile
 });
 assert.equal(proof.resource,encodedFile);
 assert.equal(proof.operation,"read_file");
 assert.equal(proof.execution_authorized,false);
 assert.equal((await owner.verifiedEpochHistory()).length,1);
 await assert.rejects(owner.preflightRepairDiscovery({
  sessionId:SESSION,taskId:"discovery-unencoded-owner",
  agentId:"backend",resource:FILE
 }),/outside exact issued Rust root/);
});

test("R109 discovery cannot invent grants, switch branches, impersonate agents or replay original Task IDs",async(t)=>{
 const e=await env(t,true),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 const ok={sessionId:SESSION,taskId:"read-new-task",
  agentId:"backend" as const,resource:FILE};
 await assert.rejects(owner.preflightRepairDiscovery({
  ...ok,resource:BRANCH+"/files/src/other.ts"
 }),/outside exact issued Rust root/);
 await assert.rejects(owner.preflightRepairDiscovery({
  ...ok,resource:URI+"/branches/feature%2Fother/files/src/invoice.ts"
 }),/outside exact issued Rust root/);
 await assert.rejects(owner.preflightRepairDiscovery({
  ...ok,taskId:"initial-backend"
 }),/discovery Task replay/);
 await assert.rejects(owner.preflightRepairDiscovery({
  ...ok,agentId:"untrusted" as any
 }),/noncanonical discovery task/);
 await assert.rejects(owner.preflightRepairDiscovery({
  ...ok,sessionId:"other-session"
 }),/noncanonical discovery task/);
 assert.equal((await owner.verifiedEpochHistory()).length,1);
});
test("R109 root without read_file grant rejects new discovery even if operation appears in Rust catalog",async(t)=>{
 const e=await env(t),owner=e.makeOwner();
 await owner.reserveInitialEpoch();
 await assert.rejects(owner.preflightRepairDiscovery({
  sessionId:SESSION,taskId:"read-new-task",agentId:"backend",resource:FILE
 }),/outside exact issued Rust root/);
 e.setPhase("closed");
 await assert.rejects(owner.preflightRepairDiscovery({
  sessionId:SESSION,taskId:"read-other-task",agentId:"backend",resource:FILE
 }),/operational root is not active/);
});
