/** F4 controlled-retest *observation*, not unique fault causality.
 * Trusted host passes its independently recorded provider-write journal.
 * No model claims, private paths, assertions, grants or raw bytes leave here. */
const SHA=/^[a-f0-9]{40}$/u;
const PHASES=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"];
const deny=()=>{throw Error("F4 controlled retest NO-GO");};
export function corroborateF4ControlledRetest({
 firstRunner,recoveredRunner,firstProvenance,branch,repairWrites
}={}){
 if(!SHA.test(firstRunner?.tested_commit_sha??"")||
    !SHA.test(recoveredRunner?.tested_commit_sha??"")||
    firstRunner.tested_commit_sha===recoveredRunner.tested_commit_sha||
    firstRunner?.provider!=="runner"||recoveredRunner?.provider!=="runner"||
    firstRunner?.performed!==true||recoveredRunner?.performed!==true||
    firstRunner.tool!=="run_tests"||recoveredRunner.tool!=="run_tests"||
    firstRunner.branch!==branch||recoveredRunner.branch!==branch||
    firstRunner.revision!==firstRunner.tested_commit_sha||
    recoveredRunner.revision!==recoveredRunner.tested_commit_sha||
    firstRunner.status!=="fail"||recoveredRunner.status!=="pass"||
    firstRunner.project_tests?.status!=="fail"||
    firstRunner.researcher_acceptance?.status!=="skipped"||
    recoveredRunner.project_tests?.status!=="pass"||
    recoveredRunner.researcher_acceptance?.status!=="pass"||
    !Array.isArray(recoveredRunner.phases)||
    recoveredRunner.phases.length!==PHASES.length||
    recoveredRunner.phases.some((x,i)=>x?.phase!==PHASES[i]||x.status!=="pass")||
    firstProvenance?.status!=="f4_verified_runner_provenance"||
    firstProvenance.tested_commit_sha!==firstRunner.tested_commit_sha||
    firstProvenance.causal_attribution!=="not_established"||
    firstProvenance.permissions_issued!==false||
    !Array.isArray(firstProvenance.possible_investigations)||
    !Array.isArray(repairWrites)||repairWrites.length>32)deny();
 let route="not_isolated";
 if(repairWrites.length===1){
  const w=repairWrites[0];
  if(!w||!["backend","frontend","test"].includes(w.role)||
     typeof w.taskId!=="string"||!w.taskId||
     typeof w.runtimeTaskId!=="string"||
     !/^dispatch_[A-Za-z0-9_-]{22}$/u.test(w.runtimeTaskId)||
     typeof w.credentialId!=="string"||!w.credentialId||
     typeof w.path!=="string"||!w.path||
     !["update_file","create_file"].includes(w.operation)||
     w.branch!==branch||w.commitSha!==recoveredRunner.tested_commit_sha)deny();
  route=w.role==="test"?"generated_test_investigation":"source_investigation";
  if(!firstProvenance.possible_investigations.includes(route)||
     w.role!=="test"&&w.role!==(firstProvenance.failed_phase==="backend_tests"?
       "backend":"frontend"))deny();
 }
 return Object.freeze({
  status:"f4_verified_controlled_retest_observation",
  failed_sha:firstRunner.tested_commit_sha,
  passed_sha:recoveredRunner.tested_commit_sha,
  project_tests_after:"pass",independent_acceptance_after:"pass",
  change_scope:route,
  owner_observed_repair_write_count:repairWrites.length,
  causal_attribution:"not_established",
  test_correctness_causality:"not_proven",
  permissions_issued:false
 });
}
