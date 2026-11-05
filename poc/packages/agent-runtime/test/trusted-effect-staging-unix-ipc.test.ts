import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {TrustedEffectStagingTaskRegistry} from
 "../src/trusted-effect-staging-task-registry.ts";
import {
 TrustedOwnerEffectStagingRegistry,createTrustedOwnerEffectStagingServer,
 connectTrustedOwnerEffectStagingClient,createTrustedEffectAgentBindingServer,
 connectTrustedEffectAgentBindingClient
} from "../src/trusted-effect-staging-unix-ipc.ts";
import type {AgentTaskContext} from "../src/contracts.ts";

const runtime="dispatch_"+"R".repeat(22);
const path="apps/backend/src/users/account.ts";
const pins={
 runtimeTaskId:runtime,planTaskId:"r322-backend-task",
 role:"backend" as const,childCredentialId:"urn:r322:child:backend",
 presenterId:"did:thesis:backend-agent",branch:"feature/account-suspension",
 operation:"update_file" as const,path
};
const task=():AgentTaskContext=>({
 task_id:"a2a-r322",context_id:"r322",
 trusted_gateway_task_id:runtime,role:"backend",
 subtask:{subtask_id:pins.planTaskId,
  instruction:"Change one authorized file",branch:pins.branch,
  relevant_paths:[path],
  approved_file_permissions:[{path,operation:"update_file"}],
  approved_run_tests:false},
 delegation_evidence:{credential:"PRIVATE_CHILD_DC",
  credential_id:pins.childCredentialId,presenter_id:pins.presenterId}
});
async function fixtures(){
 const dir=await mkdtemp(join(tmpdir(),"r322-"));
 const bindSecret=join(dir,"bind.hex"),stageSecret=join(dir,"stage.hex"),
  foreignSecret=join(dir,"foreign.hex");
 for(const file of [bindSecret,stageSecret,foreignSecret])
  await writeFile(file,randomBytes(32).toString("hex")+"\n",
   {mode:0o600,flag:"wx"});
 const owner=new TrustedOwnerEffectStagingRegistry();
 const agent=new TrustedEffectStagingTaskRegistry(),calls:string[]=[];
 const stageSocket=join(dir,"stage.sock"),bindSocket=join(dir,"bind.sock");
 const ownerServer=await createTrustedOwnerEffectStagingServer({
  socketPath:stageSocket,secretFile:stageSecret,registry:owner
 });
 await ownerServer.start();
 const remote=await connectTrustedOwnerEffectStagingClient({
  socketPath:stageSocket,secretFile:stageSecret});
 const agentServer=await createTrustedEffectAgentBindingServer({
  socketPath:bindSocket,secretFile:bindSecret,
  registry:agent,ownerStageClient:remote
 });
 await agentServer.start();
 const client=await connectTrustedEffectAgentBindingClient({
  socketPath:bindSocket,secretFile:bindSecret});
 const close=async()=>{
  await Promise.allSettled([agentServer.close(),ownerServer.close()]);
  await rm(dir,{recursive:true,force:true});
 };
 return {dir,owner,agent,calls,client,remote,close,
  bindSocket,stageSocket,bindSecret,stageSecret,foreignSecret};
}

test("R322 authenticated owner binds remote A2A Task; one prepared Gateway request stages at actual owner",async()=>{
 const x=await fixtures();
 try{
  x.owner.bindTask(runtime,{stage:async id=>{
   assert.equal(id,"r322-prepare-001");x.calls.push(id);
  }});
  await x.client.bindTask(pins);
  const privatePort=x.agent.selectFor(task());
  assert.deepEqual(await privatePort.stage("r322-prepare-001"),
   {provider_write_authorized:false});
  assert.deepEqual(x.calls,["r322-prepare-001"]);
  await assert.rejects(privatePort.stage("r322-prepare-001"),/consumed or retired/u);
  await assert.rejects(x.remote.stage(runtime,"r322-prepare-001"),
   /Authenticated private effect operation denied/u);
  await assert.rejects(x.client.bindTask(pins),
   /Authenticated private effect operation denied/u);
 }finally{await x.close();}
});
test("R322 distinct HMAC secrets and missing owner prebinding cannot stage",async()=>{
 const x=await fixtures();
 try{
  const wrongBinding=await connectTrustedEffectAgentBindingClient({
   socketPath:x.bindSocket,secretFile:x.foreignSecret});
  await assert.rejects(wrongBinding.bindTask(pins),/operation denied/u);
  const wrongStage=await connectTrustedOwnerEffectStagingClient({
   socketPath:x.stageSocket,secretFile:x.bindSecret});
  await assert.rejects(wrongStage.stage(runtime,"r322-prepare-001"),
   /operation denied/u);
  await x.client.bindTask(pins);
  const port=x.agent.selectFor(task());
  await assert.rejects(port.stage("r322-prepare-001"),/operation denied/u);
  assert.deepEqual(x.calls,[]);
 }finally{await x.close();}
});
test("R322 authenticated fence retires foreign or unfinished Task before any effect",async()=>{
 const x=await fixtures();
 try{
  x.owner.bindTask(runtime,{stage:async id=>x.calls.push(id)});
  await x.client.bindTask(pins);
  const port=x.agent.selectFor(task());
  await x.client.fence(runtime);
  await assert.rejects(port.stage("r322-prepare-001"),/consumed or retired/u);
  assert.deepEqual(x.calls,[]);
  x.owner.retireFor(runtime);
  await assert.rejects(x.remote.stage(runtime,"r322-prepare-001"),/operation denied/u);
 }finally{await x.close();}
});
test("R322 forged A2A Child cannot claim an authenticated remotely prebound port",async()=>{
 const x=await fixtures();
 try{
  x.owner.bindTask(runtime,{stage:async id=>x.calls.push(id)});
  await x.client.bindTask(pins);
  const forged={...task(),delegation_evidence:{
    ...task().delegation_evidence,credential_id:"urn:r322:forged"}};
  assert.throws(()=>x.agent.selectFor(forged),/differs from trusted owner/u);
  assert.throws(()=>x.agent.selectFor(task()),/already dispatched/u);
  assert.deepEqual(x.calls,[]);
 }finally{await x.close();}
});

// R329.1: production Gateway emits req_<UUIDv4>; the original
// validation pattern already permits this form. Keep an integrated
// regression so a fixture-only ID cannot hide a future mismatch.
test("R329.1 production req_UUID propagates through real owner Unix staging",async()=>{
 const x=await fixtures();
 try{
  const requestId="req_12345678-1234-4123-8123-1234567890ab";
  x.owner.bindTask(runtime,{stage:async id=>{
   assert.equal(id,requestId);x.calls.push(id);
  }});
  await x.client.bindTask(pins);
  const local=x.agent.selectFor(task());
  await local.stage(requestId);
  assert.deepEqual(x.calls,[requestId]);
  await assert.rejects(x.remote.stage(runtime,requestId),
   /Authenticated private effect operation denied/u);
 }finally{await x.close();}
});
