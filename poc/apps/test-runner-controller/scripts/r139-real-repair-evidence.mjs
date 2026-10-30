/**
 * R139 non-authorizing evidence for TWO real Docker Runner runs on a
 * disposable Gitea branch. This is a provider-level fixture only:
 * NOT an R133 admitted signed root/Child DC, NOT a human-approved run.
 * Source-free; never substitute for Rust/Gateway task attestation.
 */
const SHA=/^[a-f0-9]{40}$/u;
const TASK=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const fail=(s)=>{throw Error("R139 real Docker evidence NO-GO: "+s);};
const valid=(r)=>r&&typeof r==="object"&&!Array.isArray(r)&&
 Array.isArray(r.phases)&&r.runner_profile==="poc-default"&&
 typeof r.repository==="string"&&typeof r.branch==="string";
export function verifyR139RealRepairEvidence(input){
 const {failed,passed,failedSha,repairedSha,branch,failedTaskId,
  repairTaskId,passedTaskId}=input??{};
 if(!SHA.test(failedSha??"")||!SHA.test(repairedSha??"")||
    failedSha===repairedSha||typeof branch!=="string"||
    !branch.startsWith("feature/")||
    !TASK.test(failedTaskId??"")||
    !TASK.test(repairTaskId??"")||
    !TASK.test(passedTaskId??"")||
    new Set([failedTaskId,repairTaskId,passedTaskId]).size!==3)
  fail("two immutable SHAs and three distinct Task IDs required");
 if(!valid(failed)||!valid(passed)||
    failed.repository!=="gitea://gitea.local/thesis/iam-console-poc"||
    passed.repository!==failed.repository||
    failed.branch!==branch||passed.branch!==branch||
    failed.tested_commit_sha!==failedSha||
    passed.tested_commit_sha!==repairedSha||
    failed.request_id===passed.request_id||
    failed.status!=="fail"||failed.project_tests?.status!=="fail"||
    failed.phases.some(p=>p.phase==="researcher_acceptance"&&p.status==="pass")||
    !failed.phases.some(p=>p.phase==="backend_tests"&&p.status==="fail")||
    passed.status!=="pass"||passed.project_tests?.status!=="pass"||
    passed.researcher_acceptance?.status!=="pass"||
    !passed.phases.some(p=>p.phase==="backend_tests"&&p.status==="pass")||
    passed.phases.some(p=>p.status!=="pass")||
    failed.phases.some(p=>!["pass","fail","skipped"].includes(p.status)))
  fail("actual exact-SHA Runner FAIL then PASS results do not corroborate");
 return Object.freeze({
  status:"r139_disposable_real_docker_repair_provider_verified_no_delegation",
  failed_sha:failedSha,repaired_sha:repairedSha,branch,
  failed_test_task_id:failedTaskId,repair_task_id:repairTaskId,
  new_test_task_id:passedTaskId,
  failed_project_tests:"fail",repaired_project_tests:"pass",
  repaired_researcher_acceptance:"pass",
  real_runner_exact_sha_evidence:true,
  root_vp_verified:false,gateway_repair_epoch_admitted:false,
  rust_repair_child_issued:false,review_only_pr_opened:false,
  merger_authorized:false
 });
}
