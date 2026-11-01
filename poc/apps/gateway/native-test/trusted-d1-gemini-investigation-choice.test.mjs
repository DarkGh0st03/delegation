import assert from "node:assert/strict";
import test from "node:test";
import {createBoundedD1GeminiInvestigationChoice as choose}
 from "./trusted-d1-gemini-investigation-choice.mjs";

const observation={
 tested_commit_sha:"a".repeat(40),failed_phase:"backend_tests",
 source_candidate_count:2,test_candidate_count:1,
 causal_attribution:"not_established"
};
function model(mode){
 const seen=[];
 return {
  seen,
  model:"offline-stub-no-network",
  async *generateContentAsync(request){
   seen.push(request);
   yield {content:{parts:[{text:JSON.stringify({mode})}]}};
  }
 };
}
test("single bounded inference chooses only an investigation route",async()=>{
 const stub=model("generated_test_investigation");
 const decision=choose({model:stub,requirement:"Implement a status transition"});
 assert.equal(await decision(observation),"generated_test_investigation");
 assert.equal(stub.seen.length,1);
 const raw=stub.seen[0].contents[0].parts[0].text;
 assert.match(raw,/not prove|does NOT prove/i);
 assert.doesNotMatch(raw,/Bearer |signed_vp|credential_id|file\/tests\/private/);
 await assert.rejects(decision(observation),/NO-GO/);
});
test("source route can be selected for investigation without proving cause",async()=>{
 assert.equal(await choose({model:model("original_source"),requirement:"Implement API"})(observation),"original_source");
});
test("uncertainty cannot be silently converted into authorization",async()=>{
 await assert.rejects(
  async()=>{const route=await choose({model:model("insufficient_evidence"),requirement:"API"})(observation);
   if(!["original_source","generated_test_investigation"].includes(route))
    throw Error("D1 choice NO-GO");},/NO-GO/);
});
test("unknown response and forged candidate observations fail closed",async()=>{
 for(const mode of ["backend","test",null,undefined,3]){
  await assert.rejects(choose({model:model(mode),requirement:"API"})(observation),/NO-GO/);
 }
 for(const bad of [
  {...observation,tested_commit_sha:"stale"},
  {...observation,test_candidate_count:0},
  {...observation,source_candidate_count:9},
  {...observation,causal_attribution:"test_incorrect"}
 ]){
  const stub=model("original_source");
  await assert.rejects(choose({model:stub,requirement:"API"})(bad),/NO-GO/);
  assert.equal(stub.seen.length,0);
 }
});
test("malformed JSON and extra fields fail closed",async()=>{
 const badModels=[
  {model:"fake",async *generateContentAsync(){yield {content:{parts:[{text:"not JSON"}]}};}},
  {model:"fake",async *generateContentAsync(){yield {content:{parts:[{text:'{"mode":"original_source","privilege":"yes"}'}]}};}},
  {model:"fake",async *generateContentAsync(){yield {errorCode:429};}}
 ];
 for(const m of badModels)
  await assert.rejects(choose({model:m,requirement:"API"})(observation),/NO-GO/);
});
