import test from "node:test";
import assert from "node:assert/strict";
import {inspectF1RealGiteaPlannerReadiness}
  from "../f1-real-gitea-planner-readiness.mjs";

const SHA="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const BASE="http://127.0.0.1:31315";
const TOKEN="read-only-fixture-token-unique";
const FILES={
  "apps/backend/src/users/user.service.ts":
    "export class UserService { listUsers(){} getUser(id){} }\n",
  "apps/backend/src/users/user.routes.ts":
    'router.get("/", controller.listUsers);\nrouter.get("/:id", controller.getUser);\n',
  "apps/frontend/src/api/users-api.ts":
    "export async function listUsers(){} export async function getUser(){}\n",
  "apps/frontend/src/pages/UserDetailPage.tsx":
    "export function UserDetailPage(){return <section/>;}\n"
};
const json=(result,status=200)=>({
  ok:status===200,status,
  async text(){return JSON.stringify(result);}
});
function fixture({sources=FILES,mainSha=SHA,lastMainSha=mainSha}={}){
  const calls=[];
  let branchCalls=0;
  const fetchFn=async (url,request)=>{
    const location=new URL(url);
    const api="/api/v1/repos/thesis/iam-console-poc";
    assert.equal(location.origin,BASE);
    assert.equal(request.method,"GET");
    assert.equal(request.headers.authorization,"token "+TOKEN);
    calls.push({pathname:location.pathname,ref:location.searchParams.get("ref")});
    if(location.pathname===api&&!location.search)
      return json({owner:{login:"thesis"},name:"iam-console-poc",
        full_name:"thesis/iam-console-poc",default_branch:"main"});
    if(location.pathname===api+"/branches/main"){
      branchCalls++;
      return json({name:"main",commit:{id:branchCalls===1?mainSha:lastMainSha}});
    }
    const prefix=api+"/contents/";
    assert.ok(location.pathname.startsWith(prefix));
    const path=decodeURIComponent(location.pathname.slice(prefix.length));
    assert.equal(location.searchParams.get("ref"),SHA);
    if(!Object.hasOwn(sources,path))return json({message:"not found"},404);
    const content=sources[path];
    return json({type:"file",path,encoding:"base64",
      content:Buffer.from(content).toString("base64"),
      sha:"b".repeat(40),size:Buffer.byteLength(content)});
  };
  return {
    calls,read:()=>inspectF1RealGiteaPlannerReadiness({
      baseUrl:BASE,readToken:TOKEN,expectedMainSha:SHA,fetchFn
    })
  };
}
test("F1 verifies genuine Gitea read API shapes, original main SHA and four unsolved files",async()=>{
  const f=fixture();
  const report=await f.read();
  assert.equal(report.status,"unsolved_pinned_real_gitea_baseline_verified");
  assert.equal(report.base_revision,SHA);
  assert.equal(report.verified_source_files,4);
  assert.equal(report.novel_unsolved_requirement,true);
  assert.equal(report.provider_model_inference_calls,0);
  assert.equal(report.executable_gemini_plan_produced,false);
  assert.equal(report.external_r5_go,false);
  assert.deepEqual(f.calls.map(x=>x.pathname.includes("/contents/")?
    "read_file":x.pathname.endsWith("/branches/main")?"get_branch":"get_repo"),[
      "get_repo","get_branch","read_file","read_file",
      "read_file","read_file","get_branch"
    ]);
  assert.equal(JSON.stringify(report).includes("UserService"),false);
  assert.equal(JSON.stringify(report).includes(TOKEN),false);
});
test("F1 declines source revision change before or during Planning",async()=>{
  for(const f of [
    fixture({mainSha:"a".repeat(40)}),
    fixture({lastMainSha:"a".repeat(40)})
  ])await assert.rejects(f.read(),/NO-GO/);
});
test("F1 rejects source already containing department search, even when SHA is correct",async()=>{
  const mutations=[
    {file:"apps/backend/src/users/user.service.ts",code:"listUsersByDepartment("},
    {file:"apps/backend/src/users/user.routes.ts",code:"by-department"},
    {file:"apps/frontend/src/api/users-api.ts",code:"listUsersByDepartment"},
    {file:"apps/frontend/src/pages/UserDetailPage.tsx",code:"Department directory"}
  ];
  for(const {file,code} of mutations){
    const sources={...FILES,[file]:FILES[file]+"\n"+code};
    await assert.rejects(fixture({sources}).read(),/NO-GO/);
  }
});
test("F1 refuses unknown file, remote origin and missing out-of-band Gitea SHA",async()=>{
  await assert.rejects(fixture({sources:{
    ...FILES,"apps/frontend/src/api/users-api.ts":undefined
  }}).read(),/NO-GO|unbounded/);
  for(const invalid of [
    {baseUrl:"https://gitea.example.org"},
    {baseUrl:"http://127.0.0.1:0"},
    {expectedMainSha:"current-main"},
    {readToken:"short"}
  ]){
    let called=0;
    await assert.rejects(inspectF1RealGiteaPlannerReadiness({
      baseUrl:BASE,expectedMainSha:SHA,readToken:TOKEN,
      ...invalid,fetchFn:async()=>{called++;throw Error("MUST NOT CALL");}
    }),/NO-GO/);
    assert.equal(called,0);
  }
});
