import test from "node:test";
import assert from "node:assert/strict";
import {classifyR403,R403_PROTECTED_DOCUMENTS,R403_ARCHITECTURE_ANCHORS}
 from "../r403-document-retirement-classifier.mjs";

const fake=()=>({
 "README.md":"# README",
 "docs/ACTIVE_AUTHORITY_ONLY_ROADMAP.md":
  "See [historic](R354_1_REFERENCED.md) for old checkpoints",
 "docs/ARCHITECTURE_DECISIONS.md":"Keep signed Root",
 "docs/IMPLEMENTATION_STATE.md":"Current state",
 "docs/REPRODUCIBILITY.md":"Hashes",
 "docs/human-approved-gitea-merge.md":"Human Gate",
 "docs/R401_PLANNER_CARD_AND_PROJECT_TEST_PROFILES.md":"Current",
 "docs/R402_REACHABILITY_COVERAGE_INVENTORY.md":"Current",
 "docs/R351_0_ADK_DYNAMIC_TASK_DECISION.md":"# Kept architectural milestone",
 "docs/R355_ADAPTIVE_OWNER_WORK_LOOP.md":"# Kept architectural milestone",
 "docs/R370_CANONICAL_ORIGINAL_REVIEW_HOST_LAUNCHER.md":"# Kept architectural milestone",
 "docs/R375_ORIGINAL_PROTECTED_MAIN_FUNCTIONAL_PASS_AND_DRAFT_PR.md":"# Kept architectural milestone",
 "docs/R350_1_UNUSED.md":"# Old milestone; historical evidence",
 "docs/R351_1_LINKED.md":"# Legacy Link",
 "docs/R352_1_PEER.md":"[linked](R351_1_LINKED.md)",
 "docs/R354_1_REFERENCED.md":"# Historical referenced",
 "poc/src/runtime.ts":"export const x = 1;",
 ".github/workflows/ci.yml":"on:\n  workflow_dispatch:\n"
});
const scan=record=>classifyR403({tracked:Object.keys(record),
 read:path=>{
  if(!Object.hasOwn(record,path))throw Error("Missing");
  return record[path];
 },requireProtected:true});
test("R403 isolates historical docs without authorizing deletion",()=>{
 const out=scan(fake());
 const rows=new Map(out.records.map(row=>[row.path,row]));
 assert.equal(rows.get("docs/R350_1_UNUSED.md").classification,"UNREFERENCED_INTERNAL_REVIEW");
 assert.equal(rows.get("docs/R351_1_LINKED.md").classification,"REVIEW_HISTORICAL_INTERLINK");
 assert.equal(rows.get("docs/R354_1_REFERENCED.md").classification,"BLOCKED_EXTERNAL_TRACKED_REFERENCE");
 assert.equal(out.summary.unreferencedReview,2);
 assert.equal(out.summary.historicalInterlinked,1);
 assert.equal(out.summary.blockedReferenced,1);
 assert.equal(out.documentationDeletionAuthorized,false);
 assert.ok(out.records.every(x=>x.deletionAuthorized===false));
 assert.ok(out.records.every(x=>x.externalConsumersVerified===false));
});
test("R403 source reference and workflow mention stop an unsafe retirement",()=>{
 const input=fake();
 input["poc/src/runtime.ts"]="const evidence='R350_1_UNUSED'";
 input[".github/workflows/ci.yml"]+="\n# R352_1_PEER.md\n";
 const rows=new Map(scan(input).records.map(x=>[x.path,x]));
 assert.equal(rows.get("docs/R350_1_UNUSED.md").classification,"BLOCKED_EXTERNAL_TRACKED_REFERENCE");
 assert.equal(rows.get("docs/R352_1_PEER.md").classification,"BLOCKED_EXTERNAL_TRACKED_REFERENCE");
});
test("R403 protected canonical docs are mandatory",()=>{
 const input=fake();
 delete input["docs/IMPLEMENTATION_STATE.md"];
 assert.throws(()=>scan(input),/R403 source provenance incomplete/);
 assert.ok(Object.isFrozen(R403_PROTECTED_DOCUMENTS));
});
test("R403 refuses to infer safety from unreadable tracked text",()=>{
 const input=fake();
 const r=classifyR403({tracked:Object.keys(input),
  read:path=>{if(path==="poc/src/runtime.ts")throw Error("inaccessible");return input[path]},
  requireProtected:false});
 assert.equal(r.summary.unreadableTextFiles,1);
 assert.equal(r.documentationDeletionAuthorized,false);
 assert.throws(()=>classifyR403({tracked:Object.keys(input),
  read:path=>{if(path==="poc/src/runtime.ts")throw Error("inaccessible");return input[path]},
  requireProtected:true}),/R403 source provenance incomplete/);
});

test("R403.1 preserves the four reviewed architectural milestone anchors",()=>{
 const report=scan(fake());
 const byPath=new Map(report.records.map(x=>[x.path,x]));
 assert.equal(report.summary.retainedArchitectureAnchors,4);
 assert.equal(R403_ARCHITECTURE_ANCHORS.length,4);
 for(const path of R403_ARCHITECTURE_ANCHORS){
  assert.equal(byPath.get(path)?.classification,"KEEP_ARCHITECTURE_EVIDENCE");
  assert.equal(byPath.get(path)?.deletionAuthorized,false);
  assert.ok(R403_PROTECTED_DOCUMENTS.includes(path));
 }
});
