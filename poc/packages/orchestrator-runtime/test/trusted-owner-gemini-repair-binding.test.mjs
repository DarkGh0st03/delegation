import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {TrustedAdkOperationalRepairProposer} from
 "../src/trusted-adk-operational-repair-proposer.ts";
import {armTrustedOwnerOperationalRecovery,isTrustedOwnerRepairPlannerConfig} from
 "../src/trusted-owner-operational-repair-handoff.ts";

class NoNetworkAdk extends BaseLlm {
 constructor(){super({model:"no-billing-r151-owner-test"});}
 async *generateContentAsync(){
  throw Error("R151 binding test must not invoke any model");
 }
 connect(){return Promise.reject(Error("No streaming"));}
}
const giteaClient=new GiteaClient({
 baseUrl:"http://127.0.0.1:3000",token:"local-fixture-token",
 owner:"thesis",repository:"iam-console-poc"
});
const trustedAdkProposer=new TrustedAdkOperationalRepairProposer({
 model:new NoNetworkAdk()
});
const noop=async()=>({tasks:[]});
const base={running:{readiness:{
  session_id:"r151-fixture",base_revision:"a".repeat(40),
  plan_digest:"b".repeat(64),
  authenticated_engineer_did:"did:example:engineer"
 },operational_root_id:"root-unchanged"}};

test("R151 owner accepts only a real bounded ADK proposer as alternative to callback",async()=>{
 // The original-root identity is intentionally absent: passing the
 // exclusive-config gate MUST stop at the original-root guard, with zero
 // model/network requests, no epoch and no credential.
 await assert.rejects(armTrustedOwnerOperationalRecovery({
  ...base,planRepairEpoch:{giteaClient,trustedAdkProposer}
 }),/original approved Coordinator, root and durable IPC required/);
});
test("R151 owner rejects two model authority paths or neither before root access",async()=>{
 for(const planRepairEpoch of [
  {giteaClient,proposeRepairPlan:noop,trustedAdkProposer},
  {giteaClient},
  {giteaClient,trustedAdkProposer:{propose:noop}},
  {giteaClient,proposeRepairPlan:undefined,trustedAdkProposer:{}}
 ]){
  await assert.rejects(armTrustedOwnerOperationalRecovery({
   ...base,planRepairEpoch
  }),/exactly one trusted owner continuation or configured repair planner required/);
 }
});
test("R151 owner still accepts the existing callback with no implicit Gemini",async()=>{
 await assert.rejects(armTrustedOwnerOperationalRecovery({
  ...base,planRepairEpoch:{giteaClient,proposeRepairPlan:noop}
 }),/original approved Coordinator, root and durable IPC required/);
});


test("R151.50 host/runtime share exclusive proposer and admission validation",async()=>{
 for(const proposer of [{proposeRepairPlan:noop},{trustedAdkProposer}]){
  for(const admitReservedEpoch of [undefined,false,true])
   assert.equal(isTrustedOwnerRepairPlannerConfig({giteaClient,...proposer,admitReservedEpoch}),true);
  for(const admitReservedEpoch of ["true",1,null,{}]){
   const planRepairEpoch={giteaClient,...proposer,admitReservedEpoch};
   assert.equal(isTrustedOwnerRepairPlannerConfig(planRepairEpoch),false);
   await assert.rejects(armTrustedOwnerOperationalRecovery({
    ...base,planRepairEpoch
   }),/exactly one trusted owner continuation or configured repair planner required/);
  }
 }
 for(const config of [undefined,null,{},
  {giteaClient,proposeRepairPlan:noop,trustedAdkProposer},
  {giteaClient,trustedAdkProposer:{propose:noop}},
  {giteaClient:{},proposeRepairPlan:noop},
  {giteaClient,proposeRepairPlan:"invalid",trustedAdkProposer}
 ])assert.equal(isTrustedOwnerRepairPlannerConfig(config),false);
});

test("R151.51 late discovery rejects structural owner and mixed source paths before side effects",async()=>{
 const {TrustedExecutionCoordinator}=await import("../src/trusted-execution-coordinator.ts");
 const native=new TrustedExecutionCoordinator({
  sessionId:"r151-fixture",baseRevision:"a".repeat(40),authority:{},
  approvedGatewayPlans:{},credentials:{async revokeRoot(){throw Error("unexpected revoke");}}
 });
 const remoteDiscoveryPorts={};
 const planner={giteaClient,proposeRepairPlan:noop,remoteDiscoveryPorts};
 for(const extra of [
  {dispatchRemoteDiscovery:noop},{loadCompletedDiscoverySource:noop},
  {completedDiscoveryRead:{}},{trustedRemoteDiscovery:{}}
 ])await assert.rejects(armTrustedOwnerOperationalRecovery({
  ...base,coordinator:native,planRepairEpoch:{...planner,...extra}
 }),/late discovery requires native owner and exclusive private ports/);
 await assert.rejects(armTrustedOwnerOperationalRecovery({
  ...base,coordinator:{phase:"execution",closeExecution:noop},planRepairEpoch:planner
 }),/late discovery requires native owner and exclusive private ports/);
 // Merely configuring ports must not construct the issuer or perform IPC:
 // the native but inactive owner still stops at the original-root guard.
 await assert.rejects(armTrustedOwnerOperationalRecovery({
  ...base,coordinator:native,planRepairEpoch:planner
 }),/original approved Coordinator, root and durable IPC required/);
});
