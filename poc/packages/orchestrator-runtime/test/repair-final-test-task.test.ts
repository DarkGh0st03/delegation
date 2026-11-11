import test from "node:test";
import assert from "node:assert/strict";
import {finalRepairTestTask as select} from "../src/repair-final-test-task.ts";
const uri="gitea://gitea.local/owner/repo/branches/feature%2Frepair";
const plan=()=>({tasks:[
 {id:"edit",agent_id:"test",depends_on:[]},
 {id:"verify",agent_id:"test",depends_on:["edit"]}],
 requested_permissions:[
 {task_id:"edit",agent_id:"test",operation:"read_file",resource:uri+"/files/tests/generated.test.ts"},
 {task_id:"edit",agent_id:"test",operation:"update_file",resource:uri+"/files/tests/generated.test.ts"},
 {task_id:"verify",agent_id:"test",operation:"run_tests",resource:uri}]});
test("Test editor and final Test are selected by signed permissions",()=>{
 assert.equal(select(plan(),uri),"verify");
 const p=plan();p.tasks[0].agent_id="backend";
 for(const g of p.requested_permissions.filter(g=>g.task_id==="edit"))g.agent_id="backend";
 assert.equal(select(p,uri),"verify");
});
test("Final acceptance rejects ambiguous Runner, writes on validator, missing dependency and cycles",()=>{
 for(const mutate of [
  p=>p.tasks[1].depends_on=[],
  p=>p.tasks[0].depends_on=["verify"],
  p=>p.tasks[1].depends_on=["foreign"],
  p=>p.requested_permissions.push({...p.requested_permissions[2],task_id:"edit"}),
  p=>p.requested_permissions.push({...p.requested_permissions[0],task_id:"verify"}),
  p=>p.requested_permissions[2].resource=uri+"-other",
  p=>p.tasks.push({id:"unverified-edit",agent_id:"backend",depends_on:[]}),
  p=>p.tasks.push({...p.tasks[0]})
 ]){const p=plan();mutate(p);assert.throws(()=>select(p,uri),/final run-only Test/);}
});
