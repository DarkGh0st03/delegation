import test from "node:test";
import assert from "node:assert/strict";
import {CryptoWorkerRouter} from "../src/crypto-worker-router.ts";
import {MCP_AUDIENCE,type TaskClaims} from "../src/task-token.ts";
const workers={
 backend:{baseUrl:"http://backend.internal:9000"},
 frontend:{baseUrl:"http://frontend.internal:9001"},
 test:{baseUrl:"http://test.internal:9002"}
};
const claims:TaskClaims={role:"backend",task_id:"signed-1",
 iss:"thesis-agent-backend",aud:MCP_AUDIENCE,
 jti:"0123456789abcdef1234",iat:1000,exp:1300};

test("R181 crypto router exposes no repository/Runner tool methods",()=>{
 const instance=new CryptoWorkerRouter(workers);
 for(const name of ["readFile","updateFile","createFile","runTests"])
  assert.equal(name in instance,false);
 assert.equal(typeof instance.createPresentation,"function");
});

test("R181 crypto router calls ONLY authenticated private VP route",async()=>{
 let url="",body:any,header="";
 const router=new CryptoWorkerRouter(workers,async(path,init)=>{
  url=String(path);
  body=JSON.parse(String(init?.body));
  header=new Headers(init?.headers).get("authorization")??"";
  return new Response(JSON.stringify({ok:true,result:{
   prepared:true,request_id:"req-1",proof_ref:"proof-opaque"
  }}),{status:200});
 });
 assert.deepEqual(await router.createPresentation(claims,"signed-task-token",
  {request_id:"req-1"}),{
   prepared:true,request_id:"req-1",proof_ref:"proof-opaque"
 });
 assert.equal(url,"http://backend.internal:9000/internal/mcp-crypto-call");
 assert.equal(header,"Bearer signed-task-token");
 assert.deepEqual(body,{
  tool:"delegation_create_presentation",
  arguments:{request_id:"req-1"}
 });
});

test("R181 crypto router cannot accept forged scope, file paths or credential selector",async()=>{
 let calls=0;
 const router=new CryptoWorkerRouter(workers,async()=>{
  calls++;return new Response("{}",{status:200});
 });
 for(const args of [
  {request_id:"req-A",operation:"update_file"},
  {request_id:"req-A",credential_id:"urn:somebody-else"},
  {request_id:"../bad"},{tool:"run_tests"},{}
 ])
  await assert.rejects(()=>router.createPresentation(claims,"tok",args),
   /invalid_tool_arguments/);
 assert.equal(calls,0);
});

test("R181 crypto worker denial never exposes provider secrets",async()=>{
 const router=new CryptoWorkerRouter(workers,async()=>new Response(
  JSON.stringify({ok:false,error:{
   kind:"authorization_denied",message:"PRIVATE_ADAPTER_TOKEN"
  }}),{status:403})
 );
 await assert.rejects(()=>router.createPresentation(claims,"tok",
  {request_id:"req-A"}),error=>{
   assert.doesNotMatch(String(error),/PRIVATE_ADAPTER_TOKEN/);
   return /authorization_denied/.test(String(error));
 });
});
