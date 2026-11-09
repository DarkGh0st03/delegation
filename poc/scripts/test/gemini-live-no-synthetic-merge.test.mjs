import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

// R426: avoid retaining an otherwise executable paid GitHub workflow
// solely for historic test assertions. Its original contents remain in Git history.
test("R426 retired billed workflow is absent; signed-consent and Human Gate stay protected",async()=>{
 const retired=new URL("../../../.github/workflows/gemini-paid-shared-mcp-final.yml",import.meta.url);
 await assert.rejects(readFile(retired,"utf8"),{code:"ENOENT"});
 const guard=await readFile(new URL("../signed-gemini-pilot-consent.mjs",import.meta.url),"utf8");
 const protectedMerge=await readFile(new URL("../../../.github/workflows/human-approved-gitea-merge.yml",import.meta.url),"utf8");
 assert.match(guard,/DELEGATION_PINNED_COMMIT_SHA!==env\.GITHUB_SHA/u);
 assert.match(guard,/GITHUB_RUN_ATTEMPT!==\"1\"/u);
 assert.match(guard,/DELEGATION_GEMINI_CHARGE_CONFIRMATION!==CONSENT/u);
 assert.match(protectedMerge,/^on:\s*\n  workflow_dispatch:/mu);
 assert.doesNotMatch(protectedMerge,/^  (?:push|schedule|pull_request|workflow_call|workflow_run):/mu);
 assert.match(protectedMerge,/github\.actor == vars\.THESIS_MERGE_GITHUB_OPERATOR/u);
 assert.match(protectedMerge,/github\.triggering_actor == github\.actor/u);
 assert.match(protectedMerge,/name: protected-gitea-merge/u);
 for(const unsafe of [
  "DISPOSABLE_SIMULATED_MERGE_TEST",
  "simulatedPositiveMerge","positiveMergeFixture",
  "merge-operator-","mergePassword"
 ])assert.ok(!protectedMerge.includes(unsafe),"Protected merge must remain real-human-only: "+unsafe);
});
