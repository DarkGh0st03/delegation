/**
 * R150.4: real native dispatcher -> original trusted owner recovery boundary.
 * Used by the paid-capable native harness, but never starts a model.
 *
 * A suspended original DAG is terminal. Only a separately Gateway-confirmed
 * Test FAIL may enter the original-root-bound owner continuation. The
 * continuation can admit new signed D1 child Tasks but CANNOT assert final
 * Runner PASS, PR review authority or a successful original DAG.
 *
 * All control paths, including callback failures, retire the original
 * operational authority and require confirmed native closure.
 */
export async function completeNativeVerifiedFailureHandoff({
  result,coordinator,sessionId,rootPlanDigest,operationalRootId,
  trustedOwnerRecovery,onPilotPhase
}){
  if(result?.status!=="verified_test_failure_suspended")
    throw Error("R150.4 requires a suspended original signed DAG");
  const proof=result.verified_test_failure;
  try{
    if(!trustedOwnerRecovery||
       typeof trustedOwnerRecovery.continueWithinActiveRoot!=="function"||
       !proof||proof.status!=="repair_planning_eligible"||
       proof.provenance!=="gateway_verified_docker_runner"||
       proof.authority_kind!=="existing_rust_operational_root"||
       proof.session_id!==sessionId||
       proof.root_plan_digest!==rootPlanDigest||
       proof.execution_authorized!==false||
       proof.permission_granted!==false||
       coordinator?.phase!=="execution")
      throw Error("R150.4 owner-bound verified Test FAIL not eligible");
    const root=coordinator.trustedOperationalAuthority();
    if(root.credential_id!==operationalRootId||
       root.plan_digest!==rootPlanDigest)
      throw Error("R150.4 current original Rust authority mismatch");
    onPilotPhase?.("trusted_owner_repair_handoff");
    await trustedOwnerRecovery.continueWithinActiveRoot(proof);
    if(coordinator.phase!=="execution")
      throw Error("R150.4 root retired unexpectedly during owner recovery");
    const after=coordinator.trustedOperationalAuthority();
    if(after.credential_id!==root.credential_id||
       after.plan_digest!==root.plan_digest)
      throw Error("R150.4 original Rust root changed during recovery");
  }finally{
    // Never leave an operational root alive after a failed or uncertain
    // recovery callback. The caller must have supplied the real Coordinator.
    if(coordinator.phase==="execution")await coordinator.closeExecution();
    await coordinator.assertOperationalClosureConfirmed();
  }
  return Object.freeze({
    status:"trusted_owner_repair_handoff_retired",
    original_dag_completed:false,
    original_signed_plan_digest:rootPlanDigest,
    original_test_sha:proof.tested_commit_sha,
    failed_phase:proof.first_failed_phase,
    repair_epoch_handoff:true,
    original_root_revoked:true,
    final_runner_pass_verified:false,
    pull_request_created:false,
    merge_calls:0
  });
}
