/**
 * R384.1 — signed owner CREATE FunctionTool gating, OFFLINE ONLY.
 * Actual Rust/EVM/OPA/Gitea/MAC success is separately attested by R384.0.
 * No model inference, provider network or credentials in this test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {GatewayControlledToolClient} from "../src/gateway-tool-client.ts";
import {ControlledToolError} from "../src/controlled-errors.ts";

const branch="feature/account-suspension";
const path="apps/backend/src/users/create-suspension.ts";
const content="export const isSuspended = true;\n";
const commit="a".repeat(40),blob="b".repeat(40);
const args={branch,path,content};
const sha="req-r3841-create";
function nativeEnvironment(t:import("node:test").TestContext){
 const names=["DELEGATION_GATEWAY_ARCHITECTURE","APPROVED_RUNNER_NATIVE_MCP"];
 const original=names.map(n=>process.env[n]);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 t.after(()=>names.forEach((n,i)=>{
  if(original[i]===undefined)delete process.env[n];
  else process.env[n]=original[i];
 }));
}
function fixture(options:{
 role?:"backend"|"frontend"|"test";
 stagedTool?:"create_file"|"update_file"|undefined;
 nativeCrypto?:boolean;
 response?:unknown;
 denyStaging?:boolean;
}={}){
 const calls:string[]=[];
 let attempted=false;
 const result=options.response??{
  request_id:sha,decision:"allow",
  execution:{provider:"gitea",performed:true,tool:"create_file",
   branch,path,revision:commit,commit_sha:commit,blob_sha:blob}
 };
 const config={
  gatewayBaseUrl:"http://r3841-gateway.invalid",
  agentRole:options.role??"backend",taskId:"dispatch_"+"R".repeat(22),
  evidenceHandler:{async createPresentation(){
   throw Error("Legacy signer is forbidden");
  }} as never,
  trustedEffectStager:{
   stagedTool:options.stagedTool??"create_file",
   async stage(id:string){
    calls.push("owner_stage");
    assert.equal(id,sha);
    if(attempted||options.denyStaging)throw Error("private owner declined");
    attempted=true;
    return {provider_write_authorized:false};
   }
  },
  ...(options.nativeCrypto===false?{}:{
   cryptoPresentation:{async createSignedPresentation(prepared:{
    request_id:string;required_permission:{operation:string}
   }){
    calls.push("native_mcp_vp");
    assert.equal(prepared.request_id,sha);
    assert.equal(prepared.required_permission.operation,"create_file");
    return "r3841-opaque-vp";
   }}
  }),
  fetchFn:async(url:URL|string,init?:RequestInit)=>{
   const endpoint=String(url);
   const data=JSON.parse(String(init?.body));
   if(endpoint.endsWith("/prepare")){
    calls.push("gateway_prepare");
    assert.equal(data.task_id,"dispatch_"+"R".repeat(22));
    assert.equal(data.tool,"create_file");
    assert.equal(data.agent_role,options.role??"backend");
    assert.deepEqual(data.arguments,args);
    return Response.json({
     request_id:sha,audience:"cloud-access-gateway",
     challenge:"r3841-challenge",
     expires_at:new Date(Date.now()+60000).toISOString(),
     required_permission:{
      operation:"create_file",resource:
       "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/"+path
     }
    },{status:201});
   }
   assert.ok(endpoint.endsWith("/execute"));
   calls.push("gateway_execute");
   assert.deepEqual(data,{request_id:sha,signed_vp:"r3841-opaque-vp"});
   return Response.json(result);
  }
 };
 return {calls,gateway:new GatewayControlledToolClient(config as never)};
}
test("R384.1 exact Backend native owner stages before MCP VP, then accepts a verified-shape CAS",async t=>{
 nativeEnvironment(t);
 const f=fixture();
 const out=await f.gateway.invoke("create_file",args);
 assert.deepEqual(f.calls,["gateway_prepare","owner_stage",
  "native_mcp_vp","gateway_execute"]);
 assert.deepEqual(out,{provider:"gitea",performed:true,
  tool:"create_file",branch,path,revision:commit,
  commit_sha:commit,blob_sha:blob});
 await assert.rejects(f.gateway.invoke("create_file",args),
  (e:unknown)=>e instanceof ControlledToolError&&
   e.kind==="tool_unavailable"&&e.message==="Trusted effect staging failed");
 assert.deepEqual(f.calls.slice(-2),["gateway_prepare","owner_stage"]);
});
test("R384.1 native owner can stage one exact Frontend CREATE",async t=>{
 nativeEnvironment(t);
 const f=fixture({role:"frontend"});
 const out=await f.gateway.invoke("create_file",args) as {commit_sha:string};
 assert.equal(out.commit_sha,commit);
 assert.deepEqual(f.calls,["gateway_prepare","owner_stage",
  "native_mcp_vp","gateway_execute"]);
});
for(const mode of ["no-mcp","wrong-owner-tool","test-role",
 "not-native-mode","not-native-signer"] as const){
 test("R384.1 "+mode+" denies CREATE before Prepare or any provider",async t=>{
  nativeEnvironment(t);
  const f=fixture({
   ...(mode==="no-mcp"?{nativeCrypto:false}:{}),
   ...(mode==="wrong-owner-tool"?{stagedTool:"update_file" as const}:{}),
   ...(mode==="test-role"?{role:"test" as const}:{})
  });
  if(mode==="not-native-mode")process.env.DELEGATION_GATEWAY_ARCHITECTURE="legacy";
  if(mode==="not-native-signer")process.env.APPROVED_RUNNER_NATIVE_MCP="0";
  await assert.rejects(f.gateway.invoke("create_file",args),
   (e:unknown)=>e instanceof ControlledToolError&&
    e.kind==="authorization_denied");
  assert.deepEqual(f.calls,[]);
 });
}
test("R384.1 create-only Task cannot access UPDATE/READ/Runner tools",async t=>{
 nativeEnvironment(t);
 const f=fixture();
 for(const tool of ["read_file","update_file","run_tests"] as const){
  await assert.rejects(f.gateway.invoke(tool,args),
   (e:unknown)=>e instanceof ControlledToolError&&
    e.kind==="authorization_denied");
 }
 assert.deepEqual(f.calls,[]);
});
for(const variant of ["wrong-path","wrong-branch","wrong-tool",
 "wrong-revision","wrong-blob","wrong-request","absent-allow",
 "missing-provider"] as const){
 test("R384.1 reject unauthenticated create response "+variant,async t=>{
  nativeEnvironment(t);
  const valid={
   request_id:sha,decision:"allow",
   execution:{provider:"gitea",performed:true,tool:"create_file",
    branch,path,revision:commit,commit_sha:commit,blob_sha:blob}
  };
  let response:unknown=valid;
  if(variant==="wrong-request")response={...valid,request_id:"foreign"};
  else if(variant==="absent-allow")response={...valid,decision:"deny"};
  else {
   const e={...valid.execution};
   switch(variant){
    case "wrong-path":e.path="apps/backend/src/other.ts";break;
    case "wrong-branch":e.branch="main";break;
    case "wrong-tool":e.tool="update_file";break;
    case "wrong-revision":e.revision="c".repeat(40);break;
    case "wrong-blob":e.blob_sha="f".repeat(6);break;
    case "missing-provider":e.provider="legacy";break;
   }
   response={...valid,execution:e};
  }
  const f=fixture({response});
  await assert.rejects(f.gateway.invoke("create_file",args),
   (e:unknown)=>e instanceof ControlledToolError&&
    e.kind==="authorization_denied");
  assert.deepEqual(f.calls,["gateway_prepare","owner_stage",
   "native_mcp_vp","gateway_execute"]);
 });
}
