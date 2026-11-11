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

test("R268 native Engineer guard rejects missing socket, wrong trust and unconsented paid pilot",()=>{
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
  /NO-GO/u);
 assert.throws(()=>selectNativeOwnerPasses({ENGINEER_CORE_NATIVE_MODE:"legacy"}),
  /Unknown native Engineer owner mode/u);
});

test("R268 only explicitly approved manual native paid owner is selectable, no model call",()=>{
 const env={
  ENGINEER_CORE_NATIVE_MODE:"1",
  ADAPTER_ENGINEER_NATIVE_SOCKET:"/tmp/engineer-r268.sock",
  APPROVED_RUNNER_NATIVE_MCP:"1",
  APPROVED_RUNNER_NATIVE_EVM:"1",
  ADAPTER_TRUST_PROFILE:"evm",GATEWAY_VERIFIER_MODE:"core-rust",
  DELEGATION_SIGNED_GEMINI_PILOT:"1",
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_REF:"refs/heads/refactor/post-prof-plan-contracts-20261021",
  GITHUB_SHA:"a".repeat(40),GITHUB_RUN_ID:"40699999999",
  DELEGATION_PINNED_COMMIT_SHA:"a".repeat(40),
  DELEGATION_BILLING_CAP_ACK:"I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_GEMINI_MODEL:"gemini-3.8-flash",
  DELEGATION_GEMINI_REPAIR_CHARGE_CONFIRMATION:"NO ADDITIONAL REPAIR AUTHORIZED",
  DELEGATION_SIGNED_GEMINI_REPAIR_D1:"0"
 };
 const selected=selectNativeOwnerPasses(env);
 assert.deepEqual(selected,{
  preliminaryReadOnlyProcess:false,signedDagOwnerProcess:true,
  soleEmbeddedRustIssuer:true
 });
 for(const patch of [
  {APPROVED_RUNNER_NATIVE_EVM:"0"},
  {DELEGATION_GEMINI_CHARGE_CONFIRMATION:"not approved"},
  {GITHUB_EVENT_NAME:"push"},
  {DELEGATION_PINNED_COMMIT_SHA:"b".repeat(40)},
  {DELEGATION_SIGNED_GEMINI_REPAIR_D1:"1"}
 ])assert.throws(()=>selectNativeOwnerPasses({...env,...patch}));
});
