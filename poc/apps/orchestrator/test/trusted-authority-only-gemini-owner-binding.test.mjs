import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {bindProtectedCanonicalGeminiOwner}
 from "../src/trusted-authority-only-gemini-owner-binding.mjs";

const SHA="a".repeat(40);
const roles=["backend","frontend","test"];
class OfflineOnlyLlm extends BaseLlm{
 constructor(){super({model:"r3826-offline-no-paid-provider"});}
 async *generateContentAsync(){throw Error("Gemini inference must not start");}
 connect(){throw Error("Gemini connection must not start");}
}
function fixture(t){
 const previous={
  architecture:process.env.DELEGATION_GATEWAY_ARCHITECTURE,
  native:process.env.APPROVED_RUNNER_NATIVE_MCP
 };
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 t.after(()=>{
  if(previous.architecture===undefined)
   delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
  else process.env.DELEGATION_GATEWAY_ARCHITECTURE=previous.architecture;
  if(previous.native===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=previous.native;
 });
 const snapshot={
  session_id:"r3826-original-review-session",base_revision:SHA,
  repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
  directories:["","src","tests"],files:["src/backend.ts","src/frontend.ts"]
 };
 const preliminaryRoot={
  credential_id:"urn:r3826:preliminary",valid_from:"2026-11-07T15:00:00.000Z",
  validity_seconds:2700,credential_status:{
   type:"BitstringStatusListEntry",statusPurpose:"revocation",
   statusListIndex:"29",statusListCredential:"https://status.invalid/list"
  }
 };
 const agents=Object.fromEntries(roles.map(role=>[
  role,{did:"did:ethr:r3826-"+role,card_ref:"trusted:"+role}
 ]));
 const authority={
  snapshot,preliminaryRoot,requirement:"Suspend accounts with controlled UI",
  workBranch:"feature/account-suspension",
  planner:{planId:"r3826-approved-planner"},
  trustedAgentRegistry:Object.fromEntries(roles.map(role=>[
   role,{...agents[role],capabilities:["read_file","update_file"]}
  ])),
  gateway:{gatewayBaseUrl:"http://127.0.0.1:9001",
   adapterToken:"TRUSTED-PRIVATE",adapterBaseUrl:"http://127.0.0.1:9002"},
  checkpoint:{store:{assertSigner(){throw Error("Only original Host may authorize signer");}},
   backendKeyId:"backend"},
  operationalRecoveryStore:{original:true}
 };
 const input={
  snapshot:structuredClone(snapshot),preliminaryRoot:structuredClone(preliminaryRoot),
  requirement:authority.requirement,
  planId:"r3826-approved-planner",agents:structuredClone(agents),
  gatewayBaseUrl:authority.gateway.gatewayBaseUrl,
  backendPrivateKeyPem:"-----BEGIN PRIVATE KEY-----\nORIGINAL_BACKEND_KEY\n-----END PRIVATE KEY-----",
  geminiApiKey:"SENSITIVE_PAID_GEMINI_KEY_MUST_NOT_ESCAPE",
  modelName:"gemini-3.8-flash",
  authorizationInput:"I AUTHORIZE GEMINI API CHARGES"
 };
 return {input,authority,model:new OfflineOnlyLlm()};
}
const bind=f=>bindProtectedCanonicalGeminiOwner(f);

test("R382.6 original authority-only Gemini Planning binds exact same runtime identities",t=>{
 const f=fixture(t);
 let calls=0;
 f.authority.planner.onObservation=()=>{calls++;};
 const b=bind(f);
 assert.equal(b.snapshot,f.authority.snapshot);
 assert.equal(b.preliminaryRoot,f.authority.preliminaryRoot);
 assert.equal(b.operationalRecoveryStore,f.authority.operationalRecoveryStore);
 assert.equal(b.checkpoint.store,f.authority.checkpoint.store);
 assert.equal(b.planner.model,f.model);
 assert.equal(b.planner.planId,f.input.planId);
 assert.equal(b.planner.maxModelTurns,20);
 assert.equal(b.planner.maxPlanningMs,180000);
 assert.equal(b.planner.maxProposalRevisions,2);
 assert.equal(b.planner.thinkingLevel,"LOW");
 assert.equal(b.checkpoint.backendPrivateKeyPem,f.input.backendPrivateKeyPem);
 assert.ok(Object.isFrozen(b)&&Object.isFrozen(b.planner)&&
  Object.isFrozen(b.checkpoint));
 assert.equal("geminiApiKey" in b,false);
 assert.equal("geminiApiKey" in b.planner,false);
 assert.equal("authorizationInput" in b,false);
 assert.equal(calls,0);
});

test("R382.6 forbids foreign Engineer Planning snapshot, role, Root, grant, model",t=>{
 const f=fixture(t);
 const cases=[
  x=>{x.input.snapshot.base_revision="b".repeat(40);},
  x=>{x.input.snapshot.files.push("src/foreign.ts");},
  x=>{x.input.preliminaryRoot.credential_id="urn:foreign-root";},
  x=>{x.input.requirement="another scope";},
  x=>{x.input.planId="foreign-plan";},
  x=>{x.input.agents.frontend.did="did:ethr:foreign";},
  x=>{x.input.agents.backend.card_ref="foreign-card";},
  x=>{x.input.gatewayBaseUrl="http://127.0.0.1:9999";},
  x=>{x.input.modelName="gemini-elsewhere";},
  x=>{x.input.authorizationInput="yes";},
  x=>{x.authority.planner.model=new OfflineOnlyLlm();},
  x=>{x.authority.planner.maxModelTurns=3000;},
  x=>{x.authority.checkpoint.store=undefined;},
  x=>{x.authority.workBranch="main";},
  x=>{x.model={model:"same-name-fake"};},
 ];
 for(const patch of cases){
  const a={
   ...f.authority,
   snapshot:structuredClone(f.authority.snapshot),
   preliminaryRoot:structuredClone(f.authority.preliminaryRoot),
   planner:{...f.authority.planner},
   trustedAgentRegistry:structuredClone(f.authority.trustedAgentRegistry),
   gateway:{...f.authority.gateway},
   checkpoint:{...f.authority.checkpoint}
  };
  // Preserve typed trusted checkpoint store, not a JSON clone.
  const x={authority:a,input:structuredClone(f.input),model:f.model};
  patch(x);
  assert.throws(()=>bind(x),/Protected canonical Gemini owner binding denied/u);
 }
});

test("R382.6 rejects Gemini authority mode and native signer downgrade before any Planning",t=>{
 const f=fixture(t);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="legacy-signed-dag";
 assert.throws(()=>bind(f),/Protected canonical Gemini owner binding denied/u);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="0";
 assert.throws(()=>bind(f),/Protected canonical Gemini owner binding denied/u);
});
