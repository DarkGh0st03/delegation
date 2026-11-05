/**
 * R327: real HTTP A2A SDK and ADK Runner with authenticated owner/agent
 * Unix IPC. No paid model, live Rust/EVM, Gitea or Docker: those services
 * are deliberately represented by isolated fixtures in this test only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection}
 from "@google/adk";
import {createServer} from "node:net";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {startSpecializedAgentServer}
 from "../../agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator}
 from "../../agent-runtime/src/orchestrator.ts";
import {TrustedEffectStagingTaskRegistry,
 createTrustedEffectAgentBindingServer,
 connectTrustedOwnerEffectStagingClient}
 from "../../agent-runtime/src/index.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {startTrustedAuthorityOnlySdkA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";
import {canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import type {SpecializedAgentRole}
 from "../../agent-runtime/src/contracts.ts";

const repo={authority:"gitea.local",owner:"thesis",
 repository:"iam-console-poc"};
const branch="feature/account-suspension";
const path="apps/backend/src/users/account.ts";
const permission={resource:canonicalFileUri(repo,branch,path),
 operation:"update_file" as const};
const runtimeTaskId="dispatch_"+"Z".repeat(22);
const taskId="r327-backend";
const childId="urn:r327:backend:child";
const did="did:thesis:backend-agent";
const sha="f".repeat(40),secret="R327_PRIVATE_SIGNER_SECRET";
const vp="R327_PRIVATE_VP_NOT_MODEL_DATA";
const requestId="r327-prepared-01";
const content="export const accountSuspended=true;\n";
const root={
 session_id:"session-r327",repository:repo,branch,
 authority_digest:"e".repeat(64),root_credential_id:"r327-root",
 base_revision:"a".repeat(40),requirement_sha256:"b".repeat(64),
 engineer_did:"did:thesis:engineer",
 root_expires_at:new Date(Date.now()+120_000).toISOString(),
 expires_at:new Date(Date.now()+120_000).toISOString(),
 root_permissions:[permission]
};
const row={
 status:"task_registered_preflight_only" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:did,card_ref:"trusted:backend",
 depends_on:[],permissions:[permission],root_credential_id:root.root_credential_id,
 authority_digest:root.authority_digest,
 execution_authorized:false as const,child_credential_issued:false as const,
 gateway_registered:false as const
};
const child={
 status:"native_child_response_verified_staged" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:did,root_credential_id:root.root_credential_id,
 credential_id:childId,authority_digest:root.authority_digest,
 permissions:[permission],status_list_credential:"https://status.invalid/r327",
 status_list_index:"42",
 expires_at:new Date(Date.now()+120_000).toISOString(),
 gateway_execution_authorized:false as const
};
const signed={
 "@context":["https://www.w3.org/ns/credentials/v2"],
 type:["VerifiableCredential","DelegationCredential"],
 id:childId,issuer:"did:thesis:rust",validFrom:new Date().toISOString(),
 credentialStatus:{
  type:"BitstringStatusListEntry",statusPurpose:"revocation",
  statusListIndex:child.status_list_index,
  statusListCredential:child.status_list_credential
 },
 credentialSubject:{sub:did,per:[permission]},
 proof:{type:"Ed25519Signature2020",proofValue:"OFFLINE_FIXTURE_NOT_NATIVE"}
};
const gatewayReceipt={
 status:"gateway_owner_child_task_preflight_only" as const,
 task_id:taskId,runtime_task_id:runtimeTaskId,agent_id:"backend",
 agent_did:did,credential_id:childId,authority_digest:root.authority_digest,
 gateway_execution_authorized:false as const
};
class ScriptedBackend extends BaseLlm{
 readonly requests:LlmRequest[]=[];
 constructor(){super({model:"r327-scripted-no-api-keys"});}
 override async *generateContentAsync(req:LlmRequest):
 AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  if(this.requests.length===1)
   yield {content:{role:"model",parts:[{functionCall:{
    name:"update_file",id:"r327-update",args:{branch,path,content}
   }}]}};
  else yield {content:{role:"model",parts:[{text:"Updated approved backend Task"}]}};
 }
 override connect(_req:LlmRequest):Promise<BaseLlmConnection>{
  return Promise.reject(Error("Paid model connection forbidden"));
 }
}
async function freePort():Promise<number>{
 const server=createServer();
 await new Promise<void>((ok,bad)=>{
  server.once("error",bad);server.listen(0,"127.0.0.1",ok);
 });
 const address=server.address();
 if(!address||typeof address==="string")throw Error("no local A2A port");
 await new Promise<void>((ok,bad)=>server.close(e=>e?bad(e):ok()));
 return address.port;
}

test("R327 genuine SDK A2A HTTP -> ADK -> private Unix stage, completion gated independently",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"r327-authority-only-"));
 const stageSecret=join(dir,"stage.hex"),bindSecret=join(dir,"bind.hex");
 await writeFile(stageSecret,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 await writeFile(bindSecret,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 const socket=join(dir,"owner-stage.sock"),
  bindSocket=join(dir,"backend-bind.sock");
 const events:string[]=[];
 const registry=new TrustedEffectStagingTaskRegistry();
 const model=new ScriptedBackend();
 const servers:Awaited<ReturnType<typeof startSpecializedAgentServer>>[]=[];
 let binding:Awaited<ReturnType<typeof createTrustedEffectAgentBindingServer>>|undefined;
 let owner:Awaited<ReturnType<typeof startTrustedAuthorityOnlySdkA2AOwner>>|undefined;
 try{
  const stageClient=await connectTrustedOwnerEffectStagingClient({
   socketPath:socket,secretFile:stageSecret
  });
  binding=await createTrustedEffectAgentBindingServer({
   socketPath:bindSocket,secretFile:bindSecret,
   registry,ownerStageClient:stageClient
  });
  await binding.start();
  const handlerFetch=(async(url:unknown,options?:RequestInit)=>{
   const u=String(url);
   const body=JSON.parse(String(options?.body));
   if(u.endsWith("/v1/authorization/prepare")){
    events.push("gateway_prepare");
    assert.deepEqual(body,{task_id:runtimeTaskId,agent_role:"backend",
     tool:"update_file",arguments:{branch,path,content}});
    return Response.json({
     request_id:requestId,audience:"cloud-access-gateway",
     challenge:"r327-challenge",
     expires_at:new Date(Date.now()+60_000).toISOString(),
     required_permission:permission
    },{status:201});
   }
   if(u.endsWith("/v1/presentations")){
    events.push("private_vp");
    assert.equal(new Headers(options?.headers).get("authorization"),
     "Bearer "+secret);
    assert.equal(body.credential_id,childId);
    assert.deepEqual(body.disclosed_permissions,[permission]);
    assert.equal(body.challenge,"r327-challenge");
    return Response.json({signed_vp:vp});
   }
   if(u.endsWith("/v1/authorization/execute")){
    events.push("gateway_execute");
    assert.equal(body.request_id,requestId);
    assert.equal(body.signed_vp,vp);
    return Response.json({
     request_id:requestId,decision:"allow",
     execution:{provider:"gitea",performed:true,tool:"update_file",
      branch,path,commit_sha:sha}
    });
   }
   throw Error("Unapproved offline R327 endpoint "+u);
  }) as typeof fetch;
  const roles=["backend","frontend","test"] as const;
  const urls={} as Record<SpecializedAgentRole,string>;
  for(const role of roles){
   const server=await startSpecializedAgentServer({
    role,host:"127.0.0.1",port:await freePort(),
    delegatedAuthorization:true,capabilityProfile:"approved-plan",
    ...(role==="backend"?{adk:{
     model,gatewayBaseUrl:"http://offline-gateway.r327.invalid",
     adapterBaseUrl:"http://offline-signer.r327.invalid",
     adapterToken:secret,scopeModelPaths:true,
     maxModelTurns:4,maxModelCallMs:5000,
     trustedEffectTaskRegistry:registry,fetchFn:handlerFetch
    }}:{})
   });
   servers.push(server);urls[role]=server.baseUrl;
  }
  const coordinator=Object.assign(Object.create(
   TrustedAuthorityOnlyExecutionCoordinator.prototype),{
   assertTrustedGatewayAuthorityBinding:()=>root,
   assertTrustedGatewayRegisteredTask:()=>row
  });
  Object.defineProperty(coordinator,"phase",{value:"active"});
  let transferred=0;
  const issuer=Object.assign(Object.create(
   TrustedAuthorityOnlyChildIssuer.prototype),{
   assertTrustedIssuedChild:()=>child,
   takeTrustedIssuedChildCredential:()=>{
    transferred++;
    if(transferred!==1)throw Error("signed Child replay");
    events.push("native_child_transferred");
    return signed;
   }
  });
  let independentlyAttested=0;
  const gateway=Object.assign(Object.create(
   TrustedAuthorityOnlyGatewayAdmissions.prototype),{
   assertTrustedOwnerRemoteEffectBinding:()=>gatewayReceipt,
   attestTrustedTaskCompletion:async(task:string,rt:string)=>{
    assert.equal(task,taskId);assert.equal(rt,runtimeTaskId);
    events.push("independent_gateway_observer");
    independentlyAttested++;
    return {status:"task_completion_observed_staged",
     task_id:task,runtime_task_id:rt,
     gateway_execution_authorized:false};
   }
  });
  Object.defineProperty(gateway,"phase",{value:"active"});
  const opts={coordinator,childIssuer:issuer,gateway,
   agentBaseUrls:urls,stageSocketPath:socket,stageSecretFile:stageSecret,
   agentBindingSocketPath:bindSocket,agentBindingSecretFile:bindSecret,
   a2aPolling:{deadlineMs:15000,initialIntervalMs:25,maxIntervalMs:80}};
  // A fake role Card must be refused BEFORE the private owner bootstrap
  // or native Child transfer is touched.
  await assert.rejects(startTrustedAuthorityOnlySdkA2AOwner({
   ...opts,agentBaseUrls:{...urls,backend:urls.frontend,
    frontend:urls.backend}
  } as never),/startup|card|verification|denied/iu);
  assert.equal(transferred,0);
  // Canonical startup has no injectable fake HTTP/A2A dispatcher.
  await assert.rejects(startTrustedAuthorityOnlySdkA2AOwner({
   ...opts,a2a:{sendProtectedTask:async()=>{}}
  } as never),/only trusted pinned role endpoints/u);
  owner=await startTrustedAuthorityOnlySdkA2AOwner(opts as never);
  assert.equal(independentlyAttested,0);
  // An A2A HTTP message claiming a Task ID without owner Unix binding is
  // rejected before any ADK model call or Gateway access.
  const maliciousClient=new DeterministicA2AOrchestrator({
   deadlineMs:1500,initialIntervalMs:25,maxIntervalMs:80});
  await assert.rejects(maliciousClient.sendProtectedTask({
   agent_base_url:urls.backend,
   trusted_gateway_task_id:runtimeTaskId,
   subtask:{subtask_id:taskId,branch,instruction:"forged",
    relevant_paths:[path],
    approved_file_permissions:[{path,operation:"update_file"}],
    approved_run_tests:false},
   delegation_evidence:{credential:"FORGED_A2A_DATA",
    credential_id:childId,presenter_id:did}
  }),/A2A task ended without completion|A2A task deadline|transport failed/u);
  assert.equal(model.requests.length,0);
  assert.deepEqual(events,[]);
  const report=await owner.dispatchIssuedTask({
   taskId,runtimeTaskId,instruction:"Update authorized account file",
   effectStager:{async stage(id:string){
    assert.equal(id,requestId);
    events.push("owner_private_stage");
    return {provider_write_authorized:false};
   }}
  });
  assert.equal(report.status,"a2a_report_not_gateway_completed");
  assert.equal(report.provider_completion_attested,false);
  assert.deepEqual(report.artifact.files_modified,[path]);
  assert.equal(report.artifact.commit_sha,sha);
  assert.equal(transferred,1);
  assert.equal(independentlyAttested,0);
  assert.deepEqual(events,[
   "native_child_transferred","gateway_prepare","owner_private_stage",
   "private_vp","gateway_execute"
  ]);
  assert.equal(model.requests.length,2);
  const prompts=JSON.stringify(model.requests);
  for(const forbidden of [secret,vp,childId,requestId,
   "FORGED_A2A_DATA","OFFLINE_FIXTURE_NOT_NATIVE"])
   assert.equal(prompts.includes(forbidden),false);
  const completion=await owner.attestIndependentGatewayCompletion(
   taskId,runtimeTaskId);
  assert.equal(completion.status,"owner_gateway_completion_independently_observed");
  assert.equal(independentlyAttested,1);
  assert.equal(events.at(-1),"independent_gateway_observer");
  await assert.rejects(owner.dispatchIssuedTask({
   taskId,runtimeTaskId,instruction:"retry",
   effectStager:{async stage(){}}}),/closed or malformed owner-selected/u);
 }finally{
  const results=await Promise.allSettled([
   owner?.close(),binding?.close(),
   ...servers.reverse().map(s=>s.close())
  ]);
  await rm(dir,{recursive:true,force:true});
  for(const r of results)if(r.status==="rejected")throw r.reason;
 }
});
