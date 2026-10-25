/**
 * Read-only runner rendezvous status for BOTH the charged and no-charge
 * workflows. This cannot grant Engineer approval, select a run, or issue
 * credentials. A terminal "completed_verified" must be derived only from
 * an originally selected run, a CLOSED trusted handoff, confirmed final
 * root closure, and its independently verified successful DAG outcome.
 *
 * Failing closed is important: "waiting_for_owner" for an orphaned/cold
 * Engineer host would strand a self-hosted GitHub worker indefinitely,
 * and "completed_verified" during operational teardown would falsely
 * certify closure while a delegated root may remain live.
 */
export function trustedEngineerRunStatus(input){
  const {hostClosed,selectedRunId,queriedRunId,
    coordinatorPhase,handoffStatus,verifiedOutcome}=input??{};
  if(hostClosed!==false)return "terminated";
  if(selectedRunId!==undefined&&selectedRunId!==queriedRunId)
    return "terminated";
  if(selectedRunId===undefined){
    return coordinatorPhase==="planning"&&handoffStatus==="idle"
      ?"waiting_for_owner":"terminated";
  }
  if(verifiedOutcome==="verified_complete"){
    return handoffStatus==="closed"&&coordinatorPhase==="closed"
      ?"completed_verified":"terminated";
  }
  if(verifiedOutcome==="failed"||
     handoffStatus==="failed"||handoffStatus==="closed")
    return "terminated";
  if(["starting","active","closing"].includes(handoffStatus))
    return "execution_active";
  return "terminated";
}
