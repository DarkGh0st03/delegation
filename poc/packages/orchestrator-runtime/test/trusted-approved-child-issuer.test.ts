import test from "node:test";
import assert from "node:assert/strict";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedPlanChildAuthorityIssuer} from "../src/trusted-approved-child-issuer.ts";
import {TrustedApprovedA2ADispatcher} from "../src/trusted-approved-a2a-dispatcher.ts";
import {DelegatedA2ARoleRunner} from "../src/a2a-workflow.ts";
import {TaskState} from "@a2a-js/sdk";

const repository={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const URI="gitea://gitea.local/thesis/iam-console-poc";
const BRANCH="feature/approved-dc";
const FILE=URI+"/branches/feature%2Fapproved-dc/files/apps/backend/user.ts";
const EXTRA=URI+"/branches/feature%2Fapproved-dc/files/apps/backend/other.ts";
const TEST=URI+"/branches/feature%2Fapproved-dc";
const DID="did:thesis:engineer";
const status={type:"BitstringStatusListEntry" as const,statusPurpose:"revocation" as const,
  statusListIndex:"8271",statusListCredential:"https://status.example/approved-child"};
function plan(){
  return {
    schema_version:"1.0.0",plan_id:"approved-child-plan",
    session_id:"approved-child-session",version:1,repository,
    base_revision:"a".repeat(40),
    requirement:"Implement approved backend change and run isolated tests",
    candidate_agents:[
      {agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"},
      {agent_id:"test",did:"did:thesis:test",card_ref:"trusted:test"}
    ],
    tasks:[
      {id:"branch",agent_id:"orchestrator",title:"Work branch",
        description:"Create work branch",depends_on:[],resources:[URI]},
      {id:"backend",agent_id:"backend",title:"Backend code",
        description:"Change only one backend file",depends_on:["branch"],
        resources:[FILE,EXTRA]},
      {id:"tests",agent_id:"test",title:"Run tests",
        description:"Run controlled tests",depends_on:["backend"],resources:[TEST]}
    ],
    requested_permissions:[
      {id:"branch-perm",task_id:"branch",agent_id:"orchestrator",resource:URI,
        operation:"create_branch",reason:"Work on safe branch"},
      {id:"backend-write",task_id:"backend",agent_id:"backend",
        resource:FILE,operation:"update_file",reason:"Approved edit"},
      {id:"backend-read",task_id:"backend",agent_id:"backend",
        resource:FILE,operation:"read_file",reason:"Read current file"},
      {id:"backend-extra",task_id:"backend",agent_id:"backend",
        resource:EXTRA,operation:"update_file",reason:"Unapproved candidate"},
      {id:"tests-run",task_id:"tests",agent_id:"test",
        resource:TEST,operation:"run_tests",reason:"Controlled test"}
    ],assumptions:[],uncertainties:[]
  };
}
const PERMISSIONS=[
 {operation:"create_branch",resource:URI},
 {operation:"update_file",resource:FILE},
 {operation:"read_file",resource:FILE},
 {operation:"run_tests",resource:TEST}
];
function fixture(options:{
  maliciousDid?:boolean;extraParent?:boolean;amplifyResponse?:boolean;
  badResponse?:boolean;wrongDigest?:boolean;
}={}){
  const p=plan();
  const ids=["branch-perm","backend-write","backend-read","tests-run"];
  const approved=makeApproval(p,{
    allowedOperations:new Set(RUST_OPERATIONS),decision_id:"signed-dec-1",
    approved_by:DID,approved_at:"2026-10-21T18:00:00Z",
    approved_permission_ids:ids
  });
  const calls:any[]=[];
  const control={phase:"execution" as string, trustedOperationalAuthority(){
    return {
      credential_id:"urn:issued:operational-root",
      plan_digest:options.wrongDigest?"b".repeat(64):planDigest(p),
      permissions:options.extraParent?
        PERMISSIONS.filter(x=>x.resource!==FILE):PERMISSIONS
    };
  }};
  const fetchFn:typeof fetch=async (_url,init)=>{
    const body=JSON.parse(String(init?.body));
    calls.push({url:String(_url),body,headers:new Headers(init?.headers)});
    if(options.badResponse)return new Response("{invalid",{status:201});
    const per=options.amplifyResponse?
      [...body.permissions,{operation:"create_pull_request",resource:URI}]:
      body.permissions;
    return new Response(JSON.stringify({
      "@context":["https://www.w3.org/ns/credentials/v2"],
      type:["VerifiableCredential","DelegationCredential"],
      id:body.credential_id,issuer:"did:thesis:orchestrator",
      validFrom:body.valid_from,
      credentialSubject:{sub:"did:thesis:"+body.delegatee,per}
    }),{status:201,headers:{"content-type":"application/json"}});
  };
  const config={
    approvals:{async loadAuthenticatedApproval(){
      return {plan:p,approval:approved,
        authenticated_engineer_did:options.maliciousDid?"did:thesis:attacker":DID};
    }},
    coordinator:control,sessionId:p.session_id,engineerDid:DID,
    adapterBaseUrl:"http://127.0.0.1:9988",bearerToken:"private-orchestrator-bearer",
    fetchFn
  };
  return {config,control,calls,p};
}
function child(overrides:Record<string,unknown>={}){
 return {
   parent_credential_id:"urn:issued:operational-root",
   credential_id:"urn:issued:backend-child",
   valid_from:"2026-10-21T18:00:00Z",validity_seconds:300,
   credential_status:status,selection:{role:"backend"},
   approved_task_id:"backend",...overrides
 };
}
test("trusted issuer sends ONLY the two signed backend grants; never the role template or unapproved file",async()=>{
 const e=fixture();
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create(e.config as any);
 const result=await issuer.issueSpecializedChild(child());
 assert.equal(result.role,"backend");
 assert.equal(e.calls.length,1);
 assert.equal(e.calls[0].url,"http://127.0.0.1:9988/v1/credentials/child");
 assert.equal(e.calls[0].headers.get("authorization"),"Bearer private-orchestrator-bearer");
 assert.equal(e.calls[0].body.delegatee,"backend");
 assert.equal(e.calls[0].body.parent_credential_id,"urn:issued:operational-root");
 assert.deepEqual(e.calls[0].body.permissions,[
   {resource:FILE,operation:"update_file"},{resource:FILE,operation:"read_file"}
 ]);
 assert.deepEqual(result.credential.credentialSubject.per,e.calls[0].body.permissions);
 assert.ok(!JSON.stringify(e.calls[0].body).includes(EXTRA));
 await assert.rejects(issuer.issueSpecializedChild(child({
   credential_id:"urn:issued:second-attempt"
 })),/already attempted/);
 assert.equal(e.calls.length,1);
});

test("Task ID/role, parent identity, unsupported selection and expired coordinator deny BEFORE network",async()=>{
 for(const overrides of [
   {approved_task_id:"other"},{approved_task_id:"branch"},
   {approved_task_id:"tests"},{selection:{role:"frontend"}},
   {selection:{role:"backend",permissions:[{operation:"create_pull_request",resource:URI}]}},
   {parent_credential_id:"urn:fake:root"},
   {validity_seconds:99999},{credential_status:{...status,statusListIndex:"invalid"}}
 ]){
   const e=fixture();
   const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create(e.config as any);
   await assert.rejects(issuer.issueSpecializedChild(child(overrides)),/Trusted child DC:/);
   assert.equal(e.calls.length,0);
 }
 const e=fixture();
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create(e.config as any);
 e.control.phase="closed";
 await assert.rejects(issuer.issueSpecializedChild(child()),/no longer active/);
 assert.equal(e.calls.length,0);
});

test("unsigned Engineer state, mismatched root digest or permissions fail before child issuance",async()=>{
 for(const opts of [{maliciousDid:true},{wrongDigest:true},{extraParent:true}]){
   const e=fixture(opts);
   await assert.rejects(TrustedApprovedPlanChildAuthorityIssuer.create(e.config as any),
     /Engineer identity mismatch|does not match|outside the operational root/);
   assert.equal(e.calls.length,0);
 }
});

test("Adapter cannot amplify, truncate or return malformed scoped child credentials",async()=>{
 for(const opts of [{amplifyResponse:true},{badResponse:true}]){
   const e=fixture(opts);
   const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create(e.config as any);
   await assert.rejects(issuer.issueSpecializedChild(child()),
     /response differs|malformed/);
   assert.equal(e.calls.length,1);
   await assert.rejects(issuer.issueSpecializedChild(child()),/already attempted/);
   assert.equal(e.calls.length,1);
 }
});

test("DelegatedA2A runner passes approved Task ID to child issuer before any A2A action",async()=>{
 const e=fixture();
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create(e.config as any);
 const sent:any[]=[];
 const roleRunner=new DelegatedA2ARoleRunner({
   authorityIssuer:issuer,
   a2a:{async sendProtectedTask(request){
     sent.push(request);
     return {card:{name:"Trusted Backend Agent"},task:{
       id:"a2a-issued-task",
       status:{state:TaskState.TASK_STATE_COMPLETED},
       artifacts:[{parts:[{content:{$case:"data",value:{
         role:"backend",summary:"Verified backend change",
         files_modified:[FILE.split("/files/")[1]],files_created:[],
         branch:BRANCH,revision:"a".repeat(40),commit_sha:"a".repeat(40),
         test_outcome:"not_run",errors:[]
       }}}]}]
     }} as any;
   }}
 });
 const done=await roleRunner.issueAndRun({
   ...child(),role:"backend",approved_task_id:"backend",
   agent_base_url:"http://trusted-backend.local",
   subtask:{subtask_id:"backend",instruction:"Only approved file",
     branch:BRANCH,relevant_paths:["apps/backend/user.ts"]}
 } as any);
 assert.equal(done.credential.credentialSubject.per.length,2);
 assert.equal(sent.length,1);
 assert.equal(sent[0].subtask.branch,BRANCH);
 assert.ok(!JSON.stringify(sent[0].subtask).includes("private-orchestrator-bearer"));
 const unauthorized=fixture();
 const rejectedIssuer=await TrustedApprovedPlanChildAuthorityIssuer.create(
   unauthorized.config as any);
 const denyRunner=new DelegatedA2ARoleRunner({
   authorityIssuer:rejectedIssuer,
   a2a:{async sendProtectedTask(){throw Error("A2A must not be reached");}}
 });
 await assert.rejects(denyRunner.issueAndRun({
   ...child({approved_task_id:"branch"}),role:"backend",
   agent_base_url:"http://trusted-backend.local",
   subtask:{subtask_id:"branch",instruction:"Malicious Task",branch:BRANCH,
     relevant_paths:[]}
 } as any),/Task\/role not authorized/);
 assert.equal(unauthorized.calls.length,0);
});


test("opt-in signed DAG factory binds before issuing exact child DC then running A2A",async()=>{
 const e=fixture();
 const order:string[]=[];
 // This is a mock of the trusted Coordinator for ordering; signed plan/root
 // are independently fetched and checked by both production-style factories.
 const trustedCoordinator={
   ...e.control,
   async bindDispatchedTask(taskId:string,id:string,role:string){
     order.push("bind:"+taskId+":"+role+":"+id);
   },
   async confirmTask(id:string,observation:{role:string}){
     order.push("confirm:"+id+":"+observation.role);
   },
   async closeExecution(){this.phase="closed";order.push("close");}
 };
 const roleTask={id:"backend",role:"backend"};
 const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
   approvals:e.config.approvals as any,coordinator:trustedCoordinator as any,
   sessionId:e.p.session_id,
   expectedEngineerDid:DID,baseRevision:e.p.base_revision,
   expectedPlanDigest:planDigest(e.p),
   agentBaseUrls:{
     backend:"http://127.0.0.1:8001",
     frontend:"http://127.0.0.1:8002",
     test:"http://127.0.0.1:8003"
   },
   adapter:{
     adapterBaseUrl:e.config.adapterBaseUrl,
     bearerToken:e.config.bearerToken,
     fetchFn:async(url,options)=>{
       order.push("adapter-issued");
       return e.config.fetchFn(url,options);
     }
   },
   async authorityForTask(taskId,role){
     assert.deepEqual({id:taskId,role},roleTask);
     return {
       parent_credential_id:"urn:issued:operational-root",
       credential_id:"urn:issued:task-backed-child",
       valid_from:"2026-10-21T18:00:00Z",
       validity_seconds:300,credential_status:status
     };
   },
   a2a:{async sendProtectedTask(request){
     order.push("a2a-sent");
     assert.ok(request.trusted_gateway_task_id?.startsWith("dispatch_"));
     assert.equal(request.subtask.branch,BRANCH);
     const dc=JSON.parse(request.delegation_evidence.credential);
     assert.deepEqual(dc.credentialSubject.per,[
       {resource:FILE,operation:"update_file"},
       {resource:FILE,operation:"read_file"}
     ]);
     return {card:{name:"Pinned Backend Agent"},task:{
       id:"remote-a2a-1",
       status:{state:TaskState.TASK_STATE_COMPLETED},
       artifacts:[{parts:[{content:{$case:"data",value:{
         role:"backend",summary:"Done",
         files_modified:["apps/backend/user.ts"],
         files_created:[],branch:BRANCH,
         revision:"a".repeat(40),commit_sha:"a".repeat(40),
         test_outcome:"not_run",errors:[]
       }}}]}]
     }} as any;
   }}
 });
 await dispatcher.runOrchestratorTask("branch",async id=>{
   order.push("orchestrator-effect:"+id);
 });
 const result=await dispatcher.dispatch("backend");
 assert.equal(result.artifact.branch,BRANCH);
 assert.deepEqual(dispatcher.completedTaskIds,["branch","backend"]);
 assert.equal(e.calls.length,1);
 assert.ok(order.findIndex(x=>x.startsWith("bind:backend:"))<
   order.indexOf("adapter-issued"));
 assert.ok(order.indexOf("adapter-issued")<order.indexOf("a2a-sent"));
 assert.ok(order.indexOf("a2a-sent")<
   order.findIndex(x=>x.startsWith("confirm:")&&x.endsWith(":backend")));
});


test("Test Agent receives only approved run_tests on the signed work branch",async()=>{
 const e=fixture();
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create(e.config as any);
 const issued=await issuer.issueSpecializedChild(child({
   approved_task_id:"tests",selection:{role:"test"},
   credential_id:"urn:issued:scoped-test-child"
 }));
 assert.equal(issued.role,"test");
 assert.deepEqual(e.calls[0].body.permissions,[
   {operation:"run_tests",resource:TEST}
 ]);
 assert.equal(e.calls[0].body.delegatee,"test");
 assert.equal(issued.credential.id,"urn:issued:scoped-test-child");
 assert.ok(!JSON.stringify(e.calls[0].body).includes("create_pull_request"));
});


test("operational root revoked during Adapter child issuance is rejected BEFORE A2A",async()=>{
 const e=fixture();
 const original=e.config.fetchFn;
 let attempted=0,sent=0;
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create({
   ...e.config,
   fetchFn:(async(url,options)=>{
     attempted++;
     const response=await original(url,options);
     // Simulate the Engineer terminating Execution before Adapter returns.
     e.control.phase="closed";
     return response;
   }) as typeof fetch
 } as any);
 const runner=new DelegatedA2ARoleRunner({
   authorityIssuer:issuer,
   a2a:{async sendProtectedTask(){sent++;throw Error("A2A MUST NOT start");}}
 });
 const input={
   ...child(),role:"backend",agent_base_url:"http://127.0.0.1:8001",
   subtask:{subtask_id:"backend",instruction:"Approved backend change",
     branch:BRANCH,relevant_paths:["apps/backend/user.ts"]}
 };
 await assert.rejects(runner.issueAndRun(input as any),/operational parent is no longer active/);
 assert.equal(attempted,1);
 assert.equal(sent,0);
 assert.equal(e.calls.length,1);
 // A canceled issuance cannot be retried, even if a misleading callback
 // claims Execution has returned.
 e.control.phase="execution";
 await assert.rejects(issuer.issueSpecializedChild(child()),/already attempted/);
 assert.equal(e.calls.length,1);
});

test("root revoked AFTER child return but BEFORE protected A2A send is refused",async()=>{
 const e=fixture();
 let sent=0,guarded=0;
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create(e.config as any);
 const runner=new DelegatedA2ARoleRunner({
   authorityIssuer:{
     async issueSpecializedChild(input){
       const issued=await issuer.issueSpecializedChild(input);
       // Deterministically close the Coordinator in the final microtask gap.
       e.control.phase="closed";
       return issued;
     },
     assertActiveBeforeA2ASend(){
       guarded++;
       issuer.assertActiveBeforeA2ASend();
     }
   },
   a2a:{async sendProtectedTask(){sent++;throw Error("A2A MUST NOT start");}}
 });
 await assert.rejects(runner.issueAndRun({
   ...child(),role:"backend",agent_base_url:"http://127.0.0.1:8001",
   subtask:{subtask_id:"backend",instruction:"Approved edit",
     branch:BRANCH,relevant_paths:["apps/backend/user.ts"]}
 } as any),/operational parent is no longer active/);
 assert.equal(e.calls.length,1);
 // The approved runner now rejects a missing guard and invokes a real
 // guard before irreversible issuance and again immediately before A2A.
 // Revocation in the issuance gap must be observed by the second check.
 assert.equal(guarded,2);
 assert.equal(sent,0);
});
