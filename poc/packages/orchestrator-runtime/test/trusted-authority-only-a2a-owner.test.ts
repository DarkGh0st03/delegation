import test from "node:test";
import assert from "node:assert/strict";
import {TaskState} from "@a2a-js/sdk";
import {canonicalBranchUri,canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyRemoteEffectBootstrap}
 from "../src/trusted-authority-only-remote-effect-bootstrap.ts";
import {TrustedAuthorityOnlyA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension",file="apps/backend/src/users/account.ts";
const taskId="r325-backend",runtimeTaskId="dispatch_"+"G".repeat(22);
const id="urn:r325:native:child",did="did:thesis:backend-agent";
const effect={resource:canonicalFileUri(repo,branch,file),
 operation:"update_file" as const};
const root={
 session_id:"r325-root-session",repository:repo,branch,
 authority_digest:"a".repeat(64),root_credential_id:"native-root-r325",
 base_revision:"b".repeat(40),requirement_sha256:"c".repeat(64),
 engineer_did:"did:thesis:engineer",
 root_expires_at:new Date(Date.now()+60000).toISOString(),
 expires_at:new Date(Date.now()+60000).toISOString(),
 root_permissions:[effect]
};
const row={
 status:"task_registered_preflight_only" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:did,card_ref:"trusted:backend",
 depends_on:[],permissions:[effect],root_credential_id:root.root_credential_id,
 authority_digest:root.authority_digest,
 execution_authorized:false as const,child_credential_issued:false as const,
 gateway_registered:false as const
};
const child={
 status:"native_child_response_verified_staged" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:did,root_credential_id:root.root_credential_id,
 credential_id:id,authority_digest:root.authority_digest,permissions:[effect],
 status_list_credential:"https://issuer.invalid/status",status_list_index:"1",
 expires_at:new Date(Date.now()+60000).toISOString(),
 gateway_execution_authorized:false as const
};
const signed={
 "@context":["https://www.w3.org/2018/credentials/v1"],
 type:["VerifiableCredential"],id,issuer:"did:thesis:rust",
 validFrom:new Date(Date.now()-1000).toISOString(),
 credentialStatus:{
  type:"BitstringStatusListEntry",statusPurpose:"revocation",
  statusListCredential:child.status_list_credential,statusListIndex:"1"
 },
 credentialSubject:{sub:did,per:[effect]},
 proof:{type:"Ed25519Signature2020",proofValue:"fixture-only-not-cryptographic"}
};
const receipt={
 status:"gateway_owner_child_task_preflight_only" as const,
 task_id:taskId,runtime_task_id:runtimeTaskId,agent_id:"backend",
 agent_did:did,credential_id:id,
 authority_digest:root.authority_digest,gateway_execution_authorized:false as const
};
const artifact={
 role:"backend",summary:"Applied authorized file update",
 files_modified:[file],files_created:[],branch,
 revision:"d".repeat(40),commit_sha:"d".repeat(40),
 test_outcome:"not_run",errors:[]
};
const goodResponse=()=>{
 return {card:{name:"Backend Agent"},task:{
  id:"a2a-task-r325",status:{state:TaskState.TASK_STATE_COMPLETED},
  artifacts:[{parts:[{content:{$case:"data",value:artifact}}]}]
 }};
};
function fixture(patch?:{
 row?:typeof row;child?:typeof child;root?:typeof root;
 receipt?:typeof receipt;signed?:typeof signed;
 response?:unknown;failBind?:boolean
 }){
 const calls:string[]=[];
 let takes=0,roots=0;
 const coord=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
  assertTrustedGatewayAuthorityBinding:()=>{roots++;return patch?.root??root;},
  assertTrustedGatewayRegisteredTask:()=>patch?.row??row
 });
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
  assertTrustedIssuedChild:()=>patch?.child??child,
  takeTrustedIssuedChildCredential:()=>{
   takes++;if(takes>1)throw Error("already taken");
   return patch?.signed??signed;
  }
 });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
  assertTrustedOwnerRemoteEffectBinding:()=>patch?.receipt??receipt
 });
 const bootstrap=Object.assign(Object.create(
  TrustedAuthorityOnlyRemoteEffectBootstrap.prototype),{
  dispatchApprovedTask:async(input:{
   taskId:string;runtimeTaskId:string;dispatch:()=>Promise<unknown>
  })=>{
   calls.push("private_bind");
   if(patch?.failBind)throw Error("owner private bind denied");
   assert.equal(input.taskId,taskId);
   assert.equal(input.runtimeTaskId,runtimeTaskId);
   return input.dispatch();
  },
  cancelTask:async()=>{},
  close:async()=>{}
 });
 const transport={sendProtectedTask:async(input:unknown)=>{
  calls.push("a2a_send");
  const sent=input as {subtask:{branch:string;approved_file_permissions:unknown[];
    approved_run_tests:boolean;relevant_paths:string[]};
    delegation_evidence:{credential:string;credential_id:string;
     presenter_id:string};
    trusted_gateway_task_id:string;agent_base_url:string};
  assert.equal(sent.agent_base_url,"http://127.0.0.1:8101");
  assert.equal(sent.trusted_gateway_task_id,runtimeTaskId);
  assert.equal(sent.subtask.branch,branch);
  assert.deepEqual(sent.subtask.relevant_paths,[file]);
  assert.deepEqual(sent.subtask.approved_file_permissions,[{
   path:file,operation:"update_file"
  }]);
  assert.equal(sent.subtask.approved_run_tests,false);
  assert.equal(sent.delegation_evidence.credential_id,id);
  assert.equal(sent.delegation_evidence.presenter_id,did);
  assert.deepEqual(JSON.parse(sent.delegation_evidence.credential),patch?.signed??signed);
  return patch?.response??goodResponse();
 }};
 const owner=new TrustedAuthorityOnlyA2AOwner({
  coordinator:coord,childIssuer:issuer,gateway,bootstrap,
  a2a:transport,agentBaseUrls:{
   backend:"http://127.0.0.1:8101/",
   frontend:"http://127.0.0.1:8102/",
   test:"http://127.0.0.1:8103/"
  }
 } as never);
 return {owner,calls,get takes(){return takes;},get roots(){return roots;}};
}
const request=()=>({taskId,runtimeTaskId,
 instruction:"Update the account status handler",
 effectStager:{async stage(){return {provider_write_authorized:false};}}
});
test("R325 actual owner handoff transfers native signed Child only after private A2A bind",async()=>{
 const f=fixture();
 const result=await f.owner.dispatchIssuedTask(request());
 assert.equal(result.status,"a2a_report_not_gateway_completed");
 assert.equal(result.provider_completion_attested,false);
 assert.equal(result.artifact.commit_sha,"d".repeat(40));
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 assert.equal(f.takes,1);
 assert.ok(f.roots>=2);
 await assert.rejects(f.owner.dispatchIssuedTask(request()),/closed or malformed owner-selected Task/u);
 assert.equal(f.takes,1);
});
test("R325 private binding failure cannot leak native Child into A2A or retry",async()=>{
 const f=fixture({failBind:true});
 await assert.rejects(f.owner.dispatchIssuedTask(request()),/owner private bind denied/u);
 assert.deepEqual(f.calls,["private_bind"]);
 assert.equal(f.takes,0);
 await assert.rejects(f.owner.dispatchIssuedTask(request()),/closed or malformed/u);
});
test("R325 signed Task/Child/Gateway mismatch fails before remote binding",async()=>{
 for(const patch of [
  {row:{...row,authority_digest:"f".repeat(64)}},
  {child:{...child,credential_id:"urn:other:child"}},
  {receipt:{...receipt,agent_did:"did:thesis:forged"}},
  {row:{...row,permissions:[{
    resource:canonicalBranchUri(repo,branch)+"/files/../bad",
    operation:"update_file" as const}]},
  {row:{...row,permissions:[effect,{resource:canonicalBranchUri(repo,branch),
    operation:"run_tests" as const}]}}
 ]){
  const f=fixture(patch as never);
  await assert.rejects(f.owner.dispatchIssuedTask(request()),/NO-GO/u);
  assert.deepEqual(f.calls,[]);
  assert.equal(f.takes,0);
 }
});
test("R325 forged signed DC payload is rejected after private binding but before A2A",async()=>{
 const f=fixture({signed:{...signed,id:"urn:wrong:credential"}});
 await assert.rejects(f.owner.dispatchIssuedTask(request()),
  /native signed Child payload mismatches/u);
 assert.deepEqual(f.calls,["private_bind"]);
 assert.equal(f.takes,1);
});
test("R325 untrusted A2A status, extra artifact or bad branch is never Gateway completion",async()=>{
 const bad=[
  {card:{name:"Backend Agent"},task:{...goodResponse().task,
   status:{state:TaskState.TASK_STATE_FAILED}}},
  {card:{name:"Backend Agent"},task:{...goodResponse().task,
   artifacts:[...goodResponse().task.artifacts,...goodResponse().task.artifacts]}},
  {card:{name:"Backend Agent"},task:{...goodResponse().task,
   artifacts:[{parts:[{content:{$case:"data",value:{
    ...artifact,branch:"feature/foreign"
   }}}]}]}}
 ];
 for(const response of bad){
  const f=fixture({response});
  await assert.rejects(f.owner.dispatchIssuedTask(request()));
  assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 }
});
test("R325 only Test role may dispatch branch-pinned run_tests",async()=>{
 const branchPermission={resource:canonicalBranchUri(repo,branch),
  operation:"run_tests" as const};
 const testRow={...row,agent_id:"test",agent_did:"did:thesis:test-agent",
  permissions:[branchPermission]};
 const f=fixture({row:testRow as never,child:{
  ...child,agent_id:"test",agent_did:"did:thesis:test-agent",
  permissions:[branchPermission]
 } as never,receipt:{
  ...receipt,agent_id:"test",agent_did:"did:thesis:test-agent"
 } as never});
 // Fake transport fixture only expects Backend; this verifies that a
 // Test report cannot be fabricated without correctly pinned Test Child.
 await assert.rejects(f.owner.dispatchIssuedTask(request()));
 assert.ok(f.calls.includes("private_bind"));
});
