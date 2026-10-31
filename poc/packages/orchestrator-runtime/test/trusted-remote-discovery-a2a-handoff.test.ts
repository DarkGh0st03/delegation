import assert from "node:assert/strict";
import test from "node:test";
import {TaskState,type Task} from "@a2a-js/sdk";
import {createHash} from "node:crypto";
import {validateTrustedDiscoveryA2AArtifact,
 verifyPrivateBackendDiscoverySource} from
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

test("R151.48.2 only private HMAC source matching the independent Gateway ledger can enter repair",()=>{
 const content="export function invoice():number{return 42;}\n";
 const sha256=createHash("sha256").update(content).digest("hex");
 const source={
  status:"private_backend_read_source_not_authority",task_id:undefined,
  runtime_task_id:"dispatch_"+Buffer.alloc(16,7).toString("base64url"),
  resource:"gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts",
  branch,path:"src/invoices.ts",revision:tested_commit_sha,
  bytes:Buffer.byteLength(content,"utf8"),sha256,content
 };
 delete (source as {task_id?:unknown}).task_id;
 const pins={task_id:"r151-remote-child-task",
  runtime_task_id:source.runtime_task_id,
  resource:source.resource,branch:source.branch,path:source.path,
  revision:source.revision};
 const ledger={source_sha256:sha256,source_bytes:source.bytes};
 assert.equal(verifyPrivateBackendDiscoverySource(source,ledger,pins),content);
 for(const modified of [
  {...source,content:content+"// changed"},
  {...source,resource:source.resource+"-other"},
  {...source,runtime_task_id:"dispatch_"+Buffer.alloc(16,8).toString("base64url")},
  {...source,revision:"b".repeat(40)},
  {...source,branch:"feature/foreign"},
  {...source,path:"src/secret.ts"},
  {...source,bytes:source.bytes+1},
  {...source,sha256:"b".repeat(64)},
  {...source,content:"x".repeat(32769),bytes:32769},
  {...source,content:content+"\0"}
 ]){
  assert.throws(()=>verifyPrivateBackendDiscoverySource(modified,ledger,pins),
   /Trusted remote discovery A2A NO-GO/);
 }
 assert.throws(()=>verifyPrivateBackendDiscoverySource(source,{
  ...ledger,source_sha256:"b".repeat(64)
 },pins),/does not match real Gateway/);
 assert.throws(()=>verifyPrivateBackendDiscoverySource(source,{
  ...ledger,source_bytes:source.bytes+1
 },pins),/does not match real Gateway/);
 assert.throws(()=>verifyPrivateBackendDiscoverySource({
  ...source,private_token:"do-not-export"
 },ledger,pins),/cannot be bound/);
});
