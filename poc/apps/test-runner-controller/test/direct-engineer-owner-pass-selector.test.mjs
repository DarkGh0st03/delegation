import test from "node:test";
import assert from "node:assert/strict";
import {selectNativeOwnerPasses}
 from "../scripts/direct-engineer-owner-pass-selector.mjs";

test("R235 historical signed DAG retains separate preliminary and approved processes",()=>{
 const selected=selectNativeOwnerPasses({});
 assert.deepEqual(selected,{
  preliminaryReadOnlyProcess:true,
  signedDagOwnerProcess:true,
  soleEmbeddedRustIssuer:false
 });
 assert.equal(selectNativeOwnerPasses({ENGINEER_CORE_NATIVE_MODE:"0"})
  .preliminaryReadOnlyProcess,true);
});

test("R235 embedded Engineer issuer runs one signed DAG process per EVM chain",()=>{
 const selected=selectNativeOwnerPasses({
  ENGINEER_CORE_NATIVE_MODE:"1",
  ADAPTER_ENGINEER_NATIVE_SOCKET:"/tmp/engineer-r235.sock",
  APPROVED_RUNNER_NATIVE_MCP:"1",
  ADAPTER_TRUST_PROFILE:"evm",
  GATEWAY_VERIFIER_MODE:"core-rust",
  DELEGATION_SIGNED_GEMINI_PILOT:"0"
 });
 assert.deepEqual(selected,{
  preliminaryReadOnlyProcess:false,
  signedDagOwnerProcess:true,
  soleEmbeddedRustIssuer:true
 });
});

test("R235 owner guard rejects missing native socket, unsafe modes, wrong verifier and paid pilot",()=>{
 const correct={
  ENGINEER_CORE_NATIVE_MODE:"1",
  ADAPTER_ENGINEER_NATIVE_SOCKET:"/tmp/engineer-r235.sock",
  APPROVED_RUNNER_NATIVE_MCP:"1",
  ADAPTER_TRUST_PROFILE:"evm",
  GATEWAY_VERIFIER_MODE:"core-rust"
 };
 for(const override of [
  {ADAPTER_ENGINEER_NATIVE_SOCKET:undefined},
  {ADAPTER_ENGINEER_NATIVE_SOCKET:"relative.sock"},
  {ADAPTER_ENGINEER_NATIVE_SOCKET:" /tmp/a.sock "},
  {ADAPTER_ENGINEER_NATIVE_SOCKET:"/"+"a".repeat(110)},
  {APPROVED_RUNNER_NATIVE_MCP:"0"},
  {ADAPTER_TRUST_PROFILE:"in-memory"},
  {GATEWAY_VERIFIER_MODE:"mock"}
 ]){
  assert.throws(()=>selectNativeOwnerPasses({...correct,...override}),
   /Direct Engineer signed DAG requires sole native issuer/u);
 }
 assert.throws(()=>selectNativeOwnerPasses({...correct,
  DELEGATION_SIGNED_GEMINI_PILOT:"1"}),
  /forbids paid model pilot/u);
 assert.throws(()=>selectNativeOwnerPasses({ENGINEER_CORE_NATIVE_MODE:"legacy"}),
  /Unknown native Engineer owner mode/u);
});
