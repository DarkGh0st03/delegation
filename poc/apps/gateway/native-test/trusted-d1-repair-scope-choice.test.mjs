import assert from "node:assert/strict";
import test from "node:test";
import {selectTrustedD1RepairScope as select,trustedD1ScopeStopCategory}
 from "./trusted-d1-repair-scope-choice.mjs";

const sha="a".repeat(40);
const failure=Object.freeze({phase:"backend_tests",failed_test_file_count:1});
const source=Object.freeze({
 status:"verified_original_project_test_repair_scope",
 tested_commit_sha:sha,
 project_test_failure:failure,causal_attribution:"not_established",
 candidates:[{role:"backend",resource:"gitea://test/repo/file.ts"}]
});
const generated=Object.freeze({
 status:"verified_original_generated_test_edit_scope",
 tested_commit_sha:sha,
 project_test_failure:failure,
 candidates:[{role:"test",resource:"gitea://test/repo/test.ts"}],
 causal_attribution:"not_established"
});

test("both verified routes allow model to choose source investigation",async()=>{
 let calls=0;
 const x=await select({testedSha:sha,sourceTarget:source,
  generatedTestTarget:generated,chooseInvestigation:async observation=>{
   calls++;
   assert.deepEqual(observation,{
    tested_commit_sha:sha,failed_phase:"backend_tests",
    source_candidate_count:1,test_candidate_count:1,
    causal_attribution:"not_established"
   });
   return "original_source";
  }});
 assert.equal(calls,1);assert.equal(x.target,source);
 assert.equal(x.causal_attribution,"not_established");
});
test("both verified routes allow model to choose Test investigation",async()=>{
 const x=await select({testedSha:sha,sourceTarget:source,
  generatedTestTarget:generated,chooseInvestigation:async()=>"generated_test_investigation"});
 assert.equal(x.target,generated);
 assert.equal(x.causal_attribution,"not_established");
});
test("one available scope needs no model call",async()=>{
 const noCall=()=>{throw Error("model must not run");};
 assert.equal((await select({testedSha:sha,sourceTarget:source,
  chooseInvestigation:noCall})).target,source);
 assert.equal((await select({testedSha:sha,generatedTestTarget:generated,
  chooseInvestigation:noCall})).target,generated);
});
test("both routes without decision fail closed, never bias source",async()=>{
 await assert.rejects(select({testedSha:sha,sourceTarget:source,
  generatedTestTarget:generated}),/NO-GO/);
 for(const value of ["backend","test","unsure",null,{},["original_source"]]){
  await assert.rejects(select({testedSha:sha,sourceTarget:source,
   generatedTestTarget:generated,chooseInvestigation:async()=>value}),/NO-GO/);
 }
});
test("stale or inconsistent evidence fails before model inference",async()=>{
 let calls=0;const chooseInvestigation=async()=>{calls++;return "original_source";};
 for(const bad of [
  {sourceTarget:{...source,tested_commit_sha:"b".repeat(40)},generatedTestTarget:generated},
  {sourceTarget:source,generatedTestTarget:{...generated,tested_commit_sha:"b".repeat(40)}},
  {sourceTarget:source,generatedTestTarget:{...generated,project_test_failure:{phase:"frontend_tests",failed_test_file_count:1}}},
  {sourceTarget:source,generatedTestTarget:{...generated,causal_attribution:"test_incorrect"}},
  {sourceTarget:source,generatedTestTarget:{...generated,candidates:[]}},
  {sourceTarget:source,generatedTestTarget:{...generated,candidates:Array(9).fill(generated.candidates[0])}}
 ]){
  await assert.rejects(select({testedSha:sha,...bad,chooseInvestigation}),/NO-GO/);
 }
 assert.equal(calls,0);
});
test("unsupported mixed modes and absent authority fail closed",async()=>{
 await assert.rejects(select({testedSha:sha,sourceTarget:{
  ...source,status:"verified_runner_single_file_repair_target"
 },generatedTestTarget:generated,chooseInvestigation:async()=>"original_source"}),/NO-GO/);
 await assert.rejects(select({testedSha:sha}),/NO-GO/);
 await assert.rejects(select({testedSha:"bad",sourceTarget:source}),/NO-GO/);
});


test("bounded uncertain model response stops before invoking a repair proposer",async()=>{
 const {createBoundedD1GeminiInvestigationChoice}=await import("./trusted-d1-gemini-investigation-choice.mjs");
 let modelCalls=0,proposals=0;
 const chooseInvestigation=createBoundedD1GeminiInvestigationChoice({requirement:"Preserve profile fields",
  model:{model:"offline-no-network",async *generateContentAsync(){
   modelCalls++;yield {content:{parts:[{text:'{"mode":"insufficient_evidence"}'}]}};
  }}});
 await assert.rejects(async()=>{
  await select({testedSha:sha,sourceTarget:source,generatedTestTarget:generated,chooseInvestigation});
  proposals++;
 },error=>trustedD1ScopeStopCategory(error)==="repair_insufficient_evidence");
 assert.equal(modelCalls,1);assert.equal(proposals,0);
 assert.equal(trustedD1ScopeStopCategory({category:"repair_insufficient_evidence"}),null);
 assert.equal(trustedD1ScopeStopCategory(Error("insufficient_evidence SECRET")),null);
 await assert.rejects(select({testedSha:sha,sourceTarget:source,generatedTestTarget:generated,
  chooseInvestigation:async()=>{throw {category:"repair_insufficient_evidence"};}}),
  error=>trustedD1ScopeStopCategory(error)===null);
});
