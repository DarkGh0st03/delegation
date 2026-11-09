/**
 * R460: guard the canonical paid Gemini specialist roster. No API call,
 * private files, native signer, Engineer root, A2A task, provider or merge.
 * Extra owner-pinned A2A workers remain available only to separate tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {bindProtectedCanonicalGeminiOwner}
 from "../src/trusted-authority-only-gemini-owner-binding.mjs";

class OfflineModel extends BaseLlm{
 constructor(){super({model:"r460-offline-never-billed"});}
 async *generateContentAsync(){throw Error("Paid model invocation forbidden");}
 connect(){throw Error("Paid model connection forbidden");}
}
test("R460 Gemini binds exactly Backend/Frontend/Test; original Orchestrator is not a fourth specialist",()=>{
 const envKeys=["DELEGATION_GATEWAY_ARCHITECTURE","APPROVED_RUNNER_NATIVE_MCP"];
 const previous=envKeys.map(name=>[name,process.env[name]]);
 try{
  process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
  process.env.APPROVED_RUNNER_NATIVE_MCP="1";
  const model=new OfflineModel();
  const card=role=>({did:"did:thesis:"+role,card_ref:"trusted:"+role});
  const canonical=Object.fromEntries(
   ["backend","frontend","test"].map(role=>[role,card(role)]));
  const snapshot={session_id:"r460-offline",base_revision:"a".repeat(40)};
  const preliminaryRoot={credential_id:"urn:r460:fixture-only"};
  const input={authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
   modelName:"gemini-3.8-flash",backendPrivateKeyPem:
   "-----BEGIN PRIVATE KEY-----\nOFFLINE_FAKE_NOT_A_SECRET\n-----END PRIVATE KEY-----",
   geminiApiKey:"OFFLINE_FAKE_NOT_A_SECRET",
   planId:"r460-plan",snapshot,preliminaryRoot,
   requirement:"Account Suspension",agents:canonical,
   gatewayBaseUrl:"http://127.0.0.1:8130"};
  const authority={planner:{planId:input.planId},snapshot,preliminaryRoot,
   requirement:input.requirement,
   trustedAgentRegistry:{...canonical,orchestrator:card("orchestrator")},
   gateway:{gatewayBaseUrl:input.gatewayBaseUrl},
   checkpoint:{backendKeyId:"r460-offline",store:{assertSigner(){
    throw Error("No private key or signing action in this test");
   }}},
   workBranch:"feature/account-suspension"};
  const bind=(a=authority,b=input)=>bindProtectedCanonicalGeminiOwner({
   authority:a,input:b,model});
  const bound=bind();
  assert.strictEqual(bound.planner.model,model);
  assert.equal(bound.planner.maxModelTurns,20);
  assert.deepEqual(Object.keys(bound.trustedAgentRegistry).sort(),
   ["backend","frontend","orchestrator","test"]);
  assert.ok(Object.isFrozen(bound));
  const noOrchestrator=bind({
   ...authority,trustedAgentRegistry:canonical});
  assert.strictEqual(noOrchestrator.planner.model,model);
  assert.throws(()=>bind({...authority,trustedAgentRegistry:{
   ...authority.trustedAgentRegistry,
   reviewer:{did:"did:thesis:reviewer",card_ref:"trusted:reviewer",
    capabilities:["read_file"]}
  }}),/Protected canonical Gemini owner binding denied/u,
   "an additional registered specialist must not enter paid Gemini");
  assert.throws(()=>bind(authority,{...input,agents:{
   ...canonical,reviewer:card("reviewer")
  }}),/Protected canonical Gemini owner binding denied/u,
   "the private Gemini manifest must not provision a fourth specialist");
  assert.throws(()=>bind({...authority,trustedAgentRegistry:{
   backend:canonical.backend,frontend:canonical.frontend,
   orchestrator:card("orchestrator")
  }}),/Protected canonical Gemini owner binding denied/u,
   "the original three roles cannot be partially provisioned");
  assert.throws(()=>bind({...authority,trustedAgentRegistry:{
   ...authority.trustedAgentRegistry,reviewer:card("reviewer")
  }}),/Protected canonical Gemini owner binding denied/u);
 }finally{
  for(const [name,value] of previous){
   if(value===undefined)delete process.env[name];
   else process.env[name]=value;
  }
 }
});
