import test from "node:test";
import assert from "node:assert/strict";
import {TrustedAuthorityOnlyRemoteEffectOwner,
 claimTrustedOriginalNativeTaskPrebindForModelIpc}
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
 const proof=claimTrustedOriginalNativeTaskPrebindForModelIpc(r);
 assert.deepEqual(proof,{
  role:"backend",task_id:taskId,runtime_task_id:runtimeTaskId,
  credential_id:credentialId,session_id:root.session_id,
  authority_digest:digest,root_credential_id:root.root_credential_id
 });
 assert.equal(Object.isFrozen(proof),true);
 assert.throws(()=>claimTrustedOriginalNativeTaskPrebindForModelIpc(r),
  /authentic one-use original prebind/u);
 assert.throws(()=>claimTrustedOriginalNativeTaskPrebindForModelIpc({...r}),
  /authentic one-use original prebind/u);
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

test("R389 original native Test Child can bind CREATE only for one exact project test source",async()=>{
 const source="tests/backend/account.test.ts";
 const grant={resource:canonicalFileUri(repo,branch,source),
  operation:"create_file" as const};
 const testDid="did:thesis:test-agent";
 const f=fixture({
  row:{...row,agent_id:"test",agent_did:testDid,permissions:[grant]} as never,
  child:{...child,agent_id:"test",agent_did:testDid,permissions:[grant]} as never,
  gateway:{...gatewayReceipt,agent_id:"test",agent_did:testDid} as never,
  root:{...root,root_permissions:[grant]}
 });
 const writer=new GiteaClient({baseUrl:"http://gitea.local:3000",
  owner:"thesis",repository:"iam-console-poc",token:"disposable"});
 const preflight=new CreatePreflight({
  admissions:f.gateway,giteaClient:writer,
  journal:new CreateJournal("/tmp/r389-test-create-owner"),
  repository:"thesis/iam-console-poc",branch
 });
 const stager=new CreateStager({
  store:new InMemoryRequestStore(),admissions:f.gateway,
  preflight,giteaClient:writer,repository:"thesis/iam-console-poc",
  branch,planTaskId:taskId,runtimeTaskId,expectedHeadSha:"a".repeat(40)
 });
 const result=await f.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:stager
 });
 assert.equal(result.gateway_execution_authorized,false);
 assert.equal(result.status,"owner_remote_effect_task_prebound_not_executed");
 assert.deepEqual(JSON.parse(f.calls[1]!),{
  runtimeTaskId,planTaskId:taskId,role:"test",
  childCredentialId:credentialId,presenterId:testDid,branch,
  operation:"create_file",path:source
 });
});

test("original native prebind is the ONLY IPC authorization origin, with exact live Root and bounded turns",async()=>{
 const {createDisposableOriginalNativeIpcTaskAdmission}=await import(
  "../../../apps/orchestrator/src/disposable-gemini-original-ipc-task-admission.mjs");
 const f=fixture();
 let currentRoot={...root};
 const approval=createDisposableOriginalNativeIpcTaskAdmission({
  role:"backend",assertOriginalRootActive:()=>currentRoot
 });
 const signed=await f.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:port
 });
 assert.equal(approval.boundTaskCount,0);
 assert.throws(()=>approval.bindOriginalReceipt({...signed}),
  /only an authentic one-use original prebind/u);
 const bound=approval.bindOriginalReceipt(signed,{maxCalls:2});
 assert.equal(bound.gateway_execution_authorized,false);
 assert.equal(bound.model_calls_started_here,0);
 assert.equal(approval.boundTaskCount,1);
 const exactTask={task_id:taskId,runtime_task_id:runtimeTaskId,
  credential_id:credentialId,session_id:root.session_id};
 const call=callId=>approval.authorizeSignedTask({
  role:"backend",task:exactTask,callId,payload:{contents:[]}
 });
 assert.equal(await call("call-native-000001"),true);
 assert.equal(approval.retired,false);
 assert.equal(await call("call-native-000002"),true);
 // A replay or over-budget attempt permanently closes this Task's
 // admission; it is NOT permissible to continue after ambiguous reuse.
 await assert.rejects(call("call-native-000001"),
  /Disposable original signed IPC Task admission NO-GO/u);
 await assert.rejects(call("call-native-000003"),
  /Disposable original signed IPC Task admission NO-GO/u);
 assert.throws(()=>approval.bindOriginalReceipt(signed),
  /authentic one-use original prebind/u);
});
test("original IPC Task admission denies wrong Child, wrong role and revoked Root BEFORE model invocation",async()=>{
 const {createDisposableOriginalNativeIpcTaskAdmission}=await import(
  "../../../apps/orchestrator/src/disposable-gemini-original-ipc-task-admission.mjs");
 const f=fixture(),signed=await f.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:port
 });
 let currentRoot={...root};
 const gate=createDisposableOriginalNativeIpcTaskAdmission({
  role:"backend",assertOriginalRootActive:()=>currentRoot
 });
 gate.bindOriginalReceipt(signed,{maxCalls:2});
 const actual={task_id:taskId,runtime_task_id:runtimeTaskId,
  credential_id:credentialId,session_id:root.session_id};
 await assert.rejects(gate.authorizeSignedTask({
  role:"frontend",task:actual,callId:"call-native-01"
 }),/Disposable original signed IPC Task admission NO-GO/u);
 await assert.rejects(gate.authorizeSignedTask({
  role:"backend",task:{...actual,credential_id:"forged"},
  callId:"call-native-02"
 }),/Disposable original signed IPC Task admission NO-GO/u);
 await assert.rejects(gate.authorizeSignedTask({
  role:"backend",task:actual,callId:"call-native-03"
 }),/Disposable original signed IPC Task admission NO-GO/u);
 // New genuine Task instance: Root retirement denies independently.
 const f2=fixture();
 const signed2=await f2.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:port
 });
 const active=createDisposableOriginalNativeIpcTaskAdmission({
  role:"backend",assertOriginalRootActive:()=>currentRoot
 });
 active.bindOriginalReceipt(signed2);
 currentRoot={...root,root_credential_id:"revoked-root"};
 await assert.rejects(active.authorizeSignedTask({
  role:"backend",task:actual,callId:"call-native-04"
 }),/Disposable original signed IPC Task admission NO-GO/u);
 assert.equal(active.retired,true);
 await assert.rejects(active.authorizeSignedTask({
  role:"backend",task:actual,callId:"call-native-05"
 }),/Disposable original signed IPC Task admission NO-GO/u);
});

test("real Unix RPC accepts only original Coordinator/native Child/Gateway prebind and meters the owner ADK",async t=>{
 const {mkdtemp,writeFile,rm}=await import("node:fs/promises");
 const {tmpdir}=await import("node:os");
 const {join}=await import("node:path");
 const {randomBytes}=await import("node:crypto");
 const {BaseLlm}=await import("@google/adk");
 const {DisposablePrivateBudgetedAdkModel}=await import(
  "../../../apps/orchestrator/src/disposable-gemini-live-budgeted-model.mjs");
 const {createDisposableOriginalOwnerIpcModelAdapter}=await import(
  "../../../apps/orchestrator/src/disposable-gemini-original-owner-ipc-model-adapter.mjs");
 const {createDisposableOriginalNativeIpcTaskAdmission}=await import(
  "../../../apps/orchestrator/src/disposable-gemini-original-ipc-task-admission.mjs");
 const {startDisposableOwnerModelIpcServer,
  connectDisposableWorkerModelIpcClient}=await import(
  "../../../apps/orchestrator/src/disposable-gemini-owner-worker-ipc.mjs");
 const original=fixture();
 // This is the ORIGINAL R323 prebind running its exact typed checks and
 // owner private IPC binder; no fake approval minted by the model transport.
 const receipt=await original.owner.bindRegisteredTask({
  taskId,runtimeTaskId,effectStager:port
 });
 const gate=createDisposableOriginalNativeIpcTaskAdmission({
  role:"backend",assertOriginalRootActive:()=>root
 });
 gate.bindOriginalReceipt(receipt,{maxCalls:1});
 class OfflineModel extends BaseLlm{
  calls=0;
  constructor(){super({model:"gemini-3.8-flash"});}
  async *generateContentAsync(){
   this.calls++;
   yield {content:{role:"model",parts:[{text:"OFFLINE_NATIVE_SIGNED_TASK"}]},
    usageMetadata:{promptTokenCount:5,candidatesTokenCount:3,
     totalTokenCount:8}};
  }
  connect(){throw Error("No real provider allowed");}
 }
 const delegate=new OfflineModel();
 const model=new DisposablePrivateBudgetedAdkModel({
  delegate,phase:"backend",maxCalls:2,maxReportedTokens:100,
  maxPerCallTokens:90
 });
 const adapter=createDisposableOriginalOwnerIpcModelAdapter({
  role:"backend",model
 });
 const dir=await mkdtemp(join(tmpdir(),"r323-ipc-admission-"));
 const socketPath=join(dir,"model.sock"),secretFile=join(dir,"model.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 const owner=await startDisposableOwnerModelIpcServer({
  role:"backend",socketPath,secretFile,
  authorizeSignedTask:gate.authorizeSignedTask,
  invokeModel:adapter.invokeModel
 });
 t.after(async()=>{
  gate.retireAll();adapter.retire();
  await owner.close().catch(()=>{});
  await rm(dir,{recursive:true,force:true});
 });
 const client=await connectDisposableWorkerModelIpcClient({
  role:"backend",socketPath,secretFile
 });
 const exact={task_id:taskId,runtime_task_id:runtimeTaskId,
  credential_id:credentialId,session_id:root.session_id};
 const payload={contents:[{role:"user",
  parts:[{text:"Read approved backend source offline"}]}]};
 const good=await client.call({
  task:exact,callId:"r323-original-model-call-1",payload
 });
 assert.equal(good.chunks.length,1);
 assert.equal(good.chunks[0].content.parts[0].text,
  "OFFLINE_NATIVE_SIGNED_TASK");
 assert.equal(good.metered_calls_started,1);
 assert.equal(good.metered_total_tokens,8);
 assert.equal(delegate.calls,1);
 assert.equal(good.owner_original_signed_task_verified_here,false);
 // Full signed Task/Child/Gateway agreement is the ORIGINAL native prebind;
 // it is not invented by transport flags or provider model output.
 await assert.rejects(client.call({
  task:exact,callId:"r323-original-model-call-2",payload
 }),/Disposable owner-worker model IPC NO-GO/u);
 await assert.rejects(client.call({
  task:{...exact,credential_id:"urn:forged:child"},
  callId:"r323-original-model-call-3",payload
 }),/Disposable owner-worker model IPC NO-GO/u);
 assert.equal(delegate.calls,1);
 assert.throws(()=>gate.bindOriginalReceipt({...receipt}),
  /authentic one-use original prebind/u);
});
