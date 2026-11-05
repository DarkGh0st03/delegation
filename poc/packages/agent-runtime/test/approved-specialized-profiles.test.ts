import test from "node:test";
import assert from "node:assert/strict";
import {APPROVED_SPECIALIZED_AGENT_PROFILES} from "../src/approved-specialized-profiles.ts";
import {SPECIALIZED_AGENT_PROFILES} from "../src/specialized-agents.ts";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";

test("R198 approved specialist identities contain only reusable role skills",()=>{
 for(const role of ["backend","frontend","test"] as const){
  const p=APPROVED_SPECIALIZED_AGENT_PROFILES[role];
  assert.equal(p.role,role);
  assert.equal(p.writable_paths.length,0);
  assert.equal(p.creatable_paths.length,0);
  assert.equal(p.read_only_paths.length,0);
  for(const text of [p.skill,p.system_prompt]){
   assert.doesNotMatch(text,/account suspension|suspend user|reactivate user|iam console|feature\/account-suspension|UserDetailPage|user\.service/i);
  }
  assert.ok(p.system_prompt.includes("trusted Orchestrator"));
  assert.notEqual(p.system_prompt,SPECIALIZED_AGENT_PROFILES[role].system_prompt);
 }
 assert.deepEqual(APPROVED_SPECIALIZED_AGENT_PROFILES.backend.tools,
  ["read_file","update_file","create_file"]);
 assert.deepEqual(APPROVED_SPECIALIZED_AGENT_PROFILES.frontend.tools,
  ["read_file","update_file","create_file"]);
 assert.deepEqual(APPROVED_SPECIALIZED_AGENT_PROFILES.test.tools,
  ["read_file","update_file","create_file","run_tests"]);
});

test("R198 generic approved baseline is immutable and separate from legacy fixtures",()=>{
 assert.equal(Object.isFrozen(APPROVED_SPECIALIZED_AGENT_PROFILES),true);
 for(const p of Object.values(APPROVED_SPECIALIZED_AGENT_PROFILES)){
  assert.equal(Object.isFrozen(p),true);
  assert.equal(Object.isFrozen(p.tools),true);
  assert.equal(Object.isFrozen(p.writable_paths),true);
 }
});

// The actual signed ADK constructor is exercised by the existing
// adk-specialized-agents.test.ts, including independent Task file grants.
test("R198 signed ADK factory binds generic baseline before dynamically using grants",async()=>{
 const {readFileSync}=await import("node:fs");
 const src=readFileSync(new URL("../src/adk-specialized-agents.ts",import.meta.url),"utf8");
 assert.match(src,/signedTask\s*\?\s*APPROVED_SPECIALIZED_AGENT_PROFILES\[config\.role\]/u);
 assert.match(src,/: LEGACY_ACCOUNT_SUSPENSION_PROFILES\[config\.role\]/u);
 assert.match(src,/trustedFilePermissions!==undefined/u);
 assert.doesNotMatch(APPROVED_SPECIALIZED_AGENT_PROFILES.frontend.system_prompt,
  /Account Suspension/u);
 assert.equal(typeof createAdkSpecializedAgent,"function");
});

test("R199 generic Agent Card is the default and scenario content is an explicit fixture",async()=>{
 const {createSpecializedAgentCard}=await import("../src/cards.ts");
 for(const role of ["backend","frontend","test"] as const){
  const card=createSpecializedAgentCard(role,"http://127.0.0.1:9000");
  assert.equal(card.skills[0]?.tags?.includes("delegated-authorization"),true);
  assert.doesNotMatch(JSON.stringify(card),/Account Suspension|account-suspension|feature\/account-suspension/u);
  const archived=createSpecializedAgentCard(role,"http://127.0.0.1:9000",{
   capabilityProfile:"legacy"
  });
  assert.match(JSON.stringify(archived),/account-suspension|Account Suspension/u);
  assert.equal(card.capabilities.extensions?.[0]?.params?.agentDid,
   archived.capabilities.extensions?.[0]?.params?.agentDid);
 }
});
