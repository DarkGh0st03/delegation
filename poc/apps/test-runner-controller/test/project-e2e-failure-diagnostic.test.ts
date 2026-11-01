import test from "node:test";
import assert from "node:assert/strict";
import {extractProjectE2eFailureDiagnostic as extract,safeProjectE2eFailureDiagnostic as safe}
  from "../scripts/project-e2e-failure-diagnostic.mjs";
import {extractSafeGeminiPilotDockerEvidence} from "../scripts/gemini-pilot-safe-docker-evidence.mjs";

test("Playwright diagnostics retain fixed check IDs and numeric locations without test text",()=>{
  const raw="1) tests/e2e/user-profile.spec.ts:3:1 › PRIVATE_TITLE\n"+
    "Error: expect(locator).toBeVisible() failed\n"+
    "at /workspace/tests/e2e/user-profile.spec.ts:8:55\n"+
    "PRIVATE_EXPECTED_AND_RECEIVED\n";
  const result=extract(raw,"PRIVATE_CREDENTIAL",false);
  assert.deepEqual(result,{locations:[
    {check_id:"baseline_user_profile",line:3,column:1},
    {check_id:"baseline_user_profile",line:8,column:55}],
    failure_kinds:["visibility"],timed_out:false,unclassified_failure:false});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|tests\/|workspace|spec\.ts/);
  assert.equal(extract("unknown error","",true)?.unclassified_failure,true);
  assert.equal(extract("unknown error","",true)?.timed_out,true);
  const startup=extract("","Timed out waiting for port 3000",false);
  assert.deepEqual(startup?.failure_kinds,["startup_port_timeout"]);
  assert.equal(startup?.unclassified_failure,true);
});
test("Malformed and injected Playwright metadata cannot escape the public double filter",()=>{
  const summary=extract("tests/e2e/account-suspension.spec.ts:19:15\nexpect(locator).toBeVisible() failed","",false);
  const phases=["dependency_install","typecheck","backend_tests","frontend_tests","build",
    "playwright_e2e","researcher_acceptance"];
  const event={stage:"signed_dag_disposable_docker_acceptance",status:"fail",
    project_tests:"fail",researcher_acceptance:"skipped",
    phases:phases.map((phase,i)=>({phase,status:i<5?"pass":i===5?"fail":"skipped"})),
    project_e2e_failure:summary,source:"NEVER_PUBLISH_SOURCE"};
  const prefix="[trusted-positive-ci] native_dag_failure ";
  const published=extractSafeGeminiPilotDockerEvidence(prefix+JSON.stringify(event));
  assert.deepEqual(published?.project_e2e_failure,summary);
  assert.doesNotMatch(JSON.stringify(published),/NEVER_PUBLISH_SOURCE/);
  for(const invalid of [
    {...summary,secret:"LEAK"},{...summary,locations:[{check_id:"LEAK",line:1,column:1}]},
    {...summary,failure_kinds:["PRIVATE_ASSERTION"]},
    {...summary,locations:[{check_id:"baseline_user_profile",line:Infinity,column:1}]},
    {...summary,unclassified_failure:true},
    {...summary,locations:Array(9).fill(summary.locations[0])}
  ]){
    assert.equal(safe(invalid),null);
    assert.equal(extractSafeGeminiPilotDockerEvidence(prefix+JSON.stringify({
      ...event,project_e2e_failure:invalid})),null);
  }
  assert.equal(extractSafeGeminiPilotDockerEvidence(prefix+JSON.stringify({
    ...event,phases:event.phases.map(p=>p.phase==="backend_tests"?{...p,status:"fail"}:p)})),null);
});
