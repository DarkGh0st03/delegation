import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

// The old billed sequential MCP entrypoint was physically removed in R169.
// Regression targets the retained, fully disabled historical signed-DAG workflow.
test("R421 retired signed Gemini workflow cannot run or inject synthetic merge approvals",async()=>{
 const workflow=await readFile(
   new URL("../../../.github/workflows/gemini-paid-shared-mcp-final.yml",import.meta.url),
   "utf8");
 const guard=await readFile(
   new URL("../signed-gemini-pilot-consent.mjs",import.meta.url),"utf8");
 assert.match(workflow,/^on:\s*\n  workflow_dispatch:/mu);
 // R421: this is a fully retired, disabled workflow, not a paid pilot.
 // The previously expected runtime conditions are intentionally gone:
 // unconditional job skips are stronger and must NEVER be replaced.
 const events=/^on:\s*\n([\s\S]*?)^permissions:/mu.exec(workflow);
 assert.ok(events,"retired workflow events must be explicit");
 assert.match(events[1],/^  workflow_dispatch:/mu);
 assert.doesNotMatch(events[1],/^  (?:push|pull_request|schedule|workflow_run|workflow_call):/mu);
 for(const job of ["account-suspension","f1-real-gitea-planning"]){
  const marker="  "+job+":\n";
  const i=workflow.indexOf(marker);
  assert.ok(i>=0,"retired job must stay auditable: "+job);
  const tail=workflow.slice(i+marker.length);
  const end=tail.search(/^  [A-Za-z][A-Za-z0-9_-]*:\s*$/mu);
  const body=end<0?tail:tail.slice(0,end);
  assert.match(body,/^    if: \$\{\{ false \}\}$/mu,
   "historical billed job must be unconditionally skipped: "+job);
 }
 assert.match(workflow,/^      authorization:\s*$/mu);
 assert.match(workflow,/I AUTHORIZE GEMINI API CHARGES/u);
 assert.match(workflow,/^      pinned_commit_sha:\s*$/mu);
 assert.match(workflow,/^      billing_cap_acknowledgement:\s*$/mu);
 assert.match(guard,/DELEGATION_PINNED_COMMIT_SHA!==env\.GITHUB_SHA/u);
 assert.match(guard,/GITHUB_RUN_ATTEMPT!=="1"/u);
 for(const unsafe of [
  "DISPOSABLE_SIMULATED_MERGE_TEST",
  "simulatedPositiveMerge","positiveMergeFixture",
  "merge-operator-","mergePassword","TrustedGiteaMergeExecutor"
 ])assert.ok(!workflow.includes(unsafe),"Paid workflow contains obsolete synthetic merge: "+unsafe);
});
