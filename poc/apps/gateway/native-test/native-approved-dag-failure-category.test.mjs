import test from "node:test";
import assert from "node:assert/strict";
import {classifyApprovedDagFailure as classify,safeApprovedDagFailureTrace} from "./native-approved-dag-failure-category.mjs";
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

test("R116 error trace exposes only allowlisted first-party callsite and no secret text",()=>{
 const inner=Error("PRIVATE_MODEL_OUTPUT token abc123");
 inner.stack="Error: PRIVATE_MODEL_OUTPUT\n    at task (file:///home/ci/repo/poc/packages/agent-runtime/src/adk-a2a-handler.ts:414:22)\n    at processTicks (node:internal/process/task_queues:95:5)";
 const outer=new Error("opaque provider token", {cause:inner});
 outer.stack="Error: PRIVATE_TOKEN\n    at bad (file:///home/ci/repo/poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs:798:20)";
 const trace=safeApprovedDagFailureTrace(outer);
 assert.equal(trace.length,2);
 assert.deepEqual(trace[0].site,
  {module:"native-approved-planner-dag-positive.mjs",line:798});
 assert.deepEqual(trace[1].site,
  {module:"adk-a2a-handler.ts",line:414});
 assert.equal(trace[1].kind,"Error");
 assert.equal(trace[1].category,"unclassified");
 assert.equal(JSON.stringify(trace).includes("PRIVATE_"),false);
 assert.equal(JSON.stringify(trace).includes("abc123"),false);
 assert.equal(JSON.stringify(trace).includes("/home/"),false);
});
test("R116 ignores third-party and injected stack filenames, and bounds cyclic causes",()=>{
 const e=Error("unknown");
 e.stack="Error: unknown\n    at handler (file:///tmp/evil/poc/apps/gateway/native-test/evil.ts:44:3)\n    at handler (node_modules/model-sdk/consumer.ts:50:3)";
 e.cause=e;
 const trace=safeApprovedDagFailureTrace(e);
 assert.equal(trace.length,1);
 assert.equal(trace[0].site,null);
 assert.equal(trace[0].code,"unknown");
 assert.equal(trace[0].category,"unclassified");
 const injected=Error("test");
 injected.stack="Error: fake\n  at eval (model_output.js:1:1)";
 assert.equal(safeApprovedDagFailureTrace(injected)[0].site,null);
});

test("R116 genuine Docker FAIL ends A2A Task without a false success",()=>{
 assert.equal(classify(Error("Protected A2A task ended without completion")),
  "a2a_task_not_completed");
 assert.equal(classify(Error("Private source failure / credential payload")),
  "unclassified");
});
