import test from "node:test";
import assert from "node:assert/strict";
import {classifyApprovedDagFailure as classify} from "./native-approved-dag-failure-category.mjs";
test("remote A2A failure is distinct from missing Artifact without leaking IDs",()=>{
  const id="PRIVATE_TASK_ID";
  assert.equal(classify(Error("Remote A2A Task "+id+" is not completed")),"a2a_task_not_completed");
  assert.equal(classify(Error("Remote A2A Task "+id+" must return exactly one Artifact")),"a2a_artifact_invalid");
  assert.equal(classify(Error("Remote A2A Artifact must contain exactly one JSON data part")),"a2a_artifact_invalid");
  assert.ok(!classify(Error("Remote A2A Task "+id+" is not completed")).includes(id));
});
test("distinguish controlled-tool, revision, model and denied operations",()=>{
  assert.equal(classify(Error("ADK controlled task failed: x")),"controlled_tool_failure");
  assert.equal(classify(Error("ADK task produced no confirmed repository revision")),"no_confirmed_revision");
  assert.equal(classify(Error("ADK protected model failure: x")),"adk_model_failure");
  assert.equal(classify({code:"approved_plan_denied"}),"approved_plan_denied");
});
test("unknown text and newline injection are never exported",()=>{
  assert.equal(classify(Error("PRIVATE_MODEL_OUTPUT")),"unclassified");
  assert.equal(classify({message:"Remote A2A Task\nsecret is not completed"}),"unclassified");
  assert.equal(classify(null),"unclassified");
});
