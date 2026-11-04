import test from "node:test";
import assert from "node:assert/strict";
import {runF1OfflinePlanningEntry as run}
 from "./f1-offline-planning-entry-runner.mjs";
import {readNativePhaseFailure,PREFIX}
 from "./native-signed-dag-phase-diagnostic.mjs";

const env=Object.freeze({
 PLANNING_REAL_GITEA_ONLY:"1",
 ENGINEER_CORE_NATIVE_MODE:"1",
 APPROVED_RUNNER_NATIVE_MCP:"1",
 DELEGATION_SIGNED_GEMINI_PILOT:"0",
 GEMINI_API_KEY:""
});

test("R277 an exception before native module try/catch emits only finite phase metadata",async()=>{
 const lines=[],secret="PRIVATE_BEARER_SOURCE_AND_KEY";
 const failure=Object.assign(new TypeError(secret),{code:"ERR_INVALID_ARG_TYPE"});
 const ok=await run({
  env,state:{__nativeDagBootstrapStage:"configuration_validation"},
  load:async()=>{throw failure;},write:line=>lines.push(line)
 });
 assert.equal(ok,false);
 assert.equal(lines.length,1);
 const parsed=readNativePhaseFailure(lines[0]);
 assert.equal(parsed.stage,"configuration_validation");
 assert.equal(parsed.kind,"TypeError");
 assert.equal(parsed.code,"ERR_INVALID_ARG_TYPE");
 assert.doesNotMatch(lines[0],/PRIVATE_BEARER|SOURCE_AND_KEY|secret/u);
 assert.ok(lines[0].startsWith(PREFIX));
});

test("R277 no duplicate report if the child already emitted trusted signed DAG receipt",async()=>{
 const lines=[];
 const ok=await run({
  env,state:{__nativeDagBootstrapStage:"root_issuance",
   __nativeDagPhaseReported:true},
  load:async()=>{throw Error("DO_NOT_LOG_PRIVATE_ERROR");},
  write:x=>lines.push(x)
 });
 assert.equal(ok,false);
 assert.deepEqual(lines,[]);
});

test("R277 invalid native mode or billed model key fails closed before loading",async()=>{
 for(const patch of [
  {ENGINEER_CORE_NATIVE_MODE:"0"},{APPROVED_RUNNER_NATIVE_MCP:"0"},
  {PLANNING_REAL_GITEA_ONLY:"0"},{DELEGATION_SIGNED_GEMINI_PILOT:"1"},
  {GEMINI_API_KEY:"PRIVATE_API_KEY"}
 ]){
  let called=false,lines=[];
  const ok=await run({
   env:{...env,...patch},state:{__nativeDagBootstrapStage:"entrypoint_bootstrap"},
   load:async()=>{called=true;},write:x=>lines.push(x)
  });
  assert.equal(ok,false);
  assert.equal(called,false);
  assert.equal(readNativePhaseFailure(lines[0])?.stage,"entrypoint_bootstrap");
  assert.doesNotMatch(lines[0],/PRIVATE_API_KEY/u);
 }
});

test("R277 successful F1 load preserves zero-billing output and exit semantics",async()=>{
 const lines=[];let called=0;
 assert.equal(await run({
  env,state:{__nativeDagBootstrapStage:"configuration_validation"},
  load:async()=>{called++;},write:x=>lines.push(x)
 }),true);
 assert.equal(called,1);
 assert.deepEqual(lines,[]);
});

test("R277 an early native-addon loader exception retains bounded code and first-party line",async()=>{
 const lines=[];
 const error=Object.assign(new Error("PRIVATE_NATIVE_ADDON_PATH_AND_BEARER"),{
  code:"ERR_DLOPEN_FAILED"
 });
 error.stack="Error: PRIVATE_NATIVE_ADDON_PATH_AND_BEARER\n"+
  "    at load (file:///home/runner/work/delegation/delegation/poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs:451:13)\n";
 const ok=await run({
  env,state:{__nativeDagBootstrapStage:"native_issuer_initialization"},
  load:async()=>{throw error;},write:line=>lines.push(line)
 });
 assert.equal(ok,false);
 const detail=readNativePhaseFailure(lines[0]);
 assert.equal(detail.stage,"native_issuer_initialization");
 assert.equal(detail.code,"ERR_DLOPEN_FAILED");
 assert.deepEqual(detail.assertion_location,
  {module:"native-planning-read-core-evm-e2e.mjs",line:451});
 assert.doesNotMatch(JSON.stringify(detail),
  /PRIVATE_NATIVE|ADDON_PATH|BEARER|home\/runner|file:\/\//u);
});
