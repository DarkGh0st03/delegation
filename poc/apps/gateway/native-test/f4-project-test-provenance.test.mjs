import test from "node:test";
import assert from "node:assert/strict";
import {corroborateF4ProjectTestProvenance as diagnose}
 from "./f4-project-test-provenance.mjs";
import {injectProjectTestFault,injectGeneratedTestAssertionFault,
 PROJECT_TEST_FAULT,GENERATED_TEST_WRONG_ASSERTION}
 from "./offline-project-test-repair-fixture.mjs";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES as files}
 from "../../test-runner-controller/fixtures/account-suspension-reference.mjs";

const sha="a".repeat(40),branch="feature/account-suspension";
const service="apps/backend/src/users/user.service.ts";
const testFile="tests/backend/user.service.test.ts";
const result={
 provider:"runner",performed:true,tool:"run_tests",status:"fail",
 branch,revision:sha,tested_commit_sha:sha,
 project_tests:{status:"fail"},researcher_acceptance:{status:"skipped"},
 phases:["dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"].map((phase,i)=>({
   phase,status:i<2?"pass":i===2?"fail":"skipped"
  })),failing_test_files:[testFile]
};
const input=(backend=[service],testWritten=[],created=[])=>({
 runnerOutcome:structuredClone(result),testedSha:sha,branch,
 observedWrites:{backend:new Set(backend),frontend:new Set(),test:new Set(testWritten)},
 observedTestCreates:new Set(created)
});
test("F4 verified source-fault fixture suggests source inspection, never claims cause",()=>{
 const broken=injectProjectTestFault(files[service]);
 assert.ok(broken.includes(PROJECT_TEST_FAULT));
 assert.notEqual(broken,files[service]);
 const d=diagnose(input([service]));
 assert.deepEqual(d.possible_investigations,["source_investigation"]);
 assert.equal(d.failed_test_created_by_test_count,0);
 assert.equal(d.causal_attribution,"not_established");
 assert.equal(d.permissions_issued,false);
 assert.equal(JSON.stringify(d).includes(service),false);
 assert.equal(JSON.stringify(d).includes(testFile),false);
});
test("F4 incorrect generated assertion with unchanged source suggests Test investigation",()=>{
 const faulty=injectGeneratedTestAssertionFault(files[testFile]);
 assert.ok(faulty.includes(GENERATED_TEST_WRONG_ASSERTION));
 assert.equal(files[service].includes(PROJECT_TEST_FAULT),false);
 const d=diagnose(input([], [testFile], [testFile]));
 assert.deepEqual(d.possible_investigations,["generated_test_investigation"]);
 assert.equal(d.original_source_write_candidate_count,0);
 assert.equal(d.failed_test_created_by_test_count,1);
 assert.equal(d.causal_attribution,"not_established");
 assert.equal(JSON.stringify(d).includes(testFile),false);
});
test("F4 real-style mixed authored source and generated test remains ambiguous",()=>{
 const d=diagnose(input([service],[testFile],[testFile]));
 assert.deepEqual(d.possible_investigations,
  ["source_investigation","generated_test_investigation"]);
 assert.equal(d.causal_attribution,"not_established");
 assert.equal(d.repair_task_created,false);
});
test("F4 no corroborated author creates no repair candidate or inferred blame",()=>{
 const d=diagnose(input([],[],[]));
 assert.deepEqual(d.possible_investigations,[]);
 assert.equal(d.causal_attribution,"not_established");
});
test("F4 stale SHA, multiple failure phases, invalid provenance, fabricated Runner all deny",()=>{
 const cases=[
  x=>{x.runnerOutcome.provider="gemini";},
  x=>{x.runnerOutcome.tested_commit_sha="b".repeat(40);},
  x=>{x.runnerOutcome.branch="feature/other";},
  x=>{x.runnerOutcome.phases[3].status="fail";},
  x=>{x.runnerOutcome.failing_test_files=["../secret.test.ts"];},
  x=>{x.runnerOutcome.failing_test_files=[testFile,testFile];},
  x=>{x.runnerOutcome.failing_test_files=[];},
  x=>{x.runnerOutcome.project_tests.status="pass";},
  x=>{x.runnerOutcome.researcher_acceptance.status="pass";},
  x=>{x.runnerOutcome.typecheck_error_codes=["TS2820"];},
  x=>{x.observedTestCreates.add("tests/backend/not-written.test.ts");},
  x=>{x.observedWrites.backend.add("../secret.ts");}
 ];
 for(const mutate of cases){
  const x=input([service],[testFile],[testFile]);mutate(x);
  assert.throws(()=>diagnose(x),/F4 project-test provenance NO-GO/);
 }
});
