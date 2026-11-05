/**
 * R321: actual offline ADK LlmAgent/Runner -> direct Gateway controlled tool
 * -> trusted owner per-Task staging -> private signer -> Gateway execute.
 * Synthetic responses, no live network, Rust, EVM, Docker or paid model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm,type LlmRequest,type LlmResponse,
 type BaseLlmConnection} from "@google/adk";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";
import {TrustedEffectStagingTaskRegistry}
 from "../src/trusted-effect-staging-task-registry.ts";
import type {AgentTaskContext} from "../src/contracts.ts";

const RUNTIME="dispatch_"+"K".repeat(22);
const PLAN="r321-backend-file-task";
const BRANCH="feature/account-suspension";
const PATH="apps/backend/src/users/account.ts";
const CHILD="urn:r321:backend:child";
const PRESENTER="did:thesis:backend-agent";
const BASE_URL="http://gateway.r321.invalid";
const RESOURCE="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/"+PATH;
const SHA="a".repeat(40);
const SECRET="R321_PRIVATE_SIGNING_TOKEN";
const VP="R321_PRIVATE_SIGNED_VP";
const context=():AgentTaskContext=>({
 task_id:"r321-a2a-task",context_id:"r321-context",
 role:"backend",trusted_gateway_task_id:RUNTIME,
 subtask:{subtask_id:PLAN,branch:BRANCH,
  instruction:"Update the exact authorized backend file",
  relevant_paths:[PATH],
  approved_file_permissions:[{path:PATH,operation:"update_file"}],
  approved_run_tests:false
 },
 delegation_evidence:{
  credential:"PRIVATE_CHILD_DC_NOT_FOR_MODEL",
  credential_id:CHILD,presenter_id:PRESENTER
 }
});
class ScriptedBackendUpdate extends BaseLlm {
 readonly requests:LlmRequest[]=[];
 constructor(){super({model:"r321-scripted-adk-no-api"});}
 override async *generateContentAsync(req:LlmRequest):
 AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  if(this.requests.length===1)
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r321-edit-once",name:"update_file",
    args:{branch:BRANCH,path:PATH,content:"export const suspended=true;\n"}
   }}]}};
  else yield {content:{role:"model",parts:[{text:"Completed authorized change"}]}};
 }
 override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
  return Promise.reject(Error("R321 no live model connection"));
 }
}
function fixture(){
 const registry=new TrustedEffectStagingTaskRegistry();
 const calls:string[]=[];
 registry.bindTask({
  runtimeTaskId:RUNTIME,planTaskId:PLAN,
  role:"backend",branch:BRANCH,operation:"update_file",path:PATH,
  childCredentialId:CHILD,presenterId:PRESENTER,
  effectStager:{async stage(id:string){
   assert.equal(id,"r321-prepared-request");
   calls.push("owner_stage");
   return {provider_write_authorized:false};
  }}
 });
 const model=new ScriptedBackendUpdate();
 const handler=createAdkA2ATaskHandler({
  model,gatewayBaseUrl:BASE_URL,adapterToken:SECRET,
  adapterBaseUrl:"http://native-signer.r321.invalid",
  maxModelTurns:4,scopeModelPaths:true,
  trustedEffectTaskRegistry:registry,
  fetchFn:(async(url:unknown,options?:RequestInit)=>{
   const u=String(url),body=JSON.parse(String(options?.body));
   if(u.endsWith("/v1/authorization/prepare")){
    calls.push("gateway_prepare");
    assert.deepEqual(body,{task_id:RUNTIME,agent_role:"backend",
     tool:"update_file",arguments:{
      branch:BRANCH,path:PATH,content:"export const suspended=true;\n"
     }});
    return Response.json({
     request_id:"r321-prepared-request",
     audience:"cloud-access-gateway",challenge:"r321-challenge",
     expires_at:new Date(Date.now()+60000).toISOString(),
     required_permission:{resource:RESOURCE,operation:"update_file"}
    },{status:201});
   }
   if(u.endsWith("/v1/presentations")){
    calls.push("private_vp");
    assert.equal(new Headers(options?.headers).get("authorization"),
     "Bearer "+SECRET);
    assert.equal(body.credential_id,CHILD);
    assert.equal(body.challenge,"r321-challenge");
    assert.deepEqual(body.disclosed_permissions,[{
     resource:RESOURCE,operation:"update_file"
    }]);
    return Response.json({signed_vp:VP});
   }
   if(u.endsWith("/v1/authorization/execute")){
    calls.push("gateway_execute");
    assert.equal(body.request_id,"r321-prepared-request");
    assert.equal(body.signed_vp,VP);
    return Response.json({
     request_id:"r321-prepared-request",decision:"allow",
     execution:{provider:"gitea",performed:true,tool:"update_file",
      branch:BRANCH,path:PATH,commit_sha:SHA}
    });
   }
   throw Error("Forbidden offline R321 transport "+u);
  }) as typeof fetch
 });
 return {handler,model,registry,calls};
}
test("R321 owner-prebound A2A Task uses actual ADK Runner without sharing signer or stager with model",async()=>{
 const x=fixture();
 const result=await x.handler(context());
 assert.equal(result.role,"backend");
 assert.deepEqual(result.files_modified,[PATH]);
 assert.equal(result.commit_sha,SHA);
 assert.deepEqual(result.errors,[]);
 assert.deepEqual(x.calls,[
  "gateway_prepare","owner_stage","private_vp","gateway_execute"
 ]);
 assert.equal(x.model.requests.length,2);
 const modelData=JSON.stringify(x.model.requests);
 for(const secret of [SECRET,VP,CHILD,
  "PRIVATE_CHILD_DC_NOT_FOR_MODEL","r321-prepared-request"])
  assert.equal(modelData.includes(secret),false);
 await assert.rejects(x.handler(context()),
  /not prebound or was already dispatched/u);
 assert.equal(x.model.requests.length,2);
});
test("R321 malicious A2A task metadata cannot select owner effect port or trigger model",async()=>{
 for(const forged of [
  {...context(),trusted_gateway_task_id:"dispatch_"+"Z".repeat(22)},
  {...context(),delegation_evidence:{...context().delegation_evidence,
   credential_id:"urn:other:child"}},
  {...context(),subtask:{...context().subtask,branch:"feature/wrong"}},
  {...context(),trusted_gateway_task_id:undefined}
 ]){
  const x=fixture();
  await assert.rejects(x.handler(forged),
   /Trusted ADK effect Task binding NO-GO/u);
  assert.deepEqual(x.calls,[]);
  assert.equal(x.model.requests.length,0);
 }
});
