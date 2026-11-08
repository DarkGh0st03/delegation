import test from "node:test";
import assert from "node:assert/strict";
import {auditR3854DagClosure,R3854_DAG_BOUNDARIES}
 from "../r3854-legacy-dag-closure-audit.mjs";

const copyInventory=()=>({
 candidates:R3854_DAG_BOUNDARIES.map(rule=>({
  target:rule.target,exists:true,
  staticImporters:rule.staticImporters.map(source=>({source,referenceType:"runtime-or-test-source"})),
  runtimeIndirectionHints:rule.dynamicImporters.map(source=>({
   source,kind:"dynamic-import",specifier:"./legacy.ts"
  })),
  configuredCallers:[]
 })),
 unresolvedRuntimeIndirections:[{source:"external-repo.ts",kind:"computed-dynamic-import"}]
});

test("R385.4 exact historical test/owner-only graph is inventoried, not deleted",()=>{
 const result=auditR3854DagClosure(copyInventory());
 assert.equal(result.status,"BOUNDARY_PROVENANCE_OK");
 assert.deepEqual(result.issues,[]);
 assert.equal(result.summaries.length,3);
 assert.equal(result.unresolvedRepositoryIndirections,1);
 assert.equal(result.deletionAuthorized,false);
});

test("R385.4 new static production importer is blocked despite existing tests",()=>{
 const inventory=copyInventory();
 inventory.candidates[0].staticImporters.push({
  source:"poc/apps/orchestrator/src/canonical-owner-deployment.mjs"
 });
 const report=auditR3854DagClosure(inventory);
 assert.equal(report.status,"BOUNDARY_PROVENANCE_FAIL");
 assert.match(report.issues.join("\n"),/unexpected static ESM import from poc\/apps\/orchestrator\/src\/canonical-owner-deployment\.mjs/u);
});

test("R385.4 R409 forbids reintroduced dynamic legacy owner imports and alternate loaders",()=>{
 const inventory=copyInventory();
 const row=inventory.candidates[1];
 assert.equal(row.runtimeIndirectionHints.length,0,
  "migrated historical Planner requires ZERO remaining runtime owner loaders");
 row.runtimeIndirectionHints.push({
  source:"poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs",
  kind:"dynamic-import",specifier:"./trusted-operational-repair-planner.ts"
 });
 row.runtimeIndirectionHints.push({source:"poc/apps/gateway/src/runtime.ts",
  kind:"commonjs-require",specifier:"./legacy.ts"});
 const result=auditR3854DagClosure(inventory);
 assert.equal(result.status,"BOUNDARY_PROVENANCE_FAIL");
 assert.match(result.issues.join("\n"),/unexpected literal dynamic import/u);
 assert.match(result.issues.join("\n"),/unexpected runtime indirection commonjs-require/u);
 assert.equal(result.deletionAuthorized,false);
});

test("R385.4 cannot silently convert historical DAG module into CLI workflow",()=>{
 const inventory=copyInventory();
 inventory.candidates[2].configuredCallers.push({
  source:".github/workflows/gemini-paid-shared-mcp-final.yml",
  kind:"github-actions-via-npm-script"
 });
 const result=auditR3854DagClosure(inventory);
 assert.equal(result.status,"BOUNDARY_PROVENANCE_FAIL");
 assert.match(result.issues.join("\n"),/executable configured caller/u);
});

test("R385.4 removed module, missing test importer or duplicate edges fail closed",()=>{
 const inventory=copyInventory();
 inventory.candidates[0].staticImporters.pop();
 inventory.candidates[1].exists=false;
 const forbidden={
  source:"poc/packages/orchestrator-runtime/src/trusted-owner-operational-repair-handoff.ts",
  kind:"dynamic-import",specifier:"./trusted-repair-dag-controller.ts"
 };
 inventory.candidates[2].runtimeIndirectionHints.push(forbidden,{...forbidden});
 const result=auditR3854DagClosure(inventory);
 assert.equal(result.status,"BOUNDARY_PROVENANCE_FAIL");
 assert.match(result.issues.join("\n"),/expected static ESM import absent/u);
 assert.match(result.issues.join("\n"),/missing retained legacy module/u);
 assert.match(result.issues.join("\n"),/duplicate literal dynamic import source/u);
});
