import test from "node:test";
import assert from "node:assert/strict";
import {planDigest} from "../src/plan.mjs";
import {preflightNextOperationalEpoch as preflight} from "../src/operational-epoch-scope.mjs";

const repository={authority:"gitea.local",owner:"sample",repository:"invoice-service"};
const rootUri="gitea://gitea.local/sample/invoice-service";
const branchUri=rootUri+"/branches/feature%2Finvoice-review";
const file=branchUri+"/files/src/invoice.ts";
const ops=new Set(["read_file","update_file","run_tests","delete_file"]);
const SHA="a".repeat(40);
const registry=[
 {agent_id:"backend",did:"did:example:backend",card_ref:"trusted:backend"},
 {agent_id:"frontend",did:"did:example:frontend",card_ref:"trusted:frontend"},
 {agent_id:"test",did:"did:example:test",card_ref:"trusted:test"}
];
function plan(planId,version,role,taskId,operation="update_file",resource=file){
 return {schema_version:"1.0.0",plan_id:planId,session_id:"s1",version,
  repository:{...repository},base_revision:SHA,requirement:"Maintain invoice service",
  candidate_agents:[{...registry.find(a=>a.agent_id===role)}],
  tasks:[{id:taskId,agent_id:role,title:"Work",description:"Implement or test",
    depends_on:[],resources:[resource]}],
  requested_permissions:[{id:"perm-"+taskId,task_id:taskId,agent_id:role,
    resource,operation,reason:"Scoped task"}],assumptions:[],uncertainties:[]
 };
}
const original=plan("initial",1,"backend","backend-original");
const parent={
 credential_id:"issued-rust-root",plan_digest:planDigest(original),
 permissions:[{resource:file,operation:"read_file"},
   {resource:file,operation:"update_file"},
   {resource:branchUri,operation:"run_tests"}]
};
function args(candidate,previous=original){
 return {originalSignedPlan:original,previousEpochPlan:previous,candidatePlan:candidate,
  operationalRoot:parent,pinnedAgentRegistry:registry,
  priorPlanIds:previous===original?["initial"]:["initial",previous.plan_id],
  priorTaskIds:previous===original?["backend-original"]:
   ["backend-original",previous.tasks[0].id]};
}
const check=x=>preflight(x,{allowedOperations:ops});

test("same issued parent admits backend/other-role and subsequent Test repair epoch",()=>{
 const repair=plan("repair-2",2,"frontend","frontend-repair");
 const one=check(args(repair));
 assert.equal(one.new_epoch_version,2);
 assert.equal(one.execution_authorized,false);
 assert.equal(one.child_credential_issued,false);
 assert.equal(one.parent_credential_id,parent.credential_id);
 const testPlan=plan("test-3",3,"test","test-again","run_tests",branchUri);
 const two=check(args(testPlan,repair));
 assert.equal(two.new_epoch_version,3);
 assert.notEqual(one.candidate_plan_digest,two.candidate_plan_digest);
});
test("denies escalation not in issued root, repo change and branch change",()=>{
 const repair=plan("repair-2",2,"backend","backend-repair");
 const bigger=structuredClone(repair);
 bigger.requested_permissions[0].operation="delete_file";
 assert.throws(()=>check(args(bigger)),/outside actually issued root/);
 const repo=structuredClone(repair);repo.repository.repository="different";
 assert.throws(()=>check(args(repo)),/repository changed/);
 const branch=structuredClone(repair);
 const other=rootUri+"/branches/feature%2Fother/files/src/invoice.ts";
 branch.requested_permissions[0].resource=other;branch.tasks[0].resources=[other];
 assert.throws(()=>check(args(branch)),/working branch changed/);
});
test("denies wrong root, missing pairs, invalid registry and stale epoch",()=>{
 const repair=plan("repair-2",2,"backend","backend-repair");
 assert.throws(()=>check({...args(repair),operationalRoot:{
   ...parent,plan_digest:"b".repeat(64)}}),/root does not match/);
 assert.throws(()=>check({...args(repair),operationalRoot:{
   ...parent,permissions:[{resource:branchUri,operation:"run_tests"}]}}),/outside actually issued root/);
 const invalid=structuredClone(repair);
 invalid.candidate_agents[0].did="did:example:attacker";
 assert.throws(()=>check(args(invalid)),/Agent identity/);
 const stale=structuredClone(repair);stale.version=4;
 assert.throws(()=>check(args(stale)),/advance one version/);
});
test("denies replayed Task ID, replayed plan, untrusted Task history",()=>{
 const repair=plan("repair-2",2,"backend","backend-repair");
 const replay=structuredClone(repair);
 replay.tasks[0].id="backend-original";
 replay.requested_permissions[0].task_id="backend-original";
 assert.throws(()=>check(args(replay)),/replay/);
 assert.throws(()=>check({...args(repair),priorTaskIds:[]}),/history/);
 assert.throws(()=>check({...args(repair),priorPlanIds:[]}),/history/);
 const duplicate=structuredClone(parent);
 duplicate.permissions=[...parent.permissions,parent.permissions[0]];
 assert.throws(()=>check({...args(repair),operationalRoot:duplicate}),/duplicate/);
});
