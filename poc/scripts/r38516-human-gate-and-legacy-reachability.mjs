/**
 * R385.16 - READ-ONLY security and legacy reachability checkpoint.
 *
 * No import of the manual-merge CLI, ADK, Gateway, provider client or signer.
 * Neither this audit nor its test has write credentials, paid-model access,
 * merge capability or permission to delete a tracked module.
 *
 * Literal references are NOT complete reachability. Computed imports,
 * external deployments and protected GitHub Environment reviewer settings
 * remain outside this static audit's proof boundary.
 */
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {R3854_DAG_BOUNDARIES,auditR3854DagClosure}
 from "./r3854-legacy-dag-closure-audit.mjs";
import {collectLegacyReferences,gitTrackedFiles}
 from "./r6-legacy-references.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const WF=".github/workflows/human-approved-gitea-merge.yml";
const CLI="poc/packages/orchestrator-runtime/scripts/human-merge.mjs";
const EXEC="poc/packages/orchestrator-runtime/src/trusted-merge.ts";
const OLD_SECURITY=".github/workflows/phase11-security.yml";
export const PRIVATE_MCP_KEEP=Object.freeze([
 "poc/mcp-shared/src/owner-private-crypto-stdio.ts",
 "poc/mcp-shared/src/owner-private-crypto-stdio-server.mjs",
 "poc/mcp-shared/src/owner-private-native-crypto-stdio.mjs",
 "poc/mcp-shared/src/owner-private-child-mcp.ts"
]);
export const LEGACY_MIGRATION_REVIEW=Object.freeze([
 "poc/packages/orchestrator-runtime/src/authority-client.ts",
 "poc/packages/orchestrator-runtime/src/authority-adapter-transport.ts",
 ...R3854_DAG_BOUNDARIES.map(x=>x.target)
]);

function declaredEvents(workflow){
 const lines=workflow.split(/\r?\n/u);
 const start=lines.findIndex(s=>s==="on:");
 if(start<0)return null;
 const stop=lines.findIndex((s,i)=>i>start&&/^[a-zA-Z][a-zA-Z0-9_-]*:/u.test(s));
 const block=lines.slice(start+1,stop===-1?lines.length:stop);
 return block.filter(s=>/^  [a-zA-Z][a-zA-Z0-9_-]*:/u.test(s))
  .map(s=>s.trim().replace(/:$/u,""));
}
function includesRequiredInput(wf,name){
 const start=wf.indexOf("      "+name+":");
 if(start===-1)return false;
 // Match the NEXT sibling input at exactly six spaces, not the
 // eight-space description/type children. A plain substring matches their
 // first six spaces and would incorrectly truncate every required field.
 const tail=wf.slice(start+("      "+name+":").length);
 const next=tail.search(/^ {6}[a-zA-Z_][a-zA-Z0-9_-]*:/mu);
 const value=next<0?tail:tail.slice(0,next);
 return /^ {8}required: true\s*$/mu.test(value);
}
function must(issues,condition,reason){
 if(!condition)issues.push(reason);
}
/**
 * Pure analysis of exact repository bytes, not execution.
 * Environment protection configuration is ALWAYS external/unverified.
 */
export function auditR38516HumanGate({workflow,cli,executor,legacyWorkflow}){
 const issues=[];
 const events=declaredEvents(workflow);
 must(issues,Array.isArray(events)&&events.length===1&&
  events[0]==="workflow_dispatch","human workflow must be dispatch-only");
 for(const input of ["pr_number","expected_head_sha","confirmation"])
  must(issues,includesRequiredInput(workflow,input),
   "human merge input missing or optional: "+input);
 const requiredGuards=[
  "github.ref == 'refs/heads/main'",
  "github.actor == vars.THESIS_MERGE_GITHUB_OPERATOR",
  "github.triggering_actor == github.actor",
  "github.event_name == 'workflow_dispatch'",
  "vars.THESIS_MERGE_GITHUB_OPERATOR != ''",
  "name: protected-gitea-merge",
  "persist-credentials: false",
  "contents: read",
  "node --experimental-strip-types poc/packages/orchestrator-runtime/scripts/human-merge.mjs --execute"
 ];
 for(const guard of requiredGuards)
  must(issues,workflow.includes(guard),"human merge workflow missing: "+guard);
 must(issues,!/\b(?:GEMINI_API_KEY|GOOGLE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/u.test(workflow),
  "human merge cannot read paid model credentials");
 must(issues,cli.includes('process.argv[2]!=="--execute"')&&
  cli.includes('process.env.GITHUB_ACTIONS!=="true"'),
  "manual CLI must require exact execute flag and Actions provenance");
 const intent=cli.indexOf("const intent=validateManualMergeIntent(");
 const firstToken=cli.indexOf('const reader=required("THESIS_MERGE_READ_TOKEN")');
 must(issues,intent>=0&&firstToken>intent,
  "human intent must be validated before privileged secrets are loaded");
 must(issues,cli.includes("new TrustedGiteaMergeExecutor")&&
  cli.includes("await executor.execute("),
  "manual CLI must delegate to protected executor");
 const first=executor.indexOf("const first=await this.#verifier.verify(input)");
 const identity=executor.indexOf("await this.#identity()",first+1);
 const final=executor.indexOf("const final=await this.#verifier.verify(input)",identity+1);
 const write=executor.indexOf('method:"POST"',final+1);
 must(issues,first>=0&&identity>first&&final>identity&&write>final,
  "merge must reverify protected evidence and operator before write");
 for(const check of [
  "head_commit_id:final.head_sha","force_merge:false",
  "merge_when_checks_succeed:false","delete_branch_after_merge:false",
  "if(!response.ok)deny(\"provider_rejected\")",
  "if(!sameEvidence(first,final))deny(\"evidence_changed\")"
 ])
  must(issues,executor.includes(check),"merge transaction missing: "+check);
 return Object.freeze({
  status:issues.length?"HUMAN_GATE_FAIL":"HUMAN_GATE_STATIC_OK",
  issues:Object.freeze(issues),
  // This is never verified from a source file.
  protectedEnvironmentReviewersVerified:false,
  protectedMainBranchConfigurationVerified:false,
  manualMergeExecuted:false,
  legacyMainPushAdapterWorkflowObserved:
   /branches:\s*\n\s+- main/u.test(legacyWorkflow)&&
   /--features legacy-http/u.test(legacyWorkflow),
  legacyMainPushAdapterDisposition:"historical-workflow-review-required"
 });
}

/**
 * Audit real tracked source graph using the prior parsed-import inventory.
 * Do NOT infer that zero importers means deletion is safe. Only report.
 */
export function r38516LegacyInventory(root,tracked){
 const candidates=[...new Set([
  ...LEGACY_MIGRATION_REVIEW,...PRIVATE_MCP_KEEP
 ])];
 const inventory=collectLegacyReferences(root,tracked,{candidates});
 const dag=auditR3854DagClosure(inventory);
 const row=path=>inventory.candidates.find(c=>c.target===path);
 const protectedModules=PRIVATE_MCP_KEEP.map(path=>Object.freeze({
  path,present:existsSync(resolve(root,path)),
  staticImporters:(row(path)?.staticImporters??[]).length,
  runtimeHints:(row(path)?.runtimeIndirectionHints??[]).length,
  disposition:"RETAIN_PRIVATE_CRYPTO_MCP"
 }));
 const legacyModules=LEGACY_MIGRATION_REVIEW.map(path=>{
  const entry=row(path);
  return Object.freeze({
   path,present:entry?.exists===true,
   staticImporters:(entry?.staticImporters??[]).map(x=>x.source).sort(),
   runtimeHints:(entry?.runtimeIndirectionHints??[])
    .map(x=>Object.freeze({source:x.source,kind:x.kind})),
   configuredCallers:(entry?.configuredCallers??[])
    .map(x=>Object.freeze({source:x.source,kind:x.kind})),
   disposition:"MIGRATION_REVIEW_NOT_DELETION_APPROVAL"
  });
 });
 return Object.freeze({
  status:dag.status==="BOUNDARY_PROVENANCE_OK"&&
   protectedModules.every(x=>x.present)?"INVENTORY_PROVENANCE_OK":
   "INVENTORY_BLOCKED",
  historicalDagClosureStatus:dag.status,
  dagIssues:dag.issues,
  protectedModules:Object.freeze(protectedModules),
  legacyModules:Object.freeze(legacyModules),
  unresolvedRuntimeIndirections:inventory.unresolvedRuntimeIndirections?.length??null,
  externalConsumersVerified:false,
  deletionAuthorized:false
 });
}
export function r38516Scan(root=ROOT,tracked=gitTrackedFiles(root)){
 const read=path=>readFileSync(resolve(root,path),"utf8");
 const human=auditR38516HumanGate({
  workflow:read(WF),cli:read(CLI),executor:read(EXEC),
  legacyWorkflow:read(OLD_SECURITY)
 });
 const legacy=r38516LegacyInventory(root,tracked);
 return Object.freeze({human,legacy,status:
  human.status==="HUMAN_GATE_STATIC_OK"&&legacy.status==="INVENTORY_PROVENANCE_OK"
   ?"R38516_STATIC_GATE_PASS":"R38516_STATIC_GATE_FAIL"});
}
function main(){
 const r=r38516Scan();
 // No PR head, tokens, sensitive paths, model prompts or file contents.
 console.log(JSON.stringify({
  event:"r38516_security_and_legacy_reachability",status:r.status,
  human_gate:r.human.status,
  protected_reviewers_external_unverified:!r.human.protectedEnvironmentReviewersVerified,
  manual_merge_executed:r.human.manualMergeExecuted,
  legacy_main_push_http_adapter_review:r.human.legacyMainPushAdapterWorkflowObserved,
  legacy_dag_provenance:r.legacy.historicalDagClosureStatus,
  protected_crypto_mcp_modules:r.legacy.protectedModules.map(x=>x.path),
  legacy_module_count:r.legacy.legacyModules.length,
  unresolved_indirections:r.legacy.unresolvedRuntimeIndirections,
  deletion_authorized:r.legacy.deletionAuthorized,
  issues:[...r.human.issues,...r.legacy.dagIssues]
 }));
 if(r.status!=="R38516_STATIC_GATE_PASS")process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main();
