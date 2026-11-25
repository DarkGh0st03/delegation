/**
 * Phase W (W3): the whole agent chain of a write-set Task on REAL components:
 * GatewayControlledToolClient.writeFiles -> agent Task registry -> real
 * authenticated Unix IPC (bind + stage channels) -> owner staging registry ->
 * native owner write-set stager -> real Gateway write-batch Prepare/Execute,
 * admissions, executor (ChangeFiles + HEAD-CAS) and per-file evidence, over
 * the in-memory Gitea. Not simulated: everything except the Rust VP verifier
 * (fixture), OPA (allow fixture), the wallet signer (fixture) and Gitea.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SAMPLE_TEST_SOURCES} from "../../plan-contracts/test/fixtures/test-sources.mjs";
import {setup,p,N1,N2,branch} from "./fixtures/write-set-harness.ts";
import {GatewayControlledToolClient} from "../../agent-runtime/src/gateway-tool-client.ts";
import {DelegationEvidenceHandler} from "../../agent-runtime/src/delegation-evidence-handler.ts";
import {TrustedEffectStagingTaskRegistry} from "../../agent-runtime/src/trusted-effect-staging-task-registry.ts";
import {TrustedOwnerEffectStagingRegistry,createTrustedOwnerEffectStagingServer,
 connectTrustedOwnerEffectStagingClient,createTrustedEffectAgentBindingServer,
 connectTrustedEffectAgentBindingClient} from "../../agent-runtime/src/trusted-effect-staging-unix-ipc.ts";
import {TrustedAuthorityOnlySequentialWriteSetStager}
 from "../../../apps/gateway/src/trusted-authority-only-sequential-write-set-stager.ts";
import type {AgentTaskContext} from "../../agent-runtime/src/contracts.ts";

const RT="dispatch_"+"W".repeat(22);
const role="backend" as const;
async function chain(opts:{permissions?:{resource:string;operation:string}[]}={}){
 const h=await setup({permissions:opts.permissions??[p("create_file",N1),p("create_file",N2)],runtimeTaskId:RT});
 const dir=await mkdtemp(join(tmpdir(),"w3-ipc-"));
 const bindSecret=join(dir,"bind.hex"),stageSecret=join(dir,"stage.hex");
 for(const f of [bindSecret,stageSecret])await writeFile(f,randomBytes(32).toString("hex")+"\n",{mode:0o600,flag:"wx"});
 const native=await TrustedAuthorityOnlySequentialWriteSetStager.begin({store:h.store,admissions:h.gate,
  batches:h.writeBatches,preflight:h.preflight,observer:h.wsObserver,planTaskId:"task-ws",
  runtimeTaskId:RT,expectedHeadSha:h.hash,nowMs:()=>h.clock.now});
 const ownerRegistry=new TrustedOwnerEffectStagingRegistry();
 ownerRegistry.bindTask(RT,native,role);
 const agentRegistry=new TrustedEffectStagingTaskRegistry({projectTestSourceProfile:SAMPLE_TEST_SOURCES});
 const stageSocket=join(dir,"stage.sock"),bindSocket=join(dir,"bind.sock");
 const ownerServer=await createTrustedOwnerEffectStagingServer({socketPath:stageSocket,secretFile:stageSecret,
  registry:ownerRegistry,expectedRole:role});
 await ownerServer.start();
 const ownerStage=await connectTrustedOwnerEffectStagingClient({socketPath:stageSocket,secretFile:stageSecret});
 const agentServer=await createTrustedEffectAgentBindingServer({socketPath:bindSocket,secretFile:bindSecret,
  registry:agentRegistry,ownerStageClient:ownerStage,expectedRole:role});
 await agentServer.start();
 const close=async()=>{await Promise.allSettled([agentServer.close(),ownerServer.close()]);
  await rm(dir,{recursive:true,force:true});await h.close();};
 const binder=await connectTrustedEffectAgentBindingClient({projectTestSourceProfile:SAMPLE_TEST_SOURCES,
  socketPath:bindSocket,secretFile:bindSecret});
 await binder.bindTask({runtimeTaskId:RT,planTaskId:"task-ws",role,childCredentialId:"urn:w:child",
  presenterId:"did:thesis:backend",branch,operation:"read_then_write_set"});
 const writes=(opts.permissions??[p("create_file",N1),p("create_file",N2)]).map(x=>({
  path:x.resource.slice(x.resource.indexOf("/files/")+7),operation:x.operation as "create_file"}));
 const reads=writes.filter(w=>w.operation==="update_file").map(w=>({path:w.path,operation:"read_file" as const}));
 const context:AgentTaskContext={task_id:"a2a-w3",context_id:"ctx-w3",role,trusted_gateway_task_id:RT,
  subtask:{subtask_id:"task-ws",branch,instruction:"Create the files",relevant_paths:writes.map(w=>w.path),
   approved_file_permissions:[...reads,...writes],approved_run_tests:false},
  delegation_evidence:{credential:"OFFLINE",credential_id:"urn:w:child",presenter_id:"did:thesis:backend"}};
 const effectStager=agentRegistry.selectFor(context);
 const signed:unknown[]=[];
 const evidenceHandler=new DelegationEvidenceHandler({adapterToken:"OFFLINE",
  evidence:{credential:"OFFLINE_CHILD",credential_id:"urn:w:child",presenter_id:"did:thesis:backend"},
  presentationSigner:async request=>{signed.push(request);return "OFFLINE_WRITE_VP";}});
 const routes:string[]=[];
 const client=new GatewayControlledToolClient({gatewayBaseUrl:"http://gateway.fixture.invalid",
  agentRole:role,taskId:RT,evidenceHandler,trustedEffectStager:effectStager,
  fetchFn:async(input,init)=>{
   const url=String(input),body=JSON.parse(String(init?.body));
   try{
    if(url.endsWith("/v1/authorization/prepare-write-batch")){
     routes.push("prepare_write_batch");
     if(body.agent_role!==role||body.task_id!==RT)return Response.json({error:"role"},{status:403});
     return Response.json(h.prepareBatch(body.arguments.changes),{status:201});
    }
    if(url.endsWith("/v1/authorization/execute")){
     routes.push("execute");
     return Response.json(await h.execute(body.request_id,body.signed_vp));
    }
   }catch(error){
    return Response.json({error:(error as {code?:string}).code??"error",message:(error as Error).message},
     {status:(error as {statusCode?:number}).statusCode??500});
   }
   throw Error("unexpected fixture URL "+url);
  }});
 return {h,client,effectStager,native,ownerRegistry,signed,routes,close};
}

test("W3 chain: write_files -> IPC -> owner write-set stager -> Gateway -> ONE commit -> ordered evidence -> final",async()=>{
 const c=await chain();
 try{
  assert.equal(c.client.supportsBatchWrites,true);
  const out=await c.client.writeFiles(branch,[{path:N2,operation:"create_file",content:"n2\n"},
   {path:N1,operation:"create_file",content:"n1\n"}]);
  assert.match(out.commit_sha,/^[a-f0-9]{40}$/u);
  assert.equal(c.h.fake.head("feature/sample-change"),out.commit_sha);
  // ONE presentation disclosing both Gateway-derived permissions.
  assert.equal(c.signed.length,1);
  assert.equal((c.signed[0] as {disclosed_permissions:unknown[]}).disclosed_permissions.length,2);
  assert.deepEqual(c.routes,["prepare_write_batch","execute","execute"]);
  assert.equal(c.native.finalized,true);
  assert.equal(c.h.gate.assertTrustedCompletedSequentialReadUpdateTask("task-ws",RT).status,
   "sequential_read_update_task_completed_staged");
  // The single-write tools of a write-set Task are refused locally.
  await assert.rejects(c.client.invoke("create_file",{branch,path:N1,content:"x"}),/write_files, in one batch/u);
 }finally{await c.close();}
});

test("W3 chain: non-conforming calls through the owner channels are refused",async()=>{
 const c=await chain();
 try{
  // Attestation before any staged batch, and a malformed/foreign batch id.
  await assert.rejects(c.effectStager.attestWriteSet!("wbatch_"+"0".repeat(8)+"-0000-0000-0000-"+"0".repeat(12)));
  await assert.rejects(c.effectStager.stageWriteSet!("not-a-batch"));
 }finally{await c.close();}
 const d=await chain();
 try{
  await d.client.writeFiles(branch,[{path:N1,operation:"create_file",content:"n1\n"},
   {path:N2,operation:"create_file",content:"n2\n"}]);
  // A second write-set or a repeated attestation after completion.
  await assert.rejects(d.client.writeFiles(branch,[{path:N1,operation:"create_file",content:"z\n"},
   {path:N2,operation:"create_file",content:"z\n"}]));
 }finally{await d.close();}
});

test("W3 chain: a write batch that is not the exact signed set is refused at owner staging, nothing published",async()=>{
 const c=await chain({permissions:[p("create_file",N1),p("create_file",N2),p("create_file","tests/backend/a.test.ts")]});
 try{
  await assert.rejects(c.client.writeFiles(branch,[{path:N1,operation:"create_file",content:"n1\n"},
   {path:N2,operation:"create_file",content:"n2\n"}]),/Trusted write-set staging failed/u);
  assert.equal(c.h.fake.head("feature/sample-change"),c.h.hash);
  assert.deepEqual(c.routes,["prepare_write_batch"]);
 }finally{await c.close();}
});
