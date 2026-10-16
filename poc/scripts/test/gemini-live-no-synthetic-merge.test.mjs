import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

test("paid Gemini entrypoint cannot prepare synthetic review or merge identities",async()=>{
  const source=await readFile(
    new URL("../../packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",import.meta.url),
    "utf8"
  );
  assert.match(source,/DISPOSABLE_SIMULATED_MERGE_TEST==="1"/);
  assert.match(source,/Live Gemini cannot create a synthetic approval or merge/);
  assert.doesNotMatch(source,/simulatedPositiveMerge|positiveMergeFixture|merge-operator-|mergePassword|TrustedGiteaMergeExecutor/);
});
