import test from "node:test";
import assert from "node:assert/strict";
import {verifiedFailedCreatedTestPaths as select}
  from "./verified-failed-generated-test-selection.mjs";

const branch="feature/approved",sha="a".repeat(40);
const phases=["dependency_install","typecheck","backend_tests",
 "frontend_tests","build","playwright_e2e","researcher_acceptance"]
 .map((phase,i)=>({phase,status:i<2?"pass":i===2?"fail":"skipped"}));
const first="tests/backend/generated-a.test.ts";
const second="tests/backend/generated-b.test.ts";
const other="tests/backend/old.test.ts";
const runnerOutcome={
 provider:"runner",performed:true,tool:"run_tests",status:"fail",
 project_tests:{status:"fail"},researcher_acceptance:{status:"skipped"},
 tested_commit_sha:sha,revision:sha,branch,phases,
 failing_test_files:[second,other,first]
};
function fixture(){return{
 runnerOutcome:structuredClone(runnerOutcome),
 originalCreatedPaths:new Set([first,second,"tests/backend/created-unrelated.test.ts"]),
 branch,failedSha:sha
};}
test("Only failed files confirmed as created by the original Test are eligible",()=>{
 const found=select(fixture());
 assert.deepEqual(found,[first,second]);
 assert.ok(Object.isFrozen(found));
 assert.equal(found.includes(other),false);
});
test("New Test-edit scope rejects unverified or ambiguous Runner facts",()=>{
 const cases=[
  x=>{x.runnerOutcome.provider="model";},
  x=>{x.runnerOutcome.status="pass";},
  x=>{x.runnerOutcome.project_tests.status="pass";},
  x=>{x.runnerOutcome.branch="feature/another";},
  x=>{x.runnerOutcome.revision="b".repeat(40);},
  x=>{x.runnerOutcome.tested_commit_sha="b".repeat(40);},
  x=>{x.runnerOutcome.failing_test_files.push("tests/backend/../../private.test.ts");},
  x=>{x.runnerOutcome.failing_test_files.push(first);},
  x=>{x.runnerOutcome.phases[3].status="fail";},
  x=>{x.runnerOutcome.phases[2].phase="typecheck";},
  x=>{x.runnerOutcome.failing_test_files=["tests/frontend/generated.test.tsx"];},
  x=>{x.originalCreatedPaths=new Set([other]);},
  x=>{x.originalCreatedPaths.add("../outside");},
  x=>{x.failedSha="invalid-sha";}
 ];
 for(const change of cases){
  const input=fixture();change(input);
  assert.throws(()=>select(input),/selection NO-GO/);
 }
});
test("A correct unchanged Backend source cannot be blamed from Test provenance alone",()=>{
 const selected=select(fixture());
 assert.deepEqual(selected,[first,second]);
 assert.equal(Object.hasOwn(selected,"causal_attribution"),false);
 assert.ok(!JSON.stringify(selected).includes("apps/backend"));
});
