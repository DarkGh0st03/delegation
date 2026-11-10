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
