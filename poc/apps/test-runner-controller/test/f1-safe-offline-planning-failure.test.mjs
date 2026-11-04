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
