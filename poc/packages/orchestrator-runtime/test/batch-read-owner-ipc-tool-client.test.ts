import {SAMPLE_TEST_SOURCES} from "../../plan-contracts/test/fixtures/test-sources.mjs";
/**
 * Phase R batch reads. Cost-free protocol integration: native owner state machine, real
 * authenticated Unix bind/stage channels and the controlled Gateway client.
 * The Gateway, Rust/OPA/signing and Gitea results are simulated fixtures.
 * This test is NEVER native provider E2E or independent security approval.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {GatewayControlledToolClient}
 from "../../agent-runtime/src/gateway-tool-client.ts";
import {DelegationEvidenceHandler}
 from "../../agent-runtime/src/delegation-evidence-handler.ts";
import {TrustedEffectStagingTaskRegistry}
 from "../../agent-runtime/src/trusted-effect-staging-task-registry.ts";
import {TrustedOwnerEffectStagingRegistry,
 createTrustedOwnerEffectStagingServer,connectTrustedOwnerEffectStagingClient,
 createTrustedEffectAgentBindingServer,connectTrustedEffectAgentBindingClient}
 from "../../agent-runtime/src/trusted-effect-staging-unix-ipc.ts";
import type {AgentTaskContext} from "../../agent-runtime/src/contracts.ts";
import {InMemoryRequestStore} from "../../../apps/gateway/src/prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions as TrustedAuthorityOnlyGatewayAdmissionsBase}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight}
 from "../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts";
import {AuthenticatedGiteaMutationCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {TrustedAuthorityOnlySequentialReadUpdateStager}
 from "../../../apps/gateway/src/trusted-authority-only-sequential-read-update-stager.ts";
/** Test default: the sample repository test-source profile. */
class TrustedAuthorityOnlyGatewayAdmissions extends TrustedAuthorityOnlyGatewayAdmissionsBase{constructor(c){super({projectTestSourceProfile:SAMPLE_TEST_SOURCES,...c});}
 get projectTestSourceProfile(){return super.projectTestSourceProfile??SAMPLE_TEST_SOURCES;}}

const runtime="dispatch_"+"B".repeat(22),task="r-batch-backend";
const branch="feature/sample-change",path="apps/backend/src/users/account.ts";
const context2="apps/backend/src/users/types.ts";
const sha="a".repeat(40),role="backend" as const;
const childId="urn:r3598:child",presenter="did:thesis:backend-agent";

async function fixture(opts:{badPath?:boolean}={}){
 const dir=await mkdtemp(join(tmpdir(),"r-batch-ipc-"));
 const bindSecret=join(dir,"bind.hex"),stageSecret=join(dir,"stage.hex");
 for(const secretFile of [bindSecret,stageSecret])
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600,flag:"wx"});
 const store=new InMemoryRequestStore(),events:string[]=[];
 let reads=0;const signed:unknown[]=[];const vps:string[]=[];
 const gateway=Object.assign(Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype),{
  async beginTrustedSequentialReadUpdateTask(){events.push("manifest");
   return {status:"sequential_read_update_manifest_reserved_staged",
    task_id:task,total_effects:3,write_operation:"update_file",gateway_execution_authorized:false};},
  async stageTrustedSequentialReadEffect(){events.push("reserve_read");
   return {status:"sequential_read_effect_reserved_staged",task_id:task,
    sequence:reads+1,gateway_execution_authorized:false};},
  async attestTrustedSequentialReadEffect(){events.push("verify_read");reads++;
   return {status:"sequential_read_effect_attested_staged",task_id:task,
    sequence:reads,gateway_execution_authorized:false};},
  async stageTrustedSequentialMutationEffect(){events.push("reserve_update");
   assert.equal(reads,2);
   return {status:"sequential_mutation_effect_reserved_staged",task_id:task,
    sequence:3,gateway_execution_authorized:false};},
  async attestTrustedSequentialMutationEffect(){events.push("verify_update");
   return {status:"sequential_mutation_effect_attested_staged",task_id:task,
    sequence:3,gateway_execution_authorized:false};},
  async finalizeTrustedSequentialReadTask(){events.push("finalize");
   return {status:"sequential_read_task_complete_staged",task_id:task,
    total_effects:3,gateway_execution_authorized:false};}
 }) as TrustedAuthorityOnlyGatewayAdmissions;
 const mutation=Object.assign(Object.create(TrustedAuthorityOnlyGiteaMutationPreflight.prototype),{
   isForAdmissions:(g:unknown)=>g===gateway,
   async stageUpdate(){events.push("cas_preflight");
    return {status:"gitea_update_intent_reserved_without_execution",provider_write_authorized:false};}
 }) as TrustedAuthorityOnlyGiteaMutationPreflight;
 const observer=Object.assign(Object.create(AuthenticatedGiteaMutationCompletionObserver.prototype),{
   toTrustedObserver:()=>({offline_fixture:true})
 }) as AuthenticatedGiteaMutationCompletionObserver;
 const native=await TrustedAuthorityOnlySequentialReadUpdateStager.begin({
  store,admissions:gateway,mutation,mutationObserver:observer,
  planTaskId:task,runtimeTaskId:runtime,expectedHeadSha:sha
 });
 const ownerRegistry=new TrustedOwnerEffectStagingRegistry();
 ownerRegistry.bindTask(runtime,native,role);
 const agentRegistry=new TrustedEffectStagingTaskRegistry({projectTestSourceProfile:SAMPLE_TEST_SOURCES});
 const stageSocket=join(dir,"stage.sock"),bindSocket=join(dir,"bind.sock");
 const ownerServer=await createTrustedOwnerEffectStagingServer({
  socketPath:stageSocket,secretFile:stageSecret,registry:ownerRegistry,expectedRole:role});
 let agentServer:Awaited<ReturnType<typeof createTrustedEffectAgentBindingServer>>|undefined;
 const close=async()=>{
  await Promise.allSettled([agentServer?.close(),ownerServer.close()]);
  await rm(dir,{recursive:true,force:true});
 };
 try{
  await ownerServer.start();
  const ownerStage=await connectTrustedOwnerEffectStagingClient({socketPath:stageSocket,secretFile:stageSecret});
  agentServer=await createTrustedEffectAgentBindingServer({
   socketPath:bindSocket,secretFile:bindSecret,registry:agentRegistry,
   ownerStageClient:ownerStage,expectedRole:role});
  await agentServer.start();
  const binder=await connectTrustedEffectAgentBindingClient({projectTestSourceProfile:SAMPLE_TEST_SOURCES,
   socketPath:bindSocket,secretFile:bindSecret});
  await binder.bindTask({runtimeTaskId:runtime,planTaskId:task,
   role,childCredentialId:childId,presenterId:presenter,branch,
   operation:"read_then_update",path});
  const context:AgentTaskContext={
   task_id:"a2a-r-batch",context_id:"ctx-r-batch",role,trusted_gateway_task_id:runtime,
   subtask:{subtask_id:task,branch,instruction:"Read context and update exact source",
    relevant_paths:[context2,path],approved_file_permissions:[
     {path:context2,operation:"read_file"},{path,operation:"read_file"},{path,operation:"update_file"}],
    approved_run_tests:false},
   delegation_evidence:{credential:"OFFLINE_NO_SECRET",credential_id:childId,presenter_id:presenter}
  };
  const effectStager=agentRegistry.selectFor(context);
  const evidenceHandler=new DelegationEvidenceHandler({
   adapterToken:"OFFLINE",
   evidence:{credential:"OFFLINE_CHILD",credential_id:childId,presenter_id:presenter},
   presentationSigner:async request=>{
    events.push("sign_"+request.challenge);signed.push(request);
    return "OFFLINE_VP_"+request.challenge;
   }
  });
  const gatewayClient=new GatewayControlledToolClient({
   gatewayBaseUrl:"http://gateway.fixture.invalid",
   agentRole:role,taskId:runtime,evidenceHandler,trustedEffectStager:effectStager,
   fetchFn:async(input,init)=>{
    const url=String(input),body=JSON.parse(String(init?.body));
    if(url.endsWith("/v1/authorization/prepare-read-batch")){
     events.push("prepare_batch");
     assert.equal(body.tool,"read_files");
     const items=(body.arguments.paths as string[]).map((p,i)=>{
      const requestId="r-batch-read-"+i;
      store.put({request_id:requestId,task_id:runtime,agent_role:role,
       request:{tool:"read_file",arguments:{branch,path:p}},
       pinned_revision:sha,consumed:false,expires_at_ms:Date.now()+60_000} as never);
      return {request_id:requestId,path:p,
       required_permission:{operation:"read_file",resource:"gitea://fixture/"+p}};
     });
     return Response.json({batch_id:"batch_fixture",audience:"cloud-access-gateway",
      challenge:"batch",expires_at:new Date(Date.now()+60_000).toISOString(),items},{status:201});
    }
    if(url.endsWith("/v1/authorization/prepare")){
     events.push("prepare_update");
     store.put({request_id:"r-batch-update",task_id:runtime,agent_role:role,
      request:{tool:body.tool,arguments:body.arguments},
      pinned_revision:sha,consumed:false,expires_at_ms:Date.now()+60_000} as never);
     return Response.json({request_id:"r-batch-update",audience:"gateway",challenge:"update",
      required_permission:{operation:"update_file",resource:"signed-fixture"},
      expires_at:new Date(Date.now()+60_000).toISOString()},{status:201});
    }
    if(url.endsWith("/v1/authorization/execute")){
     vps.push(body.signed_vp);
     const record=store.get(body.request_id) as {request:{tool:string;arguments:{path:string}}};
     const read=record.request.tool==="read_file";
     const p=record.request.arguments.path;
     events.push("execute_"+(read?"read:"+p:"update"));
     return Response.json({request_id:body.request_id,decision:"allow",
      execution:{provider:"gitea",performed:true,tool:record.request.tool,branch,
       path:opts.badPath&&read?"apps/other.ts":p,
       ...(read?{revision:sha,blob_sha:"c".repeat(40),content:"source of "+p}:
        {revision:"b".repeat(40),commit_sha:"b".repeat(40)})}});
    }
    throw Error("unexpected fixture URL");
   }
  });
  return {gatewayClient,events,signed,vps,close};
 }catch(error){await close();throw error;}
}

test("batch read: one Prepare, ONE presentation for all reads, per-file owner staging and attestation",async()=>{
 const f=await fixture();
 try{
  assert.equal(f.gatewayClient.supportsBatchReads,true);
  const out=await f.gatewayClient.readFiles(branch,[context2,path]);
  assert.deepEqual(out.files.map(x=>(x as {path:string}).path),[context2,path]);
  assert.equal(f.signed.length,1);
  assert.deepEqual((f.signed[0] as {disclosed_permissions:unknown[]}).disclosed_permissions,[
   {operation:"read_file",resource:"gitea://fixture/"+context2},
   {operation:"read_file",resource:"gitea://fixture/"+path}]);
  await f.gatewayClient.invoke("update_file",{branch,path,content:"new source"});
  assert.deepEqual(f.events,[
   "manifest","prepare_batch","sign_batch",
   "reserve_read","execute_read:"+context2,"verify_read",
   "reserve_read","execute_read:"+path,"verify_read",
   "prepare_update","cas_preflight","reserve_update","sign_update","execute_update",
   "verify_update","finalize"]);
  // The SAME batch VP for both reads, a separate VP for the write.
  assert.deepEqual(f.vps,["OFFLINE_VP_batch","OFFLINE_VP_batch","OFFLINE_VP_update"]);
 }finally{await f.close();}
});

test("batch read: a receipt for another path stops before attestation and the write",async()=>{
 const f=await fixture({badPath:true});
 try{
  await assert.rejects(f.gatewayClient.readFiles(branch,[context2,path]),/exact Gitea execution receipt/u);
  assert.equal(f.events.includes("verify_read"),false);
  await assert.rejects(f.gatewayClient.invoke("update_file",{branch,path,content:"x"}),
   /Trusted effect staging failed/u);
  assert.equal(f.events.includes("execute_update"),false);
 }finally{await f.close();}
});

test("batch read: a repeated signed read after the batch is refused by the owner",async()=>{
 const f=await fixture();
 try{
  await f.gatewayClient.readFiles(branch,[context2,path]);
  await assert.rejects(f.gatewayClient.invoke("read_file",{branch,path}),/Trusted effect staging failed/u);
 }finally{await f.close();}
});
