/**
 * R151.42 — actual owner-only Unix HMAC prebind followed by the actual ADK
 * Backend Tool call to Gateway Prepare/Execute. The Rust Adapter, Gateway
 * VP verifier, OPA and Gitea responses are offline stubs; this is not a
 * claim of a complete real-repair run or of unbilled Gemini inference.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BaseLlm,type BaseLlmConnection,type LlmRequest,type LlmResponse} from "@google/adk";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";
import {TrustedBackendDiscoveryChildPresenter} from "../src/trusted-backend-discovery-presenter.ts";
import {TrustedBackendDiscoveryTaskSlot} from "../src/trusted-backend-discovery-task-slot.ts";
import {createTrustedBackendDiscoveryTaskBindingServer,
 TrustedBackendDiscoveryTaskBindingSocketClient} from
 "../src/trusted-backend-discovery-task-binding-ipc.ts";
import type {AgentTaskContext} from "../src/contracts.ts";

const branch="feature/invoice-approval",path="src/invoices.ts";
const sha="a".repeat(40);
const resource="gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts";
const child="urn:child:r151-remote-discovery";
const planTask="r151-remote-child-task",backendDid="did:example:backend";
const privateBearer="SECRET_BACKEND_TOKEN_R15142";
const privateChild="SECRET_DELEGATION_DC_R15142";
const fallbackBearer="SECRET_GENERIC_ADAPTER_R15142";
class ScriptedReadModel extends BaseLlm{
 readonly observed:LlmRequest[]=[];
 constructor(){super({model:"R15142-no-billing-scripted-read"});}
 override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
  this.observed.push(req);
  if(this.observed.length===1)yield {content:{role:"model",parts:[{
   functionCall:{id:"r15142-read",name:"read_file",args:{branch,path}}
  }]}};
  else yield {content:{role:"model",parts:[{text:"Read completed through Gateway"}]}};
 }
 override connect():Promise<BaseLlmConnection>{
  return Promise.reject(Error("Paid inference disabled in offline R151.42"));
 }
}
async function fixture(t:import("node:test").TestContext){
 const dir=await mkdtemp(join(tmpdir(),"delegation-hmac-adk-r15142-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const socketPath=join(dir,"binding.sock"),secretFile=join(dir,"secret.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 const runtimeId="dispatch_"+randomBytes(16).toString("base64url");
 const challenge=randomBytes(32).toString("base64url");
 let adapter=0,prepare=0,execute=0,untrusted=0;
 const holder=new TrustedBackendDiscoveryChildPresenter({
  adapterBaseUrl:"http://private-rust-adapter.local",
  backendToken:privateBearer,childCredentialId:child,resource,
  audience:"cloud-access-gateway",isTaskActive:()=>true,
  fetchFn:(async(_url:unknown,options?:RequestInit)=>{
   adapter++;
   assert.equal(new Headers(options?.headers).get("authorization"),
    "Bearer "+privateBearer);
   const request=JSON.parse(String(options?.body));
   assert.deepEqual(request,{credential_id:child,
    disclosed_permissions:[{resource,operation:"read_file"}],
    audience:"cloud-access-gateway",challenge});
   return new Response(JSON.stringify({signed_vp:"native-child:"+challenge}));
  }) as typeof fetch
 });
 const slot=new TrustedBackendDiscoveryTaskSlot({
  holder,planTaskId:planTask,childCredentialId:child,
  presenterId:backendDid,branch,path,resource,
  audience:"cloud-access-gateway",
  repository:{authority:"gitea.local",owner:"sample",repository:"invoice-service"}
 });
 const server=await createTrustedBackendDiscoveryTaskBindingServer({
  socketPath,secretFile,slot
 });
 await server.start();t.after(()=>server.close());
 const client=await TrustedBackendDiscoveryTaskBindingSocketClient.connect({
  socketPath,secretFile
 });
 const pins={runtime_task_id:runtimeId,plan_task_id:planTask,
  credential_id:child,presenter_id:backendDid,branch,path,resource,
  audience:"cloud-access-gateway" as const};
 const context:AgentTaskContext={
  task_id:"a2a-r15142",context_id:"r15142",role:"backend",
  trusted_gateway_task_id:runtimeId,
  subtask:{subtask_id:planTask,branch,instruction:"Read exactly approved source",
   relevant_paths:[path],approved_file_permissions:[{operation:"read_file",path}],
   approved_run_tests:false},
  delegation_evidence:{credential:privateChild,credential_id:child,
   presenter_id:backendDid}
 };
 const model=new ScriptedReadModel();
 const handler=createAdkA2ATaskHandler({
  model,gatewayBaseUrl:"http://gateway.internal",
  adapterBaseUrl:"http://generic-adapter.invalid",adapterToken:fallbackBearer,
  scopeModelPaths:true,trustedBackendDiscoverySlot:slot,
  fetchFn:(async(url:unknown,options?:RequestInit)=>{
   const body=JSON.parse(String(options?.body));
   if(String(url).endsWith("/v1/authorization/prepare")){
    prepare++;
    assert.deepEqual(body,{
     task_id:runtimeId,agent_role:"backend",tool:"read_file",
     arguments:{branch,path}
    });
    return new Response(JSON.stringify({
     request_id:"gateway-r15142",audience:"cloud-access-gateway",
     challenge,expires_at:new Date(Date.now()+30000).toISOString(),
     required_permission:{resource,operation:"read_file"}
    }),{status:201});
   }
   if(String(url).endsWith("/v1/authorization/execute")){
    execute++;
    assert.equal(body.request_id,"gateway-r15142");
    assert.equal(body.signed_vp,"native-child:"+challenge);
    return new Response(JSON.stringify({
     request_id:body.request_id,decision:"allow",
     execution:{provider:"gitea",performed:true,tool:"read_file",
      branch,path,revision:sha,blob_sha:"b".repeat(40),
      last_commit_sha:sha,size:29,encoding:"utf-8",
      content:"export function invoice() {}"}
    }),{status:200});
   }
   untrusted++;
   throw Error("Unscoped Adapter is forbidden for this discovery Child");
  }) as typeof fetch
 });
 return {client,slot,pins,context,model,handler,challenge,
  get counts(){return {adapter,prepare,execute,untrusted};}};
}
test("R151.42 authenticated owner IPC -> Backend slot -> ADK -> private VP -> Gateway read",async t=>{
 const f=await fixture(t);
 assert.equal(f.slot.bindingFor(f.context),undefined,"no signer before owner prebind");
 assert.equal((await f.client.prepare(f.pins)).status,
  "backend_discovery_read_prebound_not_executed");
 const artifact=await f.handler(f.context);
 assert.equal(artifact.role,"backend");
 assert.equal(artifact.revision,sha);
 assert.deepEqual(artifact.files_modified,[]);
 assert.deepEqual(artifact.errors,[]);
 assert.deepEqual(f.counts,{adapter:1,prepare:1,execute:1,untrusted:0});
 assert.equal(f.model.observed.length,2);
 const seen=JSON.stringify(f.model.observed);
 for(const secret of [privateBearer,privateChild,fallbackBearer,
  "native-child:"+f.challenge])
  assert.equal(seen.includes(secret),false);
 await f.client.fence(f.pins.runtime_task_id);
 await assert.rejects(f.client.prepare(f.pins),/binding denied/);
 assert.deepEqual(f.counts,{adapter:1,prepare:1,execute:1,untrusted:0});
});
test("R151.42 protected ADK rejects mismatched A2A Task BEFORE tools or models",async t=>{
 const f=await fixture(t);
 await f.client.prepare(f.pins);
 const variants=[
  {...f.context, trusted_gateway_task_id:"dispatch_"+randomBytes(16).toString("base64url")},
  {...f.context,subtask:{...f.context.subtask,
   approved_file_permissions:[{operation:"update_file" as const,path}]}},
  {...f.context,delegation_evidence:{
   ...f.context.delegation_evidence,credential_id:"urn:child:foreign"}}
 ];
 for(const bad of variants)
  await assert.rejects(f.handler(bad as AgentTaskContext),
   /Trusted Backend discovery A2A NO-GO/);
 assert.equal(f.model.observed.length,0);
 assert.deepEqual(f.counts,{adapter:0,prepare:0,execute:0,untrusted:0});
 await f.client.fence(f.pins.runtime_task_id);
});
