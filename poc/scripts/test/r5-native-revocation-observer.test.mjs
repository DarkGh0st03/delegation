import test from "node:test";
import assert from "node:assert/strict";
import {observeR5AdapterEvmRevocations,validateR5RevocationInventory}
  from "../r5-native-revocation-observer.mjs";

const SHA="a".repeat(40),DIGEST="b".repeat(64),RUN="40470000111";
function ownerEvidence(){
  return {
    schema:"r5-scripted-owner-completion-v1",
    status:"verified_complete_local_owner_observation",
    source_sha:SHA,github_run_id:RUN,session_id:"r5-owner-original",
    approved_plan_digest:DIGEST,
    approved_task_ids:["branch","backend","frontend","test","pr"],
    completed_task_ids:["branch","frontend","backend","test","pr"],
    authenticated_engineer_did:"did:example:engineer",
    coordinator_terminal_phase:"closed",
    original_runtime_returned_success:true,
    independently_attested:false,
    provider_model_calls_verified_here:false,external_r5_go:false
  };
}
function inventory(){
  return {
    schema:"r5-credential-issuance-inventory-v1",
    source_sha:SHA,github_run_id:RUN,session_id:"r5-owner-original",
    approved_plan_digest:DIGEST,
    preliminary_root_id:"urn:r5:preliminary",
    operational_root_id:"urn:r5:operational",
    task_children:["backend","frontend","test"].map(task_id=>({
      task_id,credential_id:"urn:r5:child:"+task_id
    }))
  };
}
const arg=()=>({
  ownerEvidence:ownerEvidence(),inventory:inventory(),
  adapterBaseUrl:"http://127.0.0.1:8092",
  gatewayVerifierToken:"test-verified-gateway-secret"
});
function goodStatus(credential_id){
  return {
    credential_id,status_purpose:"revocation",status_set:true,
    source:"evm_anchored_signed_jwt",anchor_version:3
  };
}
function fake(overrides=()=>{}){
  const calls=[];
  const fetchFn=async(url,options)=>{
    calls.push({url,options});
    const req=JSON.parse(options.body);
    const status=goodStatus(req.credential_id);
    const out=overrides(status,req,calls.length);
    return {ok:true,status:200,
      text:async()=>JSON.stringify(out??status)};
  };
  return {calls,fetchFn};
}
test("R5 observes two exact roots and every supplied approved specialized Task child through read-only Gateway bearer",async()=>{
  const f=fake();
  const result=await observeR5AdapterEvmRevocations({...arg(),fetchFn:f.fetchFn});
  assert.equal(result.observed_root_count,2);
  assert.equal(result.observed_task_child_count,3);
  assert.equal(result.adapter_status_source,"evm_anchored_signed_jwt");
  assert.equal(result.external_r5_go,false);
  assert.equal(result.issuance_inventory_completeness_independently_verified,false);
  assert.equal(result.adapter_and_chain_independently_attested,false);
  assert.equal(f.calls.length,5);
  assert.deepEqual(f.calls.map(c=>JSON.parse(c.options.body).credential_id),
    ["urn:r5:preliminary","urn:r5:operational",
     "urn:r5:child:backend","urn:r5:child:frontend","urn:r5:child:test"]);
  for(const {url,options} of f.calls){
    assert.equal(url,"http://127.0.0.1:8092/v1/credentials/status/inspect");
    assert.equal(options.method,"POST");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers.authorization,
      "Bearer test-verified-gateway-secret");
    assert.deepEqual(Object.keys(JSON.parse(options.body)),["credential_id"]);
  }
  assert.equal(JSON.stringify(result).includes("gateway-secret"),false);
});
test("R5 invented or incomplete issuance inventory is rejected before any HTTP call",async()=>{
  const mutations=[
    x=>x.inventory.task_children.pop(),
    x=>x.inventory.task_children[0].task_id="branch",
    x=>x.inventory.task_children[0].task_id="not-approved",
    x=>x.inventory.task_children.push({...x.inventory.task_children[0]}),
    x=>x.inventory.operational_root_id=x.inventory.preliminary_root_id,
    x=>x.inventory.task_children[1].credential_id=x.inventory.preliminary_root_id,
    x=>x.inventory.source_sha="c".repeat(40),
    x=>x.inventory.approved_plan_digest="c".repeat(64),
    x=>x.inventory.github_run_id="42",
    x=>x.inventory.session_id="swapped-session",
    x=>x.inventory.task_children[0].extra="unauthorized",
    x=>x.inventory.unknown="unexpected",
    x=>x.ownerEvidence.external_r5_go=true,
    x=>x.ownerEvidence.completed_task_ids.pop()
  ];
  for(const change of mutations){
    const f=fake(),args=arg();
    change(args);
    await assert.rejects(observeR5AdapterEvmRevocations({
      ...args,fetchFn:f.fetchFn
    }),/NO-GO/);
    assert.equal(f.calls.length,0);
  }
});
test("R5 rejects memory-only, false, stale, malformed and swapped Adapter revocation observations",async()=>{
  const attacks=[
    x=>{x.source="adapter_memory_only";},
    x=>{x.status_set=false;},
    x=>{x.status_purpose="suspension";},
    x=>{x.credential_id="urn:other:root";},
    x=>{x.anchor_version=0;},
    x=>{x.anchor_version="3";},
    x=>{delete x.anchor_version;},
    x=>{x.surprise="forged";},
  ];
  for(const attack of attacks){
    const f=fake((status,_req,i)=>{
      if(i===3)attack(status);
    });
    await assert.rejects(observeR5AdapterEvmRevocations({
      ...arg(),fetchFn:f.fetchFn
    }),/NO-GO/);
    assert.equal(f.calls.length,3);
  }
});
test("R5 rejects remote origins, non-verifier tokens and HTTP failure before any success",async()=>{
  for(const bad of [
    {adapterBaseUrl:"https://example.org"},
    {adapterBaseUrl:"http://localhost:8092"},
    {adapterBaseUrl:"http://127.0.0.1:8092/extra"},
    {gatewayVerifierToken:"short"},
    {gatewayVerifierToken:"dangerous token with spaces"}
  ]){
    const f=fake();
    await assert.rejects(observeR5AdapterEvmRevocations({
      ...arg(),...bad,fetchFn:f.fetchFn
    }),/NO-GO/);
    assert.equal(f.calls.length,0);
  }
  const requests=[];
  await assert.rejects(observeR5AdapterEvmRevocations({
    ...arg(),fetchFn:async(url,options)=>{
      requests.push([url,options.method]);
      return {ok:false,status:401,text:async()=>"{ }"};
    }
  }),/NO-GO/);
  assert.equal(requests.length,1);
});
test("R5 pure inventory validation never treats a closed owner receipt as independent evidence",()=>{
  const result=validateR5RevocationInventory({
    ownerEvidence:ownerEvidence(),inventory:inventory()
  });
  assert.equal(result.ids.length,5);
  assert.equal(Object.isFrozen(result.ids),true);
  assert.equal(result.child_count,3);
});
