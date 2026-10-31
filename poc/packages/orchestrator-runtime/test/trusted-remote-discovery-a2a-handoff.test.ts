import assert from "node:assert/strict";
import test from "node:test";
import {TaskState,type Task} from "@a2a-js/sdk";
import {validateTrustedDiscoveryA2AArtifact} from
 "../src/trusted-remote-discovery-a2a-handoff.ts";

const branch="feature/invoice-approval",tested_commit_sha="a".repeat(40);
const pins={branch,tested_commit_sha};
const good={
 role:"backend",summary:"Backend read completed through trusted Gateway",
 files_modified:[],files_created:[],branch,
 revision:tested_commit_sha,commit_sha:tested_commit_sha,
 test_outcome:"not_run",errors:[]
};
function fixture(value:unknown=good){
 return {
  card:{name:"Backend Agent"},
  task:{
   id:"remote-a2a-discovery-read",
   status:{state:TaskState.TASK_STATE_COMPLETED},
   artifacts:[{parts:[{content:{$case:"data",value}}]}]
  } as unknown as Task
 };
}
test("R151.38.1 source-free Backend A2A receipt matches exactly failed SHA",()=>{
 const a=validateTrustedDiscoveryA2AArtifact(fixture(),pins);
 assert.equal(a.revision,tested_commit_sha);
 assert.equal(a.test_outcome,"not_run");
 assert.deepEqual(a.files_modified,[]);
 assert.ok(Object.isFrozen(a));
 assert.deepEqual(Object.keys(a).filter(k=>/token|vp|source/i.test(k)),[]);
});
test("R151.38.1 malformed, incomplete or claimed Test PASS never yields read receipt",()=>{
 const bad=[
  {card:{name:""},task:fixture().task},
  {...fixture(),task:{...fixture().task,id:"invalid/id"}},
  {...fixture(),task:{...fixture().task,status:{state:TaskState.TASK_STATE_FAILED}}},
  {...fixture(),task:{...fixture().task,artifacts:[]}},
  {...fixture(),task:{...fixture().task,artifacts:[
   ...fixture().task.artifacts,...fixture().task.artifacts]}},
  {...fixture(),task:{...fixture().task,artifacts:[{
   parts:[{content:{$case:"text",value:"untrusted"}}]
  }]}},
  {...fixture(),task:{...fixture().task,artifacts:[{
   parts:[{content:{$case:"data",value:good}},
    {content:{$case:"text",value:"secret"}}]
  }]}},
  fixture({...good,branch:"feature/foreign"}),
  fixture({...good,revision:"b".repeat(40),commit_sha:"b".repeat(40)}),
  fixture({...good,test_outcome:"pass"}),
  fixture({...good,files_modified:["src/invoices.ts"]}),
  fixture({...good,files_created:["src/extra.ts"]}),
  fixture({...good,tested_commit_sha:tested_commit_sha}),
  fixture({...good,errors:["agent failed"]})
 ];
 for(const output of bad)
  assert.throws(()=>validateTrustedDiscoveryA2AArtifact(
   output as ReturnType<typeof fixture>,pins));
});
test("R151.38.1 changing expected failed Runner SHA cannot launder a successful Task",()=>{
 assert.throws(()=>validateTrustedDiscoveryA2AArtifact(fixture(),{
  ...pins,tested_commit_sha:"b".repeat(40)
 }),/pure read of failed SHA/);
 assert.throws(()=>validateTrustedDiscoveryA2AArtifact(fixture(),{
  ...pins,tested_commit_sha:"malformed"
 }),/pure read of failed SHA/);
});
