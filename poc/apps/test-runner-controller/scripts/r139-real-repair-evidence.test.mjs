import test from "node:test";
import assert from "node:assert/strict";
import {verifyR139RealRepairEvidence} from "./r139-real-repair-evidence.mjs";
const shaA="a".repeat(40),shaB="b".repeat(40);
const branch="feature/r139-disposable-repair";
const phase=(n,status)=>({phase:n,status});
const failed={
 request_id:"r139-test-fail",repository:"gitea://gitea.local/thesis/iam-console-poc",
 branch,tested_commit_sha:shaA,runner_profile:"poc-default",
 status:"fail",project_tests:{status:"fail"},
 researcher_acceptance:{status:"skipped"},
 phases:[phase("dependency_install","pass"),phase("typecheck","pass"),
  phase("backend_tests","fail"),phase("frontend_tests","skipped")]
};
const passed={
 ...failed,request_id:"r139-test-pass",tested_commit_sha:shaB,
 status:"pass",project_tests:{status:"pass"},
 researcher_acceptance:{status:"pass"},
 phases:[phase("dependency_install","pass"),phase("typecheck","pass"),
  phase("backend_tests","pass"),phase("frontend_tests","pass"),
  phase("build","pass"),phase("playwright_e2e","pass"),
  phase("researcher_acceptance","pass")]
};
const good=()=>({failed,passed,failedSha:shaA,repairedSha:shaB,branch,
 failedTaskId:"test-initial",repairTaskId:"backend-repair",
 passedTaskId:"test-repair",failedPhase:"backend_tests"});
test("R139 real-runner evidence stays explicitly non-authorizing",()=>{
 const x=verifyR139RealRepairEvidence(good());
 assert.equal(x.real_runner_exact_sha_evidence,true);
 assert.equal(x.failed_phase,"backend_tests");
 assert.equal(x.gateway_repair_epoch_admitted,false);
 assert.equal(x.rust_repair_child_issued,false);
 assert.equal(x.review_only_pr_opened,false);
 assert.equal(x.merger_authorized,false);
});
test("R150 real typecheck fault is accepted only with an exact failure-phase receipt",()=>{
 const typecheckFailed={...failed,phases:[
  phase("dependency_install","pass"),phase("typecheck","fail"),
  phase("backend_tests","skipped"),phase("frontend_tests","skipped")
 ],typecheck_error_codes:["TS2820"]};
 const proof=verifyR139RealRepairEvidence({
  ...good(),failed:typecheckFailed,failedPhase:"typecheck"
 });
 assert.equal(proof.failed_phase,"typecheck");
 assert.throws(()=>verifyR139RealRepairEvidence({
  ...good(),failed:typecheckFailed,failedPhase:"backend_tests"
 }),/R139 real Docker evidence NO-GO/);
 assert.throws(()=>verifyR139RealRepairEvidence({
  ...good(),failed:{...typecheckFailed,
   phases:[phase("dependency_install","pass"),phase("typecheck","fail"),
    phase("backend_tests","fail")]},failedPhase:"typecheck"
 }),/R139 real Docker evidence NO-GO/);
});
test("R139 rejects stale SHA, same-Task retry and invented PASS",()=>{
 for(const change of [
  {repairedSha:shaA},
  {passedTaskId:"test-initial"},
  {passed:{...passed,tested_commit_sha:shaA}},
  {passed:{...passed,project_tests:{status:"fail"}}},
  {passed:{...passed,researcher_acceptance:{status:"fail"}}},
  {failed:{...failed,status:"pass"}},
  {failed:{...failed,phases:[phase("backend_tests","pass")]}},
  {passed:{...passed,phases:[phase("backend_tests","skipped")]}},
  {passed:{...passed,request_id:"r139-test-fail"}}
 ]){
  assert.throws(()=>verifyR139RealRepairEvidence({...good(),...change}),
   /R139 real Docker evidence NO-GO/);
 }
});
