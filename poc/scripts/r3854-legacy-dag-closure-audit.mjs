/** R413: offline absence gate for three physically retired Signed-DAG wrappers.
 * Tracks parsed ESM imports, literal runtime indirections and configured
 * entrypoints. Computed imports / external consumers remain unresolved.
 * No model, signing, provider, merge or file deletion occurs in this audit.
 */
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {collectLegacyReferences,gitTrackedFiles}
 from "./r6-legacy-references.mjs";

const SRC="poc/packages/orchestrator-runtime/src/";
export const R3854_DAG_BOUNDARIES=Object.freeze([
 "trusted-reviewed-approved-dag.ts",
 "trusted-operational-repair-planner.ts",
 "trusted-repair-dag-controller.ts"
].map(name=>Object.freeze({
 target:SRC+name,
 staticImporters:Object.freeze([]),
 dynamicImporters:Object.freeze([])
})));

export function auditR3854DagClosure(inventory){
 const issues=[],summaries=[];
 for(const rule of R3854_DAG_BOUNDARIES){
  const row=inventory.candidates?.find(x=>x.target===rule.target);
  if(!row){
   issues.push(rule.target+": missing tracked inventory target");
   continue;
  }
  if(row.exists===true)
   issues.push(rule.target+": retired legacy module reintroduced");
  const statics=row.staticImporters??[];
  const dynamic=row.runtimeIndirectionHints??[];
  const configured=row.configuredCallers??[];
  for(const edge of statics)
   issues.push(rule.target+": retired static ESM import from "+edge.source);
  for(const edge of dynamic)
   issues.push(rule.target+": retired runtime indirection "+edge.kind+" from "+edge.source);
  for(const edge of configured)
   issues.push(rule.target+": retired configured caller "+edge.kind+" from "+edge.source);
  summaries.push(Object.freeze({
   target:rule.target,exists:row.exists===true,
   staticImporters:statics.length,literalDynamicImporters:dynamic.length,
   configuredCallers:configured.length,status:"RETIRED_ABSENCE_REQUIRED"
  }));
 }
 return Object.freeze({
  status:issues.length?"BOUNDARY_PROVENANCE_FAIL":"BOUNDARY_PROVENANCE_OK",
  issues:Object.freeze(issues),summaries:Object.freeze(summaries),
  unresolvedRepositoryIndirections:inventory.unresolvedRuntimeIndirections?.length??null,
  externalConsumersVerified:false,
  deletionAuthorized:false
 });
}
function main(){
 const root=fileURLToPath(new URL("../../",import.meta.url));
 const inventory=collectLegacyReferences(root,gitTrackedFiles(root),{
  candidates:R3854_DAG_BOUNDARIES.map(x=>x.target)
 });
 const result=auditR3854DagClosure(inventory);
 for(const row of result.summaries)
  console.log("R385.4 | "+row.target+" | exists="+row.exists+
   " | static="+row.staticImporters+" | dynamic="+row.literalDynamicImporters+
   " | configured="+row.configuredCallers+" | RETIRED");
 console.log("R385.4 unresolved computed/external indirections="+
  result.unresolvedRepositoryIndirections+" (not complete reachability proof)");
 for(const issue of result.issues)console.error("R385.4 FAIL | "+issue);
 if(result.issues.length)process.exitCode=1;
 else console.log("R385.4 PASS | retired wrappers absent; no parsed/configured callers");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main();
