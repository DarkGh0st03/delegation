import test from "node:test";
import assert from "node:assert/strict";
import {MCP_AUDIENCE,type TaskClaims} from "../src/task-token.ts";
import {TaskRouter} from "../src/task-router.ts";
const workers={backend:{baseUrl:"http://backend.internal:9000"},
  frontend:{baseUrl:"http://frontend.internal:9001"},test:{baseUrl:"http://test.internal:9002"}};
const claims:TaskClaims={role:"backend",task_id:"task-A",iss:"thesis-agent-backend",
  aud:MCP_AUDIENCE,jti:"0123456789abcdef1234",iat:1000,exp:1200};
test("shared MCP dispatches by authenticated role, not model data",async()=>{
  let url="", body:unknown;
  const router=new TaskRouter(workers,async(u,init)=>{
    url=String(u);body=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ok:true,result:{content:"hello"}}),{status:200});
  });
  assert.deepEqual(await router.readFile(claims,"signed-token",{
    branch:"feature/account-suspension",path:"apps/backend/src/users/user.model.ts"
  }),{content:"hello"});
  assert.equal(url,"http://backend.internal:9000/internal/mcp-tool-call");
  assert.deepEqual(Object.keys(body as object).sort(),["arguments","tool"]);
});
test("authority injection never reaches worker",async()=>{
  let calls=0;
  const router=new TaskRouter(workers,async()=>{calls++;throw new Error("unexpected");});
  await assert.rejects(router.readFile(claims,"token",{
    branch:"feature/account-suspension",path:"a.ts",task_id:"task-B"
  }),/invalid_tool_arguments/);
  assert.equal(calls,0);
});
test("worker rejects -> MCP never returns success",async()=>{
  const router=new TaskRouter(workers,async()=>new Response("{}",{status:403}));
  await assert.rejects(router.readFile(claims,"token",{
    branch:"feature/account-suspension",path:"a.ts"
  }),/task_worker_rejected/);
});

test("worker authorization denial stays a safe MCP error category",async()=>{
  const router=new TaskRouter(workers,async()=>new Response(
    JSON.stringify({ok:false,error:{kind:"authorization_denied",message:"should-not-leak"}}),
    {status:403,headers:{"content-type":"application/json"}}));
  await assert.rejects(router.readFile(claims,"token",{
    branch:"feature/account-suspension",path:"a.ts"
  }),/^Error: authorization_denied$/);
});
test("worker errors never forward arbitrary body text",async()=>{
  const router=new TaskRouter(workers,async()=>new Response(
    JSON.stringify({ok:false,error:{kind:"untrusted_detail",message:"secret"}}),
    {status:403,headers:{"content-type":"application/json"}}));
  await assert.rejects(router.readFile(claims,"token",{
    branch:"feature/account-suspension",path:"a.ts"
  }),/^Error: task_worker_rejected$/);
});

test("Runner phase error transport keeps the phase enum but never arbitrary details",async()=>{
  const testClaims={...claims,role:"test" as const};
  const args={branch:"feature/account-suspension",profile:"poc-default"};
  const content="PRIVATE_TYPECHECK_OUTPUT";
  const transport=new TaskRouter(workers,async()=>new Response(JSON.stringify({
    ok:false,error:{kind:"tests_failed",
      details:{first_failed_phase:"typecheck",logs:content,path:content}}
  }),{status:422}));
  await assert.rejects(transport.runTests(testClaims,"token",args),
    (e:unknown)=>e instanceof Error&&
      e.message==="tests_failed:typecheck"&&!e.message.includes(content));
  const invalid=new TaskRouter(workers,async()=>new Response(JSON.stringify({
    ok:false,error:{kind:"tests_failed",
      details:{first_failed_phase:content}}
  }),{status:422}));
  await assert.rejects(invalid.runTests(testClaims,"token",args),
    (e:unknown)=>e instanceof Error&&e.message==="tests_failed");
});
