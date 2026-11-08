/**
 * R385.4 — bounded read-only provenance gate for the three retained legacy
 * signed-DAG modules. No production modules are imported, no model is run.
 *
 * This gate does NOT prove all computed imports or runtime reachability.
 * The wider R6 inventory separately reports unresolved indirections.
 */
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {collectLegacyReferences,gitTrackedFiles}
 from "./r6-legacy-references.mjs";

const P="poc/packages/orchestrator-runtime/";
const SRC=P+"src/",TEST=P+"test/";
const GATEWAY_TEST="poc/apps/gateway/test/operational-epoch-gateway.test.ts";

export const R3854_DAG_BOUNDARIES=Object.freeze([
 Object.freeze({
  target:SRC+"trusted-reviewed-approved-dag.ts",
  staticImporters:Object.freeze([
   TEST+"trusted-planning-review-gate.test.ts",
   TEST+"trusted-reviewed-approved-dag.test.ts",
   "poc/scripts/test/r3852-reviewed-dag-runtime-isolation.test.mjs"
  ]),
  dynamicImporters:Object.freeze([])
 }),
 Object.freeze({
  target:SRC+"trusted-operational-repair-planner.ts",
  staticImporters:Object.freeze([
   GATEWAY_TEST,
   TEST+"trusted-verified-discovery-repair-input.test.ts"
  ]),
  dynamicImporters:Object.freeze([])
 }),
 Object.freeze({
  target:SRC+"trusted-repair-dag-controller.ts",
  staticImporters:Object.freeze([
   "poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs",
   GATEWAY_TEST
  ]),
  dynamicImporters:Object.freeze([])
 })
]);

function difference(actual,expected){
 const a=new Set(actual),e=new Set(expected);
 return {unexpected:[...a].filter(s=>!e.has(s)).sort(),
  missing:[...e].filter(s=>!a.has(s)).sort()};
}
function checkEdges(target,kind,actual,expected,issues){
 const observed=actual.map(e=>e.source);
 if(new Set(observed).size!==observed.length)
  issues.push(target+": duplicate "+kind+" source; reconcile provenance");
 const delta=difference(observed,expected);
 for(const source of delta.unexpected)
  issues.push(target+": unexpected "+kind+" from "+source);
 for(const source of delta.missing)
  issues.push(target+": expected "+kind+" absent from "+source);
}

/** The policy is intentionally exact, not a broad src/ or test/ allowlist. */
export function auditR3854DagClosure(inventory){
 const issues=[],summaries=[];
 for(const rule of R3854_DAG_BOUNDARIES){
  const row=inventory.candidates?.find(x=>x.target===rule.target);
  if(!row||row.exists!==true){
   issues.push(rule.target+": missing retained legacy module");
   continue;
  }
  checkEdges(rule.target,"static ESM import",
   row.staticImporters??[],rule.staticImporters,issues);
  const hints=row.runtimeIndirectionHints??[];
  for(const hint of hints)
   if(hint.kind!=="dynamic-import")
    issues.push(rule.target+": unexpected runtime indirection "+hint.kind+
     " from "+hint.source);
  checkEdges(rule.target,"literal dynamic import",hints,
   rule.dynamicImporters,issues);
  for(const caller of row.configuredCallers??[])
   issues.push(rule.target+": executable configured caller from "+
    caller.source+" ("+caller.kind+")");
  summaries.push(Object.freeze({
   target:rule.target,
   staticImporters:(row.staticImporters??[]).length,
   literalDynamicImporters:hints.length,
   configuredCallers:(row.configuredCallers??[]).length,
   status:"retained-for-historical-tests-and-gated-owner-calls"
  }));
 }
 return Object.freeze({
  status:issues.length===0?"BOUNDARY_PROVENANCE_OK":"BOUNDARY_PROVENANCE_FAIL",
  issues:Object.freeze(issues),
  summaries:Object.freeze(summaries),
  // Computed import(), unknown aliases, scripts and external API callers
  // are NOT disproven by this count. Never infer safe deletion from zero.
  unresolvedRepositoryIndirections:inventory.unresolvedRuntimeIndirections?.length??null,
  deletionAuthorized:false
 });
}

function main(){
 const root=fileURLToPath(new URL("../../",import.meta.url));
 const inventory=collectLegacyReferences(root,gitTrackedFiles(root),{
  candidates:R3854_DAG_BOUNDARIES.map(rule=>rule.target)
 });
 const result=auditR3854DagClosure(inventory);
 for(const row of result.summaries)
  console.log("R385.4 | "+row.target+" | static="+row.staticImporters+
   " | dynamic="+row.literalDynamicImporters+
   " | configured="+row.configuredCallers+
   " | retained; NOT approved for deletion");
 console.log("R385.4 unresolved unrelated/computed module indirections="+
  result.unresolvedRepositoryIndirections+
  " (not a complete reachability proof)");
 for(const issue of result.issues)console.error("R385.4 FAIL | "+issue);
 if(result.issues.length>0)process.exitCode=1;
 else console.log("R385.4 PASS | exactly inventoried legacy entrypoints;"+
  " public canonical runtime still requires separate E2E verification");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main();
