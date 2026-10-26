import test from "node:test";
import assert from "node:assert/strict";
import {bindProtectedGeminiApprovedExecution}
  from "../src/trusted-gemini-execution-binding.mjs";

const ROLES=["backend","frontend","test"];
function fixture(){
  const gateway=Object.freeze({
    gatewayBaseUrl:"http://127.0.0.1:8091",
    adapterBaseUrl:"http://127.0.0.1:8092",
    adapterToken:"owner-original-adapter-token"
  });
  const planning=Object.freeze({gateway});
  const input={
    runId:"40350000000",
    operationalRoot:{
      credential_id:"urn:trusted:operational",
      valid_from:"2026-10-26T00:00:00.000Z",
      validity_seconds:900,
      credential_status:{
        type:"BitstringStatusListEntry",
        statusPurpose:"revocation",
        statusListIndex:"87",
        statusListCredential:"https://example.invalid/status"
      }
    },
    ports:{backend:8101,frontend:8102,test:8103},
    transports:Object.fromEntries(ROLES.map((role,i)=>[
      role,{
        gatewayBaseUrl:gateway.gatewayBaseUrl,
        adapterBaseUrl:gateway.adapterBaseUrl,
        adapterToken:"original-role-only-token-"+i
      }
    ])),
    sendProtectedTask:async()=>({status:"not_called"}),
    childStatusProvisioning:{
      reservationDirectory:"/home/private/child-index",
      statusListCredential:"https://example.invalid/children",
      indexByTask:{branch:11,backend:12,frontend:13,test:14,pr:15},
      excludedIndices:[1,2,3]
    }
  };
  return {planning,input};
}
test("paid Gemini owner binding copies only original localhost Gateway and unique role transports",()=>{
  const {planning,input}=fixture();
  const bound=bindProtectedGeminiApprovedExecution(planning,input);
  assert.equal(bound.runId,input.runId);
  assert.equal(bound.privateGatewayTransport.gatewayBaseUrl,
    planning.gateway.gatewayBaseUrl);
  assert.equal(bound.privateGatewayTransport.adapterToken,
    planning.gateway.adapterToken);
  assert.equal(bound.execution.adapter.bearerToken,
    planning.gateway.adapterToken);
  assert.equal(bound.execution.a2a.sendProtectedTask,input.sendProtectedTask);
  assert.equal(Object.isFrozen(bound),true);
  assert.equal(Object.isFrozen(bound.ports),true);
  assert.equal(Object.isFrozen(bound.transports.backend),true);
  assert.ok(!Object.hasOwn(bound,"coordinator"));
  assert.ok(!Object.hasOwn(bound,"reviewGate"));
  assert.ok(!Object.hasOwn(bound,"geminiApiKey"));
  assert.ok(!Object.hasOwn(bound,"engineerDid"));
  assert.ok(!Object.hasOwn(bound,"sourceSha"));
  input.ports.backend=8120;
  input.transports.backend.adapterToken="attacker-token";
  input.childStatusProvisioning.indexByTask.backend=999;
  assert.equal(bound.ports.backend,8101);
  assert.equal(bound.transports.backend.adapterToken,"original-role-only-token-0");
  assert.equal(bound.childStatusProvisioning.indexByTask.backend,12);
});
test("paid Gemini binding denies caller-supplied authority and off-host role transports",()=>{
  for(const mutation of [
    x=>{x.sessionId="forged";},
    x=>{x.coordinator={phase:"execution"};},
    x=>{x.reviewGate={loadAuthenticatedApproval:()=>{}};},
    x=>{x.operationalRoot.injected=true;},
    x=>{x.runId="0";},
    x=>{x.ports.frontend=x.ports.backend;},
    x=>{x.ports.test=80;},
    x=>{delete x.transports.test;},
    x=>{x.transports.backend.gatewayBaseUrl="https://evil.test";},
    x=>{x.transports.backend.adapterBaseUrl="http://127.0.0.1:8888";},
    x=>{x.transports.backend.adapterToken="owner-original-adapter-token";},
    x=>{x.transports.test.adapterToken=x.transports.backend.adapterToken;},
    x=>{x.childStatusProvisioning.extraPermission="merge";},
    x=>{x.childStatusProvisioning.reservationDirectory="relative";},
    x=>{x.sendProtectedTask=null;}
  ]){
    const {planning,input}=fixture();
    mutation(input);
    assert.throws(()=>bindProtectedGeminiApprovedExecution(planning,input),
      /Protected Gemini Execution binding denied/);
  }
});
test("paid Gemini binding refuses replaced, mutable or external planning Gateway identity",()=>{
  for(const planning of [
    undefined,{gateway:{gatewayBaseUrl:"http://127.0.0.1:8091",
      adapterBaseUrl:"http://127.0.0.1:8092",
      adapterToken:"original-secret"}},
    Object.freeze({gateway:Object.freeze({
      gatewayBaseUrl:"https://evil.test",adapterBaseUrl:"http://127.0.0.1:8092",
      adapterToken:"owner-original-adapter-token"
    })})
  ]){
    const f=fixture();
    assert.throws(()=>bindProtectedGeminiApprovedExecution(planning,f.input),
      /Protected Gemini Execution binding denied/);
  }
});
