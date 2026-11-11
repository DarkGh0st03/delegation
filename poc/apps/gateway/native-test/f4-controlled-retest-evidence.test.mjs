import test from "node:test";
import assert from "node:assert/strict";
import {corroborateF4ControlledRetest as correlate}
 from "./f4-controlled-retest-evidence.mjs";
import {corroborateF4ProjectTestProvenance}
 from "./f4-project-test-provenance.mjs";
import {injectProjectTestFault,injectGeneratedTestAssertionFault}
 from "./offline-project-test-repair-fixture.mjs";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES as files}
 from "../../test-runner-controller/fixtures/account-suspension-reference.mjs";
const a="a".repeat(40),b="b".repeat(40),branch="feature/account-suspension";
const source="apps/backend/src/users/user.service.ts";
const testFile="tests/backend/user.service.test.ts";
const phases=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"];
const failed={
 provider:"runner",performed:true,tool:"run_tests",branch,revision:a,
 tested_commit_sha:a,status:"fail",project_tests:{status:"fail"},
 researcher_acceptance:{status:"skipped"},
 phases:phases.map((phase,i)=>({phase,status:i<2?"pass":i===2?"fail":"skipped"})),
 failing_test_files:[testFile]
};
const passed={
 provider:"runner",performed:true,tool:"run_tests",branch,revision:b,
 tested_commit_sha:b,status:"pass",project_tests:{status:"pass"},
 researcher_acceptance:{status:"pass"},
 phases:phases.map(phase=>({phase,status:"pass"}))
};
const p=(sourceWrites,testWrites,testCreated)=>corroborateF4ProjectTestProvenance({
 runnerOutcome:failed,testedSha:a,branch,
 observedWrites:{backend:new Set(sourceWrites),frontend:new Set(),
 test:new Set(testWrites)},observedTestCreates:new Set(testCreated)
});
const effect=(role,path)=>({taskId:"signed-repair-1",runtimeTaskId:"dispatch_"+"Z".repeat(22),
 credentialId:"urn:credential:repair-1",operation:"update_file",role,
 path,branch,commitSha:b});
test("F4 source regression: a real-style isolated source edit and independent PASS are observed, not blamed",()=>{
 assert.notEqual(injectProjectTestFault(files[source]),files[source]);
 const got=correlate({firstRunner:failed,recoveredRunner:passed,
  firstProvenance:p([source],[],[]),branch,repairWrites:[effect("backend",source)]});
 assert.equal(got.change_scope,"source_investigation");
 assert.equal(got.independent_acceptance_after,"pass");
 assert.equal(got.causal_attribution,"not_established");
 assert.equal(JSON.stringify(got).includes(source),false);
});
test("F4 wrong generated assertion: test-only edit and exact SHA PASS are separately visible",()=>{
 assert.notEqual(injectGeneratedTestAssertionFault(files[testFile]),files[testFile]);
 const got=correlate({firstRunner:failed,recoveredRunner:passed,
  firstProvenance:p([], [testFile],[testFile]),branch,
  repairWrites:[effect("test",testFile)]});
 assert.equal(got.change_scope,"generated_test_investigation");
 assert.equal(got.test_correctness_causality,"not_proven");
 assert.equal(JSON.stringify(got).includes(testFile),false);
});
test("F4 two edits never yield a falsely isolated attribution",()=>{
 const both=p([source],[testFile],[testFile]);
 const got=correlate({firstRunner:failed,recoveredRunner:passed,
  firstProvenance:both,branch,
  repairWrites:[effect("backend",source),effect("test",testFile)]});
 assert.equal(got.change_scope,"not_isolated");
 assert.equal(got.causal_attribution,"not_established");
});
test("F4 stale before/after SHA, false PASS and unapproved route fail closed",()=>{
 const input={firstRunner:failed,recoveredRunner:passed,
  firstProvenance:p([source],[],[]),branch,repairWrites:[effect("backend",source)]};
 for(const bad of [
  {...input,recoveredRunner:{...passed,tested_commit_sha:a}},
  {...input,recoveredRunner:{...passed,project_tests:{status:"fail"}}},
  {...input,recoveredRunner:{...passed,researcher_acceptance:{status:"skipped"}}},
  {...input,recoveredRunner:{...passed,phases:passed.phases.map((x,i)=>
   i===2?{...x,status:"fail"}:x)}},
  {...input,repairWrites:[effect("test",testFile)]},
  {...input,repairWrites:[{...effect("backend",source),commitSha:a}]},
  {...input,firstProvenance:{...input.firstProvenance,tested_commit_sha:b}},
  {...input,firstProvenance:{...input.firstProvenance,causal_attribution:"backend_fault"}}
 ])assert.throws(()=>correlate(bad),/F4 controlled retest NO-GO/);
});
