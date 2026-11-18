import test from "node:test";
import assert from "node:assert/strict";
import {APPROVED_SPECIALIZED_AGENT_PROFILES} from "../src/approved-specialized-profiles.ts";
import {createSpecializedAgentCard} from "../src/cards.ts";

test("specialist profiles contain only reusable role skills",()=>{
 for(const role of ["backend","frontend","test"] as const){
  const p=APPROVED_SPECIALIZED_AGENT_PROFILES[role];
  assert.equal(p.role,role);
  assert.equal(p.writable_paths.length,0);
  assert.equal(p.creatable_paths.length,0);
  assert.equal(p.read_only_paths.length,0);
  assert.ok(p.system_prompt.includes("trusted Orchestrator"));
 }
 assert.deepEqual(APPROVED_SPECIALIZED_AGENT_PROFILES.backend.tools,
  ["read_file","update_file","create_file"]);
 assert.deepEqual(APPROVED_SPECIALIZED_AGENT_PROFILES.frontend.tools,
  ["read_file","update_file","create_file"]);
 assert.deepEqual(APPROVED_SPECIALIZED_AGENT_PROFILES.test.tools,
  ["read_file","update_file","create_file","run_tests"]);
});

test("specialist profiles are immutable",()=>{
 assert.equal(Object.isFrozen(APPROVED_SPECIALIZED_AGENT_PROFILES),true);
 for(const p of Object.values(APPROVED_SPECIALIZED_AGENT_PROFILES)){
  assert.equal(Object.isFrozen(p),true);
  assert.equal(Object.isFrozen(p.tools),true);
  assert.equal(Object.isFrozen(p.writable_paths),true);
 }
});

test("Agent Cards advertise generic role capabilities only",()=>{
 for(const role of ["backend","frontend","test","docs","data","devops"] as const){
  const card=createSpecializedAgentCard(role,"http://127.0.0.1:9000");
  assert.equal(card.skills[0]?.tags?.includes("delegated-authorization"),true);
  assert.deepEqual(card.capabilities.extensions?.[0]?.params?.taskCapabilities,
   [...APPROVED_SPECIALIZED_AGENT_PROFILES[role].tools]);
 }
});
