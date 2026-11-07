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
       "denied_reads","last_denial","rejected_proposals"
      ].sort().join("|")||
      !DENIALS.has(item.last_denial)||
      ["model_turns","verified_lists","verified_files","denied_reads",
       "rejected_proposals"].some(k=>!Number.isSafeInteger(item[k])||
        item[k]<0||item[k]>100))continue;
   return Object.freeze({
     model_turns:item.model_turns,
     verified_lists:item.verified_lists,
     verified_files:item.verified_files,
     denied_reads:item.denied_reads,
     last_denial:item.last_denial,
     rejected_proposals:item.rejected_proposals
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
