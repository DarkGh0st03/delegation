/**
 * R275: F1's scripted planning subprocess may print source, Gitea tokens or
 * private Rust diagnostics to stderr. Re-emit ONLY the existing trusted
 * finite native-phase receipt; missing/invalid evidence remains explicit.
 */
import {readNativePhaseFailure}
 from "../../gateway/native-test/native-signed-dag-phase-diagnostic.mjs";

const PROBE_PREFIX="[r3803-planning-probe] ";
const DENIALS=new Set(["none","trusted_planning_read_failed",
 "outside_planning_scope","read_budget","planning_deadline",
 "composite_unavailable","other"]);
const VERIFIER_PHASES=new Set([
 "not_called","verified","native_result_invalid",
 "native_verification_rejected","other"
]);
const GATEWAY_REASONS=new Set([
 "none","verification_rejected","verifier_unavailable","policy_denied",
 "provider_unavailable","trusted_binding_denied",
 "verified_only_no_provider","provider_mismatch","other"
]);
function boundedR3803Probe(stderr){
 const raw=Buffer.isBuffer(stderr)?stderr.toString("utf8"):
   typeof stderr==="string"?stderr:"";
 for(const line of raw.slice(-65536).split(/\r?\n/u).reverse()){
   if(!line.startsWith(PROBE_PREFIX)||line.length>512)continue;
   let item;
   try{item=JSON.parse(line.slice(PROBE_PREFIX.length));}catch{continue;}
   if(!item||typeof item!=="object"||Array.isArray(item)||
      item.event!=="r3803_planning_failure_probe_v1"||
      Object.keys(item).sort().join("|")!==[
       "event","model_turns","verified_lists","verified_files",
       "denied_reads","first_denial","last_denial","rejected_proposals",
       "gateway_prepares","gateway_executions","gitea_reads",
       "gateway_last_reason","single_verifier","composite_verifier"
      ].sort().join("|")||
      !DENIALS.has(item.first_denial)||!DENIALS.has(item.last_denial)||
      !GATEWAY_REASONS.has(item.gateway_last_reason)||
      !VERIFIER_PHASES.has(item.single_verifier)||
      !VERIFIER_PHASES.has(item.composite_verifier)||
      ["model_turns","verified_lists","verified_files","denied_reads",
       "rejected_proposals","gateway_prepares","gateway_executions",
       "gitea_reads"].some(k=>!Number.isSafeInteger(item[k])||
        item[k]<0||item[k]>100))continue;
   return Object.freeze({
     model_turns:item.model_turns,
     verified_lists:item.verified_lists,
     verified_files:item.verified_files,
     denied_reads:item.denied_reads,
     first_denial:item.first_denial,
     last_denial:item.last_denial,
     rejected_proposals:item.rejected_proposals,
     gateway_prepares:item.gateway_prepares,
     gateway_executions:item.gateway_executions,
     gitea_reads:item.gitea_reads,
     gateway_last_reason:item.gateway_last_reason,
     single_verifier:item.single_verifier,
     composite_verifier:item.composite_verifier
   });
 }
 return null;
}

export function safeF1OfflinePlanningFailure(stderr){
 const verified=readNativePhaseFailure(stderr);
 const r3803=boundedR3803Probe(stderr);
 return Object.freeze({
  event:"f1_offline_planning_child_failure_v1",
  status:"fail",
  first_failed_phase:verified?.stage??"unknown",
  category:verified?.category??"trusted_diagnostic_unavailable",
  kind:verified?.kind??"unknown",
  code:verified?.code??"unknown",
  ...(r3803?{r3803_probe:r3803}:{}),
  ...(verified?.assertion_location?
    {assertion_location:verified.assertion_location}:{}),
  ...(verified?.failure_trace?
    {failure_trace:verified.failure_trace}:{})
 });
}
