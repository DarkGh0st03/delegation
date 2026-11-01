/**
 * Owner-private, fail-closed choice of an INVESTIGATION route after
 * independently authenticated Docker project-test failure.
 *
 * Candidate identity is not causal attribution and the model choice never
 * grants a permission. A newly signed D1 plan still passes original-root
 * subset checks, Gateway VP/Rust verification, and OPA before any write.
 */
const SHA=/^[a-f0-9]{40}$/u;
const SOURCE_STATUSES=new Set([
 "verified_runner_single_file_repair_target",
 "verified_runner_multi_file_repair_targets",
 "verified_acceptance_single_file_repair_candidate",
 "verified_original_acceptance_repair_scope",
 "verified_original_project_test_repair_scope"
]);
const TEST_STATUS="verified_original_generated_test_edit_scope";
const PROJECT_PHASES=new Set(["backend_tests","frontend_tests"]);
const deny=()=>{throw Error("Trusted D1 repair scope routing NO-GO");};

export async function selectTrustedD1RepairScope({
 testedSha,sourceTarget,generatedTestTarget,chooseInvestigation
}={}){
 if(!SHA.test(testedSha??""))deny();
 const source=sourceTarget??null,test=generatedTestTarget??null;
 if(source&&(!SOURCE_STATUSES.has(source.status)||
    source.tested_commit_sha!==testedSha))deny();
 if(test&&(test.status!==TEST_STATUS||
    test.tested_commit_sha!==testedSha||
    test.causal_attribution!=="not_established"||
    !Array.isArray(test.candidates)||
    test.candidates.length<1||test.candidates.length>8||
    test.candidates.some(x=>x?.role!=="test"||
      typeof x.resource!=="string")))deny();
 if(source&&test){
  // Both options must describe exactly the SAME Runner failure. A stale or
  // independent event is not an excuse to silently choose the source.
  if(source.status!=="verified_original_project_test_repair_scope"||
     source.causal_attribution!=="not_established"||
     !PROJECT_PHASES.has(source.project_test_failure?.phase)||
     JSON.stringify(source.project_test_failure)!==
       JSON.stringify(test.project_test_failure)||
     !Array.isArray(source.candidates)||
     source.candidates.length<1||source.candidates.length>8||
     source.candidates.some(x=>
       !["backend","frontend"].includes(x?.role)||
       typeof x.resource!=="string")||
     typeof chooseInvestigation!=="function")deny();
  const observation=Object.freeze({
   tested_commit_sha:testedSha,
   failed_phase:source.project_test_failure.phase,
   source_candidate_count:source.candidates.length,
   test_candidate_count:test.candidates.length,
   causal_attribution:"not_established"
  });
  // Only the two exact, pre-verified routes are acceptable. No fallbacks.
  const mode=await chooseInvestigation(observation);
  if(mode!=="original_source"&&mode!=="generated_test_investigation")deny();
  return Object.freeze({
   mode,target:mode==="original_source"?source:test,
   causal_attribution:"not_established"
  });
 }
 if(source)return Object.freeze({mode:"original_source",target:source});
 if(test)return Object.freeze({
  mode:"generated_test_investigation",target:test,
  causal_attribution:"not_established"
 });
 deny();
}
