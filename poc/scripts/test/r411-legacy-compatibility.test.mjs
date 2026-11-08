/**
 * R411: execution identity of retained legacy wrappers, exact source caller
 * closure and native fixture migration. Zero writes, credentials or models.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createReviewedApprovedDagExecution as legacyReviewed,
        pinTrustedReviewedAgentEndpoints as legacyPins}
 from "../../packages/orchestrator-runtime/src/trusted-reviewed-approved-dag.ts";
import {createReviewedApprovedDagExecution as ownerReviewed}
 from "../../packages/orchestrator-runtime/src/trusted-owner-reviewed-dag-execution.ts";
import {pinTrustedReviewedAgentEndpoints as ownerPins}
 from "../../packages/orchestrator-runtime/src/trusted-reviewed-agent-endpoint-pins.ts";
import * as legacyPlanner
 from "../../packages/orchestrator-runtime/src/trusted-operational-repair-planner.ts";
import * as ownerPlanner
 from "../../packages/orchestrator-runtime/src/trusted-owner-repair-planning-core.ts";
import {executeTrustedAdmittedRepairDag as legacyDag}
 from "../../packages/orchestrator-runtime/src/trusted-repair-dag-controller.ts";
import {executeTrustedAdmittedRepairDag as ownerDag}
 from "../../packages/orchestrator-runtime/src/trusted-owner-repair-dag-execution.ts";
import {R3854_DAG_BOUNDARIES,auditR3854DagClosure}
 from "../r3854-legacy-dag-closure-audit.mjs";
import {scanR38517} from "../r38517-canonical-route-closure.mjs";
import {collectLegacyReferences,gitTrackedFiles}
 from "../r6-legacy-references.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const path="poc/packages/orchestrator-runtime/src/";
const native="poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs";
const r411="poc/scripts/test/r411-legacy-compatibility.test.mjs";
const read=file=>readFileSync(resolve(root,file),"utf8");

test("R411 retained wrappers resolve to the SAME reviewed DAG functions, not copies",()=>{
 assert.strictEqual(legacyReviewed,ownerReviewed);
 assert.strictEqual(legacyPins,ownerPins);
 assert.equal(typeof ownerReviewed,"function");
});
test("R411 retained Planner wrapper preserves exactly the real Owner module exports",()=>{
 const oldKeys=Object.keys(legacyPlanner).sort();
 const actualKeys=Object.keys(ownerPlanner).sort();
 assert.ok(oldKeys.includes("TrustedOperationalRepairPlanner"));
 assert.ok(oldKeys.includes("verifyTrustedRepairDiscoverySource"));
 assert.deepEqual(oldKeys,actualKeys);
 for(const name of oldKeys)assert.strictEqual(legacyPlanner[name],ownerPlanner[name],
  "legacy Planner must reexport unchanged implementation: "+name);
});
test("R411 retained D1 DAG wrapper exports the SAME Owner executor",()=>{
 assert.strictEqual(legacyDag,ownerDag);
 assert.equal(typeof ownerDag,"function");
});
test("R411 historical native EVM harness directly tests Owner DAG core",()=>{
 const src=read(native);
 assert.match(src,/from\s+"\.\.\/\.\.\/\.\.\/packages\/orchestrator-runtime\/src\/trusted-owner-repair-dag-execution\.ts";/u);
 assert.doesNotMatch(src,/from\s+"\.\.\/\.\.\/\.\.\/packages\/orchestrator-runtime\/src\/trusted-repair-dag-controller\.ts";/u);
 assert.match(src,/await executeTrustedAdmittedRepairDag\(/u);
});
test("R411 exact 3 DAG wrapper importers and unresolved uncertainty forbid deletion",()=>{
 const tracked=gitTrackedFiles(root);
 const scan=scanR38517(root,tracked);
 assert.equal(scan.status,"R38517_MIGRATION_GATE_PASS",
  JSON.stringify([...scan.routes.issues,...scan.callers.issues]));
 assert.equal(scan.callers.deletionAuthorized,false);
 assert.equal(scan.callers.externalConsumersVerified,false);
 assert.equal(scan.callers.privateMcp.filter(x=>x.present).length,4);
 assert.ok(scan.callers.unresolvedIndirections>0);
 const targets=R3854_DAG_BOUNDARIES.map(x=>x.target);
 const inventory=collectLegacyReferences(root,tracked,{candidates:targets});
 const closure=auditR3854DagClosure(inventory);
 assert.equal(closure.status,"BOUNDARY_PROVENANCE_OK",closure.issues.join("\n"));
 for(const row of inventory.candidates){
  assert.equal(row.exists,true);
  assert.equal(row.runtimeIndirectionHints.length,0);
  assert.equal(row.configuredCallers.length,0);
  assert.ok(row.staticImporters.every(x=>/\/test\//u.test(x.source)),
   "old DAG wrapper may only have precise test imports: "+row.target);
  assert.ok(row.staticImporters.some(x=>x.source===r411),
   "explicit compatibility identity check must remain pinned: "+row.target);
 }
 assert.equal(closure.deletionAuthorized,false);
});
