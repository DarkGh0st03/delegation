import test from "node:test";
import assert from "node:assert/strict";
import {
  observedA2ACompletion,observedOrchestratorProviderCompletion
} from "../src/trusted-a2a-observer.ts";

const SHA="a".repeat(40);
function result(){
  return {
    role:"backend",task_id:"a2a-backend-task",
    artifact:{
      role:"backend",branch:"feature/approved",revision:SHA,
      commit_sha:SHA,files_modified:["apps/backend/user.ts"],files_created:[],
      test_outcome:"not_run",errors:[],summary:"Validated result"
    }
  };
}
test("trusted A2A result adapter extracts only validated artifact metadata",()=>{
  const r=result();
  const o=observedA2ACompletion(r as any);
  assert.equal(o.source,"trusted_a2a_poll");
  assert.equal(o.state,"completed");
  assert.equal(o.runtime_task_id,r.task_id);
  assert.deepEqual(o.artifact?.files_modified,["apps/backend/user.ts"]);
  r.artifact.files_modified.push("injected-afterwards.ts");
  assert.deepEqual(o.artifact?.files_modified,["apps/backend/user.ts"]);
  assert.ok(!Object.hasOwn(o.artifact!,"summary"));
});
test("invalid result role/ID is not converted to trusted observation",()=>{
  assert.throws(()=>observedA2ACompletion({
    ...result(),role:"test"
  } as any),/requires validated/);
  assert.throws(()=>observedA2ACompletion({
    ...result(),task_id:"../outside"
  } as any),/requires validated/);
  assert.throws(()=>observedOrchestratorProviderCompletion("../escape"),/Invalid/);
  assert.deepEqual(observedOrchestratorProviderCompletion("task-branch"),{
    source:"trusted_orchestrator",runtime_task_id:"task-branch",
    role:"orchestrator",state:"completed"
  });
});
