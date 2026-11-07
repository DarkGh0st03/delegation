import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const yaml=readFileSync(new URL(
 "../../../.github/workflows/gemini-paid-shared-mcp-final.yml",import.meta.url
),"utf8");
const names=["account-suspension","f1-real-gitea-planning"];
const [beforeD0,d0,isolated]=yaml.split(/\n  (account-suspension|f1-real-gitea-planning):\n/u)
 .filter((_,i)=>![1,3].includes(i));

test("R384.6 historical D0/F1 workflow remains visible but is no longer operational",()=>{
 assert.match(yaml,/^# R384\.6 RETIRED:/u);
 assert.match(beforeD0,/^name: RETIRED - Historical Gemini Signed DAG Pilot \(Disabled\)$/mu);
 assert.ok(beforeD0.includes("  workflow_dispatch:"));
 assert.doesNotMatch(beforeD0,/^  (push|schedule|pull_request):/mu);
 assert.ok(beforeD0.includes("options: [full-d0, planning-only]"),
  "Preserve historical choices for audit only");
 assert.ok(beforeD0.includes("actions: read"));
});

test("R384.6 archived full D0 and F1 Planning are both unconditionally skipped",()=>{
 assert.equal(names.length,2);
 assert.ok(d0&&isolated,"Both old billing jobs must remain identifiable");
 for(const fragment of [d0,isolated]){
  assert.match(fragment,/^    if: \$\{\{ false \}\}$/mu,
   "No legacy job can reach a billed model step");
 }
 assert.ok(d0.includes("DELEGATION_SIGNED_GEMINI_PILOT")||
           d0.includes("DELEGATION_GEMINI_MODEL"),
  "Keep old steps only as historical proof, never invoke them");
 assert.ok(isolated.includes("DELEGATION_F1_EXECUTION_MODE: planning-only"));
 assert.ok(isolated.includes("secrets.Delegation_Thesis_Gemini"));
 assert.ok(isolated.includes("node --test poc/scripts/test/real-gitea-planning-mode.test.mjs"));
});
