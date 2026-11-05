import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash} from "node:crypto";
import {mkdtemp,chmod,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedOperationalSessionStore}
 from "../../../apps/gateway/src/trusted-operational-session-store.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {signAuthorityOnlyGrant,verifyAuthorityOnlyGrant,
 selectAuthorityOnlyGrant} from "../../../packages/plan-contracts/src/authority-only-approval.mjs";
import {SignedAuthorityOnlyFileStore} from "../src/signed-authority-only-store.ts";
import {DurableAuthorityOnlyActivationJournal}
 from "../src/authority-only-activation-journal.ts";
import {TrustedAuthorityOnlyEngineerSession}
 from "../src/trusted-authority-only-engineer-session.ts";
import {DurableAuthorityTaskJournal}
 from "../src/trusted-authority-task-journal.ts";
import {TrustedAuthorityOnlyExecutionCoordinator,
 type AuthorityOnlyTaskProposal}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import type {EngineerCredentialPort,TrustedPlanningSnapshot,RootParameters}
 from "../src/trusted-engineer-authority.ts";
import type {DelegatedPermission} from "../src/delegated-permission.ts";
import type {IssuedDelegationCredential} from "../src/authority-client.ts";

const now="2026-11-05T07:10:00Z",nowMs=Date.parse(now);
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const sessionId="authority-session-s1";
const requirement="Implement requested account suspension with signed limits";
const hash="a".repeat(40);
const root="gitea://gitea.local/thesis/iam-console-poc";
const branch="feature/account-suspension";
const file=root+"/branches/feature%2Faccount-suspension/files/apps/backend/user.ts";
const did="did:thesis:engineer",keyId="trusted-engineer-1";
const pairs=[
 {resource:root,operation:"create_branch"},
 {resource:file,operation:"read_file"},
 {resource:file,operation:"update_file"}
];
const keys=generateKeyPairSync("ed25519");
const privateKeyPem=keys.privateKey.export({format:"pem",type:"pkcs8"});
const trustedKeys={[keyId]:{engineer_did:did,
 public_key_pem:keys.publicKey.export({format:"pem",type:"spki"})}};
const operations=new Set<string>(RUST_OPERATIONS);
function snapshot():TrustedPlanningSnapshot{
 return {session_id:sessionId,repository:{...repo},base_revision:hash,
  directories:["","apps","apps/backend"],files:["apps/backend/user.ts"]};
}
function params(id:string,index:string,ttl=1800):RootParameters{
 return {credential_id:id,valid_from:now,validity_seconds:ttl,
  credential_status:{
   type:"BitstringStatusListEntry",statusPurpose:"revocation",
   statusListCredential:"https://status.example/revocation",
   statusListIndex:index
  }};
}
const preliminary=params("urn:authority:preliminary","201",600);
const operational=params("urn:authority:operational","202",1800);
function signedReceipt({
 selected=pairs,objective=requirement,session=sessionId,expiry="2026-11-05T09:00:00Z"
}:{selected?:typeof pairs;objective?:string;session?:string;expiry?:string}={}){
 const draft={schema_version:"1.0.0",session_id:session,
  repository:{...repo},branch,base_revision:hash,requirement:objective,
  requested_permissions:[...pairs]};
 const grant=selectAuthorityOnlyGrant(draft,selected,{allowedOperations:operations});
 return signAuthorityOnlyGrant({authorization:grant,engineerDid:did,keyId,
  privateKeyPem,issuedAt:"2026-11-05T07:00:00Z",expiresAt:expiry,
  allowedOperations:operations});
}
class Issuer implements EngineerCredentialPort{
 readonly calls:Array<{event:string;id?:string;permissions?:readonly DelegatedPermission[]}>;
 failRevoke=false;
 failOperational=false;
 constructor(log:Array<{event:string;id?:string;permissions?:readonly DelegatedPermission[]}>){
  this.calls=log;
 }
 async issueScopedOrchestratorRoot(input:RootParameters&{
  permissions:readonly DelegatedPermission[]
 }):Promise<IssuedDelegationCredential>{
  this.calls.push({event:"issue",id:input.credential_id,
   permissions:structuredClone(input.permissions)});
  if(this.failOperational&&input.credential_id===operational.credential_id)
   throw Error("Rust issuer refused operational root");
  return {id:input.credential_id,
   credentialSubject:{per:structuredClone(input.permissions)}} as
   unknown as IssuedDelegationCredential;
 }
 async revokeRoot(credentialId:string){
  this.calls.push({event:"revoke",id:credentialId});
  if(this.failRevoke)throw Error("Native Rust revocation unavailable");
 }
}
async function fixture(fn:(x:{
 issuer:Issuer;session:TrustedAuthorityOnlyEngineerSession;
 log:Array<{event:string;id?:string;permissions?:readonly DelegatedPermission[]}>;
 journal:DurableAuthorityOnlyActivationJournal;
 taskJournal:DurableAuthorityTaskJournal;
 gatewayTaskJournal:DurableAuthorityTaskJournal;
 gatewaySessionStore:TrustedOperationalSessionStore;
 approvals:SignedAuthorityOnlyFileStore;
 createSession:()=>TrustedAuthorityOnlyEngineerSession;
 save:(receipt?:object)=>Promise<void>
})=>Promise<void>,receipt=signedReceipt()){
 const directory=await mkdtemp(join(tmpdir(),"delegation-r285-"));
 const receiptDir=join(directory,"approvals"),journalDir=join(directory,"journal"),
  taskDir=join(directory,"task-journal"),
  gatewayDir=join(directory,"gateway-sessions"),
  gatewayTaskDir=join(directory,"gateway-tasks");
 const {mkdir}=await import("node:fs/promises");
 await mkdir(receiptDir,{mode:0o700});await mkdir(journalDir,{mode:0o700});
 await mkdir(taskDir,{mode:0o700});
 await mkdir(gatewayDir,{mode:0o700});
 await mkdir(gatewayTaskDir,{mode:0o700});
 const save=async(raw:object=receipt)=>{
  await writeFile(join(receiptDir,sessionId+".json"),JSON.stringify(raw),{mode:0o600});
  await chmod(join(receiptDir,sessionId+".json"),0o600);
 };
 try{
  await save();
  const log:Array<{event:string;id?:string;permissions?:readonly DelegatedPermission[]}>= [];
  const issuer=new Issuer(log);
  const approvals=new SignedAuthorityOnlyFileStore({directory:receiptDir,
   engineerDid:did,trustedKeys,nowMs:()=>nowMs});
  const journal=new DurableAuthorityOnlyActivationJournal(journalDir);
  const taskJournal=new DurableAuthorityTaskJournal(taskDir);
  const gatewayTaskJournal=new DurableAuthorityTaskJournal(gatewayTaskDir);
  const gatewaySessionStore=new TrustedOperationalSessionStore(gatewayDir);
  const createSession=()=>new TrustedAuthorityOnlyEngineerSession({
   snapshot:snapshot(),requirement,credentials:issuer,approvals,journal,
   authenticatedEngineerDid:did,nowMs:()=>nowMs,
   planningRevisions:{
    async begin(taskId,ttlMs){
     log.push({event:"revision.begin",id:taskId});
     assert.ok(ttlMs>0);
     return {task_id:sessionId,base_revision:hash,
      expires_at:"2026-11-05T07:50:00Z"};
    },
    async end(taskId){log.push({event:"revision.end",id:taskId});}
   }
  });
  await fn({issuer,session:createSession(),log,journal,taskJournal,
   gatewayTaskJournal,gatewaySessionStore,approvals,createSession,save});
 }finally{await rm(directory,{recursive:true,force:true});}
}
test("R285 only authority pairs are issued after confirmed Planning retirement and Rust revocation",async()=>{
 await fixture(async({session,log})=>{
  const planned=await session.startPlanning(preliminary);
  assert.equal(planned.phase,"planning");
  assert.ok(planned.permissions.every(p=>["read_repository","read_file","list_directory"]
   .includes(p.operation)));
  const issued=await session.approveAndIssueOperationalRoot(operational);
  assert.equal(issued.phase,"operational");
  assert.match(issued.authority_digest,/^[a-f0-9]{64}$/u);
  assert.deepEqual(issued.permissions,pairs);
  assert.deepEqual(log.map(x=>x.event),[
   "revision.begin","issue","revision.end","revoke","issue"
  ]);
  assert.deepEqual(log.filter(x=>x.event==="issue").map(x=>x.id),[
   preliminary.credential_id,operational.credential_id
  ]);
  assert.notEqual(planned.credential_id,issued.credential_id);
  assert.equal("plan_digest" in issued,false);
  assert.equal("approved_task_ids" in issued,false);
  await assert.rejects(session.approveAndIssueOperationalRoot(params(
   "urn:authority:reissue","203",120)),/active preliminary root missing/);
 });
});
test("R285 journal prevents replay after process reconstruction, even after successful issuance",async()=>{
 await fixture(async({session,createSession,log})=>{
  await session.startPlanning(preliminary);
  await assert.rejects(createSession().startPlanning(preliminary),/EEXIST/u);
  await session.approveAndIssueOperationalRoot(operational);
  await assert.rejects(createSession().startPlanning(params(
   "urn:authority:other-preliminary","230",600)),/EEXIST/u);
  assert.deepEqual(log.map(x=>x.event).filter(x=>x==="issue"),["issue","issue"]);
 });
});
test("R285 failed native preliminary revocation never issues an operational root and cannot retry",async()=>{
 await fixture(async({session,issuer,log})=>{
  await session.startPlanning(preliminary);
  issuer.failRevoke=true;
  await assert.rejects(session.approveAndIssueOperationalRoot(operational),
   /revocation or Gateway retirement unconfirmed/);
  assert.equal(session.phase,"failed_closed");
  assert.deepEqual(log.map(x=>x.event),[
   "revision.begin","issue","revision.end","revoke"
  ]);
  await assert.rejects(session.approveAndIssueOperationalRoot(operational),
   /active preliminary root missing/);
 });
});
test("R285 modified root status, stale root or overlong authority lifetime is denied BEFORE revocation",async()=>{
 await fixture(async({session,log})=>{
  await session.startPlanning(preliminary);
  for(const invalid of [
   {...operational,credential_id:preliminary.credential_id},
   {...operational,credential_status:structuredClone(preliminary.credential_status)},
   {...operational,validity_seconds:7201},
   {...operational,valid_from:"2026-11-04T07:10:00Z"},
  ]){
   await assert.rejects(session.approveAndIssueOperationalRoot(invalid));
  }
  assert.deepEqual(log.map(x=>x.event),["revision.begin","issue"]);
  const result=await session.approveAndIssueOperationalRoot(operational);
  assert.equal(result.phase,"operational");
 });
});
test("R285 wrong signed Engineer objective fails closed without revocation or operational issuance",async()=>{
 await fixture(async({session,log})=>{
  await session.startPlanning(preliminary);
  await assert.rejects(session.approveAndIssueOperationalRoot(operational),
   /outside trusted Engineer snapshot or requirement/);
  assert.deepEqual(log.map(x=>x.event),["revision.begin","issue"]);
 },signedReceipt({objective:"Unapproved separate requirement"}));
});
test("R285 expiring receipt refuses a longer root and disallows a second attempt",async()=>{
 await fixture(async({session,log})=>{
  await session.startPlanning(preliminary);
  await assert.rejects(session.approveAndIssueOperationalRoot(operational),
   /outlive approved authority/);
  assert.deepEqual(log.map(x=>x.event),["revision.begin","issue"]);
 },signedReceipt({expiry:"2026-11-05T07:30:00Z"}));
});
test("R285 forged store object cannot become Engineer authority",async()=>{
 await fixture(async({issuer,journal,log})=>{
  const fakeStore={
   async loadAuthenticatedAuthority(){
    return {...verifyAuthorityOnlyGrant(signedReceipt(),{
     trustedKeys,expectedEngineerDid:did,allowedOperations:operations,nowMs}),
     authorization:{...signedReceipt().authorization}}
   }
  };
  const s=new TrustedAuthorityOnlyEngineerSession({
   snapshot:snapshot(),requirement,credentials:issuer,
   approvals:fakeStore as never,journal,authenticatedEngineerDid:did,
   nowMs:()=>nowMs,
   planningRevisions:{
    async begin(){log.push({event:"revision.begin"});return{
     task_id:sessionId,base_revision:hash,expires_at:"2026-11-05T07:50:00Z"
    }},
    async end(){log.push({event:"revision.end"});}
   }
  });
  await s.startPlanning(preliminary);
  await assert.rejects(s.approveAndIssueOperationalRoot(operational),
   /unverified Engineer authority/);
  assert.deepEqual(log.map(x=>x.event),["revision.begin","issue"]);
 });
});

test("R285 private Engineer cancellation confirms Gateway retirement and native revocation",async()=>{
 await fixture(async({session,log,createSession})=>{
  await session.startPlanning(preliminary);
  await session.cancelPlanning();
  assert.equal(session.phase,"revoked");
  assert.deepEqual(log.map(x=>x.event),[
   "revision.begin","issue","revision.end","revoke"
  ]);
  await assert.rejects(session.approveAndIssueOperationalRoot(operational),
   /active preliminary root missing/);
  await assert.rejects(createSession().startPlanning(preliminary),/EEXIST/u);
 });
});


// R286: verified signed authority, real Engineer root session and pinned cards.
// These tests only register trusted epoch candidates: no Gateway execution.
const registry={
 backend:{did:"did:thesis:backend",card_ref:"trusted:backend",
  capabilities:["read_file","update_file"]},
 frontend:{did:"did:thesis:frontend",card_ref:"trusted:frontend",
  capabilities:["read_file","update_file"]},
 test:{did:"did:thesis:test",card_ref:"trusted:test",
  capabilities:["read_file"]}
};
function nextTask(agent_id="backend",epoch=1,task_id="task-backend"):AuthorityOnlyTaskProposal{
 return {
  session_id:sessionId,requirement_sha256:
   (awaitRequirementHash()),
  base_revision:hash,branch,task_id,epoch,agent_id,
  depends_on:epoch===1?[]:["task-backend"],
  permissions:[{resource:file,operation:epoch===1?"read_file":"update_file"}]
 };
}
function awaitRequirementHash(){
 return createHash("sha256").update(requirement,"utf8").digest("hex");
}
test("R286 Coordinator activation requires a genuinely issued Engineer operational root",async()=>{
 await fixture(async({session,approvals,taskJournal})=>{
  const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals,journal:taskJournal,
   trustedAgentRegistry:registry,nowMs:()=>nowMs
  });
  await assert.rejects(coordinator.activate(),/operational root is not active/);
  assert.equal(coordinator.phase,"failed_closed");
 });
});
test("R286 two different signed-scope Tasks/agents are bound without a new Engineer signature",async()=>{
 await fixture(async({session,approvals,taskJournal,log})=>{
  await session.startPlanning(preliminary);
  await session.approveAndIssueOperationalRoot(operational);
  const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals,journal:taskJournal,
   trustedAgentRegistry:registry,nowMs:()=>nowMs
  });
  const activated=await coordinator.activate();
  assert.equal(activated.status,"authority_session_activated_preflight_only");
  assert.equal(activated.execution_authorized,false);
  const first=await coordinator.registerTask(nextTask());
  assert.equal(first.status,"task_registered_preflight_only");
  assert.equal(first.agent_did,"did:thesis:backend");
  assert.equal(first.gateway_registered,false);
  const second=await coordinator.registerTask(nextTask(
   "frontend",2,"task-frontend"));
  assert.equal(second.agent_did,"did:thesis:frontend");
  assert.deepEqual(second.depends_on,["task-backend"]);
  assert.equal(second.authority_digest,first.authority_digest);
  assert.equal(second.root_credential_id,first.root_credential_id);
  assert.equal(second.child_credential_issued,false);
  assert.equal(coordinator.registeredTaskCount,2);
  assert.deepEqual(log.filter(x=>x.event==="issue").map(x=>x.id),
   [preliminary.credential_id,operational.credential_id]);
  await assert.rejects(coordinator.registerTask(nextTask(
   "backend",3,"task-backend")),/invalid epoch or replayed/);
 });
});
test("R286 Coordinator rejects escalation, foreign agent, scope or dependency and remains reusable for corrected Task",async()=>{
 await fixture(async({session,approvals,taskJournal})=>{
  await session.startPlanning(preliminary);
  await session.approveAndIssueOperationalRoot(operational);
  const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals,journal:taskJournal,
   trustedAgentRegistry:registry,nowMs:()=>nowMs
  });
  await coordinator.activate();
  const invalid=[
   {...nextTask(),session_id:"other-session"},
   {...nextTask(),branch:"feature/other"},
   {...nextTask(),base_revision:"b".repeat(40)},
   {...nextTask(),requirement_sha256:"b".repeat(64)},
   {...nextTask(),agent_id:"unregistered"},
   {...nextTask(),depends_on:["unknown-task"]},
   {...nextTask(),epoch:2},
   {...nextTask(),permissions:[{resource:file,operation:"create_file"}]},
   {...nextTask(),permissions:[{resource:file.replace("user.ts","other.ts"),
     operation:"read_file"}]},
   {...nextTask(),permissions:[{resource:file,operation:"read_file"},
     {resource:file,operation:"read_file"}]},
   {...nextTask(),agent_id:"test",
     permissions:[{resource:file,operation:"update_file"}]},
   {...nextTask(),task_id:"bad..id"}
  ];
  for(const candidate of invalid){
   await assert.rejects(coordinator.registerTask(candidate as AuthorityOnlyTaskProposal));
   assert.equal(coordinator.registeredTaskCount,0);
   assert.equal(coordinator.phase,"active");
  }
  const admitted=await coordinator.registerTask(nextTask());
  assert.equal(admitted.agent_id,"backend");
  assert.equal(coordinator.registeredTaskCount,1);
 });
});
test("R286 durable Task journal rejects duplicate session activation across Coordinator objects",async()=>{
 await fixture(async({session,approvals,taskJournal})=>{
  await session.startPlanning(preliminary);
  await session.approveAndIssueOperationalRoot(operational);
  const create=()=>new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals,journal:taskJournal,
   trustedAgentRegistry:registry,nowMs:()=>nowMs
  });
  const first=create();
  await first.activate();
  const second=create();
  await assert.rejects(second.activate(),/EEXIST/u);
  assert.equal(second.phase,"failed_closed");
  await first.registerTask(nextTask());
  assert.equal(first.registeredTaskCount,1);
  await assert.rejects(first.registerTask(nextTask()),/invalid epoch or replayed/);
 });
});
test("R286 Coordinator cannot activate after root expiry or with fake verified Engineer receipt",async()=>{
 await fixture(async({session,approvals,taskJournal})=>{
  await session.startPlanning(preliminary);
  await session.approveAndIssueOperationalRoot(operational);
  const expired=new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals,journal:taskJournal,
   trustedAgentRegistry:registry,
   nowMs:()=>Date.parse("2026-11-05T07:45:00Z")
  });
  await assert.rejects(expired.activate(),/expired/);
  const fakeApprovals={
   async loadAuthenticatedAuthority(){
    const valid=await approvals.loadAuthenticatedAuthority(sessionId);
    return structuredClone(valid);
   }
  };
  const forged=new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals:fakeApprovals as never,
   journal:taskJournal,trustedAgentRegistry:registry,nowMs:()=>nowMs
  });
  await assert.rejects(forged.activate(),/unverified Engineer authority/);
 });
});


// R287: Gateway authority-only admission is opt-in and PREPARE/EXECUTE
// remain unreachable from this registry until Rust VP and OPA are integrated.
test("R287 Gateway independently verifies Engineer signature and exact dynamic Task scope",async()=>{
 await fixture(async({session,approvals,taskJournal,
  gatewayTaskJournal,gatewaySessionStore,log})=>{
  await session.startPlanning(preliminary);
  await session.approveAndIssueOperationalRoot(operational);
  const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals,journal:taskJournal,
   trustedAgentRegistry:registry,nowMs:()=>nowMs
  });
  await coordinator.activate();
  const gateway=new TrustedAuthorityOnlyGatewayAdmissions({
   repository:repo,engineerDid:did,coordinator,approvals,
   operationalSessionStore:gatewaySessionStore,
   taskJournal:gatewayTaskJournal,nowMs:()=>nowMs
  });
  const started=await gateway.activate(sessionId,hash);
  assert.equal(started.status,"gateway_authority_admitted_preflight_only");
  assert.equal(started.gateway_execution_authorized,false);
  await assert.rejects(gateway.bindTrustedTask("unknown","runtime-unknown","backend"),
   /Task not admitted/);
  const receipt=await coordinator.registerTask(nextTask());
  assert.equal(receipt.gateway_registered,false);
  await assert.rejects(gateway.bindTrustedTask("task-backend","runtime-a","frontend"),
   /Task differs/);
  const admitted=await gateway.bindTrustedTask("task-backend","runtime-a","backend");
  assert.equal(admitted.gateway_execution_authorized,false);
  const allowed=gateway.preflightCanonicalRequest({
   task_id:"runtime-a",agent_role:"backend",tool:"read_file",
   arguments:{branch,path:"apps/backend/user.ts"}
  });
  assert.equal(allowed.status,"gateway_permission_preflight_only");
  assert.equal(allowed.required_permission.resource,file);
  assert.equal(allowed.gateway_execution_authorized,false);
  for(const raw of [
   {task_id:"unbound",agent_role:"backend",tool:"read_file",
    arguments:{branch,path:"apps/backend/user.ts"}},
   {task_id:"runtime-a",agent_role:"frontend",tool:"read_file",
    arguments:{branch,path:"apps/backend/user.ts"}},
   {task_id:"runtime-a",agent_role:"backend",tool:"update_file",
    arguments:{branch,path:"apps/backend/user.ts",content:"not approved by Task"}},
   {task_id:"runtime-a",agent_role:"backend",tool:"read_file",
    arguments:{branch,path:"apps/backend-extra/user.ts"}},
   {task_id:"runtime-a",agent_role:"backend",tool:"read_file",
    arguments:{branch:"main",path:"apps/backend/user.ts"}},
   {task_id:"runtime-a",agent_role:"backend",tool:"read_file",
    arguments:{branch,path:"../private/.env"}}
  ])assert.throws(()=>gateway.preflightCanonicalRequest(raw as never));
  assert.throws(()=>gateway.assertExecutionReady(),/unavailable/);
  assert.deepEqual(log.filter(x=>x.event==="issue").map(x=>x.id),
   [preliminary.credential_id,operational.credential_id]);
 });
});

test("R287 Gateway denies replay, dependencies without trusted completion and double-binding",async()=>{
 await fixture(async({session,approvals,taskJournal,
  gatewayTaskJournal,gatewaySessionStore})=>{
  await session.startPlanning(preliminary);
  await session.approveAndIssueOperationalRoot(operational);
  const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals,journal:taskJournal,
   trustedAgentRegistry:registry,nowMs:()=>nowMs
  });
  await coordinator.activate();
  const create=()=>new TrustedAuthorityOnlyGatewayAdmissions({
   repository:repo,engineerDid:did,coordinator,approvals,
   operationalSessionStore:gatewaySessionStore,
   taskJournal:gatewayTaskJournal,nowMs:()=>nowMs
  });
  const gateway=create();
  await gateway.activate(sessionId,hash);
  const duplicate=create();
  await assert.rejects(duplicate.activate(sessionId,hash),
   /operational session already used or retired/);
  assert.equal(duplicate.phase,"failed_closed");
  await coordinator.registerTask(nextTask());
  await gateway.bindTrustedTask("task-backend","runtime-a","backend");
  await coordinator.registerTask(nextTask("frontend",2,"task-frontend"));
  const second=await gateway.bindTrustedTask("task-frontend","runtime-b","frontend");
  assert.equal(second.gateway_execution_authorized,false);
  assert.throws(()=>gateway.preflightCanonicalRequest({
   task_id:"runtime-b",agent_role:"frontend",tool:"update_file",
   arguments:{branch,path:"apps/backend/user.ts",content:"not yet attested"}
  }),/dependency completion not yet Gateway-attested/);
  await assert.rejects(gateway.bindTrustedTask("task-backend","runtime-c","backend"),
   /replayed or invalid/);
  assert.equal(gateway.registeredTaskCount,2);
 });
});

test("R287 Gateway denies untrusted receipt reader, changed repo and expired root",async()=>{
 await fixture(async({session,approvals,taskJournal,
  gatewayTaskJournal,gatewaySessionStore})=>{
  await session.startPlanning(preliminary);
  await session.approveAndIssueOperationalRoot(operational);
  const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
   sessionId,engineer:session,approvals,journal:taskJournal,
   trustedAgentRegistry:registry,nowMs:()=>nowMs
  });
  await coordinator.activate();
  assert.throws(()=>new TrustedAuthorityOnlyGatewayAdmissions({
   repository:repo,engineerDid:did,coordinator,
   approvals:{...approvals} as never,
   operationalSessionStore:gatewaySessionStore,
   taskJournal:gatewayTaskJournal,nowMs:()=>nowMs
  }),/trusted Gateway admission dependencies missing/);
  const wrong=new TrustedAuthorityOnlyGatewayAdmissions({
   repository:{...repo,repository:"outside"},engineerDid:did,
   coordinator,approvals,operationalSessionStore:gatewaySessionStore,
   taskJournal:gatewayTaskJournal,nowMs:()=>nowMs
  });
  await assert.rejects(wrong.activate(sessionId,hash),
   /Coordinator root belongs to different trusted session/);
  const expired=new TrustedAuthorityOnlyGatewayAdmissions({
   repository:repo,engineerDid:did,coordinator,approvals,
   operationalSessionStore:gatewaySessionStore,
   taskJournal:gatewayTaskJournal,
   nowMs:()=>Date.parse("2026-11-05T07:45:00Z")
  });
  await assert.rejects(expired.activate(sessionId,hash),/expired/);
  assert.equal(expired.phase,"failed_closed");
 });
});
