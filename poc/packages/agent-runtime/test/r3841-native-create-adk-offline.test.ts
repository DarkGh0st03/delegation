/**
 * R384.1 — actual Google ADK LlmAgent/Runner, original prebound A2A Task,
 * one-use owner stage, real task-local MCP token/challenge protocol and
 * GatewayControlledToolClient CREATE. The Rust signer and Gateway are
 * deliberately STUBBED: native provider proof is separately R384.0.
 *
 * No live network/model, API charge, provider write or real credential.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {BaseLlm,type BaseLlmConnection,type LlmRequest,type LlmResponse}
 from "@google/adk";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";
import {TrustedEffectStagingTaskRegistry}
 from "../src/trusted-effect-staging-task-registry.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";
import type {AgentTaskContext} from "../src/contracts.ts";

const RUNTIME="dispatch_"+"N".repeat(22);
const PLAN="r3841-backend-create-task";
const BRANCH="feature/account-suspension";
const PATH="apps/backend/src/users/account-suspension-created.ts";
const CONTENT="export const accountSuspended = true;\n";
const CHILD="urn:r3841:child:backend";
const DID="did:thesis:backend-agent";
const REQUEST="r3841-backend-create-prepare";
const RESOURCE="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/"+PATH;
const COMMIT="a".repeat(40),BLOB="b".repeat(40);
const SIGNED="r3841-native-mcp-synthetic-signed-vp";
const context=():AgentTaskContext=>({
 task_id:"r3841-agent-a2a-task",
 context_id:"r3841-original-context",
 role:"backend",trusted_gateway_task_id:RUNTIME,
 subtask:{
  subtask_id:PLAN,branch:BRANCH,
  instruction:"Create only the signed backend account suspension source",
  relevant_paths:[PATH],
  approved_file_permissions:[{path:PATH,operation:"create_file"}],
  approved_run_tests:false
 },
 delegation_evidence:{
  credential:"R3841_PRIVATE_CHILD_DC_NEVER_FOR_MODEL",
  credential_id:CHILD,presenter_id:DID
 }
});
class ScriptedCreate extends BaseLlm{
 readonly requests:LlmRequest[]=[];
 readonly repeat:boolean;
 constructor(repeat=false){
  super({model:"r3841-scripted-offline-adk"});
  this.repeat=repeat;
 }
 override async *generateContentAsync(req:LlmRequest):
 AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  if(this.requests.length===1||this.repeat){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r3841-create-"+this.requests.length,
    name:"create_file",args:{branch:BRANCH,path:PATH,content:CONTENT}
   }}]}};
  }else yield {content:{role:"model",parts:[
   {text:"The exact approved source file was created."}
  ]}};
 }
 override connect(_req:LlmRequest):Promise<BaseLlmConnection>{
  return Promise.reject(Error("R384.1 prohibits live AI connections"));
 }
}
function nativeEnvironment(t:import("node:test").TestContext){
 const keys=["DELEGATION_GATEWAY_ARCHITECTURE","APPROVED_RUNNER_NATIVE_MCP",
  "ADAPTER_ENGINEER_NATIVE_SOCKET"];
 const previous=keys.map(k=>process.env[k]);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="/tmp/r3841-offline-no-socket";
 const original=DelegationEvidenceHandler.prototype.createPresentation;
 // The REAL PrivateMcpTaskRegistry and LocalCryptoMcpBridge still bind
 // the exact Gateway request and sign a private task token; only the Rust
 // cryptographic port is synthetic in this offline ADK test.
 DelegationEvidenceHandler.prototype.createPresentation=async function(prepared){
  assert.equal(prepared.request_id,REQUEST);
  assert.equal(prepared.required_permission.operation,"create_file");
  assert.equal(prepared.required_permission.resource,RESOURCE);
  return SIGNED;
 };
 t.after(()=>{
  DelegationEvidenceHandler.prototype.createPresentation=original;
  keys.forEach((k,i)=>{
   if(previous[i]===undefined)delete process.env[k];
   else process.env[k]=previous[i];
  });
 });
}
function fixture(options:{wrongResult?:boolean;denyStage?:boolean;repeat?:boolean}={}){
 const registry=new TrustedEffectStagingTaskRegistry();
 const calls:string[]=[];
 let attempted=false;
 registry.bindTask({
  runtimeTaskId:RUNTIME,planTaskId:PLAN,
  role:"backend",branch:BRANCH,
  operation:"create_file",path:PATH,
  childCredentialId:CHILD,presenterId:DID,
  effectStager:{
   stagedTool:"create_file",
   async stage(requestId:string){
    assert.equal(requestId,REQUEST);
    calls.push("owner_stage");
    if(attempted||options.denyStage)throw Error("OWNER PRIVATE SINGLE USE");
    attempted=true;
    return {provider_write_authorized:false};
   }
  }
 });
 const keys=generateKeyPairSync("ed25519");
 const nativeMcp=new PrivateMcpTaskRegistry({
  role:"backend",
  signingPrivateKeyPem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
  signingPublicKeyPem:keys.publicKey.export({format:"pem",type:"spki"}).toString()
 });
 const model=new ScriptedCreate(options.repeat===true);
 const handler=createAdkA2ATaskHandler({
  model,gatewayBaseUrl:"http://gateway.r3841.invalid",
  adapterToken:"r3841-owner-secret-signer-token",
  maxModelTurns:4,scopeModelPaths:true,
  trustedEffectTaskRegistry:registry,
  mcpTaskRegistry:nativeMcp,
  nativePresentationTransport:"mcp-stdio",
  fetchFn:async(url:URL|string,init?:RequestInit)=>{
   const endpoint=String(url),data=JSON.parse(String(init?.body));
   if(endpoint.endsWith("/v1/authorization/prepare")){
    calls.push("gateway_prepare");
    assert.deepEqual(data,{
     task_id:RUNTIME,agent_role:"backend",tool:"create_file",
     arguments:{branch:BRANCH,path:PATH,content:CONTENT}
    });
    return Response.json({
     request_id:REQUEST,audience:"cloud-access-gateway",
     challenge:"r3841-gateway-challenge",
     expires_at:new Date(Date.now()+60000).toISOString(),
     required_permission:{resource:RESOURCE,operation:"create_file"}
    },{status:201});
   }
   if(endpoint.endsWith("/v1/authorization/execute")){
    calls.push("gateway_execute");
    assert.deepEqual(data,{request_id:REQUEST,signed_vp:SIGNED});
    return Response.json({
     request_id:REQUEST,decision:"allow",
     execution:{
      provider:"gitea",performed:true,tool:"create_file",
      branch:BRANCH,path:options.wrongResult?"apps/backend/src/foreign.ts":PATH,
      commit_sha:COMMIT,revision:COMMIT,blob_sha:BLOB
     }
    });
   }
   throw Error("R384.1 forbidden legacy network transport "+endpoint);
  }
 });
 return {registry,model,handler,nativeMcp,calls};
}
test("R384.1 actual ADK/Local-MCP FunctionTool CREATE runs only on original A2A Task",async t=>{
 nativeEnvironment(t);
 const f=fixture();
 const result=await f.handler(context());
 assert.equal(result.role,"backend");
 assert.deepEqual(result.files_created,[PATH]);
 assert.deepEqual(result.files_modified,[]);
 assert.equal(result.commit_sha,COMMIT);
 assert.deepEqual(result.errors,[]);
 assert.equal(f.nativeMcp.completedCryptoProofs,1);
 assert.deepEqual(f.calls,[
  "gateway_prepare","owner_stage","gateway_execute"
 ]);
 assert.equal(f.model.requests.length,2);
 const visible=JSON.stringify(f.model.requests);
 for(const secret of [SIGNED,CHILD,"R3841_PRIVATE_CHILD_DC_NEVER_FOR_MODEL",
  "r3841-owner-secret-signer-token",REQUEST])
  assert.equal(visible.includes(secret),false);
 await assert.rejects(f.handler(context()),
  /not prebound or was already dispatched/u);
 assert.equal(f.model.requests.length,2);
});
test("R384.1 signed A2A cannot swap role, Child or create file hint to gain owner port",async t=>{
 nativeEnvironment(t);
 for(const forged of [
  {...context(),role:"test" as const},
  {...context(),delegation_evidence:{...context().delegation_evidence,
   credential_id:"urn:foreign:child"}},
  {...context(),subtask:{...context().subtask,
   relevant_paths:["apps/backend/src/foreign.ts"]}},
  {...context(),subtask:{...context().subtask,
   approved_file_permissions:[{path:PATH,operation:"update_file" as const}]}},
  {...context(),trusted_gateway_task_id:"dispatch_"+"Z".repeat(22)}
 ]){
  const f=fixture();
  await assert.rejects(f.handler(forged),/Trusted ADK effect Task binding NO-GO/u);
  assert.deepEqual(f.calls,[]);
  assert.equal(f.model.requests.length,0);
  assert.equal(f.nativeMcp.completedCryptoProofs,0);
 }
});
test("R384.1 malformed CAS response never becomes a completed ADK Task",async t=>{
 nativeEnvironment(t);
 const f=fixture({wrongResult:true});
 await assert.rejects(f.handler(context()),
  /ADK controlled task failed: authorization_denied/u);
 assert.deepEqual(f.calls,[
  "gateway_prepare","owner_stage","gateway_execute"
 ]);
 assert.equal(f.nativeMcp.completedCryptoProofs,1);
});
test("R384.1 owner CREATE staging rejection prevents both VP and Gateway execute",async t=>{
 nativeEnvironment(t);
 const f=fixture({denyStage:true});
 await assert.rejects(f.handler(context()),
  /ADK controlled task failed: tool_unavailable/u);
 assert.deepEqual(f.calls,["gateway_prepare","owner_stage"]);
 assert.equal(f.nativeMcp.completedCryptoProofs,0);
});
test("R384.1 repeated ADK CREATE attempts cannot consume owner effect twice",async t=>{
 nativeEnvironment(t);
 const f=fixture({repeat:true});
 await assert.rejects(f.handler(context()),
  /ADK controlled task failed/u);
 const stages=f.calls.filter(x=>x==="owner_stage");
 assert.equal(stages.length,2);
 assert.equal(f.calls.filter(x=>x==="gateway_execute").length,1);
 assert.equal(f.nativeMcp.completedCryptoProofs,1);
});
