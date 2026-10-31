import test from "node:test";
import assert from "node:assert/strict";
import {selectSignedNativeD1Tasks,selectSignedNativeMultiD1Tasks} from "./native-owner-d1-task-selection.mjs";

const branchUri="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fdynamic";
const fileUri=branchUri+"/files/apps/backend/src/example.ts";
const digest="a".repeat(64);
function fixture(backendTaskId="fix-arbitrary-837",testTaskId="test-arbitrary-962"){
 return {epoch:2,plan_digest:digest,plan:{
  tasks:[
   {id:backendTaskId,agent_id:"backend",depends_on:[]},
   {id:testTaskId,agent_id:"test",depends_on:[backendTaskId]}
  ],
  requested_permissions:[
   {task_id:backendTaskId,agent_id:"backend",operation:"read_file",resource:fileUri},
   {task_id:backendTaskId,agent_id:"backend",operation:"update_file",resource:fileUri},
   {task_id:testTaskId,agent_id:"test",operation:"run_tests",resource:branchUri}
  ]
 }};
}
function check(epoch){
 return selectSignedNativeD1Tasks({epoch,planDigest:digest,fileUri,branchUri});
}
test("R151.9 derives unpredictable Task IDs from verified signed epoch",()=>{
 const result=check(fixture());
 assert.deepEqual(result,{
  backendTaskId:"fix-arbitrary-837",testTaskId:"test-arbitrary-962"
 });
 assert.equal(Object.isFrozen(result),true);
});
test("R151.9 fails closed on mutated role, dependency, permission, epoch or digest",()=>{
 const mutations=[
  e=>{e.plan.tasks[1].depends_on=[];},
  e=>{e.plan.tasks[0].agent_id="frontend";},
  e=>{e.plan.tasks[1].id=e.plan.tasks[0].id;},
  e=>{e.plan.requested_permissions[1].operation="create_file";},
  e=>{e.plan.requested_permissions[1].resource=branchUri;},
  e=>{e.plan.requested_permissions[2].resource=fileUri;},
  e=>{e.plan.requested_permissions.push(e.plan.requested_permissions[0]);},
  e=>{e.epoch=1;},
  e=>{e.plan_digest="b".repeat(64);},
  e=>{e.plan.tasks.push({id:"extra",agent_id:"backend",depends_on:[]});}
 ];
 for(const modify of mutations){
  const e=fixture();
  modify(e);
  assert.throws(()=>check(e),/R151 signed owner D1 task selection NO-GO/);
 }
});

test("R151.72 derives exact Frontend then Test from signed epoch",()=>{
 const frontFile=branchUri+"/files/apps/frontend/src/App.tsx";
 const epoch=fixture("fix-ui","test-after-ui");
 epoch.plan.tasks[0].agent_id="frontend";
 epoch.plan.requested_permissions[0].agent_id="frontend";
 epoch.plan.requested_permissions[1].agent_id="frontend";
 epoch.plan.requested_permissions[0].resource=frontFile;
 epoch.plan.requested_permissions[1].resource=frontFile;
 assert.deepEqual(selectSignedNativeD1Tasks({
  epoch,planDigest:digest,fileUri:frontFile,branchUri,
  repairRole:"frontend"
 }),{frontendTaskId:"fix-ui",testTaskId:"test-after-ui"});
 assert.throws(()=>selectSignedNativeD1Tasks({
  epoch,planDigest:digest,fileUri:frontFile,branchUri
 }),/R151 signed owner D1 task selection NO-GO/);
});


const frontFile=branchUri+"/files/apps/frontend/src/Users.tsx";
function multiFixture(){
 const p=fixture("backend-real","test-after-repair");
 p.plan.tasks.splice(1,0,{
  id:"frontend-real",agent_id:"frontend",depends_on:["backend-real"]
 });
 p.plan.tasks[2].depends_on=["frontend-real"];
 p.plan.requested_permissions.splice(2,0,
  {task_id:"frontend-real",agent_id:"frontend",resource:frontFile,operation:"read_file"},
  {task_id:"frontend-real",agent_id:"frontend",resource:frontFile,operation:"update_file"}
 );
 return p;
}
function multi(epoch){
 return selectSignedNativeMultiD1Tasks({epoch,planDigest:digest,
  branchUri,originalFilesByRole:{backend:[fileUri],frontend:[frontFile]}});
}
test("R151.74.1 signed owner selects Backend + Frontend + Test DAG with real file permissions",()=>{
 const result=multi(multiFixture());
 assert.deepEqual(result,{
  editingTasks:[
   {taskId:"backend-real",role:"backend",fileUris:[fileUri]},
   {taskId:"frontend-real",role:"frontend",fileUris:[frontFile]}
  ],
  testTaskId:"test-after-repair",
  orderedTaskIds:["backend-real","frontend-real","test-after-repair"]
 });
 assert.ok(Object.isFrozen(result));
 const parallel=multiFixture();
 parallel.plan.tasks[1].depends_on=[];
 parallel.plan.tasks[2].depends_on=["backend-real","frontend-real"];
 assert.deepEqual(multi(parallel).orderedTaskIds,
  ["backend-real","frontend-real","test-after-repair"]);
});
test("R151.74.1 signed owner rejects extra files, mixed roles and broken DAG",()=>{
 const bad=[
  e=>{e.plan.tasks[1].agent_id="backend";},
  e=>{e.plan.tasks[1].id=e.plan.tasks[0].id;},
  e=>{e.plan.tasks[0].depends_on=["frontend-real"];},
  e=>{e.plan.tasks[2].depends_on=["backend-real"];},
  e=>{e.plan.requested_permissions[2].resource=branchUri+"/files/foreign.ts";},
  e=>{e.plan.requested_permissions[3].agent_id="backend";},
  e=>{e.plan.requested_permissions.push(e.plan.requested_permissions[0]);},
  e=>{e.plan.requested_permissions[1].operation="create_file";},
  e=>{e.plan.requested_permissions[4].resource=frontFile;},
  e=>{e.epoch=1;},
  e=>{e.plan_digest="b".repeat(64);}
 ];
 for(const mutate of bad){
  const epoch=multiFixture();mutate(epoch);
  assert.throws(()=>multi(epoch),/R151 signed owner D1 task selection NO-GO/);
 }
});
