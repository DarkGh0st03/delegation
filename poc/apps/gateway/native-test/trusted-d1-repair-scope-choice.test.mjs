import assert from "node:assert/strict";
import test from "node:test";
import {selectTrustedD1RepairScope as select}
 from "./trusted-d1-repair-scope-choice.mjs";

const sha="a".repeat(40);
const source=Object.freeze({
 status:"verified_original_project_test_repair_scope",
 tested_commit_sha:sha,
 candidates:[{role:"backend",resource:"gitea://test/repo/file.ts"}]
});
const generated=Object.freeze({
 status:"verified_original_generated_test_edit_scope",
 tested_commit_sha:sha,
 candidates:[{role:"test",resource:"gitea://test/repo/test.ts"}],
 causal_attribution:"not_established"
});

test("source remains preferred when both verified scopes exist",()=>{
 const x=select({testedSha:sha,sourceTarget:source,generatedTestTarget:generated});
 assert.equal(x.mode,"original_source");
 assert.equal(x.target,source);
});
test("independent generated Test candidate is usable only if source unavailable",()=>{
 const x=select({testedSha:sha,sourceTarget:null,generatedTestTarget:generated});
 assert.equal(x.mode,"generated_test_investigation");
 assert.equal(x.target,generated);
});
test("stale source fails closed rather than silently becoming a Test repair",()=>{
 assert.throws(()=>select({testedSha:sha,sourceTarget:{...source,tested_commit_sha:"b".repeat(40)},generatedTestTarget:generated}),/NO-GO/);
});
test("rejects forged generated scope and stale SHA",()=>{
 for(const candidate of [
  {...generated,status:"agent_claimed_test_incorrect"},
  {...generated,tested_commit_sha:"b".repeat(40)},
  {...generated,candidates:[]},
  {...generated,candidates:Array(9).fill(generated.candidates[0])}
 ]){
  assert.throws(()=>select({testedSha:sha,generatedTestTarget:candidate}),/NO-GO/);
 }
});
test("no source or generated scope cannot trigger a model proposal",()=>{
 assert.throws(()=>select({testedSha:sha}),/NO-GO/);
 assert.throws(()=>select({testedSha:"bad",sourceTarget:source}),/NO-GO/);
});
