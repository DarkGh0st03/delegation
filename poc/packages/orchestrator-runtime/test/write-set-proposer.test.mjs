/**
 * Phase W (W3): the REAL adaptive ADK decision proposer with the trusted
 * owner option batchWrites (never model-selected). No model billing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {SAMPLE_TEST_SOURCES} from "../../plan-contracts/test/fixtures/test-sources.mjs";
import {TrustedAuthorityOnlyAdkDecisionProposer as Proposer}
 from "../src/trusted-authority-only-adk-decision-proposer.mjs";

const branch="feature/sample-change";
const root="gitea://gitea.local/thesis/sample-app/branches/feature%2Fsample-change";
const F=root+"/files/";
const p=(operation,path)=>({resource:F+path,operation});
const A="apps/backend/a.ts",B="apps/backend/b.ts",N="apps/backend/n.ts";
const commit="a".repeat(40);
class OneChoice extends BaseLlm{
 constructor(choice){super({model:"phase-w-scripted-proposer"});this.choice=choice;this.calls=0;}
 async *generateContentAsync(request){
  this.calls++;this.prompt=JSON.stringify(request);
  yield {content:{role:"model",parts:[{text:JSON.stringify(this.choice)}]}};
 }
 connect(){throw Error("No external model connections");}
}
const writeSet=[p("read_file",A),p("read_file",B),p("update_file",A),p("update_file",B),p("create_file",N)];
const delegate=(permissions,task_id="w3-backend-write-set")=>({action:"delegate",task:{task_id,
 agent_id:"backend",depends_on:["w3-root-branch"],permissions,instruction:"Implement the change in all approved files"}});
function config(choice,{batchWrites,completed="create_branch"}={}){
 const previousTasks=[{task_id:"w3-root-branch",agent_id:"orchestrator"}];
 const completed_work=[{task_id:"w3-root-branch",agent_id:"orchestrator",operation:"create_branch",
  instruction:"Independently completed signed Task"}];
 if(completed==="write_set"){
  previousTasks.push({task_id:"w3-prior-write-set",agent_id:"backend"});
  completed_work.push({task_id:"w3-prior-write-set",agent_id:"backend",operation:"write_set",
   instruction:"Independently completed signed Task"});
 }
 return {model:new OneChoice(choice),requirement:"Ledger: record each change",branch,
  rootPermissions:[...writeSet,{resource:root,operation:"run_tests"}],
  agents:{orchestrator:{capabilities:["create_branch"]},
   backend:{capabilities:["read_file","update_file","create_file"]},
   test:{capabilities:["read_file","update_file","create_file","run_tests"]}},
  previousTasks,nextEpoch:previousTasks.length+1,decisionKind:"adaptive",
  executionProgress:{current_head_sha:commit,completed_work},
  projectTestSourceProfile:SAMPLE_TEST_SOURCES,maxVerifiedFailures:2,
  ...(batchWrites===undefined?{}:{batchWrites})};
}

test("W3 proposer: a write-set Task is accepted only with the owner option batchWrites",async()=>{
 const choice=delegate(writeSet);
 const on=config(choice,{batchWrites:true});
 assert.deepEqual(await new Proposer(on).propose(),choice);
 assert.equal(on.model.calls,1);
 for(const batchWrites of [false,undefined])
  await assert.rejects(new Proposer(config(choice,{batchWrites})).propose(),/model Task choice denied/u);
 assert.throws(()=>new Proposer(config(choice,{batchWrites:"yes"})),/model Task choice denied/u);
});

test("W3 proposer: write-set shape is enforced (update of an unread file, foreign pair)",async()=>{
 await assert.rejects(new Proposer(config(delegate([p("read_file",A),p("update_file",A),
  p("update_file",B)]),{batchWrites:true})).propose(),/model Task choice denied/u);
 await assert.rejects(new Proposer(config(delegate([...writeSet,p("create_file","apps/backend/x.ts")]),
  {batchWrites:true})).propose(),/model Task choice denied/u);
});

test("W3 proposer: a completed write-set Task is accepted as progress only with batchWrites",async()=>{
 const next={action:"delegate",task:{task_id:"w3-test-run",agent_id:"test",depends_on:["w3-prior-write-set"],
  permissions:[{resource:root,operation:"run_tests"}],instruction:"Run the project tests on the latest HEAD"}};
 assert.doesNotThrow(()=>new Proposer(config(next,{batchWrites:true,completed:"write_set"})));
 assert.throws(()=>new Proposer(config(next,{batchWrites:false,completed:"write_set"})),
  /model Task choice denied/u);
});

test("W3 proposer: the generic workflow keeps one edited file per Task unless batchWrites is on",async()=>{
 const choice=delegate(writeSet);
 const on=config(choice,{batchWrites:true});await new Proposer(on).propose();
 assert.match(on.model.prompt,/one specialist step per Task/u);
 assert.doesNotMatch(on.model.prompt,/implement the requirement, one edited file per Task/u);
 assert.match(on.model.prompt,/WRITE-SET \(enabled\)/u);
 const one=delegate([p("read_file",A),p("update_file",A)]);
 const off=config(one,{batchWrites:false});await new Proposer(off).propose();
 assert.match(off.model.prompt,/implement the requirement, one edited file per Task/u);
 assert.doesNotMatch(off.model.prompt,/WRITE-SET|one specialist step per Task/u);
});
