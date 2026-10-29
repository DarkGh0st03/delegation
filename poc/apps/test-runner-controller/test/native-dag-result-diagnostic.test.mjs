import test from "node:test";
import assert from "node:assert/strict";
import {safeNativeDockerFailureDiagnostic as safe}
  from "../scripts/native-dag-result-diagnostic.mjs";

const phases=["dependency_install","typecheck","backend_tests",
  "frontend_tests","build","playwright_e2e","researcher_acceptance"];
function event(failedPhase){
  let failure=false;
  return {
    status:failedPhase?"fail":"pass",
    phases:phases.map(phase=>{
      const state=failure?"skipped":phase===failedPhase?"fail":"pass";
      if(state==="fail")failure=true;
      return {phase,status:state,private_log:"do-not-export-token"};
    }),
    project_tests:failedPhase?"fail":"pass",
    researcher_acceptance:failedPhase?"skipped":"pass",
    sensitive_metadata:"SENSITIVE_PRIVATE_KEY_DO_NOT_OUTPUT"
  };
}
test("R5 native Docker CI surfaces only failed phase name from untrusted child stderr",()=>{
  const payload=event("dependency_install");
  const raw="Bearer abc-secret\n"+
    "[native-dag-adk] docker_phase_status "+JSON.stringify(payload)+"\n"+
    "application source, login and secret keys\n";
  const result=safe(Buffer.from(raw));
  assert.equal(result.first_failed_phase,"dependency_install");
  assert.equal(result.project_tests,"fail");
  assert.equal(result.researcher_acceptance,"skipped");
  assert.equal(result.phases.length,7);
  const message=JSON.stringify(result);
  assert.doesNotMatch(message,/abc-secret|SENSITIVE_PRIVATE_KEY|do-not-export-token|application source/u);
});
test("R5 native Docker failure diagnosis supports every exact phase and benign success",()=>{
  for(const name of phases.slice(0,-1)){
    const result=safe("[native-dag-adk] docker_phase_status "+
      JSON.stringify(event(name))+"\n");
    assert.equal(result.first_failed_phase,name);
    assert.equal(result.status,"fail");
  }
  const success=safe("[native-dag-adk] docker_phase_status "+
    JSON.stringify(event(null)));
  assert.equal(success.status,"pass");
  assert.equal(success.first_failed_phase,null);
});
test("Typecheck codes survive without paths or compiler messages",()=>{
  const payload={...event("typecheck"),
    typecheck_error_codes:["TS2304","TS2322"],
    compiler_message:"SECRET_SOURCE_NEVER_PUBLISH",
    typecheck_diagnostics:[{path:"private/path.ts",line:4}]};
  const parsed=safe("[native-dag-adk] docker_phase_status "+
    JSON.stringify(payload));
  assert.deepEqual(parsed.typecheck_error_codes,["TS2304","TS2322"]);
  assert.ok(!JSON.stringify(parsed).includes("SECRET_SOURCE_NEVER_PUBLISH"));
  assert.ok(!JSON.stringify(parsed).includes("private/path.ts"));
});
test("Typecheck codes reject injected, duplicate, out-of-order or non-typecheck metadata",()=>{
  const prefix="[native-dag-adk] docker_phase_status ";
  for(const codes of [["TS2304;SECRET"],["TS2304","TS2304"],
    ["TS2322","TS2304"],["TS999999"],[],Array(9).fill("TS2304")]){
    assert.equal(safe(prefix+JSON.stringify({
      ...event("typecheck"),typecheck_error_codes:codes
    })),null);
  }
  assert.equal(safe(prefix+JSON.stringify({
    ...event("frontend_tests"),typecheck_error_codes:["TS2304"]
  })),null);
});
test("R5 malformed/fabricated Docker event never prints raw secret material",()=>{
  const errors=[
    "Bearer opaque-secret",
    "[native-dag-adk] docker_phase_status "+JSON.stringify({
      ...event("typecheck"),phases:[{phase:"arbitrary",status:"fail"}]
    }),
    "[native-dag-adk] docker_phase_status "+JSON.stringify({
      ...event("typecheck"),status:"pass"
    }),
    "[native-dag-adk] docker_phase_status "+JSON.stringify({
      ...event("typecheck"),project_tests:"success"
    }),
    "[native-dag-adk] docker_phase_status "+
      JSON.stringify({status:"fail",phases:"../etc/secrets"})
  ];
  for(const line of errors)assert.equal(safe(line),null);
});
