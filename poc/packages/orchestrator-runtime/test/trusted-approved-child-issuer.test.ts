import test from "node:test";
import assert from "node:assert/strict";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedPlanChildAuthorityIssuer} from "../src/trusted-approved-child-issuer.ts";
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
