import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

// The old billed sequential MCP entrypoint was physically removed in R169.
// Regression now applies to the ONLY supported signed-DAG manual workflow.
test("R176 signed Gemini pilot has no synthetic merge/test approvals or auto trigger",async()=>{
 const workflow=await readFile(
   new URL("../../../.github/workflows/gemini-paid-shared-mcp-final.yml",import.meta.url),
   "utf8");
 const guard=await readFile(
   new URL("../signed-gemini-pilot-consent.mjs",import.meta.url),"utf8");
 assert.match(workflow,/^on:\s*\n  workflow_dispatch:/mu);
 assert.match(workflow,/github\.event_name == 'workflow_dispatch'/u);
 assert.match(workflow,/github\.run_attempt == 1/u);
 assert.match(workflow,/inputs\.authorization == 'I AUTHORIZE GEMINI API CHARGES'/u);
 assert.match(workflow,/inputs\.pinned_commit_sha/u);
 assert.match(guard,/DELEGATION_PINNED_COMMIT_SHA!==env\.GITHUB_SHA/u);
 assert.match(guard,/GITHUB_RUN_ATTEMPT!=="1"/u);
 for(const unsafe of [
  "DISPOSABLE_SIMULATED_MERGE_TEST",
  "simulatedPositiveMerge","positiveMergeFixture",
  "merge-operator-","mergePassword","TrustedGiteaMergeExecutor"
 ])assert.ok(!workflow.includes(unsafe),"Paid workflow contains obsolete synthetic merge: "+unsafe);
});
