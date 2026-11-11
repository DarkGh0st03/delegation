import test from "node:test";
import assert from "node:assert/strict";
import {
 safeEmbeddedEngineerD1Success,
 safeEmbeddedEngineerD1Failure
} from "../scripts/signed-d1-gate-observation.mjs";

const correct=Object.freeze({
 event:"signed_owner_d1_real_backend_test_repair_review",
 status:"PASS",
 original_rust_root_verified:true,
 independently_admitted_repair_epoch:true,
 original_root_retired:true,
 repaired_docker_pass_verified:true,
 corrected_exact_sha:"a".repeat(40),
 draft_pr_review_only:true,merged:false,
 automated_merge_calls:0,gemini_calls:0,
 untrusted_source:"DO_NOT_LOG_SECRET_DATA"
});

test("R237 success requires every independently verified repair/root/PR property",()=>{
 const valid=safeEmbeddedEngineerD1Success(
  "untrusted source BEFORE\n"+JSON.stringify(correct)+"\n");
 assert.equal(valid?.status,"PASS");
 assert.equal(valid?.repaired_exact_sha,"a".repeat(40));
 assert.equal(valid?.original_root_revoked,true);
 assert.equal(valid?.same_epoch_repair_docker_pass,true);
 assert.equal(valid?.paid_model_calls,0);
 assert.doesNotMatch(JSON.stringify(valid),/DO_NOT_LOG_SECRET_DATA|untrusted_source/u);
 assert.ok(Object.isFrozen(valid));
 for(const [key,value] of [
  ["original_rust_root_verified",false],
  ["independently_admitted_repair_epoch",false],
  ["original_root_retired",false],
  ["repaired_docker_pass_verified",false],
  ["draft_pr_review_only",false],
  ["merged",true],
  ["gemini_calls",1],
  ["automated_merge_calls",1],
  ["corrected_exact_sha","not-a-verified-commit"],
  ["status","FAIL"]
 ]){
  assert.equal(safeEmbeddedEngineerD1Success(JSON.stringify({
    ...correct,[key]:value
   })),null,key+" must reject positive release receipt");
 }
});

test("R237 failure reports safe phase, source module and cause without raw log leak",()=>{
 const detail={
  stage:"signed_dag_disposable_docker_acceptance",
  first_failed_phase:"backend_tests",
  assertion_location:{module:"native-planning-read-core-evm-e2e",line:1555},
  multi_test_diagnostic:{
    cause_category:"controlled_tool_failure",
    secret_token:"DONT_SHOW_ME"
  },
  arbitrary_error_text:"CRITICAL_PRIVATE_SOURCE_AND_BEARER"
 };
 const diag=safeEmbeddedEngineerD1Failure(
  "bad injected logs\n[trusted-positive-ci] native_dag_failure "+
   JSON.stringify(detail)+"\n");
 assert.equal(diag.status,"FAIL");
 assert.equal(diag.first_failed_phase,"backend_tests");
 assert.equal(diag.cause_category,"controlled_tool_failure");
 assert.deepEqual(diag.assertion_location,
  {module:"native-planning-read-core-evm-e2e",line:1555});
 assert.doesNotMatch(JSON.stringify(diag),
  /CRITICAL_PRIVATE_SOURCE_AND_BEARER|DONT_SHOW_ME/u);
 const unknown=safeEmbeddedEngineerD1Failure(
  "[trusted-positive-ci] native_dag_failure "+
  JSON.stringify({...detail,
   assertion_location:{module:"private-env-config",line:81},
   first_failed_phase:"private-phase",
   multi_test_diagnostic:{cause_category:"secret-material"}
  }));
 assert.equal(unknown.first_failed_phase,"unknown");
 assert.equal(unknown.cause_category,"unknown");
 assert.equal(Object.hasOwn(unknown,"assertion_location"),false);
 assert.equal(safeEmbeddedEngineerD1Failure("no structured failure").category,
  "no_structured_failure_evidence");
});
