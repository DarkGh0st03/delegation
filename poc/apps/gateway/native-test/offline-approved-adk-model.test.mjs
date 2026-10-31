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
