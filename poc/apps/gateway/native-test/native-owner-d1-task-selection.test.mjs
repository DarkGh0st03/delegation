import test from "node:test";
import assert from "node:assert/strict";
import {selectSignedNativeD1Tasks} from "./native-owner-d1-task-selection.mjs";

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
