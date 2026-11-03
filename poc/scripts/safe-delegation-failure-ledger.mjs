/**
 * Cross-cutting failure observations. Only trusted, already-sanitized
 * planner/ADK/Runner/D1 receipts may enter; never private error text.
 *
 * The reporting component is NOT necessarily the origin of the application
 * defect. A reason is a verified stop condition, not speculative causality.
 */
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
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const known=(v,items)=>typeof v==="string"&&items.includes(v);
const integer=(v,max=10000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;

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
 function add(phase,reportedBy,role,operation,code,evidence,detail={}){
  if(events.length>=24)return;
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
    {operation_evidence:Object.freeze(counts)});
  }
 }
 const failed=validDocker(docker_phase_evidence);
 if(failed)add("docker_runner","trusted_runner",null,"run_tests",
  failed,"runner_verified_phase",{runner_phase:failed});
 if(!events.length)add("unknown","workflow",null,null,"unclassified",
  "insufficient_public_diagnostics");
 const primary=events.findLast(e=>
    e.phase==="recovery_d1"&&e.reporting_component==="trusted_revision_verifier")??
   events.findLast(e=>e.phase==="docker_runner")??
   events.findLast(e=>e.phase==="agent_task")??events.at(-1);
 const missing=[];
 if(!failed&&events.some(e=>e.operation==="run_tests"||
    e.phase==="recovery_d1"))
  missing.push("runner_phase_not_in_public_receipt");
 if(events.some(e=>e.observed_code==="no_confirmed_editor_write"))
  missing.push("model_reason_for_no_edit_not_independently_verified");
 return Object.freeze({
  schema:"delegation-failure-ledger-v1",
  ordering:"grouped_by_evidence_not_chronological",
  causal_attribution:"not_established",
  primary_blocker_event_id:primary.event_id,
  observed_events:Object.freeze(events),
  missing_evidence:Object.freeze(missing),
  private_detail_required:missing.length>0,
  interpretation:"Reporting component, role and operation identify the observed failure; application root cause is not inferred."
 });
}
