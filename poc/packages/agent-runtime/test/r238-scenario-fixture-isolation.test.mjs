import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=relative=>readFileSync(new URL("../src/"+relative,import.meta.url),"utf8");

test("R238 shared specialized-agent controller has no hardcoded feature tasks, paths or skill prompts",()=>{
 const module=read("specialized-agents.ts");
 assert.doesNotMatch(module,/const BRANCH\s*=|function prompt\(|const BACKEND_WRITABLE|const TEST_CREATABLE/u);
 assert.doesNotMatch(module,/in the Account Suspension thesis PoC|Suspend user|Reactivate user/u);
 assert.match(module,/fixtures\/account-suspension-agent-profiles\.ts/u);
 assert.match(module,/LEGACY_ACCOUNT_SUSPENSION_PROFILES/u);
 assert.match(module,/new ControlledToolRegistry/u);
 const fixture=read("fixtures/account-suspension-agent-profiles.ts");
 assert.match(fixture,/feature\/account-suspension/u);
 assert.match(fixture,/tests\/e2e\/account-suspension\.spec\.ts/u);
 assert.match(fixture,/Frontend correctness requirement/u);
});

test("R238 canonical role cards disclose reusable skills while legacy descriptions live in fixtures",()=>{
 const cards=read("cards.ts");
 assert.match(cards,/APPROVED_PLAN_SKILLS/u);
 assert.match(cards,/options\.capabilityProfile !== "legacy"/u);
 assert.match(cards,/LEGACY_ACCOUNT_SUSPENSION_AGENT_CARD_CONTENT/u);
 assert.doesNotMatch(cards,/Deterministic Phase 7|Account Suspension Validation|Implement administrator Suspend\/Reactivate controls/u);
 const fixture=read("fixtures/account-suspension-agent-cards.ts");
 assert.match(fixture,/Account Suspension Validation/u);
 assert.match(fixture,/Suspend\/Reactivate controls/u);
});

test("R238 signed ADK profile and immutable trusted grants are independent of the demo scenario",()=>{
 const adk=read("adk-specialized-agents.ts");
 const roles=read("approved-specialized-profiles.ts");
 assert.match(adk,/signedTask\s*\?\s*APPROVED_SPECIALIZED_AGENT_PROFILES\[config\.role\]/u);
 assert.match(adk,/: LEGACY_ACCOUNT_SUSPENSION_PROFILES\[config\.role\]/u);
 assert.match(adk,/const grant=permissions===undefined\?null:new Set/u);
 assert.match(adk,/Gateway\/OPA\/DC remain authoritative/u);
 assert.doesNotMatch(roles,/const BRANCH\s*=|Suspend\/Reactivate|frontend\.tsx/iu);
 assert.match(roles,/trusted Orchestrator/u);
});
