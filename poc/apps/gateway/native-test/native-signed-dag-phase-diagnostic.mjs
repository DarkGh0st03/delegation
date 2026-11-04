/** R246: strict native signed-DAG diagnostics. No raw errors or tokens. */
import {safeApprovedDagFailureTrace,classifyApprovedDagFailure}
 from "./native-approved-dag-failure-category.mjs";
export const PREFIX="[native-dag-adk] trusted_native_dag_phase_failure ";
export const PHASES=Object.freeze([
 "root_issuance","planning_scope","engineer_review_and_root",
 "agent_model_binding","signed_a2a_dispatch","positive_dag_assertions",
 "root_revocation"
]);
const phases=new Set(PHASES);
const cats=new Set([
 "a2a_dispatch_failed","orchestrator_task_failed",
 "root_revocation_unconfirmed","dependency_denied","adk_model_failure",
 "controlled_tool_failure","no_confirmed_revision","a2a_task_not_completed",
 "a2a_artifact_invalid","a2a_result_mismatch","attestation_effect_race",
 "approved_plan_denied","test_assertion","unclassified"
]);
const kinds=new Set(["Error","AssertionError","TypeError","RangeError",
 "SyntaxError","AbortError","TimeoutError","AggregateError","unknown"]);
const codes=new Set(["ERR_ASSERTION","approved_plan_denied","ERR_INVALID_ARG_TYPE",
 "ERR_HTTP_HEADERS_SENT","ECONNRESET","ETIMEDOUT","ECONNREFUSED","ABORT_ERR",
 "ERR_INVALID_STATE","unknown"]);
const modules=new Set(["native-planning-read-core-evm-e2e.mjs",
 "native-approved-planner-dag-positive.mjs","trusted-approved-a2a-dispatcher.ts",
 "a2a-workflow.ts","orchestrator.ts","executor.ts",
 "adk-a2a-handler.ts","artifact-validation.ts","private-request-handler.ts",
 "gateway-tool-client.ts","adk-tool-progress.ts","approved-execution-plans.ts",
 "runtime.ts","execute.ts","runner-client.ts","isolated-executor.ts",
 "native-approved-dag-failure-category.mjs"]);
const validSite=site=>site&&typeof site==="object"&&!Array.isArray(site)&&
 modules.has(site.module)&&Number.isSafeInteger(site.line)&&site.line>=1&&site.line<=2500
 ?{module:site.module,line:site.line}:null;
function validTrace(trace){
 if(!Array.isArray(trace)||trace.length===0||trace.length>3)return null;
 const result=[];
 for(const item of trace){
  if(!item||typeof item!=="object"||Array.isArray(item)||
    !cats.has(item.category)||!kinds.has(item.kind)||
    !codes.has(item.code))return null;
  const site=item.site===null?null:validSite(item.site);
  if(item.site!==null&&!site)return null;
  result.push({category:item.category,kind:item.kind,code:item.code,site});
 }
 return result;
}
export function safeNativePhaseFailure(error,stage){
 const trace=validTrace(safeApprovedDagFailureTrace(error).slice(0,3));
 const first=trace?.[0]??{kind:"unknown",code:"unknown",site:null};
 const category=classifyApprovedDagFailure(error);
 return Object.freeze({
  stage:phases.has(stage)?stage:"root_issuance",
  category:cats.has(category)?category:"unclassified",
  kind:first.kind,code:first.code,
  ...(first.site?{assertion_location:first.site}:{}),
  ...(trace?{failure_trace:trace}:{})
 });
}
export function readNativePhaseFailure(stderr){
 const raw=Buffer.isBuffer(stderr)?stderr.toString("utf8"):
  typeof stderr==="string"?stderr:"";
 for(const line of raw.slice(-262144).split(/\r?\n/u).reverse()){
  if(!line.startsWith(PREFIX)||line.length>4096)continue;
  let item;
  try{item=JSON.parse(line.slice(PREFIX.length));}catch{continue;}
  if(!item||typeof item!=="object"||Array.isArray(item)||
    !phases.has(item.stage)||!cats.has(item.category)||
    !kinds.has(item.kind)||!codes.has(item.code))continue;
  const location=item.assertion_location===undefined?null:
   validSite(item.assertion_location);
  if(item.assertion_location!==undefined&&!location)continue;
  const trace=item.failure_trace===undefined?null:validTrace(item.failure_trace);
  if(item.failure_trace!==undefined&&!trace)continue;
  return Object.freeze({stage:item.stage,category:item.category,
   kind:item.kind,code:item.code,
   ...(location?{assertion_location:location}:{}),
   ...(trace?{failure_trace:trace}:{})});
 }
 return null;
}
