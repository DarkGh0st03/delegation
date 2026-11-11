/**
 * R359.8 cost-free protocol integration: native owner state machine, real
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
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight}
 from "../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts";
import {AuthenticatedGiteaMutationCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {TrustedAuthorityOnlySequentialReadUpdateStager}
 from "../../../apps/gateway/src/trusted-authority-only-sequential-read-update-stager.ts";

const runtime="dispatch_"+"M".repeat(22),task="r3598-backend";
const branch="feature/account-suspension",path="apps/backend/src/users/account.ts";
const sha="a".repeat(40),role="backend" as const;
const childId="urn:r3598:child",presenter="did:thesis:backend-agent";

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),"r359-mixed-ipc-"));
 const bindSecret=join(dir,"bind.hex"),stageSecret=join(dir,"stage.hex");
 for(const secretFile of [bindSecret,stageSecret])
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
   {mode:0o600,flag:"wx"});
 const store=new InMemoryRequestStore(),events:string[]=[];
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
  async beginTrustedSequentialReadUpdateTask(){events.push("manifest");
   return {status:"sequential_read_update_manifest_reserved_staged",
    task_id:task,total_effects:2,gateway_execution_authorized:false};},
  async stageTrustedSequentialReadEffect(){events.push("reserve_read");
   return {status:"sequential_read_effect_reserved_staged",task_id:task,
    sequence:1,gateway_execution_authorized:false};},
  async attestTrustedSequentialReadEffect(){events.push("verify_read");
   assert.ok(events.includes("execute_read"));
   return {status:"sequential_read_effect_attested_staged",task_id:task,
    sequence:1,gateway_execution_authorized:false};},
  async stageTrustedSequentialMutationEffect(){events.push("reserve_update");
   assert.ok(events.includes("verify_read"));
   return {status:"sequential_mutation_effect_reserved_staged",task_id:task,
    sequence:2,gateway_execution_authorized:false};},
  async attestTrustedSequentialMutationEffect(){events.push("verify_update");
   assert.ok(events.includes("execute_update"));
   return {status:"sequential_mutation_effect_attested_staged",task_id:task,
    sequence:2,gateway_execution_authorized:false};},
  async finalizeTrustedSequentialReadTask(){events.push("finalize");
   return {status:"sequential_read_task_complete_staged",task_id:task,
    total_effects:2,gateway_execution_authorized:false};}
 }) as TrustedAuthorityOnlyGatewayAdmissions;
 const mutation=Object.assign(Object.create(
  TrustedAuthorityOnlyGiteaMutationPreflight.prototype),{
   isForAdmissions:(g:unknown)=>g===gateway,
   async stageUpdate(_record:unknown,head:string){
    assert.equal(head,sha);events.push("cas_preflight");
    return {status:"gitea_update_intent_reserved_without_execution",
     provider_write_authorized:false};
   }
 }) as TrustedAuthorityOnlyGiteaMutationPreflight;
 const observer=Object.assign(Object.create(
  AuthenticatedGiteaMutationCompletionObserver.prototype),{
   toTrustedObserver:()=>({offline_fixture:true})
 }) as AuthenticatedGiteaMutationCompletionObserver;
 const native=await TrustedAuthorityOnlySequentialReadUpdateStager.begin({
  store,admissions:gateway,mutation,mutationObserver:observer,
  planTaskId:task,runtimeTaskId:runtime,expectedHeadSha:sha
 });
 const ownerRegistry=new TrustedOwnerEffectStagingRegistry();
 ownerRegistry.bindTask(runtime,native,role);
 const agentRegistry=new TrustedEffectStagingTaskRegistry();
 const stageSocket=join(dir,"stage.sock"),bindSocket=join(dir,"bind.sock");
 const ownerServer=await createTrustedOwnerEffectStagingServer({
  socketPath:stageSocket,secretFile:stageSecret,
  registry:ownerRegistry,expectedRole:role
 });
 let agentServer:Awaited<ReturnType<typeof createTrustedEffectAgentBindingServer>>|undefined;
 try{
  await ownerServer.start();
  const ownerStage=await connectTrustedOwnerEffectStagingClient({
   socketPath:stageSocket,secretFile:stageSecret
  });
  agentServer=await createTrustedEffectAgentBindingServer({
   socketPath:bindSocket,secretFile:bindSecret,registry:agentRegistry,
   ownerStageClient:ownerStage,expectedRole:role
  });
  await agentServer.start();
  const binder=await connectTrustedEffectAgentBindingClient({
   socketPath:bindSocket,secretFile:bindSecret
  });
  await binder.bindTask({runtimeTaskId:runtime,planTaskId:task,
   role,childCredentialId:childId,presenterId:presenter,branch,
   operation:"read_then_update",path});
  const context:AgentTaskContext={
   task_id:"a2a-r3598",context_id:"ctx-r3598",role,
   trusted_gateway_task_id:runtime,
   subtask:{subtask_id:task,branch,instruction:"Read and update exact source",
    relevant_paths:[path],approved_file_permissions:[
     {path,operation:"read_file"},{path,operation:"update_file"}],
    approved_run_tests:false},
   delegation_evidence:{credential:"OFFLINE_NO_SECRET",credential_id:childId,
    presenter_id:presenter}
  };
  const effectStager=agentRegistry.selectFor(context);
  assert.equal(effectStager.stagedTool,"read_then_update");
  const evidenceHandler=new DelegationEvidenceHandler({
   adapterBaseUrl:"http://fixture.invalid",adapterToken:"OFFLINE",
   evidence:{credential:"OFFLINE_CHILD",credential_id:childId,
    presenter_id:presenter},
   fetchFn:async(input,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.ok(String(input).endsWith("/v1/presentations"));
    events.push("sign_"+body.challenge);
    return Response.json({signed_vp:"OFFLINE_VP"});
   }
  });
  const gatewayClient=new GatewayControlledToolClient({
   gatewayBaseUrl:"http://gateway.fixture.invalid",
   agentRole:role,taskId:runtime,evidenceHandler,
   trustedEffectStager:effectStager,
   fetchFn:async(input,init)=>{
    const url=String(input),body=JSON.parse(String(init?.body));
    if(url.endsWith("/v1/authorization/prepare")){
     const tool=body.tool as "read_file"|"update_file";
     const requestId="r3598-"+(tool==="read_file"?"read":"update");
     events.push("prepare_"+(tool==="read_file"?"read":"update"));
     store.put({request_id:requestId,task_id:runtime,agent_role:role,
      request:{tool,arguments:body.arguments},
      pinned_revision:sha,consumed:false,
      expires_at_ms:Date.now()+60_000} as never);
     return Response.json({request_id:requestId,audience:"gateway",
      challenge:tool==="read_file"?"read":"update",
      required_permission:{operation:tool,resource:"signed-fixture"},
      expires_at:new Date(Date.now()+60_000).toISOString()},{status:201});
    }
    if(url.endsWith("/v1/authorization/execute")){
     const read=body.request_id==="r3598-read";
     const operation=read?"read":"update";
     events.push("execute_"+operation);
     assert.equal(body.signed_vp,"OFFLINE_VP");
     return Response.json({request_id:body.request_id,decision:"allow",
      execution:{provider:"gitea",performed:true,
       tool:read?"read_file":"update_file",branch,path,
       ...(read?{revision:sha,blob_sha:"c".repeat(40),content:"old source"}:
        {revision:"b".repeat(40),commit_sha:"b".repeat(40)})}});
    }
    throw Error("unexpected fixture URL");
   }
  });
  return {gatewayClient,events,close:async()=>{
   await Promise.allSettled([agentServer?.close(),ownerServer.close()]);
   await rm(dir,{recursive:true,force:true});
  }};
 }catch(error){
  await Promise.allSettled([agentServer?.close(),ownerServer.close()]);
  await rm(dir,{recursive:true,force:true});
  throw error;
 }
}
test("R359.8 source and CAS cross real authenticated Unix channels in strict order",async()=>{
 const f=await fixture();
 try{
  const source=await f.gatewayClient.invoke("read_file",{branch,path});
  assert.equal((source as {content:string}).content,"old source");
  const written=await f.gatewayClient.invoke("update_file",{
   branch,path,content:"new source"
  });
  assert.equal((written as {commit_sha:string}).commit_sha,"b".repeat(40));
  assert.deepEqual(f.events,[
   "manifest","prepare_read","reserve_read","sign_read","execute_read",
   "verify_read","prepare_update","cas_preflight","reserve_update",
   "sign_update","execute_update","verify_update","finalize"
  ]);
 }finally{await f.close();}
});
test("R359.8 signed update before read never reaches VP or provider",async()=>{
 const f=await fixture();
 try{
  await assert.rejects(f.gatewayClient.invoke("update_file",{
   branch,path,content:"new source"
  }),/Trusted effect staging failed/u);
  assert.deepEqual(f.events,["manifest","prepare_update"]);
  await assert.rejects(f.gatewayClient.invoke("read_file",{branch,path}),
   /Trusted effect staging failed/u);
  assert.equal(f.events.some(x=>x.startsWith("execute_")),false);
 }finally{await f.close();}
});
