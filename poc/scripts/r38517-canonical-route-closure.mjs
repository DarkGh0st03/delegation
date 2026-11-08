/**
 * R385.17 — immutable source-level migration proof, NOT a deletion tool.
 *
 * Audits the configured legacy HTTP workflow, positive no-AI Security CI,
 * the native authority-only runtime route and every recorded importer
 * of the five historical candidate modules. No module import side effects,
 * external network requests, merge, paid model calls or file deletion.
 *
 * Parsed import edges from R6 are bounded: computed/indirect/external
 * callers are still unresolved, so deletionAuthorized MUST stay false.
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {gitTrackedFiles} from "./r6-legacy-references.mjs";
import {r38516LegacyInventory,PRIVATE_MCP_KEEP}
 from "./r38516-human-gate-and-legacy-reachability.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const PHASE11=".github/workflows/phase11-security.yml";
const POSITIVE=".github/workflows/isolated-positive-security-ci.yml";
const NATIVE=".github/workflows/r38513-native-strict-full-recovery.yml";
const BOOTSTRAP="poc/apps/orchestrator/src/trusted-authority-only-owner-bootstrap.mjs";

export function configuredWorkflowEvents(workflow){
 if(typeof workflow!=="string")return [];
 const lines=workflow.split(/\r?\n/u),start=lines.indexOf("on:");
 if(start<0)return [];
 const events=[];
 for(const line of lines.slice(start+1)){
  if(/^[a-zA-Z][\w-]*:/u.test(line))break;
  const match=/^ {2}([a-zA-Z][\w-]*):/u.exec(line);
  if(match)events.push(match[1]);
 }
 return events;
}
function equalArray(a,b){
 return a.length===b.length&&a.every((v,i)=>v===b[i]);
}
export function classifyCaller(source){
 if(typeof source!=="string")return "unknown-caller-review";
 if(source.startsWith(".github/workflows/"))return "workflow-entrypoint-review";
 if(/\/(?:test|native-test)\//u.test(source)||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(source))
  return "historical-or-regression-test";
 if(source.startsWith("poc/apps/orchestrator/src/trusted-authority-only")||
    source.startsWith("poc/apps/gateway/src/trusted-authority-only"))
  return "canonical-owner-review-required";
 if(source.includes("/scripts/")||source.endsWith(".sh"))
  return "script-entrypoint-review";
 return "historical-runtime-import-review";
}
/** Exact workflow routes and canonical bootstrap, independently tested. */
export function auditR38517WorkflowRoutes({
 phase11,positive,native,bootstrap
}){
 const issues=[];
 const demand=(yes,reason)=>{if(!yes)issues.push(reason);};
 demand(equalArray(configuredWorkflowEvents(phase11),["workflow_dispatch"]),
  "Phase11 legacy HTTP Adapter must be manual-only, no push/schedule/PR");
 demand(/--features legacy-http/u.test(phase11),
  "Phase11 historical coverage must be preserved until migrated");
 const events=configuredWorkflowEvents(positive);
 demand(equalArray(events,["push","workflow_dispatch"]),
  "positive Security CI must have only push and manual triggers");
 demand(/^\s{4}branches:\s*\[refactor\/post-prof-plan-contracts-20261021\]\s*$/mu.test(positive),
  "positive Security CI must target the active authority-only branch");
 demand(!positive.includes("feat/shared-mcp-spike"),
  "positive Security CI still refers to retired shared-MCP branch");
 demand(positive.includes("security-ci:isolated-positive-smoke"),
  "positive Security CI lost its disposable independent Runner test");
 demand(!/(GEMINI_API_KEY|GOOGLE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)/u.test(positive),
  "positive Security CI cannot have paid-model credentials");
 demand(equalArray(configuredWorkflowEvents(native),["workflow_dispatch","push"]),
  "canonical native E2E trigger unexpectedly changed");
 demand(native.includes('R38513_NATIVE_STRICT_FULL_RECOVERY: "1"')&&
  native.includes('R3818_CANONICAL_NATIVE_MCP: "1"'),
  "native E2E must retain trusted Rust/MCP strict recovery route");
 // A deliberately NEGATIVE "if cargo run ... legacy-http; then exit 1"
 // is an important security regression. Distinguish it from an actual
 // unguarded launch; deleting the negative guard would weaken the gate.
 const activeNativeLines=native.split(/\r?\n/u)
  .filter(line=>!line.trim().startsWith("#"));
 const legacyCommands=activeNativeLines.filter(line=>
  /cargo run .*--features legacy-http/u.test(line));
 demand(legacyCommands.length===1&&
  /^\s*if cargo run .*--features legacy-http.*; then\s*$/u.test(legacyCommands[0])&&
  native.includes("Legacy Adapter HTTP cannot start with direct Engineer Core enabled"),
  "native E2E legacy Adapter must be only an expected-failure guard");
 demand(!activeNativeLines.some(line=>/gemini-paid-shared-mcp-final/u.test(line)),
  "native E2E cannot invoke paid Shared MCP");
 demand(bootstrap.includes("createNativeRustChildCryptographyPort")&&
  bootstrap.includes("assembleTrustedAuthorityOnlyNativeEffects"),
  "canonical owner must directly compose native Rust Child and effects");
 demand(!/(cargo run .*--features legacy-http)/u.test(bootstrap),
  "canonical owner cannot spawn legacy HTTP Adapter");
 return Object.freeze({
  status:issues.length?"ROUTES_FAIL":"ROUTES_STATIC_OK",
  issues:Object.freeze(issues),
  phase11Events:Object.freeze(configuredWorkflowEvents(phase11)),
  positiveEvents:Object.freeze(events),
  nativeEvents:Object.freeze(configuredWorkflowEvents(native)),
  positiveTargetBranch:BRANCH,
  phase11AutoStartRetired:equalArray(configuredWorkflowEvents(phase11),["workflow_dispatch"]),
  positiveSecurityCiNoAi:true,
  deploymentConfigurationsVerified:false,
  deletionAuthorized:false
 });
}
/** Full importer provenance rows, not a dead-code or deletion approval. */
export function auditR38517CallerInventory(legacy){
 const issues=[];
 if(!legacy||legacy.status!=="INVENTORY_PROVENANCE_OK")
  issues.push("Prior R385.16 importer inventory is not passing");
 const modules=(legacy?.legacyModules??[]).map(row=>{
  const all=[
   ...(row.staticImporters??[]).map(source=>({source,edge:"static-import"})),
   ...(row.runtimeHints??[]).map(h=>({source:h.source,edge:h.kind})),
   ...(row.configuredCallers??[]).map(h=>({source:h.source,edge:h.kind}))
  ];
  const callers=all.map(({source,edge})=>Object.freeze({
   source,edge,classification:classifyCaller(source)
  }));
  return Object.freeze({
   path:row.path,present:row.present,
   callerCount:callers.length,
   callers:Object.freeze(callers),
   disposition:"MIGRATION_REVIEW_NOT_DELETION_APPROVAL"
  });
 });
 const privateMcp=(legacy?.protectedModules??[]).map(p=>Object.freeze({
  path:p.path,present:p.present,disposition:"RETAIN_PRIVATE_CRYPTO_MCP"
 }));
 if(modules.length!==5||privateMcp.length!==PRIVATE_MCP_KEEP.length)
  issues.push("Missing exact legacy/private MCP inventory targets");
 if(privateMcp.some(x=>!x.present))
  issues.push("Native private crypto MCP source must not be removed");
 if(modules.some(x=>!x.present))
  issues.push("Historical candidate changed without migration record");
 if(modules.some(x=>x.callers.some(c=>c.classification==="canonical-owner-review-required")))
  issues.push("Canonical owner still references legacy module; review before migration");
 return Object.freeze({
  status:issues.length?"CALLER_INVENTORY_FAIL":"CALLER_INVENTORY_OK",
  issues:Object.freeze(issues),modules:Object.freeze(modules),
  privateMcp:Object.freeze(privateMcp),
  unresolvedIndirections:legacy?.unresolvedRuntimeIndirections??null,
  externalConsumersVerified:false,
  deletionAuthorized:false
 });
}
export function scanR38517(root=ROOT,tracked=gitTrackedFiles(root)){
 const read=path=>readFileSync(resolve(root,path),"utf8");
 const routes=auditR38517WorkflowRoutes({
  phase11:read(PHASE11),positive:read(POSITIVE),native:read(NATIVE),
  bootstrap:read(BOOTSTRAP)
 });
 const callers=auditR38517CallerInventory(
  r38516LegacyInventory(root,tracked));
 return Object.freeze({
  status:routes.status==="ROUTES_STATIC_OK"&&
    callers.status==="CALLER_INVENTORY_OK"?
      "R38517_MIGRATION_GATE_PASS":"R38517_MIGRATION_GATE_FAIL",
  routes,callers
 });
}
function main(){
 const scan=scanR38517();
 console.log(JSON.stringify({
  event:"r38517_per_caller_route_inventory",status:scan.status,
  legacy_http_auto_main_stopped:scan.routes.phase11AutoStartRetired,
  phase11_events:scan.routes.phase11Events,
  positive_security_ci_branch:scan.routes.positiveTargetBranch,
  native_crypto_mcp_retained:scan.callers.privateMcp.filter(x=>x.present).length,
  legacy_module_callers:scan.callers.modules.map(x=>({
   path:x.path,count:x.callerCount,
   classification_counts:Object.fromEntries(
    [...new Set(x.callers.map(c=>c.classification))].map(label=>[
     label,x.callers.filter(c=>c.classification===label).length
    ])
   )
  })),
  unresolved_indirections:scan.callers.unresolvedIndirections,
  deletion_authorized:scan.callers.deletionAuthorized,
  issues:[...scan.routes.issues,...scan.callers.issues]
 }));
 if(scan.status!=="R38517_MIGRATION_GATE_PASS")process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main();
