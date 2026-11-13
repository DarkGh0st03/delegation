/**
 * Reads + one create (session s-6268042fdca1): the Test agent reads the
 * component a new test covers and the API it uses, then creates the test.
 * Real ADK agent, A2A handler, owner registry, task-local MCP presentation;
 * the Gateway and the Rust signer are stubbed. Offline, no paid model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {BaseLlm,type BaseLlmConnection,type LlmRequest,type LlmResponse} from "@google/adk";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";
import {TrustedEffectStagingTaskRegistry} from "../src/trusted-effect-staging-task-registry.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";
import type {AgentTaskContext} from "../src/contracts.ts";

const RUNTIME="dispatch_"+"C".repeat(22),PLAN="t-create-page-test",BRANCH="feature/s-search";
const PAGE="apps/frontend/src/pages/UserListPage.tsx",API="apps/frontend/src/api/users-api.ts";
const NEW="tests/frontend/UserListPage.test.tsx";
const CHILD="urn:read-create:test",DID="did:thesis:test-agent";
const SHA="d".repeat(40),COMMIT="e".repeat(40),BLOB="f".repeat(40);
const SOURCE:Record<string,string>={[PAGE]:"export function UserListPage(){}\n",[API]:"export function listUsers(){}\n"};
const CONTENT="import {UserListPage} from '../../apps/frontend/src/pages/UserListPage';\n";
const context=(permissions=[{path:PAGE,operation:"read_file" as const},
 {path:API,operation:"read_file" as const},{path:NEW,operation:"create_file" as const}]):AgentTaskContext=>({
 task_id:"a2a-read-create",context_id:"ctx",role:"test",trusted_gateway_task_id:RUNTIME,
 subtask:{subtask_id:PLAN,branch:BRANCH,instruction:"Create a test for search and department filter",
  relevant_paths:permissions.map(p=>p.path),approved_file_permissions:permissions,approved_run_tests:false},
 delegation_evidence:{credential:"PRIVATE_CHILD",credential_id:CHILD,presenter_id:DID}
});
class ReadsThenCreate extends BaseLlm{
 readonly requests:LlmRequest[]=[];
 constructor(){super({model:"scripted-read-create-no-api"});}
 override async *generateContentAsync(req:LlmRequest):AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  const call=(name:string,args:Record<string,unknown>)=>
   ({content:{role:"model",parts:[{functionCall:{id:"c"+this.requests.length,name,args}}]}});
  const n=this.requests.length;
  if(n===1)yield call("read_file",{branch:BRANCH,path:PAGE});
  else if(n===2)yield call("read_file",{branch:BRANCH,path:API});
  else if(n===3)yield call("create_file",{branch:BRANCH,path:NEW,content:CONTENT});
  else yield {content:{role:"model",parts:[{text:"Created the test from the component and API read."}]}};
 }
 override connect(_r:LlmRequest):Promise<BaseLlmConnection>{return Promise.reject(Error("offline"));}
}
function nativeEnvironment(t:import("node:test").TestContext){
 const keys=["DELEGATION_GATEWAY_ARCHITECTURE","APPROVED_RUNNER_NATIVE_MCP","ADAPTER_ENGINEER_NATIVE_SOCKET"];
 const previous=keys.map(k=>process.env[k]);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="/tmp/read-create-offline-no-socket";
 const original=DelegationEvidenceHandler.prototype.createPresentation;
 DelegationEvidenceHandler.prototype.createPresentation=async()=>"SIGNED_VP";
 t.after(()=>{
  DelegationEvidenceHandler.prototype.createPresentation=original;
  keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});
 });
}
function fixture(){
 const owner:string[]=[],gateway:string[]=[];
 const registry=new TrustedEffectStagingTaskRegistry();
 registry.bindTask({runtimeTaskId:RUNTIME,planTaskId:PLAN,role:"test",branch:BRANCH,
  operation:"read_then_create",path:NEW,childCredentialId:CHILD,presenterId:DID,
  effectStager:{stagedTool:"read_then_create",
   async stage(id:string){owner.push("stage:"+id);return {provider_write_authorized:false};},
   async attest(id:string,tool:string){owner.push("attest:"+tool+":"+id);}}});
 const keys=generateKeyPairSync("ed25519");
 const mcp=new PrivateMcpTaskRegistry({role:"test",
  signingPrivateKeyPem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
  signingPublicKeyPem:keys.publicKey.export({format:"pem",type:"spki"}).toString()});
 const prepared=new Map<string,{tool:string;path:string}>();
 let next=0;
 const model=new ReadsThenCreate();
 const handler=createAdkA2ATaskHandler({model,gatewayBaseUrl:"http://gateway.invalid",
  adapterToken:"OWNER_SIGNER_TOKEN",maxModelTurns:6,scopeModelPaths:true,
  trustedEffectTaskRegistry:registry,mcpTaskRegistry:mcp,nativePresentationTransport:"mcp-stdio",
  fetchFn:(async(url:unknown,options?:RequestInit)=>{
   const u=String(url),body=JSON.parse(String(options?.body));
   if(u.endsWith("/v1/authorization/prepare")){
    const id="req-"+(++next);
    prepared.set(id,{tool:body.tool,path:body.arguments.path});
    gateway.push("prepare:"+body.tool+":"+body.arguments.path);
    return Response.json({request_id:id,audience:"cloud-access-gateway",challenge:"ch-"+id,
     expires_at:new Date(Date.now()+60000).toISOString(),
     required_permission:{resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fs-search/files/"+body.arguments.path,operation:body.tool}},{status:201});
   }
   if(u.endsWith("/v1/authorization/execute")){
    const p=prepared.get(body.request_id)!;
    gateway.push("execute:"+body.request_id);
    return Response.json({request_id:body.request_id,decision:"allow",execution:p.tool==="read_file"
     ?{provider:"gitea",performed:true,tool:"read_file",branch:BRANCH,path:p.path,revision:SHA,content:SOURCE[p.path]}
     :{provider:"gitea",performed:true,tool:"create_file",branch:BRANCH,path:p.path,
       commit_sha:COMMIT,revision:COMMIT,blob_sha:BLOB}});
   }
   throw Error("unexpected offline call "+u);
  }) as typeof fetch});
 return {owner,gateway,handler,model};
}

test("Test agent reads the component and its API, then creates the new test (one Task)",async t=>{
 nativeEnvironment(t);
 const f=fixture();
 const result=await f.handler(context());
 assert.deepEqual(result.files_created,[NEW]);
 assert.deepEqual(result.files_modified,[]);
 assert.equal(result.commit_sha,COMMIT);
 assert.deepEqual(f.gateway,["prepare:read_file:"+PAGE,"execute:req-1",
  "prepare:read_file:"+API,"execute:req-2","prepare:create_file:"+NEW,"execute:req-3"]);
 // Each read staged and attested by the owner, then the create.
 assert.deepEqual(f.owner,["stage:req-1","attest:read_file:req-1","stage:req-2",
  "attest:read_file:req-2","stage:req-3","attest:create_file:req-3"]);
 // The model saw the sources it read (that is the point of the reads).
 assert.match(JSON.stringify(f.model.requests.at(-2)),/export function UserListPage/u);
});

test("reads + create hints must match the owner pins exactly",async t=>{
 nativeEnvironment(t);
 for(const forged of [
  // the new file listed as a read, a missing create, an extra update
  [{path:NEW,operation:"read_file" as const},{path:NEW,operation:"create_file" as const}],
  [{path:PAGE,operation:"read_file" as const},{path:API,operation:"read_file" as const}],
  [{path:PAGE,operation:"read_file" as const},{path:NEW,operation:"create_file" as const},
   {path:PAGE,operation:"update_file" as const}]
 ]){
  const f=fixture();
  await assert.rejects(f.handler(context(forged)),/Trusted ADK effect Task binding NO-GO/u);
  assert.deepEqual(f.gateway,[]);
  assert.equal(f.model.requests.length,0);
 }
});
