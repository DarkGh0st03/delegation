/**
 * R275: F1's scripted planning subprocess may print source, Gitea tokens or
 * private Rust diagnostics to stderr. Re-emit ONLY the existing trusted
 * finite native-phase receipt; missing/invalid evidence remains explicit.
 */
import {readNativePhaseFailure}
 from "../../gateway/native-test/native-signed-dag-phase-diagnostic.mjs";

export function safeF1OfflinePlanningFailure(stderr){
 const verified=readNativePhaseFailure(stderr);
 return Object.freeze({
  event:"f1_offline_planning_child_failure_v1",
  status:"fail",
  first_failed_phase:verified?.stage??"unknown",
  category:verified?.category??"trusted_diagnostic_unavailable",
  kind:verified?.kind??"unknown",
  code:verified?.code??"unknown",
  ...(verified?.assertion_location?
    {assertion_location:verified.assertion_location}:{}),
  ...(verified?.failure_trace?
    {failure_trace:verified.failure_trace}:{})
 });
}
