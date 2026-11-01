import test from "node:test";
import assert from "node:assert/strict";
import {verifyD1EditorRevision as verify} from "./d1-editor-revision.mjs";
const a="a".repeat(40),b="b".repeat(40),c="c".repeat(40);
function fixture(role="backend",before=a,after=b){
 const task={task_id:role+"-repair",role,runtime_task_id:"runtime-"+role,credential_id:"dc-"+role};
 const binding={taskId:task.task_id,runtimeTaskId:task.runtime_task_id,credentialId:task.credential_id,failedSha:before,paths:["source.ts"]};
 const write={...binding,role,operation:"update_file",branch:"feature/repair",path:"source.ts",commitSha:after,sequence:1};
 return {task,binding,writes:[write],branch:write.branch,previousSha:before,headSha:after};
}
test("D1 read-only completion and unrelated writes cannot authorize next Test",()=>{
 const f=fixture();
 for(const writes of [[],[{...f.writes[0],taskId:"other"}]])
  assert.throws(()=>verify({...f,writes}),/no_confirmed_editor_write/);
 // Old head-only assertion would accept this unrelated advance.
 assert.notEqual(f.headSha,f.previousSha);
});
test("D1 provider-confirmed commit must equal HEAD and advance previous revision",()=>{
 const f=fixture();assert.equal(verify(f),b);
 assert.throws(()=>verify({...f,headSha:c}),/provider_head_mismatch/);
 assert.throws(()=>verify(fixture("backend",a,a)),/unchanged_editor_revision/);
});
test("Backend then Frontend pass final provider revision to Test",()=>{
 const backend=fixture();const first=verify(backend);
 const frontend=fixture("frontend",first,c);
 const final=verify({...frontend,writes:[...backend.writes,...frontend.writes]});
 assert.equal(frontend.binding.failedSha,b);assert.equal(final,c);
 assert.throws(()=>verify({...frontend,previousSha:a}),/revision_baseline_mismatch/);
});
test("foreign branch runtime credential and role never count as current editor effect",()=>{
 const f=fixture();
 for(const patch of [{branch:"feature/foreign"},{runtimeTaskId:"other"},{credentialId:"other"},{role:"frontend"},{path:"foreign.ts"}])
  assert.throws(()=>verify({...f,writes:[{...f.writes[0],...patch}]}),/editor_effect_binding_mismatch/);
});
test("multiple writes use last observed provider commit, not map insertion order",()=>{
 const f=fixture();
 assert.equal(verify({...f,headSha:c,writes:[{...f.writes[0],commitSha:c,sequence:3},f.writes[0]]}),c);
});
