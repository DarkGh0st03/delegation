/**
 * R151.37 — scripted real ADK Runner + trusted A2A Backend discovery signer.
 * Exercises the actual ADK Tool->Gateway prepare->private Rust signer->Gateway
 * execute route WITHOUT Gemini billing or direct source bypass.
 * Gitea/Verifier/OPA provider responses are deliberately offline mocks:
 * this is not a claim of live end-to-end credential verification.
 */
import assert from "node:assert/strict";
import {test} from "node:test";
import {randomBytes} from "node:crypto";
import {BaseLlm,type LlmRequest,type LlmResponse,
 type BaseLlmConnection} from "@google/adk";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";
import {TrustedBackendDiscoveryChildPresenter} from
 "../src/trusted-backend-discovery-presenter.ts";
import {TrustedBackendDiscoveryCryptoPresentation} from
 "../src/trusted-backend-discovery-crypto-presentation.ts";
import type {AgentTaskContext} from "../src/contracts.ts";

const branch="feature/invoice-approval";
const path="src/invoices.ts",sha="a".repeat(40);
const resource="gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts";
const child="urn:child:r151-remote-discovery";
const gatewayId="r15137-runtime-task",planTaskId="r151-remote-child-task";
const privateBearer="SECRET_BACKEND_NATIVE_NOT_FOR_MODEL";
const privateChild="SECRET_CHILD_DC_NOT_FOR_MODEL";
const fallbackBearer="SECRET_GENERIC_FALLBACK";
class SingleRead extends BaseLlm{
 readonly requests:LlmRequest[]=[];
 constructor(){super({model:"r15137-scripted-no-billing"});}
 override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  if(this.requests.length===1)
   yield {content:{role:"model",parts:[{functionCall:{
    id:"offline-discovery-read",name:"read_file",args:{branch,path}
   }}]}};
  else yield {content:{role:"model",parts:[{text:"Completed authorized source read"}]}};
 }
 override connect():Promise<BaseLlmConnection>{
  return Promise.reject(Error("No live model connection in R151.37"));
 }
}
test("R151.37 ADK calls only trusted Backend Child signer, then protected Gateway read",async()=>{
 const challenge=randomBytes(32).toString("base64url");
 const model=new SingleRead();
 let native=0,prepare=0,execute=0,untrusted=0;
 const nativeHolder=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://backend-adapter.local:8090/",
  backendToken:privateBearer,childCredentialId:child,
  resource,audience:"cloud-access-gateway",isTaskActive:()=>true,
  fetchFn:(async(_url:unknown,opts?:RequestInit)=>{
   native++;
   assert.equal(new Headers(opts?.headers).get("authorization"),
    "Bearer "+privateBearer);
   const body=JSON.parse(String(opts?.body));
   assert.deepEqual(body,{
    credential_id:child,disclosed_permissions:[{resource,operation:"read_file"}],
    audience:"cloud-access-gateway",challenge
   });
   return new Response(JSON.stringify({signed_vp:"native-child-vp:"+challenge}));
  }) as typeof fetch
 });
 const presentation=new TrustedBackendDiscoveryCryptoPresentation({
  holder:nativeHolder,childCredentialId:child,
  resource,audience:"cloud-access-gateway",isTaskActive:()=>true
 });
 const ctx:AgentTaskContext={
  task_id:"r15137-a2a",context_id:"r15137",
  role:"backend",trusted_gateway_task_id:gatewayId,
  subtask:{subtask_id:planTaskId,branch,
   instruction:"Read source file and report a safe summary",
   relevant_paths:[path],
   approved_file_permissions:[{operation:"read_file",path}],
   approved_run_tests:false},
  delegation_evidence:{credential:privateChild,credential_id:child,
   presenter_id:"did:example:backend"}
 };
 const handler=createAdkA2ATaskHandler({
  model,gatewayBaseUrl:"http://gateway.local",
  adapterBaseUrl:"http://wrong-fallback.local",adapterToken:fallbackBearer,
  scopeModelPaths:true,
  trustedBackendDiscovery:{
   planTaskId,runtimeTaskId:gatewayId,childCredentialId:child,
   presenterId:"did:example:backend",branch,path,resource,
   audience:"cloud-access-gateway",presentation,
   repository:{authority:"gitea.local",owner:"sample",
    repository:"invoice-service"}
  },
  fetchFn:(async(url:unknown,opts?:RequestInit)=>{
   const u=String(url),body=JSON.parse(String(opts?.body));
   if(u.endsWith("/v1/authorization/prepare")){
    prepare++;
    assert.deepEqual(body,{task_id:gatewayId,agent_role:"backend",
     tool:"read_file",arguments:{branch,path}});
    return new Response(JSON.stringify({
     request_id:"r15137-gateway-challenge",audience:"cloud-access-gateway",
     challenge,expires_at:new Date(Date.now()+30000).toISOString(),
     required_permission:{resource,operation:"read_file"}
    }),{status:201});
   }
   if(u.endsWith("/v1/authorization/execute")){
    execute++;
    assert.equal(body.request_id,"r15137-gateway-challenge");
    assert.equal(body.signed_vp,"native-child-vp:"+challenge);
    return new Response(JSON.stringify({
     request_id:body.request_id,decision:"allow",
     execution:{provider:"gitea",performed:true,tool:"read_file",
      branch,path,revision:sha,blob_sha:"b".repeat(40),
      last_commit_sha:sha,size:28,encoding:"utf-8",
      content:"export function invoice() {}"}
    }),{status:200});
   }
   untrusted++;
   throw Error("Generic Adapter invocation not allowed for remote Child");
  }) as typeof fetch
 });
 const artifact=await handler(ctx);
 assert.equal(artifact.role,"backend");
 assert.equal(artifact.revision,sha);
 assert.deepEqual(artifact.files_modified,[]);
 assert.deepEqual(artifact.errors,[]);
 assert.equal(native,1);assert.equal(prepare,1);
 assert.equal(execute,1);assert.equal(untrusted,0);
 assert.equal(model.requests.length,2);
 const modelData=JSON.stringify(model.requests);
 for(const forbidden of [privateBearer,privateChild,fallbackBearer,
  "native-child-vp:"])assert.equal(modelData.includes(forbidden),false);
 await assert.rejects(presentation.createSignedPresentation({
  request_id:"fresh-request",audience:"cloud-access-gateway",
  challenge:randomBytes(32).toString("base64url"),
  required_permission:{resource,operation:"read_file"},
  expires_at:new Date(Date.now()+30000).toISOString()
 }),/closed or cancelled/);
});
