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
