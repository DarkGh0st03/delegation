import test from "node:test";
import assert from "node:assert/strict";
import {extractSafeGeminiPilotDockerEvidence as safe}
  from "../scripts/gemini-pilot-safe-docker-evidence.mjs";

const PHASES=["dependency_install","typecheck","backend_tests",
  "frontend_tests","build","playwright_e2e","researcher_acceptance"];
const prefix="[trusted-positive-ci] native_dag_failure ";
function sample(failed){
  let seenFailure=false;
  const phases=PHASES.map(phase=>{
    const status=seenFailure?"skipped":phase===failed?"fail":"pass";
    if(status==="fail")seenFailure=true;
    return {phase,status,secret:"NEVER_SHARE_PRIVATE_SOURCE"};
  });
  return {
    stage:"signed_dag_disposable_docker_acceptance",
    status:failed?"fail":"pass",
    project_tests:failed?"fail":"pass",
    researcher_acceptance:failed?"skipped":"pass",
    first_failed_phase:failed,
    phases,
    gemini_pilot_diagnostic:{model_turns_started:11,
      model_text:"HIDDEN_MODEL_PROMPT"},
    credentials:"HIDDEN_SIGNED_VP"
  };
}
test("Pilot artifact retains sanitized Docker failure with exact first failing phase",()=>{
  const content="GitHub log token HIDDEN_API_KEY\n"+
    "2026-10-28T09:55:31Z "+prefix+JSON.stringify(sample("typecheck"))+"\n"+
    "SECRET SOURCE CODE THAT MUST NEVER BE REPORTED\n";
  const result=safe(content);
  assert.equal(result?.status,"fail");
  assert.equal(result?.first_failed_phase,"typecheck");
  assert.equal(result?.phases.length,7);
  const publicBody=JSON.stringify(result);
  assert.doesNotMatch(publicBody,
    /HIDDEN_API_KEY|HIDDEN_MODEL_PROMPT|HIDDEN_SIGNED_VP|NEVER_SHARE_PRIVATE_SOURCE|SECRET SOURCE CODE/u);
});
test("Pilot diagnostic accepts a genuine passing Docker phase, not model prose",()=>{
  const result=safe(prefix+JSON.stringify(sample(null)));
  assert.equal(result?.status,"pass");
  assert.equal(result?.first_failed_phase,null);
});
test("Pilot artifact carries only verified TypeScript codes across double filtering",()=>{
  const payload={...sample("typecheck"),
    typecheck_error_codes:["TS2304","TS2322"],
    untrusted_compiler_output:"DO_NOT_EXPORT_PRIVATE_SOURCE",
    typecheck_diagnostics:[{path:"private/credentials.ts",line:1}]};
  const actual=safe(prefix+JSON.stringify(payload));
  assert.deepEqual(actual?.typecheck_error_codes,["TS2304","TS2322"]);
  const serialized=JSON.stringify(actual);
  assert.doesNotMatch(serialized,/DO_NOT_EXPORT_PRIVATE_SOURCE|credentials\.ts/u);
  for(const bad of [["TS2304;LEAK"],["TS2304","TS2304"],["TS2322","TS2304"]])
    assert.equal(safe(prefix+JSON.stringify({
      ...payload,typecheck_error_codes:bad
    })),null);
  assert.equal(safe(prefix+JSON.stringify({
    ...sample("frontend_tests"),typecheck_error_codes:["TS2304"]
  })),null);
});
test("Pilot diagnostic fails closed for malformed, forged or absent phase status",()=>{
  const fake=sample("frontend_tests");
  for(const line of [
    "Failed project tests but no structured Docker event",
    prefix+JSON.stringify({...fake,status:"pass"}),
    prefix+JSON.stringify({...fake,phases:[{phase:"forged",status:"fail"}]}),
    prefix+JSON.stringify({...fake,project_tests:"error"}),
    prefix+JSON.stringify({...fake,stage:"signed_test_review"}),
    prefix+JSON.stringify({...fake,status:"fail",phases:fake.phases.map(x=>({...x,status:"pass"}))}),
    prefix+JSON.stringify({...fake,phases:"/run/secrets/VP"})
  ])assert.equal(safe(line),null);
});
