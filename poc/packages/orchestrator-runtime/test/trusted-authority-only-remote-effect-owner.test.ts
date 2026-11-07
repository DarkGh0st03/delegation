import test from "node:test";
import assert from "node:assert/strict";
import {TrustedAuthorityOnlyRemoteEffectOwner}
 from "../src/trusted-authority-only-remote-effect-owner.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedOwnerEffectStagingRegistry}
 from "../../agent-runtime/src/trusted-effect-staging-unix-ipc.ts";
import {TrustedAuthorityOnlySequentialReadUpdateStager}
 from "../../../apps/gateway/src/trusted-authority-only-sequential-read-update-stager.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight}
 from "../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts";
import {AuthenticatedGiteaMutationCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {InMemoryRequestStore} from "../../../apps/gateway/src/prepare.ts";
import {TrustedAuthorityOnlyCreateEffectStager as CreateStager}
 from "../../../apps/gateway/src/trusted-authority-only-create-effect-stager.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight as CreatePreflight}
 from "../../../apps/gateway/src/trusted-authority-only-create-preflight.ts";
import {DurableAuthorityOnlyGiteaCreateIntentJournal as CreateJournal}
 from "../../../apps/gateway/src/trusted-authority-only-create-intent-journal.ts";
import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {canonicalBranchUri,canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";

const repo={authority:"gitea.local",owner:"thesis",
 repository:"iam-console-poc"};
const branch="feature/account-suspension";
const taskId="owner-task",runtimeTaskId="dispatch_"+"C".repeat(22);
const did="did:thesis:backend-agent",credentialId="urn:r323:child:backend";
const digest="e".repeat(64);
const file="apps/backend/src/users/account.ts";
const permission={resource:canonicalFileUri(repo,branch,file),
 operation:"update_file" as const};
const root={session_id:"session-r323",repository:repo,branch,
 authority_digest:digest,root_credential_id:"root-r323",
 base_revision:"a".repeat(40),requirement_sha256:"c".repeat(64),
 engineer_did:"did:thesis:engineer",expires_at:new Date(Date.now()+60000).toISOString(),
 root_expires_at:new Date(Date.now()+60000).toISOString(),
 root_permissions:[permission]};
const row={status:"task_registered_preflight_only" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:did,card_ref:"trusted:backend",
 depends_on:[],permissions:[permission],root_credential_id:root.root_credential_id,
 authority_digest:digest,execution_authorized:false as const,
 child_credential_issued:false as const,gateway_registered:false as const};
const child={status:"native_child_response_verified_staged" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:did,root_credential_id:root.root_credential_id,
 credential_id:credentialId,authority_digest:digest,permissions:[permission],
 status_list_credential:"status",status_list_index:"0",
 expires_at:new Date(Date.now()+60000).toISOString(),
 gateway_execution_authorized:false as const};
const gatewayReceipt={
 status:"gateway_owner_child_task_preflight_only" as const,
 task_id:taskId,runtime_task_id:runtimeTaskId,agent_id:"backend",
 agent_did:did,credential_id:credentialId,authority_digest:digest,
 gateway_execution_authorized:false as const
};
function fixture(patch?:{
 root?:typeof root;row?:typeof row;child?:typeof child;
 gateway?:typeof gatewayReceipt;agentFail?:boolean
}){
 const coord=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
   assertTrustedGatewayAuthorityBinding:()=>patch?.root??root,
   assertTrustedGatewayRegisteredTask:()=>patch?.row??row
  });
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
   assertTrustedIssuedChild:()=>patch?.child??child
  });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
   assertTrustedOwnerRemoteEffectBinding:()=>patch?.gateway??gatewayReceipt
  });
 const calls:string[]=[];
 const registry=new TrustedOwnerEffectStagingRegistry();
 const binder={bindTask:async(pins:unknown)=>{
   calls.push("bind");
   if(patch?.agentFail)throw Error("private bind unavailable");
   calls.push(JSON.stringify(pins));
 },fence:async()=>{calls.push("fence")}};
 const owner=new TrustedAuthorityOnlyRemoteEffectOwner({
  coordinator:coord,childIssuer:issuer,gateway,
  ownerStageRegistry:registry,agentBindingClient:binder
 } as never);
 return {owner,calls,registry,gateway};
}
const port={async stage(_id:string){return {provider_write_authorized:false};}};
test("R323 real owner proof objects derive exact signed Backend file permission",async()=>{
 const f=fixture();
 const r=await f.owner.bindRegisteredTask({taskId,runtimeTaskId,effectStager:port});
 assert.equal(r.status,"owner_remote_effect_task_prebound_not_executed");
 assert.equal(r.gateway_execution_authorized,false);
 assert.equal(f.calls[0],"bind");
 const pins=JSON.parse(f.calls[1]!);
 assert.deepEqual(pins,{
  runtimeTaskId,planTaskId:taskId,role:"backend",
  childCredentialId:credentialId,presenterId:did,branch,
  operation:"update_file",path:file
 });
 await f.registry.stage(runtimeTaskId,"r323-prepared");
 await assert.rejects(f.registry.stage(runtimeTaskId,"r323-prepared"),
  /consumed or malformed/u);
});
test("R323 mismatch of native Child, independent Gateway or signed root denies before binding",async()=>{
 const patches=[
  {child:{...child,credential_id:"urn:forged:child"}},
  {gateway:{...gatewayReceipt,agent_did:"did:thesis:other"}},
  {root:{...root,authority_digest:"b".repeat(64)}},
  {row:{...row,permissions:[{...permission,resource:"gitea://forged"}]}}
 ];
 for(const patch of patches){
  const f=fixture(patch as never);
  await assert.rejects(f.owner.bindRegisteredTask({
   taskId,runtimeTaskId,effectStager:port
  }),/Coordinator, native Child and Gateway disagree/u);
  assert.deepEqual(f.calls,[]);
 }
});
test("R323 owner IPC error retires prebound stager without retry",async()=>{
 const f=fixture({agentFail:true});
 await assert.rejects(f.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:port
 }),/private bind unavailable/u);
 await assert.rejects(f.registry.stage(runtimeTaskId,"r323-request"),
  /consumed or malformed/u);
 await assert.rejects(f.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:port
 }),/one exact owner-selected/u);
});
test("R323 invalid signed resource and unsupported multi-effect Task fail closed",async()=>{
 const bads=[
  [{resource:canonicalBranchUri(repo,branch)+"/files/../other",
    operation:"update_file"}],
  [{resource:"gitea://other/foreign",operation:"update_file"}],
  [permission,{resource:canonicalBranchUri(repo,branch),operation:"run_tests"}],
  [{resource:canonicalBranchUri(repo,branch),operation:"create_file"}]
 ];
 for(const permissions of bads){
  const f=fixture({row:{...row,permissions} as never,
   child:{...child,permissions} as never});
  await assert.rejects(f.owner.bindRegisteredTask({
   taskId,runtimeTaskId,effectStager:port
  }),/NO-GO/u);
  assert.deepEqual(f.calls,[]);
 }
});
test("R323 runner requires Test Child and exact branch-level grant",async()=>{
 const branchPerm={resource:canonicalBranchUri(repo,branch),
  operation:"run_tests" as const};
 const testDid="did:thesis:test-agent";
 const f=fixture({
  row:{...row,agent_id:"test",agent_did:testDid,
   permissions:[branchPerm]} as never,
  child:{...child,agent_id:"test",agent_did:testDid,
   permissions:[branchPerm]} as never,
  gateway:{...gatewayReceipt,agent_id:"test",agent_did:testDid} as never
 });
 await f.owner.bindRegisteredTask({taskId,runtimeTaskId,effectStager:port});
 const pins=JSON.parse(f.calls[1]!);
 assert.equal(pins.operation,"run_tests");
 assert.equal(pins.role,"test");
 assert.equal(Object.hasOwn(pins,"path"),false);
 await f.owner.fence(runtimeTaskId);
 assert.equal(f.calls.at(-1),"fence");
});

test("R359.6 native owner binds exactly one authenticated read->update Task",async()=>{
 const read={...permission,operation:"read_file" as const};
 const permissions=[read,permission];
 const f=fixture({row:{...row,permissions} as never,
  child:{...child,permissions} as never});
 Object.assign(f.gateway,{async beginTrustedSequentialReadUpdateTask(){
  return {status:"sequential_read_update_manifest_reserved_staged",
   task_id:taskId,total_effects:2,gateway_execution_authorized:false};
 }});
 const mutation=Object.assign(Object.create(
  TrustedAuthorityOnlyGiteaMutationPreflight.prototype),{
   isForAdmissions:(v:unknown)=>v===f.gateway
 });
 const observer=Object.create(AuthenticatedGiteaMutationCompletionObserver.prototype);
 const stager=await TrustedAuthorityOnlySequentialReadUpdateStager.begin({
  store:new InMemoryRequestStore(),admissions:f.gateway,
  mutation,mutationObserver:observer,planTaskId:taskId,
  runtimeTaskId,expectedHeadSha:"a".repeat(40)
 });
 const result=await f.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:stager
 });
 assert.equal(result.status,"owner_remote_effect_task_prebound_not_executed");
 const pins=JSON.parse(f.calls[1]!);
 assert.equal(pins.operation,"read_then_update");
 assert.equal(pins.path,file);
 assert.equal(pins.childCredentialId,credentialId);
 const fake=fixture({row:{...row,permissions} as never,
  child:{...child,permissions} as never});
 await assert.rejects(fake.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:{
   stagedTool:"read_then_update",async stage(){},async attest(){}
  }
 }),/original native owner read\/update stager/u);
 assert.deepEqual(fake.calls,[]);
});

test("R383.8 native owner binds only an original CREATE stager and one exact signed file",async()=>{
 const create={resource:canonicalFileUri(repo,branch,file),
  operation:"create_file" as const};
 const f=fixture({
  root:{...root,root_permissions:[create]},
  row:{...row,permissions:[create]},
  child:{...child,permissions:[create]}
 });
 const writer=new GiteaClient({baseUrl:"http://gitea.local:3000",
  owner:"thesis",repository:"iam-console-poc",token:"private"});
 const preflight=new CreatePreflight({
  admissions:f.gateway,giteaClient:writer,
  journal:new CreateJournal("/tmp/r3838-create-owner-test"),
  repository:"thesis/iam-console-poc",branch
 });
 const stager=new CreateStager({
  store:new InMemoryRequestStore(),admissions:f.gateway,
  preflight,giteaClient:writer,repository:"thesis/iam-console-poc",
  branch,planTaskId:taskId,runtimeTaskId,expectedHeadSha:"a".repeat(40)
 });
 const r=await f.owner.bindRegisteredTask({taskId,runtimeTaskId,effectStager:stager});
 assert.equal(r.status,"owner_remote_effect_task_prebound_not_executed");
 assert.equal(r.gateway_execution_authorized,false);
 const pins=JSON.parse(f.calls[1]!);
 assert.deepEqual(pins,{
  runtimeTaskId,planTaskId:taskId,role:"backend",
  childCredentialId:credentialId,presenterId:did,branch,
  operation:"create_file",path:file
 });
 const g=fixture({row:{...row,permissions:[create]},
  child:{...child,permissions:[create]},root:{...root,root_permissions:[create]}});
 await assert.rejects(g.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:{
   stagedTool:"create_file",async stage(){return {provider_write_authorized:false};}
  }
 }),/original owner-only Child, HEAD and staging port/u);
 assert.deepEqual(g.calls,[]);
 const wrong=fixture({row:{...row,permissions:[create]},
  child:{...child,permissions:[create]},root:{...root,root_permissions:[create]}});
 await assert.rejects(wrong.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:stager
 }),/original owner-only Child, HEAD and staging port/u);
 assert.deepEqual(wrong.calls,[]);
});
test("R383.8 a Test Agent cannot bind a CREATE source Task",async()=>{
 const grant={resource:canonicalFileUri(repo,branch,file),operation:"create_file" as const};
 const testDid="did:thesis:test-agent";
 const f=fixture({
  row:{...row,agent_id:"test",agent_did:testDid,permissions:[grant]} as never,
  child:{...child,agent_id:"test",agent_did:testDid,permissions:[grant]} as never,
  gateway:{...gatewayReceipt,agent_id:"test",agent_did:testDid} as never,
  root:{...root,root_permissions:[grant]}
 });
 await assert.rejects(f.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:port
 }),/original owner-only Child, HEAD and staging port/u);
 assert.deepEqual(f.calls,[]);
});
