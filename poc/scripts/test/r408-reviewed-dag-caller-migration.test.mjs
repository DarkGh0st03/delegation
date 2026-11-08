/**
 * R408: read-only exact runtime caller inventory. No A2A dispatch, Rust
 * Root, Gemini inference, Gitea, signed Task, privileges or merge.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {stripTypeScriptTypes} from "node:module";
import {SourceTextModule} from "node:vm";
import {fileURLToPath} from "node:url";
import {collectLegacyReferences,gitTrackedFiles}
 from "../r6-legacy-references.mjs";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const p="poc/packages/orchestrator-runtime/src/";
const legacy=p+"trusted-reviewed-approved-dag.ts";
const core=p+"trusted-owner-reviewed-dag-execution.ts";
const handoffs=[
 p+"trusted-admitted-github-handoff.ts",
 p+"trusted-admitted-scripted-handoff.ts",
 p+"trusted-fresh-repair-reviewed-dag.ts"
];
const read=path=>readFileSync(resolve(root,path),"utf8");
const parse=path=>new SourceTextModule(
 stripTypeScriptTypes(read(path)),{identifier:path});
test("R408 old reviewed DAG is only a two-export compatibility shim",()=>{
 const old=read(legacy),module=parse(legacy);
 assert.deepEqual(module.dependencySpecifiers.slice().sort(),[
  "./trusted-owner-reviewed-dag-execution.ts",
  "./trusted-reviewed-agent-endpoint-pins.ts"
 ].sort());
 assert.match(old,/export \{createReviewedApprovedDagExecution\}/u);
 assert.doesNotMatch(old,/function createReviewedApprovedDagExecution|new TrustedApprovedA2ADispatcher/u);
});
test("R408 owner core retains one-shot signed Gateway/Child/A2A/closure guards",()=>{
 const src=read(core),module=parse(core);
 assert.ok(!module.dependencySpecifiers.includes("./trusted-reviewed-approved-dag.ts"));
 for(const guard of [
  "TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority",
  'if(attempted)fail("approved DAG dispatch is one-shot; retry forbidden")',
  "attempted=true",
  "await input.verifyLiveRun()",
  "trustedOperationalAuthority()",
  "authority.plan_digest!==pinned.planDigest",
  "beforeTask:async()=>{await input.verifyLiveRun();}",
  "beforeCompletion:async()=>{await input.verifyLiveRun();}",
  "await recovery.continueWithinActiveRoot(feedback)",
  'if(input.coordinator.phase!=="closed")',
  "await input.close()"
 ])assert.ok(src.includes(guard),guard);
 assert.match(src,/export function createReviewedApprovedDagExecution\(/u);
 assert.match(src,/verified_test_failure_recovery_handoff/u);
});
test("R408 all Owner handoffs lazy-load new core after original liveness checks",()=>{
 for(const path of handoffs){
  const source=read(path),parsed=parse(path);
  assert.match(source,/await import\(\s*"\.\/trusted-owner-reviewed-dag-execution\.ts"\s*\)/u);
  assert.doesNotMatch(source,/await import\(\s*"\.\/trusted-reviewed-approved-dag\.ts"\s*\)/u);
  assert.ok(!parsed.dependencySpecifiers.includes("./trusted-owner-reviewed-dag-execution.ts"));
  assert.ok(!parsed.dependencySpecifiers.includes("./trusted-reviewed-approved-dag.ts"));
 }
 for(const path of handoffs.slice(0,2))
  assert.match(read(path),
   /await import\(\s*"\.\/trusted-owner-reviewed-dag-execution\.ts"\s*\);\s*await checkNow\(\)/u);
 assert.match(read(handoffs[2]),
  /await import\(\s*"\.\/trusted-owner-reviewed-dag-execution\.ts"\s*\);\s*await input\.verifyLiveRun\(\)/u);
});
test("R408 tracked provenance: old shim no Owner callers; new core exactly 3",()=>{
 const inventory=collectLegacyReferences(root,gitTrackedFiles(root),{
  candidates:[legacy,core]
 });
 const old=inventory.candidates.find(x=>x.target===legacy);
 const active=inventory.candidates.find(x=>x.target===core);
 assert.ok(old.exists&&active.exists);
 assert.equal(old.runtimeIndirectionHints.length,0);
 assert.deepEqual(old.staticImporters.map(x=>x.source).sort(),[
  "poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts",
  "poc/packages/orchestrator-runtime/test/trusted-reviewed-approved-dag.test.ts",
  "poc/scripts/test/r3852-reviewed-dag-runtime-isolation.test.mjs",
  "poc/scripts/test/r411-legacy-compatibility.test.mjs"
 ].sort());
 assert.deepEqual(active.runtimeIndirectionHints.map(x=>x.source).sort(),
  handoffs.slice().sort());
 assert.ok(active.staticImporters.some(x=>x.source===legacy));
 assert.deepEqual(active.configuredCallers,[]);
});
