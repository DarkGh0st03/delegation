import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {REGISTERED_SIGNED_PILOT_WORKFLOW} from "../real-gitea-planning-mode.mjs";
const yaml=readFileSync(new URL(
  "../../../.github/workflows/gemini-paid-shared-mcp-final.yml",import.meta.url
),"utf8");
const [beforeD0,d0,isolated]=yaml.split(/\n  (account-suspension|f1-real-gitea-planning):\n/u)
  .filter((_,i)=>![1,3].includes(i));
test("default-registered workflow offers explicit F1 choice without an automatic paid trigger",()=>{
 assert.ok(yaml.startsWith("# Manual"));
 assert.ok(beforeD0.includes("name: "+REGISTERED_SIGNED_PILOT_WORKFLOW));
 assert.ok(beforeD0.includes("  workflow_dispatch:"));
 assert.ok(!/\n  (?:push|schedule):/u.test(beforeD0));
 assert.ok(beforeD0.includes("default: full-d0"));
 assert.ok(beforeD0.includes("options: [full-d0, planning-only]"));
 assert.ok(beforeD0.includes("actions: read"));
});
test("F1 selection cannot run the old four-model D0 job",()=>{
 assert.ok(d0.includes("inputs.execution_mode != 'planning-only'"));
 assert.ok(!d0.includes("DELEGATION_F1_EXECUTION_MODE: planning-only"));
 assert.ok(isolated.includes("inputs.execution_mode == 'planning-only'"));
 assert.ok(isolated.includes("inputs.repair_authorization == 'NO ADDITIONAL REPAIR AUTHORIZED'"));
 assert.ok(isolated.includes("inputs.pinned_commit_sha == github.sha"));
 assert.ok(isolated.includes("DELEGATION_F1_EXECUTION_MODE: planning-only"));
 assert.ok(isolated.includes('DELEGATION_F1_PAID_PLANNING_ONLY: "1"'));
 assert.ok(isolated.includes("node poc/scripts/signed-gemini-pilot-ci-gate.mjs --check-ci-no-inference"));
 assert.ok(isolated.includes('APPROVED_RUNNER_REAL_GITEA_PLANNING_ONLY: "1"'));
 assert.ok(isolated.includes("test -n"));
 assert.ok(isolated.includes("secrets.Delegation_Thesis_Gemini"));
 assert.ok(isolated.includes("node --test poc/scripts/test/real-gitea-planning-mode.test.mjs"));
});
