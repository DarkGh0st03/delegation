/**
 * Cross-cutting failure observations. Only trusted, already-sanitized
 * planner/ADK/Runner/D1 receipts may enter; never private error text.
 *
 * The reporting component is NOT necessarily the origin of the application
 * defect. A reason is a verified stop condition, not speculative causality.
 */
import {safeProjectTestFailureDiagnostic}
 from "../apps/test-runner-controller/scripts/project-test-failure-diagnostic.mjs";
import {safeProjectE2eFailureDiagnostic}
 from "../apps/test-runner-controller/scripts/project-e2e-failure-diagnostic.mjs";
import {safeAcceptanceFailureSummary}
 from "../runner/acceptance/failure-catalog.mjs";
const ROLES=["backend","frontend","test"];
const TOOLS=["read_file","update_file","create_file","run_tests"];
const STAGES=["setup","gemini_planning","gemini_plan_proposed",
 "signed_test_review","activation_dc_vp","delegated_agents_gitea_docker",
 "complete"];
const PHASES=["dependency_install","typecheck","backend_tests",
 "frontend_tests","build","playwright_e2e","researcher_acceptance"];
const DELEGATED=["none","a2a_task_not_completed","a2a_artifact_invalid",
 "controlled_tool_failure","no_confirmed_revision","a2a_dispatch_failed",
 "orchestrator_task_failed","root_revocation_unconfirmed",
 "dependency_denied","adk_model_failure","a2a_result_mismatch",
 "attestation_effect_race","approved_plan_denied","test_assertion","unclassified"];
const RECOVERY=["revision_baseline_mismatch","no_confirmed_editor_write",
 "editor_effect_binding_mismatch","provider_head_mismatch","unchanged_editor_revision"];
const TOOL_KINDS=["authorization_denied","tests_failed","tool_unavailable",
 "invalid_tool_call","iteration_limit"];
const TOOL_REASONS=["invalid_arguments","branch_mismatch",
 "path_outside_signed_scope","operation_not_granted","gateway_prepare_rejected",
 "upstream_unavailable","request_validation_rejected",
 "task_binding_rejected","signed_permission_rejected","dependency_rejected",
 "task_inactive_or_expired","runtime_scope_rejected",
 "source_witness_missing","gateway_prepare_unclassified","unclassified"];
const MODEL_CATEGORIES=["model_turn_budget","model_output_truncated",
 "api_rate_limit_or_quota","api_authentication","api_permission_denied",
 "api_model_not_found","api_invalid_request","api_service_unavailable",
 "api_inference_timeout","api_network_failure","tool_schema_or_validation",
 "sdk_model_exception","adk_event_error","controlled_tool_failures",
 "no_confirmed_revision","repair_requires_new_approval"];
const SITES=["native-approved-planner-dag-positive.mjs",
 "native-planning-read-core-evm-e2e.mjs",
 "trusted-approved-a2a-dispatcher.ts","a2a-workflow.ts","orchestrator.ts",
 "executor.ts","adk-a2a-handler.ts","artifact-validation.ts",
 "private-request-handler.ts","gateway-tool-client.ts",
 "adk-tool-progress.ts","approved-execution-plans.ts","runtime.ts",
 "execute.ts","runner-client.ts","isolated-executor.ts",
 "native-approved-dag-failure-category.mjs"];
const KINDS=["Error","AssertionError","TypeError","RangeError","SyntaxError",
 "AbortError","TimeoutError","AggregateError","unknown"];
const CODES=["ERR_ASSERTION","approved_plan_denied","ERR_INVALID_ARG_TYPE",
 "ERR_HTTP_HEADERS_SENT","ECONNRESET","ETIMEDOUT","ECONNREFUSED",
 "ABORT_ERR","ERR_INVALID_STATE","unknown"];
const DETAILS=Object.freeze({
 no_confirmed_editor_write:"No independently confirmed editor update_file",
 revision_baseline_mismatch:"Editor did not use the trusted failed revision",
 editor_effect_binding_mismatch:"Confirmed edit differs from signed Task",
 provider_head_mismatch:"Gitea HEAD differs from trusted write receipt",
 unchanged_editor_revision:"The provider revision did not change",
 tests_failed:"Controlled run_tests returned failure, not proof of culpability",
 authorization_denied:"A controlled operation was denied",
 invalid_tool_call:"The controlled arguments failed schema or Task validation",
 root_revocation_unconfirmed:"Operational root retirement was not confirmed",
 planner_contract_rejected:"Trusted plan validator rejected the proposal",
 repair_insufficient_evidence:"The original approved scope or failure context is insufficient",
 unclassified:"The public evidence does not identify a specific cause"
});
const TASK_REFS=/^[a-f0-9]{16}$/u;
const FINISH_REASONS=["STOP","MAX_TOKENS","SAFETY","RECITATION",
 "LANGUAGE","OTHER","BLOCKLIST","PROHIBITED_CONTENT","SPII",
 "MALFORMED_FUNCTION_CALL","UNEXPECTED_TOOL_CALL","NO_IMAGE",
 "FINISH_REASON_UNSPECIFIED","UNKNOWN"];
const PROVIDER_FAILURES=["authentication","permission_or_billing",
 "quota_or_rate_limit","model_or_endpoint_not_found",
 "invalid_request_or_tool_schema","provider_server_error",
 "transport_or_timeout","unknown"];
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const known=(v,items)=>typeof v==="string"&&items.includes(v);
const integer=(v,max=10000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;

/**
 * Per-signed-Task diagnostic record, not per-role totals. A STOP response
 * can establish that no update tool call was observed; it cannot establish
 * the model's private reason or the application's true fault origin.
 * These only use doubly sanitized ADK metadata and opaque dispatch hashes.
 */
function safeTaskObservations(role,rows){
 if(!Array.isArray(rows)||rows.length>12)return [];
 const records=[],seen=new Set();
 for(const raw of rows){
  if(!isObject(raw)||!TASK_REFS.test(raw.task_ref??"")||
     seen.has(raw.task_ref))continue;
  const calls=raw.observed_model_calls,ok=raw.observed_tool_successes,
    failed=raw.observed_tool_failures;
  if(!integer(calls,100)||!integer(ok,300)||!integer(failed,300))
   continue;
  const ops=raw.tool_operations;
  if(!isObject(ops))continue;
  const toolOperations={};
  let totalOk=0,totalFailed=0;
  let invalid=false;
  for(const tool of TOOLS){
   const c=ops[tool];
   if(!isObject(c)||!integer(c.attempted,300)||
      !integer(c.confirmed,300)||!integer(c.rejected,300)||
      c.confirmed+c.rejected!==c.attempted){invalid=true;break;}
   totalOk+=c.confirmed;totalFailed+=c.rejected;
   toolOperations[tool]=Object.freeze({
    attempted:c.attempted,confirmed:c.confirmed,rejected:c.rejected
   });
  }
  if(invalid||totalOk!==ok||totalFailed!==failed)continue;
  const last=raw.last_model_finish_reason;
  if(last!==null&&!known(last,FINISH_REASONS))continue;
  if(!integer(raw.observed_function_call_parts,1000)||
     !integer(raw.observed_text_parts,1000))continue;
  if(raw.last_observed_failure!==undefined&&
     !known(raw.last_observed_failure,[...RECOVERY,...MODEL_CATEGORIES]))
   continue;
  if(raw.d1_editor_revision!==undefined&&
     !known(raw.d1_editor_revision,RECOVERY))continue;
  const lastRejected=raw.last_rejected_tool;
  if(lastRejected!==undefined&&(!isObject(lastRejected)||
     !known(lastRejected.operation,TOOLS)||
     !known(lastRejected.error_kind,TOOL_KINDS)||
     (lastRejected.reason!==undefined&&
      !known(lastRejected.reason,TOOL_REASONS))||
     toolOperations[lastRejected.operation].rejected===0))continue;
  const isD1=known(raw.d1_editor_revision,RECOVERY);
  const noWrite=isD1&&raw.d1_editor_revision==="no_confirmed_editor_write"&&
    toolOperations.update_file.attempted===0;
  records.push(Object.freeze({
   task_ref:raw.task_ref,role,
   epoch_observation:isD1?"signed_d1_recovery":"epoch_not_independently_classified",
   observed_model_calls:calls,
   tool_operations:Object.freeze(toolOperations),
   observed_function_call_parts:raw.observed_function_call_parts,
   observed_text_parts:raw.observed_text_parts,
   last_model_finish_reason:last,
   ...(raw.last_observed_failure!==undefined
     ?{last_observed_failure:raw.last_observed_failure}:{}),
   ...(isD1?{d1_revision_failure:raw.d1_editor_revision}:{}),
   ...(lastRejected?{last_rejected_tool:Object.freeze({
     operation:lastRejected.operation,error_kind:lastRejected.error_kind,
     ...(lastRejected.reason?{reason:lastRejected.reason}:{})
   })}:{}),
   observed_stop_explanation:noWrite
     ?"no_update_tool_attempt_observed":
      isD1?"consult_signed_revision_evidence":
      "no_verified_task_stop_reason",
   causal_attribution:"not_established"
  }));
  seen.add(raw.task_ref);
 }
 return records;
}

/** Only fixed source module names and numeric line coordinates are published. */
export function safePublishedNativeTrace(raw){
 if(!Array.isArray(raw)||raw.length>4)return Object.freeze([]);
 const out=[];
 for(const item of raw){
  if(!isObject(item)||!known(item.category,DELEGATED)||
     !known(item.kind,KINDS)||!known(item.code,CODES)||
     !(item.site===null||(isObject(item.site)&&
      known(item.site.module,SITES)&&integer(item.site.line,2500)&&
      item.site.line>0)))return Object.freeze([]);
  out.push(Object.freeze({
   category:item.category,kind:item.kind,code:item.code,
   site:item.site===null?null:Object.freeze({
    module:item.site.module,line:item.site.line
   })
  }));
 }
 return Object.freeze(out);
}
function validDocker(raw){
 if(!isObject(raw)||raw.status!=="fail"||
    !Array.isArray(raw.phases)||raw.phases.length!==PHASES.length)return null;
 const first=raw.phases.find(p=>p?.status==="fail");
 if(!raw.phases.every((p,i)=>isObject(p)&&p.phase===PHASES[i]&&
    known(p.status,["pass","fail","skipped"]))||
    !first||first.phase!==raw.first_failed_phase)return null;
 return first.phase;
}
/** Fixed-vocabulary observations, grouped by evidence source (not timeline). */
export function buildSafeDelegationFailureLedger({
 gemini_pilot_diagnostic,agent_failure_evidence,docker_phase_evidence
}={}){
 const events=[];
 let eventsTruncated=false;
 function add(phase,reportedBy,role,operation,code,evidence,detail={}){
  if(events.length>=24){eventsTruncated=true;return;}
  events.push(Object.freeze({
   event_id:"F"+(events.length+1),phase,reporting_component:reportedBy,
   affected_role:role,operation,observed_code:code,
   verified_stop_condition:DETAILS[code]??
     "Observed fixed-category failure; consult restricted evidence",
   evidence_source:evidence,causal_attribution:"not_established",...detail
  }));
 }
 const d=isObject(gemini_pilot_diagnostic)?gemini_pilot_diagnostic:null;
 if(d&&known(d.stage,STAGES)){
  const phase=["gemini_planning","gemini_plan_proposed"].includes(d.stage)
   ?"planning":d.stage==="signed_test_review"?"approval":
   d.stage==="activation_dc_vp"?"activation":
   d.stage==="delegated_agents_gitea_docker"?"execution":
   d.stage==="complete"?"finalization":"setup";
  const component=phase==="planning"?"trusted_planner":
   phase==="approval"?"signed_approval":
   phase==="activation"?"rust_gateway":
   phase==="execution"?"trusted_orchestrator":"workflow";
  if(known(d.category,["test_assertion","planner_contract_rejected",
      "model_provider_failure","repair_insufficient_evidence","unclassified_failure"])){
   add(phase,component,null,null,d.category,"trusted_phase_diagnostic");
   // The provider's *fixed* error classification can answer which upstream
   // failure was reported. Raw provider exception text never crosses here.
   if(d.category==="model_provider_failure"&&
      known(d.model_failure,PROVIDER_FAILURES))
    add(phase,"gemini_provider",null,null,d.model_failure,
     "verified_provider_error_category");
  }
  if(phase==="execution"&&known(d.delegated_failure,DELEGATED)&&
     d.delegated_failure!=="none"&&d.delegated_failure!=="unclassified"){
   const subphase=typeof d.delegated_phase==="string"&&
     ["not_started","model_binding","dag_preflight","baseline_reads",
      "agent_bootstrap","dispatcher_setup","a2a_dispatch",
      "result_verification","trusted_owner_repair_handoff",
      "d1_repair_planning","d1_feedback_verification","d1_history_verification",
      "d1_discovery","d1_planner_preflight","d1_scope_selection",
      "d1_model_proposal","d1_validation_reservation",
      "d1_gateway_admission","d1_admitted_execution","d1_epoch_admitted",
      "d1_editor_preparation","d1_editor_revision_verified",
      "d1_test_preparation","d1_test_gateway_confirmed"].includes(d.delegated_phase)
      ?d.delegated_phase:null;
   add(subphase?.startsWith("d1_")?"recovery_d1":"execution_d0",
    "trusted_orchestrator",null,null,d.delegated_failure,
    "trusted_owner_failure_category",subphase?{subphase}:{});
  }
  const trace=safePublishedNativeTrace(d.failure_trace);
  if(trace.length)add(phase,"trusted_code_site",null,null,
    trace[0].category,"allowlisted_source_trace",
    {source_sites:trace});
 }
 const roles=isObject(agent_failure_evidence)&&
  agent_failure_evidence.schema==="signed-gemini-agent-failure-v1"&&
  isObject(agent_failure_evidence.role_evidence)?
   agent_failure_evidence.role_evidence:null;
 const taskObservations=[];
 if(roles)for(const role of ROLES){
  taskObservations.push(...safeTaskObservations(role,
    roles[role]?.task_evidence));
 }
 if(roles)for(const role of ROLES){
  const r=roles[role];if(!isObject(r))continue;
  if(isObject(r.failed_operations))for(const tool of TOOLS){
   const reasons=r.failed_operations[tool];
   if(!isObject(reasons))continue;
   for(const reason of TOOL_REASONS){
    if(integer(reasons[reason],300)&&reasons[reason]>0)
     add("agent_task","adk_tool",role,tool,reason,
      "sanitized_controlled_tool_receipt",{failure_count:reasons[reason]});
   }
  }
  const tool=isObject(r.last_function_tool_error)?
   r.last_function_tool_error:null;
  if(tool&&known(tool.tool,TOOLS)&&known(tool.error_kind,TOOL_KINDS))
   add("agent_task","adk_tool",role,tool.tool,tool.error_kind,
    "controlled_tool_result");
  if(isObject(r.agent_failure)&&known(r.agent_failure.category,MODEL_CATEGORIES))
   add("agent_task","adk_task",role,null,r.agent_failure.category,
    "sanitized_adk_task_result",integer(r.agent_failure.model_turns,30)
     ?{model_turns:r.agent_failure.model_turns}:{});
  if(known(r.d1_revision_failure,RECOVERY)){
   const v=isObject(r.d1_revision_evidence)?r.d1_revision_evidence:{};
   const counts={};
   for(const k of ["read_attempts","read_confirmed","read_denied",
     "update_attempts","update_denied","update_provider_confirmed",
     "task_write_count","runtime_write_count"]){
    if(integer(v[k]))counts[k]=v[k];
   }
   if(typeof v.head_changed==="boolean")counts.head_changed=v.head_changed;
   add("recovery_d1","trusted_revision_verifier",role,"update_file",
    r.d1_revision_failure,"signed_d1_effect_audit",
    {operation_evidence:Object.freeze(counts),
     ...(typeof v.task_ref==="string"&&TASK_REFS.test(v.task_ref)
       ?{task_ref:v.task_ref}:{})});
  }
 }
 const failed=validDocker(docker_phase_evidence);
 if(failed){
  const tsCodes=failed==="typecheck"&&
    Array.isArray(docker_phase_evidence.typecheck_error_codes)&&
    docker_phase_evidence.typecheck_error_codes.length<=8&&
    docker_phase_evidence.typecheck_error_codes.every(code=>
      typeof code==="string"&&/^TS[0-9]{4,5}$/u.test(code))
      ?[...new Set(docker_phase_evidence.typecheck_error_codes)]:[];
  // Native Runner and CI revalidate these receipts independently. Project
  // failure details are rechecked here and never copied from raw test output.
  const detail={runner_phase:failed,
   ...(tsCodes.length?{typecheck_error_codes:tsCodes}:{})};
  if(["backend_tests","frontend_tests"].includes(failed)&&
     docker_phase_evidence.project_tests==="fail"&&
     docker_phase_evidence.researcher_acceptance==="skipped"){
   const safe=safeProjectTestFailureDiagnostic(
     docker_phase_evidence.project_test_failure);
   if(safe?.phase===failed)detail.project_test_failure=safe;
  }
  if(failed==="playwright_e2e"&&
     docker_phase_evidence.project_tests==="fail"&&
     docker_phase_evidence.researcher_acceptance==="skipped"){
   const safe=safeProjectE2eFailureDiagnostic(
     docker_phase_evidence.project_e2e_failure);
   if(safe)detail.project_e2e_failure=safe;
  }
  if(failed==="researcher_acceptance"&&
     docker_phase_evidence.project_tests==="pass"&&
     docker_phase_evidence.researcher_acceptance==="fail"){
   const safe=safeAcceptanceFailureSummary(
     docker_phase_evidence.acceptance_failure);
   if(safe)detail.acceptance_failure=safe;
  }
  add("docker_runner","trusted_runner",null,"run_tests",
   failed,"runner_verified_phase",detail);
 }
 if(!events.length)add("unknown","workflow",null,null,"unclassified",
  "insufficient_public_diagnostics");
 const primary=events.findLast(e=>
    e.phase==="recovery_d1"&&e.reporting_component==="trusted_revision_verifier")??
   events.findLast(e=>e.phase==="docker_runner")??
   events.findLast(e=>e.phase==="agent_task")??events.at(-1);
 // Every incomplete diagnosis is explicitly flagged. An absent receipt
 // cannot be interpreted as a successful stage or an established root cause.
 const missing=new Set();
 if(!failed&&events.some(e=>e.operation==="run_tests"||
    e.phase==="recovery_d1"))
  missing.add("runner_phase_not_in_public_receipt");
 if(isObject(docker_phase_evidence)&&
    docker_phase_evidence.status==="fail"&&!failed)
  missing.add("runner_phase_receipt_invalid_or_incomplete");
 if(events.some(e=>["unclassified","unclassified_failure"].includes(
   e.observed_code)))
  missing.add("specific_failure_category_not_established");
 if(events.some(e=>e.observed_code==="test_assertion"))
  missing.add("failed_assertion_detail_not_in_public_receipt");
 const runner=events.find(e=>e.phase==="docker_runner"&&
   e.reporting_component==="trusted_runner");
 if(runner?.observed_code==="typecheck"&&
    !runner.typecheck_error_codes)
  missing.add("runner_compiler_error_codes_not_in_public_receipt");
 if(["backend_tests","frontend_tests"].includes(runner?.observed_code)&&
    !runner.project_test_failure)
  missing.add("runner_project_test_failure_detail_not_in_public_receipt");
 if(runner?.observed_code==="playwright_e2e"&&
    (!runner.project_e2e_failure||
     runner.project_e2e_failure.unclassified_failure))
  missing.add("runner_e2e_failure_detail_not_classified");
 if(runner?.observed_code==="researcher_acceptance"&&
    (!runner.acceptance_failure||
     runner.acceptance_failure.unclassified_failure))
  missing.add("runner_acceptance_failure_detail_not_classified");
 if(events.some(e=>e.observed_code==="model_provider_failure")&&
    !events.some(x=>x.reporting_component==="gemini_provider"&&
     x.observed_code!=="unknown"))
  missing.add("provider_failure_category_not_verified");
 if(events.some(e=>e.phase==="agent_task"&&e.affected_role&&
    !taskObservations.some(x=>x.role===e.affected_role)))
  missing.add("failed_agent_signed_task_not_correlated");
 if(events.some(e=>e.phase==="recovery_d1"&&
    e.reporting_component==="trusted_revision_verifier"&&
    !(e.task_ref&&taskObservations.some(x=>
      x.role===e.affected_role&&x.task_ref===e.task_ref))))
  missing.add("d1_recovery_task_evidence_not_correlated");
 if(events.some(e=>e.observed_code==="no_confirmed_editor_write"))
  missing.add("model_reason_for_no_edit_not_independently_verified");
 if(eventsTruncated)missing.add("public_event_limit_truncated_diagnostics");
 const evidenceGaps=Object.freeze([...missing]);
 return Object.freeze({
  schema:"delegation-failure-ledger-v1",
  ordering:"grouped_by_evidence_not_chronological",
  causal_attribution:"not_established",
  primary_blocker_event_id:primary.event_id,
  observed_events:Object.freeze(events),
  signed_task_observations:Object.freeze(taskObservations),
  missing_evidence:evidenceGaps,
  evidence_completeness:evidenceGaps.length
    ?"partial_public_evidence":"classified_public_observation",
  private_detail_required:evidenceGaps.length>0,
  interpretation:"Reporting component, role and operation identify the observed failure; application root cause is not inferred."
 });
}
