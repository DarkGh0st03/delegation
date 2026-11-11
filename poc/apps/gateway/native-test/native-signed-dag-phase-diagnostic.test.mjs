import test from "node:test";
import assert from "node:assert/strict";
import {PREFIX,PHASES,safeNativePhaseFailure,readNativePhaseFailure}
 from "./native-signed-dag-phase-diagnostic.mjs";

test("R246 valid stages carry only trusted error type/category/code",()=>{
 for(const stage of PHASES){
  const error=Object.assign(new TypeError("PRIVATE_BEARER_TEXT"),{
   code:"ERR_INVALID_ARG_TYPE"});
  const observation=safeNativePhaseFailure(error,stage);
  assert.equal(observation.stage,stage);
  assert.equal(observation.kind,"TypeError");
  assert.equal(observation.code,"ERR_INVALID_ARG_TYPE");
  assert.doesNotMatch(JSON.stringify(observation),/PRIVATE_BEARER_TEXT/u);
  const reconstructed=readNativePhaseFailure(
   PREFIX+JSON.stringify(observation)+"\n");
  assert.deepEqual(reconstructed,observation);
 }
});
test("R246 untrusted stage, source path and code cannot escape envelope",()=>{
 const good=safeNativePhaseFailure(Error("private token"),"signed_a2a_dispatch");
 const wrap=x=>PREFIX+JSON.stringify(x)+"\n";
 assert.equal(readNativePhaseFailure(wrap({...good,stage:"private"})),null);
 assert.equal(readNativePhaseFailure(wrap({...good,code:"my-secret"})),null);
 assert.equal(readNativePhaseFailure(wrap({...good,
  assertion_location:{module:"credentials.env",line:1}})),null);
 assert.equal(readNativePhaseFailure(wrap({...good,
  failure_trace:[{category:"unclassified",kind:"Error",
   code:"unknown",site:{module:"secrets.env",line:2}}]})),null);
 assert.equal(readNativePhaseFailure(wrap({...good,extra:"PRIVATE"})).extra,undefined);
});
test("R246 reports exact trusted dispatch category without raw exception",()=>{
 const e=Object.assign(new Error("Trusted dispatch failed; private agent content"),{
  code:"ECONNRESET"});
 const observation=safeNativePhaseFailure(e,"signed_a2a_dispatch");
 assert.equal(observation.category,"a2a_dispatch_failed");
 assert.equal(observation.code,"ECONNRESET");
 assert.doesNotMatch(JSON.stringify(observation),/private agent content/u);
});
