import test from "node:test";
import assert from "node:assert/strict";
import {OfflineApprovedAdkModel} from "./offline-approved-adk-model.mjs";

const branch="feature/account-suspension";
function model(role="test"){
 const calls=[
  {name:"create_file",args:{branch,path:"tests/initial.spec.ts",content:"ok"}},
  {name:"run_tests",args:{branch,profile:"poc-default"}}
 ];
 calls.approved_task_groups=[{task_id:"initial-test",call_count:2}];
 return new OfflineApprovedAdkModel(role,calls);
}
async function next(m){
 const out=[];
 for await(const x of m.generateContentAsync({}))out.push(x);
 return out[0]?.content.parts[0];
}
test("R150.9 fresh D1 test is distinct from the exhausted original Test Task",async()=>{
 const m=model(),params={branch,taskId:"r150-owner-test-fresh"};
 assert.throws(()=>m.armTrustedD1TestRun(params),/cannot reuse/);
 assert.equal((await next(m)).functionCall.name,"create_file");
 assert.equal((await next(m)).functionCall.name,"run_tests");
 assert.throws(()=>m.armTrustedD1TestRun(params),/cannot reuse/);
 assert.match((await next(m)).text,/Completed only this signed Task/);
 m.armTrustedD1TestRun(params);
 assert.deepEqual((await next(m)).functionCall,{
  id:"approved-adk-4",name:"run_tests",
  args:{branch,profile:"poc-default"}
 });
 assert.match((await next(m)).text,/Completed only this signed Task/);
 assert.throws(()=>m.armTrustedD1TestRun(params),/cannot reuse/);
 await assert.rejects(async()=>next(m),/schedule exhausted/);
});
test("R150.9 owner cannot re-arm another role, wrong Task, unsafe branch",async()=>{
 const params={branch,taskId:"r150-owner-test-fresh"};
 const backend=model("backend");
 for(let i=0;i<3;i++)await next(backend);
 assert.throws(()=>backend.armTrustedD1TestRun(params),/cannot reuse/);
 const cases=[
  {...params,taskId:"../unsafe-task"},
  {...params,taskId:"bad task with whitespace"},
  {...params,branch:"main"},
  {...params,branch:"feature/../main"},
  {...params,branch:"feature/"}
 ];
 for(const p of cases){
  const m=model();
  for(let i=0;i<3;i++)await next(m);
  assert.throws(()=>m.armTrustedD1TestRun(p),/cannot reuse/);
 }
});

test("R151.75 real-source Frontend D1 only removes the observed TypeScript fault",async()=>{
 const m=model("frontend"),path="apps/frontend/src/pages/UserDetailPage.tsx";
 const failedSha="a".repeat(40),nextSha="b".repeat(40);
 const arm={branch,path,failedSha,taskId:"frontend-d1-fix"};
 assert.throws(()=>m.armTrustedD1TypecheckRepair(arm),/new signed Task/);
 for(let i=0;i<3;i++)await next(m);
 assert.throws(()=>m.armTrustedD1TypecheckRepair({...arm,path:"../foreign.tsx"}),
  /new signed Task/);
 m.armTrustedD1TypecheckRepair(arm);
 assert.throws(()=>m.armTrustedD1TypecheckRepair(arm),/new signed Task/);
 assert.equal((await next(m)).functionCall.name,"read_file");
 const fault='\nconst __delegation_typecheck_probe: "ACTIVE" | "SUSPENDED" = "SUSPEND";\n';
 const source="export const ui = 1;"+fault;
 const result={contents:[{parts:[{functionResponse:{
  name:"read_file",response:{ok:true,result:{
   provider:"gitea",performed:true,tool:"read_file",
   branch,path,revision:failedSha,content:source
  }}
 }}]}]};
 const change=[];
 for await(const response of m.generateContentAsync(result))
  change.push(response.content.parts[0]);
 assert.equal(change[0].functionCall.name,"update_file");
 assert.equal(change[0].functionCall.args.content,"export const ui = 1;\n");
 const write={contents:[{parts:[{functionResponse:{
  name:"update_file",response:{ok:true,result:{
   provider:"gitea",performed:true,tool:"update_file",
   branch,path,commit_sha:nextSha
  }}
 }}]}]};
 const done=[];
 for await(const response of m.generateContentAsync(write))
  done.push(response.content.parts[0]);
 assert.match(done[0].text,/Frontend D1 updated/);
 assert.throws(()=>m.armTrustedD1TypecheckRepair(arm),/new signed Task/);
});

async function responsePart(m,request){
 const out=[];for await(const r of m.generateContentAsync(request))out.push(r.content.parts[0]);
 return out[0];
}
function readEffect(path,content,revision){return {contents:[{parts:[{functionResponse:{
 name:"read_file",response:{ok:true,result:{provider:"gitea",performed:true,tool:"read_file",
 branch,path,revision,content}}
}}]}]};}
test("Frontend project repair scans authorized failed-SHA source and edits only the observed faulty UI",async()=>{
 const {injectFrontendTestFault,FRONTEND_TEST_ORIGINAL}=await import("./offline-project-test-repair-fixture.mjs");
 const m=model("frontend");for(let i=0;i<3;i++)await next(m);
 const style="apps/frontend/src/styles.css",api="apps/frontend/src/api/users-api.ts",
  ui="apps/frontend/src/pages/UserDetailPage.tsx",failedSha="a".repeat(40);
 const args={branch,path:style,paths:[style,api,ui],failedSha,taskId:"frontend-semantic-new"};
 assert.throws(()=>m.armTrustedD1ProjectTestRepair({...args,paths:[style,"tests/frontend/foreign.test.tsx"]}),/bounded original/);
 m.armTrustedD1ProjectTestRepair(args);
 assert.deepEqual((await next(m)).functionCall.args,{branch,path:style});
 assert.deepEqual((await responsePart(m,readEffect(style,"body { color: black; }",failedSha)))
  .functionCall.args,{branch,path:api});
 assert.deepEqual((await responsePart(m,readEffect(api,"export const api=true;",failedSha)))
  .functionCall.args,{branch,path:ui});
 const source="export const control = "+FRONTEND_TEST_ORIGINAL+";\n";
 const write=(await responsePart(m,readEffect(ui,injectFrontendTestFault(source),failedSha))).functionCall;
 assert.equal(write.name,"update_file");assert.equal(write.args.path,ui);assert.equal(write.args.content,source);
 const done=await responsePart(m,{contents:[{parts:[{functionResponse:{name:"update_file",
  response:{ok:true,result:{provider:"gitea",performed:true,tool:"update_file",branch,path:ui,
   commit_sha:"b".repeat(40)}}}}]}]});
 assert.match(done.text,/Frontend D1 updated/);
 assert.throws(()=>m.armTrustedD1ProjectTestRepair(args),/new signed Task/);
});
test("Frontend project repair refuses wrong role, early reuse and stale source revisions",async()=>{
 const ui="apps/frontend/src/pages/UserDetailPage.tsx",failedSha="a".repeat(40);
 const args={branch,path:ui,paths:[ui],failedSha,taskId:"frontend-semantic-new"};
 for(const role of ["frontend","backend"]){
  const m=model(role);
  assert.throws(()=>m.armTrustedD1ProjectTestRepair(args),/new signed Task/);
  for(let i=0;i<3;i++)await next(m);
  if(role==="backend")assert.throws(()=>m.armTrustedD1ProjectTestRepair(args),/new signed Task/);
  else{m.armTrustedD1ProjectTestRepair(args);await next(m);
   await assert.rejects(responsePart(m,readEffect(ui,"PRIVATE_SOURCE","b".repeat(40))),/pinned TypeScript/);}
 }
});
