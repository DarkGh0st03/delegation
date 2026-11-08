import test from "node:test";
import assert from "node:assert/strict";
import {auditR3854DagClosure,R3854_DAG_BOUNDARIES}
 from "../r3854-legacy-dag-closure-audit.mjs";

const inventory=()=>({
 candidates:R3854_DAG_BOUNDARIES.map(rule=>({
  target:rule.target,exists:false,staticImporters:[],
  runtimeIndirectionHints:[],configuredCallers:[]
 })),
 unresolvedRuntimeIndirections:[{source:"external-repo.ts",kind:"computed-dynamic-import"}]
});
test("R413 physically retired Signed DAG wrappers are absent, not merely shimmed",()=>{
 const result=auditR3854DagClosure(inventory());
 assert.equal(result.status,"BOUNDARY_PROVENANCE_OK");
 assert.deepEqual(result.issues,[]);
 assert.equal(result.summaries.length,3);
 assert.ok(result.summaries.every(x=>!x.exists&&
  x.staticImporters===0&&x.literalDynamicImporters===0&&x.configuredCallers===0));
 assert.equal(result.unresolvedRepositoryIndirections,1);
 assert.equal(result.externalConsumersVerified,false);
 assert.equal(result.deletionAuthorized,false);
});
test("R413 resuscitating a retired wrapper fails closed",()=>{
 const inv=inventory();
 inv.candidates[1].exists=true;
 const result=auditR3854DagClosure(inv);
 assert.equal(result.status,"BOUNDARY_PROVENANCE_FAIL");
 assert.match(result.issues.join("\n"),/retired legacy module reintroduced/u);
});
test("R413 no new static Owner/test import may target retired Signed DAG",()=>{
 const inv=inventory();
 inv.candidates[0].staticImporters.push({
  source:"poc/apps/orchestrator/src/canonical-owner-deployment.mjs"
 });
 const result=auditR3854DagClosure(inv);
 assert.equal(result.status,"BOUNDARY_PROVENANCE_FAIL");
 assert.match(result.issues.join("\n"),/retired static ESM import from poc\/apps\/orchestrator\/src\/canonical-owner-deployment\.mjs/u);
});
test("R413 dynamic imports, computed import hints and alternate loaders fail closed",()=>{
 const inv=inventory();
 inv.candidates[1].runtimeIndirectionHints.push({
  source:"poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs",
  kind:"dynamic-import"
 },{
  source:"poc/apps/gateway/src/runtime.ts",kind:"commonjs-require"
 });
 const result=auditR3854DagClosure(inv);
 assert.equal(result.status,"BOUNDARY_PROVENANCE_FAIL");
 assert.match(result.issues.join("\n"),/retired runtime indirection dynamic-import/u);
 assert.match(result.issues.join("\n"),/retired runtime indirection commonjs-require/u);
});
test("R413 no retired Signed-DAG workflow or configured caller may reappear",()=>{
 const inv=inventory();
 inv.candidates[2].configuredCallers.push({
  source:".github/workflows/legacy-signed-dag.yml",
  kind:"github-actions-via-npm-script"
 });
 const result=auditR3854DagClosure(inv);
 assert.equal(result.status,"BOUNDARY_PROVENANCE_FAIL");
 assert.match(result.issues.join("\n"),/retired configured caller/u);
});
