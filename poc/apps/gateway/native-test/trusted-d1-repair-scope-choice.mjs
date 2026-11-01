/**
 * Trusted owner-private D1 scope routing. Candidate evidence never grants
 * permissions and never establishes which agent caused the test failure.
 *
 * A verified original Backend/Frontend scope retains priority. Only when
 * that scope is unavailable may an independently verified, originally
 * authorized generated-Test edit scope be considered for investigation.
 * The subsequent ADK draft and signed epoch planner still verify all grants.
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
const deny=()=>{throw Error("Trusted D1 repair scope routing NO-GO");};

export function selectTrustedD1RepairScope({
 testedSha,sourceTarget,generatedTestTarget
}={}){
 if(!SHA.test(testedSha??""))deny();
 if(sourceTarget!==null&&sourceTarget!==undefined){
  if(!SOURCE_STATUSES.has(sourceTarget?.status)||
     sourceTarget.tested_commit_sha!==testedSha)deny();
  return Object.freeze({mode:"original_source",target:sourceTarget});
 }
 if(generatedTestTarget!==null&&generatedTestTarget!==undefined){
  if(generatedTestTarget?.status!==TEST_STATUS||
     generatedTestTarget.tested_commit_sha!==testedSha||
     !Array.isArray(generatedTestTarget.candidates)||
     generatedTestTarget.candidates.length<1||
     generatedTestTarget.candidates.length>8)deny();
  return Object.freeze({mode:"generated_test_investigation",target:generatedTestTarget});
 }
 deny();
}
