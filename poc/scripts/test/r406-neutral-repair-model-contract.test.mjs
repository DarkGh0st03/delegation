import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {stripTypeScriptTypes} from "node:module";
import {SourceTextModule} from "node:vm";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const read=p=>readFileSync(resolve(root,p),"utf8");
const neutral="poc/packages/orchestrator-runtime/src/trusted-operational-repair-model-contracts.ts";
const planner="poc/packages/orchestrator-runtime/src/trusted-operational-repair-planner.ts";
const adk="poc/packages/orchestrator-runtime/src/trusted-adk-operational-repair-proposer.ts";
const owner="poc/packages/orchestrator-runtime/src/trusted-owner-operational-repair-handoff.ts";
test("R406 pure typed repair proposal contract has zero runtime dependencies",()=>{
 const src=read(neutral);
 for(const name of ["TrustedRepairPlanningObservation","TrustedRepairDiscoveryObservation","TrustedRepairDiagnosticSource","TrustedRepairModelInput"]){
  assert.match(src,new RegExp("export interface "+name+"\\b","u"));
 }
 assert.doesNotMatch(src,/\b(?:await|fetch|new\s+Trusted|create\w+Port)\s*\(/u);
 assert.doesNotMatch(src,/authority-client|authority-adapter-transport|trusted-repair-dag-controller|trusted-operational-repair-planner/u);
 const parsed=new SourceTextModule(stripTypeScriptTypes(src),{identifier:neutral});
 assert.deepEqual(parsed.dependencySpecifiers,[],
   "type-only repair input must not transitively import executable legacy planner");
});
test("R406 owner and ADK use neutral model input; old planner only reexports shape",()=>{
 assert.match(read(owner),/import type \{TrustedRepairModelInput\}[\s\S]*?from "\.\/trusted-operational-repair-model-contracts\.ts"/u);
 assert.match(read(adk),/import type \{TrustedRepairModelInput\} from "\.\/trusted-operational-repair-model-contracts\.ts"/u);
 assert.doesNotMatch(read(adk),/from "\.\/trusted-operational-repair-planner\.ts"/u);
 const old=read(planner);
 assert.match(old,/export type \{TrustedRepairPlanningObservation,TrustedRepairDiscoveryObservation,TrustedRepairDiagnosticSource,TrustedRepairModelInput\}/u);
 assert.match(old,/from "\.\/trusted-operational-repair-model-contracts\.ts"/u);
 assert.match(old,/export class TrustedOperationalRepairPlanner/u);
});
test("R406 type-only extraction does not remove the original fail-closed authority checks",()=>{
 const old=read(planner),host=read(owner);
 assert.match(old,/original.*root|signed.*root/iu);
 assert.match(old,/boundedTrustedRepairDiscoveryObservation/u);
 assert.match(old,/verifyTrustedRepairDiscoverySource/u);
 assert.match(host,/trustedOperationalAuthority\(\)/u);
 assert.match(host,/await import\(/u,
  "legacy recovery controller remains reachable; not authorized to delete it");
});
