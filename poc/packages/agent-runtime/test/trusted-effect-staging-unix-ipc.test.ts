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
async function fixtures(expectedRole?:"backend"|"test"){
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
  socketPath:stageSocket,secretFile:stageSecret,registry:owner,expectedRole
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

test("R332 role-keyed stage socket rejects cross-role authenticated HMAC without burning Backend reservation",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"r332-"));
 const registry=new TrustedOwnerEffectStagingRegistry();
 const backendSecret=join(dir,"be-stage.hex");
 const frontendSecret=join(dir,"fe-stage.hex");
 const backendSocket=join(dir,"be-stage.sock");
 const frontendSocket=join(dir,"fe-stage.sock");
 for(const file of [backendSecret,frontendSecret])
  await writeFile(file,randomBytes(32).toString("hex")+"\n",
   {mode:0o600,flag:"wx"});
 const backend=await createTrustedOwnerEffectStagingServer({
  socketPath:backendSocket,secretFile:backendSecret,
  expectedRole:"backend",registry
 });
 const frontend=await createTrustedOwnerEffectStagingServer({
  socketPath:frontendSocket,secretFile:frontendSecret,
  expectedRole:"frontend",registry
 });
 const effects:string[]=[];
 try{
  await backend.start();await frontend.start();
  const be=await connectTrustedOwnerEffectStagingClient({
   socketPath:backendSocket,secretFile:backendSecret
  });
  const fe=await connectTrustedOwnerEffectStagingClient({
   socketPath:frontendSocket,secretFile:frontendSecret
  });
  const requestId="req_12345678-1234-4123-8123-1234567890ab";
  registry.bindTask(runtime,{
   async stage(id:string){effects.push(id);}
  },"backend");
  // Correctly signed but WRONG role-key: the owner must not stage.
  await assert.rejects(fe.stage(runtime,requestId),
   /Authenticated private effect operation denied/u);
  assert.deepEqual(effects,[]);
  // Borrowing the correct socket with a different HMAC key also denies.
  const wrongKey=await connectTrustedOwnerEffectStagingClient({
   socketPath:backendSocket,secretFile:frontendSecret
  });
  await assert.rejects(wrongKey.stage(runtime,requestId),
   /Authenticated private effect operation denied/u);
  assert.deepEqual(effects,[]);
  // Genuine signed Backend request remains possible exactly once.
  await be.stage(runtime,requestId);
  assert.deepEqual(effects,[requestId]);
  await assert.rejects(be.stage(runtime,requestId),
   /Authenticated private effect operation denied/u);
  await assert.rejects(fe.stage(runtime,requestId),
   /Authenticated private effect operation denied/u);
  assert.deepEqual(effects,[requestId]);
 }finally{
  await Promise.allSettled([frontend.close(),backend.close()]);
  await rm(dir,{recursive:true,force:true});
 }
});
test("R332 strict role stage refuses untagged legacy Task without granting effects",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"r332-no-role-"));
 const secretFile=join(dir,"be.hex"),socketPath=join(dir,"be.sock");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 const registry=new TrustedOwnerEffectStagingRegistry();
 const server=await createTrustedOwnerEffectStagingServer({
  socketPath,secretFile,registry,expectedRole:"backend"
 });
 const effects:string[]=[];
 try{
  await server.start();
  const client=await connectTrustedOwnerEffectStagingClient({
   socketPath,secretFile
  });
  registry.bindTask(runtime,{async stage(id:string){effects.push(id);}});
  await assert.rejects(client.stage(runtime,"r332-safe-req"),
   /Authenticated private effect operation denied/u);
  assert.deepEqual(effects,[]);
 }finally{
  await server.close();await rm(dir,{recursive:true,force:true});
 }
});

test("R359.5 two authenticated Unix IPC stages require separate independent evidence acks",async()=>{
 const x=await fixtures();
 const calls:string[]=[];
 try{
  const mixed={...pins,operation:"read_then_update" as const};
  x.owner.bindTask(runtime,{stagedTool:"read_then_update",
   async stage(requestId){calls.push("stage:"+requestId);},
   async attest(requestId,tool){calls.push("attest:"+tool+":"+requestId);}
  });
  await x.client.bindTask(mixed);
  const ctx:AgentTaskContext={...task(),subtask:{...task().subtask,
   approved_file_permissions:[{path,operation:"read_file"},
    {path,operation:"update_file"}]}};
  const port=x.agent.selectFor(ctx);
  await port.stage("r359-read");
  await assert.rejects(port.stage("r359-premature"),/out of sequence/u);
  await assert.rejects(port.attest!("r359-read","update_file"),/cannot attest/u);
  await port.attest!("r359-read","read_file");
  await port.stage("r359-update");
  await port.attest!("r359-update","update_file");
  await assert.rejects(port.stage("r359-third"),/out of sequence/u);
  assert.deepEqual(calls,["stage:r359-read","attest:read_file:r359-read",
   "stage:r359-update","attest:update_file:r359-update"]);
  await assert.rejects(x.remote.attest(runtime,"r359-update","update_file"),
   /Authenticated private effect operation denied/u);
 }finally{await x.close();}
});

test("R377.8 role-authenticated no-change uses the original read and closes staging",async()=>{
 const x=await fixtures("backend");
 try{
  const calls:string[]=[];
  x.owner.bindTask(runtime,{stagedTool:"read_then_update",
   async stage(id){calls.push("stage:"+id);},
   async attest(id){calls.push("attest:"+id);},
   async reportNoChange(id){calls.push("no_change:"+id);}
  },"backend");
  await x.client.bindTask({...pins,operation:"read_then_update"});
  const ctx=task();
  ctx.subtask.approved_file_permissions=[
   {path,operation:"read_file"},{path,operation:"update_file"}];
  const port=x.agent.selectFor(ctx);
  await assert.rejects(port.reportNoChange!(),/original attested read/u);
  await port.stage("read-r3778");
  await port.attest!("read-r3778","read_file");
  await assert.rejects(x.owner.reportNoChange(runtime,"read-r3778","frontend"),/role-authenticated/u);
  await assert.rejects(x.remote.reportNoChange(runtime,"foreign-read"),/operation denied/u);
  await port.reportNoChange!();
  await assert.rejects(x.remote.stage(runtime,"late-update"),/operation denied/u);
  await assert.rejects(x.remote.reportNoChange(runtime,"read-r3778"),/operation denied/u);
  assert.deepEqual(calls,["stage:read-r3778","attest:read-r3778","no_change:read-r3778"]);
 }finally{await x.close();}
});

test("R383.8 private CREATE Task pins travel through HMAC Unix bind and one-use owner stage",async()=>{
 const x=await fixtures("backend");
 try{
  const createPins={...pins,operation:"create_file" as const};
  const calls:string[]=[];
  x.owner.bindTask(runtime,{
   stagedTool:"create_file",
   async stage(id:string){
    calls.push(id);return {provider_write_authorized:false};
   }
  },"backend");
  await x.client.bindTask(createPins);
  const createTask:AgentTaskContext={...task(),
   subtask:{...task().subtask,
    approved_file_permissions:[{path,operation:"create_file"}]}
  };
  const privatePort=x.agent.selectFor(createTask);
  assert.equal(privatePort.stagedTool,"create_file");
  assert.deepEqual(await privatePort.stage("r3838-create-1"),
   {provider_write_authorized:false});
  assert.deepEqual(calls,["r3838-create-1"]);
  await assert.rejects(privatePort.stage("r3838-create-2"),/consumed or retired/u);
  await assert.rejects(x.remote.stage(runtime,"r3838-create-3"),
   /Authenticated private effect operation denied/u);
  assert.deepEqual(calls,["r3838-create-1"]);
 }finally{await x.close();}
});
test("R390 authenticated Test CREATE rejects application source before IPC",async()=>{
 const x=await fixtures();
 try{
  // The authenticated private client rejects invalid role/task pins
  // locally, before any IPC network message can be sent.
  await assert.rejects(x.client.bindTask({
   ...pins,role:"test",operation:"create_file"
  }),/malformed owner Task pins/u);
 }finally{await x.close();}
});

test("R390 Test CREATE exact source binds through private HMAC and stages once",async()=>{
 const x=await fixtures("test");
 const testPath="tests/backend/authorized-new.test.ts";
 const testPins={...pins,role:"test" as const,path:testPath,
  operation:"create_file" as const,
  presenterId:"did:thesis:test-agent",
  childCredentialId:"urn:r390:test-child"};
 try{
  const calls:string[]=[];
  x.owner.bindTask(runtime,{
   stagedTool:"create_file" as const,
   async stage(id:string){calls.push(id);return {provider_write_authorized:false};}
  },"test");
  await x.client.bindTask(testPins);
  const base=task();
  const delegated:AgentTaskContext={...base,role:"test",
   subtask:{...base.subtask,relevant_paths:[testPath],
    approved_file_permissions:[{path:testPath,operation:"create_file"}],
    approved_run_tests:false},
   delegation_evidence:{...base.delegation_evidence,
    credential_id:testPins.childCredentialId,presenter_id:testPins.presenterId}
  };
  const port=x.agent.selectFor(delegated);
  assert.equal(port.stagedTool,"create_file");
  assert.deepEqual(await port.stage("r390-test-create-1"),
   {provider_write_authorized:false});
  assert.deepEqual(calls,["r390-test-create-1"]);
  await assert.rejects(port.stage("r390-test-create-2"),/consumed or retired/u);
  for(const path of ["apps/backend/application.test.ts",
   "tests/acceptance/runner.test.ts",
   "tests/backend/runner-config.ts","tests/backend/../admin.test.ts"]){
   await assert.rejects(x.client.bindTask({...testPins,path}),
    /malformed owner Task pins/u);
  }
  assert.deepEqual(calls,["r390-test-create-1"]);
 }finally{await x.close();}
});

/** R437: an extra role is not an untrusted fallback route. The trusted
 * Owner must provision distinct key+socket and locally pinned binding role.
 * The original Child/Task and Gateway effect rights are still independent. */
test("R437 provisioned invoice role can bind and stage only on its own private HMAC channels",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"r437-invoice-ipc-"));
 const ownerRegistry=new TrustedOwnerEffectStagingRegistry();
 const agentRegistry=new TrustedEffectStagingTaskRegistry(),effects:string[]=[];
 const stageHex=join(dir,"invoice-stage.hex"),
  stageSock=join(dir,"invoice-stage.sock"),
  beHex=join(dir,"backend-stage.hex"),
  beSock=join(dir,"backend-stage.sock"),
  bindHex=join(dir,"invoice-bind.hex"),bindSock=join(dir,"invoice-bind.sock");
 for(const key of [stageHex,beHex,bindHex])
  await writeFile(key,randomBytes(32).toString("hex")+"\n",{mode:0o600,flag:"wx"});
 const invoiceServer=await createTrustedOwnerEffectStagingServer({
  registry:ownerRegistry,expectedRole:"invoice",
  socketPath:stageSock,secretFile:stageHex
 });
 const backendServer=await createTrustedOwnerEffectStagingServer({
  registry:ownerRegistry,expectedRole:"backend",
  socketPath:beSock,secretFile:beHex
 });
 let binder;
 try{
  await invoiceServer.start();await backendServer.start();
  const stage=await connectTrustedOwnerEffectStagingClient({
   socketPath:stageSock,secretFile:stageHex
  });
  const backend=await connectTrustedOwnerEffectStagingClient({
   socketPath:beSock,secretFile:beHex
  });
  binder=await createTrustedEffectAgentBindingServer({
   registry:agentRegistry,expectedRole:"invoice",
   socketPath:bindSock,secretFile:bindHex,ownerStageClient:stage
  });
  await binder.start();
  const client=await connectTrustedEffectAgentBindingClient({
   socketPath:bindSock,secretFile:bindHex,expectedRole:"invoice"
  });
  const file="apps/invoice.ts",request="r437-invoice-read";
  const invoice={...pins,role:"invoice",planTaskId:"r437-invoice-task",
   childCredentialId:"urn:r437:child:invoice",
   presenterId:"did:thesis:invoice-agent",
   operation:"read_file" as const,path:file};
  ownerRegistry.bindTask(runtime,{async stage(id:string){effects.push(id);}},"invoice");
  await assert.rejects(client.bindTask({...invoice,role:"backend"}),
   /wrong-role owner Task pins/u);
  await client.bindTask(invoice);
  await assert.rejects(backend.stage(runtime,request),
   /Authenticated private effect operation denied/u);
  assert.deepEqual(effects,[]);
  const ctx={...task(),role:"invoice",
   subtask:{...task().subtask,subtask_id:invoice.planTaskId,
    relevant_paths:[file],
    approved_file_permissions:[{operation:"read_file" as const,path:file}]},
   delegation_evidence:{...task().delegation_evidence,
    credential_id:invoice.childCredentialId,presenter_id:invoice.presenterId}
  } as unknown as AgentTaskContext;
  const effect=agentRegistry.selectFor(ctx);
  assert.deepEqual(await effect.stage(request),{provider_write_authorized:false});
  assert.deepEqual(effects,[request]);
  await assert.rejects(backend.stage(runtime,request),
   /Authenticated private effect operation denied/u);
  await client.fence(runtime);
  assert.throws(()=>agentRegistry.selectFor(ctx),/already dispatched/u);
 }finally{
  await Promise.allSettled([
   binder?.close(),backendServer.close(),invoiceServer.close()
  ]);
  await rm(dir,{recursive:true,force:true});
 }
});
test("R437 extra roles are rejected by an unpinned legacy agent socket",async()=>{
 const x=await fixtures();
 try{
  const invoice={...pins,role:"invoice",planTaskId:"r437-extra",
   childCredentialId:"urn:r437:invoice",presenterId:"did:thesis:invoice"};
  await assert.rejects(x.client.bindTask(invoice),
   /malformed owner Task pins/u);
  // The old fixed-role host remains usable; a rejected invoice must
  // never mint a prebound Gateway effect or consume a valid signed Task.
  x.owner.bindTask(runtime,{async stage(id){x.calls.push(id);}});
  await x.client.bindTask(pins);
  const effect=x.agent.selectFor(task());
  await effect.stage("r437-canonical");
  assert.deepEqual(x.calls,["r437-canonical"]);
 }finally{await x.close();}
});

test("R437 unpinned legacy stage channel cannot execute an extra specialist effect",async()=>{
 const x=await fixtures();
 try{
  x.owner.bindTask(runtime,{async stage(id){x.calls.push(id);}},"invoice");
  await assert.rejects(x.remote.stage(runtime,"r437-unpinned-stage"),
   /Authenticated private effect operation denied/u);
  assert.deepEqual(x.calls,[]);
 }finally{await x.close();}
});
