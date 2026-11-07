import test from "node:test";
import assert from "node:assert/strict";
import {safeF1OfflinePlanningFailure as safe}
 from "../scripts/f1-safe-offline-planning-failure.mjs";
import {PREFIX,safeNativePhaseFailure}
 from "../../gateway/native-test/native-signed-dag-phase-diagnostic.mjs";

const secret="PRIVATE_GITEA_TOKEN_ROOT_KEY_AND_SOURCE_2026";
test("R275 F1 accepts only an independently validated native phase receipt",()=>{
 const error=Object.assign(new TypeError(secret),{code:"ERR_INVALID_ARG_TYPE"});
 const diagnostic=safeNativePhaseFailure(error,"native_issuer_initialization");
 const stderr="Bearer "+secret+"\n"+PREFIX+JSON.stringify(diagnostic)+"\n"+
   "stack "+secret;
 const observed=safe(Buffer.from(stderr,"utf8"));
 assert.equal(observed.event,"f1_offline_planning_child_failure_v1");
 assert.equal(observed.first_failed_phase,"native_issuer_initialization");
 assert.equal(observed.kind,"TypeError");
 assert.equal(observed.code,"ERR_INVALID_ARG_TYPE");
 assert.equal(observed.status,"fail");
 assert.equal(observed.category,diagnostic.category);
 assert.ok(Object.isFrozen(observed));
 assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_GITEA|ROOT_KEY|Bearer|source/u);
});
test("R275 missing, malformed and forged child diagnostics remain unclassified",()=>{
 for(const stderr of [
   null,"",Buffer.from("Bearer "+secret),
   PREFIX+JSON.stringify({stage:"private/"+secret,category:"unclassified",
    kind:"Error",code:"unknown"})+"\n",
   PREFIX+JSON.stringify({stage:"planning_scope",category:secret,
    kind:"Error",code:"unknown"})+"\n"
 ]){
   const result=safe(stderr);
   assert.equal(result.first_failed_phase,"unknown");
   assert.equal(result.category,"trusted_diagnostic_unavailable");
   assert.equal(result.code,"unknown");
   assert.doesNotMatch(JSON.stringify(result),/PRIVATE_GITEA|ROOT_KEY/u);
 }
});

test("R380.3 F1 publishes only fixed-category native Planning probe counters",()=>{
 const probe={event:"r3803_planning_failure_probe_v1",
  model_turns:3,verified_lists:1,verified_files:0,denied_reads:1,
  first_denial:"trusted_planning_read_failed",
  last_denial:"trusted_planning_read_failed",rejected_proposals:1,
  gateway_prepares:1,gateway_executions:1,gitea_reads:1,
  gateway_last_reason:"verifier_unavailable",
  single_verifier:"native_result_invalid",
  composite_verifier:"not_called"};
 const stderr="secret "+secret+"\n[r3803-planning-probe] "+
   JSON.stringify(probe)+"\n"+PREFIX+JSON.stringify(
     safeNativePhaseFailure(new Error(secret),"planning_scope"))+"\n";
 const observed=safe(stderr);
 assert.deepEqual(observed.r3803_probe,{
   model_turns:3,verified_lists:1,verified_files:0,denied_reads:1,
   first_denial:"trusted_planning_read_failed",
   last_denial:"trusted_planning_read_failed",rejected_proposals:1,
   gateway_prepares:1,gateway_executions:1,gitea_reads:1,
   gateway_last_reason:"verifier_unavailable",
   single_verifier:"native_result_invalid",
   composite_verifier:"not_called"
 });
 assert.equal(observed.first_failed_phase,"planning_scope");
 assert.ok(Object.isFrozen(observed.r3803_probe));
 assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_GITEA|ROOT_KEY|Bearer|secret/u);
});
test("R380.3 denies forged/oversized probe records without echoing source",()=>{
 const prefix="[r3803-planning-probe] ";
 const good={event:"r3803_planning_failure_probe_v1",
  model_turns:2,verified_lists:0,verified_files:0,denied_reads:1,
  first_denial:"outside_planning_scope",
  last_denial:"outside_planning_scope",rejected_proposals:0,
  gateway_prepares:0,gateway_executions:0,gitea_reads:1,
  gateway_last_reason:"none",
  single_verifier:"not_called",composite_verifier:"not_called"};
 for(const forged of [
   {...good,last_denial:secret},{...good,first_denial:secret},
   {...good,gateway_last_reason:secret},
   {...good,single_verifier:secret},
   {...good,composite_verifier:secret},
   {...good,gateway_prepares:-1},{...good,verified_files:-1},
   {...good,model_turns:100000},{...good,source:secret},
   {...good,last_denial:{message:secret}},
   {...good,event:"other"},
   null,[],{"__proto__":secret}
 ]){
   const receipt=safe(prefix+JSON.stringify(forged)+"\n");
   assert.equal(receipt.r3803_probe,undefined);
   assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE_GITEA|ROOT_KEY|secret/u);
 }
});
