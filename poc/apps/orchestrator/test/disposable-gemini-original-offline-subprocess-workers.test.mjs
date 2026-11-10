import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:net";
import {AGENT_CARD_PATH} from "@a2a-js/sdk";
import {startDisposableOriginalOfflineSubprocessWorkers}
 from "../src/disposable-gemini-original-offline-subprocess-workers.mjs";
import {assertTrustedSdkA2ARoster}
 from "../src/trusted-authority-only-review-host.mjs";
import {TrustedOwnerEffectStagingRegistry,
 createTrustedOwnerEffectStagingServer,
 connectTrustedEffectAgentBindingClient,
 connectTrustedOwnerEffectStagingClient}
 from "../../../packages/agent-runtime/src/trusted-effect-staging-unix-ipc.ts";

const ROLES=["backend","frontend","test"];
const DENY=/Disposable original offline native worker bridge NO-GO/u;
async function getPort(){
 const s=createServer();
 await new Promise(resolve=>s.listen(0,"127.0.0.1",resolve));
 const p=s.address().port;
 await new Promise(resolve=>s.close(resolve));
 return p;
}
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),"original-three-offline-"));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const ports=new Set(),workers={},handlers={},counters={};
 for(const role of ROLES){
  let p=await getPort();
  while(ports.has(p))p=await getPort();
  ports.add(p);
  counters[role]=0;
  workers[role]={port:p,adk:{
   gatewayBaseUrl:"http://127.0.0.1:18131",
   adapterBaseUrl:"http://127.0.0.1:18132",
   adapterToken:"offline-private-worker-"+role,maxModelTurns:2
  }};
  handlers[role]={
   authorizeSignedTask:async()=>false, // no authentic Root in offline test
   invokeModel:async()=>{counters[role]++;throw Error("NO INFERENCE");}
  };
 }
 return {directory,workers,handlers,counters};
}
test("original three-role SDK startup contract now exists with separate A2A PIDs and 9 private channels",async t=>{
 const f=await fixture(t);
 const handle=await startDisposableOriginalOfflineSubprocessWorkers({
  directory:f.directory,sessionId:"original-session-offline-01",
  workers:f.workers,offlineModelHandlers:f.handlers,
  offlineSyntheticOnly:true
 });
 t.after(()=>handle.close().catch(()=>{}));
 assert.equal(handle.status,
  "offline_synthetic_original_sdk_worker_topology_not_native_root");
 assert.equal(handle.original_signed_authority_verified_here,false);
 assert.equal(handle.osIsolationVerified,false);
 const sdk=handle.sdk;
 assert.deepEqual(Object.keys(sdk.agentBaseUrls),ROLES);
 assert.deepEqual(Object.keys(sdk.stageChannels),ROLES);
 assert.deepEqual(Object.keys(sdk.agentBindingChannels),ROLES);
 const roster=Object.fromEntries(ROLES.map(role=>
  [role,{did:"did:thesis:"+role+"-agent"}]));
 roster.orchestrator={did:"did:thesis:orchestrator"};
 assert.deepEqual([...assertTrustedSdkA2ARoster(roster,sdk)],ROLES);
 const paths=ROLES.flatMap(role=>[
  sdk.stageChannels[role].secretFile,
  sdk.agentBindingChannels[role].secretFile
 ]);
 assert.equal(new Set(paths).size,6);
 for(const role of ROLES){
  const res=await fetch(new URL(AGENT_CARD_PATH,
   sdk.agentBaseUrls[role]+"/"));
  assert.equal(res.status,200);
  const card=await res.json();
  assert.equal(card.supportedInterfaces[0].url,
   sdk.agentBaseUrls[role]+"/a2a/rest");
  assert.equal(f.counters[role],0);
 }
 // The ORIGINAL native RemoteEffectBootstrap owns these stage server ports.
 // Starting them after the A2A listeners exercises exactly that sequence.
 const registry=new TrustedOwnerEffectStagingRegistry(),servers=[];
 t.after(async()=>{for(const s of servers.reverse())
  await s.close().catch(()=>{});
 });
 for(const role of ROLES){
  const s=await createTrustedOwnerEffectStagingServer({
   ...sdk.stageChannels[role],registry,expectedRole:role
  });
  await s.start();servers.push(s);
 }
 const bind=await connectTrustedEffectAgentBindingClient({
  ...sdk.agentBindingChannels.backend,expectedRole:"backend"
 });
 const stage=await connectTrustedOwnerEffectStagingClient(
  sdk.stageChannels.backend);
 const taskId="dispatch_"+"x".repeat(22);
 let staged=0;
 registry.bindTask(taskId,{async stage(){staged++;}},"backend");
 await bind.bindTask({
  runtimeTaskId:taskId,planTaskId:"signed-backend-task-01",
  childCredentialId:"urn:child:backend:offline",
  presenterId:"did:thesis:backend-agent",
  branch:"feature/account-suspension",
  role:"backend",operation:"read_file",
  path:"apps/backend/account.ts"
 });
 await stage.stage(taskId,"owner-verified-gateway-operation-01");
 assert.equal(staged,1);
 await bind.fence(taskId);
 await assert.rejects(stage.stage(taskId,
  "owner-verified-gateway-operation-02"));
 assert.equal(staged,1);
 await handle.close();
 for(const role of ROLES){
  await assert.rejects(fetch(new URL(AGENT_CARD_PATH,
   sdk.agentBaseUrls[role]+"/")));
 }
});
test("role expansion, weak host directory, paid mode and missing owner Model authorization are forbidden",async t=>{
 const f=await fixture(t);
 const a={directory:f.directory,sessionId:"original-session-offline-01",
  workers:f.workers,offlineModelHandlers:f.handlers,
  offlineSyntheticOnly:true};
 await assert.rejects(startDisposableOriginalOfflineSubprocessWorkers({
  ...a,offlineSyntheticOnly:false
 }),DENY);
 await assert.rejects(startDisposableOriginalOfflineSubprocessWorkers({
  ...a,workers:{...f.workers,reviewer:f.workers.backend}
 }),DENY);
 await assert.rejects(startDisposableOriginalOfflineSubprocessWorkers({
  ...a,offlineModelHandlers:{...f.handlers,backend:{
   invokeModel:async()=>{}
  }}
 }),DENY);
 const before=process.env.DELEGATION_DISPOSABLE_LIVE_MODE;
 process.env.DELEGATION_DISPOSABLE_LIVE_MODE="gemini-real";
 try{await assert.rejects(startDisposableOriginalOfflineSubprocessWorkers(a),
  DENY);}finally{
  if(before===undefined)delete process.env.DELEGATION_DISPOSABLE_LIVE_MODE;
  else process.env.DELEGATION_DISPOSABLE_LIVE_MODE=before;
 }
});

test("original typed Coordinator/Child/Gateway prebind drives one real subprocess A2A model call and terminally fences it",async t=>{
 // A genuine ORIGINAL bootstrap class and owner prebind are exercised here;
 // Coordinator/Child/Gateway replies are deterministic offline fixtures,
 // NOT actual signed Ed25519/Rust artifacts or a successful Gitea/Docker E2E.
 const {TrustedAuthorityOnlyRemoteEffectBootstrap}=await import(
  "../../../packages/orchestrator-runtime/src/trusted-authority-only-remote-effect-bootstrap.ts");
 const {TrustedAuthorityOnlyExecutionCoordinator}=await import(
  "../../../packages/orchestrator-runtime/src/trusted-authority-only-execution-coordinator.ts");
 const {TrustedAuthorityOnlyChildIssuer}=await import(
  "../../../packages/orchestrator-runtime/src/trusted-authority-only-child-issuer.ts");
 const {TrustedAuthorityOnlyGatewayAdmissions}=await import(
  "../../gateway/src/trusted-authority-only-admissions.ts");
 const {canonicalFileUri}=await import(
  "../../gateway/src/canonical.ts");
 const {DeterministicA2AOrchestrator}=await import(
  "../../../packages/agent-runtime/src/orchestrator.ts");
 const {createDisposableOriginalNativeIpcTaskAdmission}=await import(
  "../src/disposable-gemini-original-ipc-task-admission.mjs");
 const f=await fixture(t);
 const role="backend",taskId="original-real-a2a-native-prebind-1";
 const runtimeTaskId="dispatch_"+"N".repeat(22);
 const branch="feature/account-suspension";
 const file="apps/backend/account.ts";
 const repository={authority:"gitea.local",owner:"thesis",
  repository:"iam-console-poc"};
 const permission={resource:canonicalFileUri(repository,branch,file),
  operation:"read_file"};
 const root={session_id:"original-session-offline-01",
  repository,branch,authority_digest:"a".repeat(64),
  root_credential_id:"synthetic-rust-root",base_revision:"b".repeat(40),
  requirement_sha256:"c".repeat(64),
  engineer_did:"did:thesis:engineer",
  expires_at:new Date(Date.now()+60_000).toISOString(),
  root_expires_at:new Date(Date.now()+60_000).toISOString(),
  root_permissions:[permission]};
 const row={status:"task_registered_preflight_only",
  session_id:root.session_id,task_id:taskId,epoch:1,agent_id:role,
  agent_did:"did:thesis:backend-agent",card_ref:"trusted:backend",
  depends_on:[],permissions:[permission],
  root_credential_id:root.root_credential_id,
  authority_digest:root.authority_digest,execution_authorized:false,
  child_credential_issued:false,gateway_registered:false};
 const child={status:"native_child_response_verified_staged",
  session_id:root.session_id,task_id:taskId,epoch:1,
  agent_id:role,agent_did:row.agent_did,
  root_credential_id:root.root_credential_id,
  credential_id:"urn:offline:original-child:backend",
  authority_digest:root.authority_digest,permissions:[permission],
  status_list_credential:"status",status_list_index:"0",
  expires_at:new Date(Date.now()+60_000).toISOString(),
  gateway_execution_authorized:false};
 const gatewayProof={status:"gateway_owner_child_task_preflight_only",
  task_id:taskId,runtime_task_id:runtimeTaskId,
  agent_id:role,agent_did:row.agent_did,
  credential_id:child.credential_id,
  authority_digest:root.authority_digest,
  gateway_execution_authorized:false};
 const coordinator=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
   assertTrustedGatewayAuthorityBinding:()=>root,
   assertTrustedGatewayRegisteredTask:()=>row
  });
 Object.defineProperty(coordinator,"phase",{value:"active"});
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
   assertTrustedIssuedChild:()=>child
  });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
   assertTrustedOwnerRemoteEffectBinding:()=>gatewayProof
  });
 Object.defineProperty(gateway,"phase",{value:"active"});
 const ledger=createDisposableOriginalNativeIpcTaskAdmission({
  role,assertOriginalRootActive:()=>root
 });
 let modelCalls=0;
 f.handlers.backend={
  authorizeSignedTask:ledger.authorizeSignedTask,
  invokeModel:async()=>{
   modelCalls++;
   return {chunks:[{content:{role:"model",
    parts:[{text:"synthetic native-bound readonly response"}]},
    usageMetadata:{promptTokenCount:5,candidatesTokenCount:3,
     totalTokenCount:8}}],
    metered_calls_started:modelCalls,
    metered_total_tokens:modelCalls*8,
    owner_original_signed_task_verified_here:false,
    provider_billed_amount_verified:false,
    model_generated_source_proven:false};
  }
 };
 const workers=await startDisposableOriginalOfflineSubprocessWorkers({
  directory:f.directory,sessionId:root.session_id,
  workers:f.workers,offlineModelHandlers:f.handlers,
  offlineSyntheticOnly:true
 });
 let native;
 t.after(async()=>{
  ledger.retireAll();
  await native?.close().catch(()=>{});
  await workers.close().catch(()=>{});
 });
 native=await TrustedAuthorityOnlyRemoteEffectBootstrap.start({
  coordinator,childIssuer:issuer,gateway,
  stageChannels:workers.sdk.stageChannels,
  agentBindingChannels:workers.sdk.agentBindingChannels
 });
 const client=new DeterministicA2AOrchestrator({
  deadlineMs:15_000,initialIntervalMs:30,maxIntervalMs:100
 });
 let staged=0,prebound=false;
 await assert.rejects(native.dispatchApprovedTask({
  taskId,runtimeTaskId,
  effectStager:{async stage(){staged++;}},
  onNativeOriginalTaskPrebound:receipt=>{
   ledger.bindOriginalReceipt(receipt,{maxCalls:1});
   prebound=true;
   return ()=>ledger.retireTask(runtimeTaskId);
  },
  dispatch:()=>client.sendProtectedTask({
   agent_base_url:workers.sdk.agentBaseUrls.backend,
   subtask:{
    subtask_id:taskId,branch,
    instruction:"Read the single approved path and report observations",
    relevant_paths:[file],
    approved_file_permissions:[{path:file,operation:"read_file"}],
    approved_run_tests:false
   },
   delegation_evidence:{
    credential:"synthetic-offline-DC-no-real-signature",
    credential_id:child.credential_id,
    presenter_id:child.agent_did
   },
   trusted_gateway_task_id:runtimeTaskId
  })
 }),/without completion/u);
 assert.equal(prebound,true);
 assert.equal(modelCalls,1);
 assert.equal(staged,0,
  "model response is not a Gateway-approved file effect");
 await assert.rejects(ledger.authorizeSignedTask({
  role,task:{task_id:taskId,runtime_task_id:runtimeTaskId,
   credential_id:child.credential_id,session_id:root.session_id},
  callId:"after-original-native-retirement-01"
 }),/Disposable original signed IPC Task admission NO-GO/u);
 await assert.rejects(native.dispatchApprovedTask({
  taskId,runtimeTaskId,effectStager:{async stage(){staged++;}},
  dispatch:async()=>{}
 }),/duplicate or invalid owner dispatch/u);
 assert.equal(modelCalls,1);
});
