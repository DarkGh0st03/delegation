/** Only fixed-vocabulary, source-free diagnostic fields can escape a paid
 * F1 child. execFileSync({encoding:"utf8"}) returns stderr as a STRING,
 * whereas the unencoded version returns a Buffer. Both are valid here. */
const F1_FAILURE_STAGES=new Set(["setup","gemini_planning","gemini_plan_proposed"]);
const F1_FAILURE_CATEGORIES=new Set(["planner_contract_rejected",
  "model_provider_failure","test_assertion","unclassified_failure"]);
const F1_MODEL_FAILURES=new Set(["none","authentication",
  "permission_or_billing","quota_or_rate_limit",
  "model_or_endpoint_not_found","invalid_request_or_tool_schema",
  "provider_server_error","transport_or_timeout","unknown"]);
const F1_PLANNING_REJECTIONS=new Set([
  "ungrounded_or_missing_output","invalid_json","invalid_proposal_shape",
  "shape_proposal_fields","shape_proposal_object","shape_proposal_list",
  "shape_proposal_string","shape_task_fields","shape_task_object",
  "shape_task_list","shape_task_string","shape_permission_fields",
  "shape_permission_object","shape_permission_string",
  "invalid_task_count","invalid_task_identity","unsupported_agent_role",
  "unsupported_tool_for_role","unauthorized_existing_file",
  "unauthorized_new_file","invalid_path","invalid_permission_path",
  "missing_branch_task","missing_branch_dependency",
  "conflicting_unordered_writes","duplicate_task_permission",
  "incorrect_work_branch","invalid_dependencies","invalid_permissions",
  "execution_dag_incompatible","execution_unsupported_bounds",
  "execution_duplicate_task_ids","execution_missing_specialist",
  "execution_permission_not_in_task","execution_duplicate_permission",
  "execution_task_without_grants","execution_required_operation_count",
  "execution_first_branch","execution_cycle","execution_unknown_task",
  "execution_branch_dependency","execution_pr_before_runner",
  "execution_update_without_read","execution_unordered_writes",
  "execution_runner_before_edit","execution_pr_before_edit",
  "execution_duplicate_creation","execution_read_before_creation",
  "execution_wrong_runner_branch","execution_bad_file_resource",
  "contract_validation_other"
]);
export function safeF1RealGiteaPlanningFailure(stderr){
  const raw=typeof stderr==="string"?stderr:
    Buffer.isBuffer(stderr)?stderr.toString("utf8"):"";
  if(Buffer.byteLength(raw,"utf8")>2_200_000)return Object.freeze([]);
  const safe=[];
  const prefix="[signed-gemini-pilot] ";
  for(const line of raw.split(/\r?\n/u)){
    if(safe.length>=12)break;
    if(!line.startsWith(prefix)||line.length>4096)continue;
    let event;
    try{event=JSON.parse(line.slice(prefix.length));}
    catch{continue;}
    if(!event||typeof event!=="object"||Array.isArray(event)||
       !F1_FAILURE_STAGES.has(event.stage)||
       !F1_FAILURE_CATEGORIES.has(event.category)||
       !Number.isSafeInteger(event.model_turns_started)||
       event.model_turns_started<0||event.model_turns_started>24)continue;
    const reason=event.planning_rejection?.reason;
    const modelFailure=event.model_failure;
    const result={
      stage:event.stage,category:event.category,
      rejection_category:F1_PLANNING_REJECTIONS.has(reason)
        ?reason:"not_reported",
      model_failure:F1_MODEL_FAILURES.has(modelFailure)
        ?modelFailure:"unknown",
      model_turns_started:event.model_turns_started,
      approval_created:false,operational_root_issued:false
    };
    // Only the bounded, host-generated stage/reason codes may survive.
    // Unknown, malformed or oversized histories are dropped in full.
    const history=event.planning_rejections;
    if(Array.isArray(history)&&history.length>0&&history.length<=3&&
       history.every(item=>item&&typeof item==="object"&&
         !Array.isArray(item)&&
         ["grounding","json","contract"].includes(item.stage)&&
         F1_PLANNING_REJECTIONS.has(item.reason)))
      result.rejection_history=Object.freeze(history.map(item=>
        Object.freeze({stage:item.stage,reason:item.reason})));
    const loc=event.assertion_location;
    if(loc&&typeof loc==="object"&&!Array.isArray(loc)&&
       ["signed_dag_harness","planning_harness"].includes(loc.module)&&
       Number.isSafeInteger(loc.line)&&loc.line>0&&loc.line<2000)
      result.assertion_location={module:loc.module,line:loc.line};
    safe.push(Object.freeze(result));
  }
  return Object.freeze(safe);
}

/**
 * Pure, prompt-free usage summarizer for the private manual Gemini pilot log.
 * Token counts are OPTIONAL provider metadata, NOT a bill or USD spend cap.
 * Never echo log lines. Each row is one model-delegate attempt, not necessarily
 * one billable HTTP request (the SDK/provider could make internal retries).
 */
import {SIGNED_GEMINI_PILOT} from "./signed-gemini-pilot-consent.mjs";
const ROLES=["planner","backend","frontend","test"];
const FIELDS=["input_tokens","output_tokens","thinking_tokens"];
const valid=(n,max=1_000_000_000)=>
  Number.isSafeInteger(n)&&n>=0&&n<=max;
export function extractSafeGeminiPilotUsage(log){
  const rows=Object.fromEntries(ROLES.map(role=>[role,[]]));
  const plannerTurns=new Set(),plannerUsage=new Map();
  let integrity="valid",observations=0;
  if(typeof log!=="string"||Buffer.byteLength(log,"utf8")>16_000_000)
    integrity="log_unavailable_or_oversized";
  else for(const line of log.split(/\r?\n/u)){
    if(!line.startsWith("{")&&!line.startsWith("[signed-gemini-pilot] "))
      continue;
    const candidate=line.startsWith("[signed-gemini-pilot] ")
      ?line.slice("[signed-gemini-pilot] ".length):line;
    if(candidate.length>8192)continue;
    let event;
    try{event=JSON.parse(candidate);}catch{continue;}
    if(!event||typeof event!=="object"||Array.isArray(event))continue;
    const kind=event.event;
    if(!["gemini_pilot_planner_turn","gemini_pilot_planner_usage",
          "adk_llm_timing"].includes(kind))continue;
    if(++observations>500){integrity="too_many_observations";break;}
    const role=kind==="adk_llm_timing"?event.role:"planner";
    if(!ROLES.includes(role)||
       !valid(event.turn,SIGNED_GEMINI_PILOT.maxTurnsPerTask[role])||
       event.turn===0){integrity="invalid_role_or_turn";continue;}
    if(kind==="gemini_pilot_planner_turn"){
      if(plannerTurns.has(event.turn))integrity="duplicate_planner_turn";
      plannerTurns.add(event.turn);continue;
    }
    const tokens={};
    for(const key of FIELDS){
      const n=event[key];
      if(n===undefined||n===null)tokens[key]=null;
      else if(valid(n))tokens[key]=n;
      else{tokens[key]=null;integrity="invalid_provider_counter";}
    }
    if(kind==="gemini_pilot_planner_usage"){
      if(plannerUsage.has(event.turn))integrity="duplicate_planner_usage";
      else plannerUsage.set(event.turn,tokens);
    }else{
      // The same turn number may recur in different signed Tasks of one role.
      rows[role].push(tokens);
    }
  }
  for(const turn of [...plannerTurns].sort((a,b)=>a-b))
    rows.planner.push(plannerUsage.get(turn)??{
      input_tokens:null,output_tokens:null,thinking_tokens:null
    });
  if([...plannerUsage.keys()].some(turn=>!plannerTurns.has(turn)))
    integrity="planner_usage_without_attempt";
  const roleUsage={};
  for(const role of ROLES){
    const data=rows[role],counts={};
    for(const key of FIELDS)
      counts[key]=data.length&&data.every(x=>x[key]!==null)
        ?data.reduce((sum,x)=>sum+x[key],0):null;
    roleUsage[role]=Object.freeze({
      observed_delegate_calls:data.length,
      calls_with_input_output_metadata:data.filter(x=>
        x.input_tokens!==null&&x.output_tokens!==null).length,
      provider_reported_input_tokens:counts.input_tokens,
      provider_reported_output_tokens:counts.output_tokens,
      provider_reported_thinking_tokens:counts.thinking_tokens,
      max_turns_per_signed_task:SIGNED_GEMINI_PILOT.maxTurnsPerTask[role]
    });
  }
  const all=ROLES.map(role=>roleUsage[role]);
  const sumField=key=>all.every(x=>x[key]!==null)
    ?all.reduce((sum,x)=>sum+x[key],0):null;
  return Object.freeze({
    schema:"signed-gemini-model-usage-v1",
    observation_integrity:integrity,
    configured_model:SIGNED_GEMINI_PILOT.model,
    provenance:"host_observed_provider_usage_metadata",
    observed_delegate_calls:all.reduce((sum,x)=>sum+x.observed_delegate_calls,0),
    input_output_metadata_complete:all.every(x=>
      x.observed_delegate_calls>0&&
      x.calls_with_input_output_metadata===x.observed_delegate_calls),
    role_usage:Object.freeze(roleUsage),
    provider_reported_input_tokens:sumField("provider_reported_input_tokens"),
    provider_reported_output_tokens:sumField("provider_reported_output_tokens"),
    provider_reported_thinking_tokens:sumField("provider_reported_thinking_tokens"),
    provider_billed_request_count:null,
    provider_invoice_usd:null,
    provider_project_spend_cap_verified:false,
    hard_monetary_spend_cap_enforced:false,
    note:"Diagnostic metadata only; actual charges and project limits require provider billing verification"
  });
}

/**
 * Failed execFileSync calls capture child stdout separately from stderr.
 * Recover ONLY reconstructed numeric observations, never untrusted text.
 */
export function safeGeminiPilotChildObservations(raw){
  const value=Buffer.isBuffer(raw)?raw.toString("utf8"):
    typeof raw==="string"?raw:"";
  if(Buffer.byteLength(value,"utf8")>2_200_000)return Object.freeze([]);
  const events=[];
  const prefix="[signed-gemini-pilot] ";
  for(const line of value.split(/\r?\n/u)){
    if(events.length>=500)break;
    let candidate;
    if(line.startsWith(prefix))candidate=line.slice(prefix.length);
    else if(line.startsWith("{"))candidate=line;
    else continue;
    if(candidate.length>4096)continue;
    let e;
    try{e=JSON.parse(candidate);}catch{continue;}
    if(!e||typeof e!=="object"||Array.isArray(e))continue;
    const kind=e.event;
    const role=kind==="adk_llm_timing"?e.role:"planner";
    if(!ROLES.includes(role)||!valid(e.turn,
      SIGNED_GEMINI_PILOT.maxTurnsPerTask[role])||e.turn===0)continue;
    if(!["gemini_pilot_planner_turn","gemini_pilot_planner_usage",
         "adk_llm_timing"].includes(kind))continue;
    if(kind==="adk_llm_timing"&&role==="planner")continue;
    const result={event:kind,turn:e.turn};
    if(kind==="adk_llm_timing")result.role=role;
    if(kind!=="gemini_pilot_planner_turn"){
      for(const field of FIELDS)
        result[field]=valid(e[field])?e[field]:null;
    }
    events.push(Object.freeze(result));
  }
  return Object.freeze(events);
}

/** Reconstruct ONLY fixed-category Agent observations from a failed child.
 * Raw errors, paths, tool arguments, prompt text and credentials are dropped. */
const AGENT_ROLES=["backend","frontend","test"];
const D1_REVISION_CATEGORIES=["revision_baseline_mismatch","no_confirmed_editor_write",
  "editor_effect_binding_mismatch","provider_head_mismatch","unchanged_editor_revision"];
const D1_OPERATION_STATUSES=["confirmed","no_update_attempted","update_denied",
  "update_not_confirmed","effect_correlation_failure"];
const D1_OPERATION_COUNTERS=["read_attempts","read_confirmed","read_denied",
  "update_attempts","update_denied","update_provider_confirmed"];
const AGENT_TYPES=["d1_editor_revision","adk_task_outcome","adk_safe_diagnostic",
  "adk_tool_timing","adk_llm_timing"];
const SAFE_FINISH_REASONS=["STOP","MAX_TOKENS","SAFETY","RECITATION",
  "LANGUAGE","OTHER","BLOCKLIST","PROHIBITED_CONTENT","SPII",
  "MALFORMED_FUNCTION_CALL","UNEXPECTED_TOOL_CALL","NO_IMAGE",
  "FINISH_REASON_UNSPECIFIED","UNKNOWN"];
const AGENT_ERRORS=["controlled_tool_failures","no_confirmed_revision",
  "repair_requires_new_approval"];
const MODEL_ERRORS=["model_turn_budget","model_output_truncated",
  "api_rate_limit_or_quota",
  "api_authentication","api_permission_denied","api_model_not_found",
  "api_invalid_request","api_service_unavailable","api_inference_timeout",
  "api_network_failure","tool_schema_or_validation",
  "sdk_model_exception","adk_event_error"];
const TOOL_ERRORS=["authorization_denied","tests_failed",
  "tool_unavailable","invalid_tool_call","iteration_limit"];
const TOOL_FAILURE_REASONS=["invalid_arguments","branch_mismatch",
  "path_outside_signed_scope","operation_not_granted",
  "gateway_prepare_rejected","upstream_unavailable","request_validation_rejected","task_binding_rejected","signed_permission_rejected","dependency_rejected","task_inactive_or_expired","runtime_scope_rejected","source_witness_missing","gateway_prepare_unclassified"];
const AGENT_TOOLS=["read_file","update_file","create_file","run_tests"];
const SAFE_400_CAUSES=["missing_thought_signature",
  "function_call_response_order","invalid_tool_schema",
  "context_token_limit","generation_configuration"];
const AGENT_METRICS=["successful_reads","distinct_read_paths",
  "duplicate_reads","failed_reads","successful_writes","failed_writes"];
const AGENT_PREFIX="[trusted-positive-ci] gemini_agent_observation ";
function safeAgentObservation(x){
  if(!x||typeof x!=="object"||Array.isArray(x)||
     !AGENT_ROLES.includes(x.role)||!AGENT_TYPES.includes(x.event))
    return null;
  if(x.task_ref!==undefined&&
     (typeof x.task_ref!=="string"||!/^[a-f0-9]{16}$/u.test(x.task_ref)))
    return null;
  const taskFields=x.task_ref?{task_ref:x.task_ref}:{};
  if(x.event==="d1_editor_revision")return ["backend","frontend","test"].includes(x.role)&&
    D1_REVISION_CATEGORIES.includes(x.category)
    ?{event:x.event,role:x.role,category:x.category,...taskFields,
      ...Object.fromEntries([...D1_OPERATION_COUNTERS,"task_write_count","runtime_write_count"].filter(k=>
        Number.isSafeInteger(x[k])&&x[k]>=0&&x[k]<=10000).map(k=>[k,x[k]])),
      ...(typeof x.head_changed==="boolean"?{head_changed:x.head_changed}:{}),
      ...(D1_OPERATION_STATUSES.includes(x.d1_operation_status)?{d1_operation_status:x.d1_operation_status}:{})}:null;
  if(x.event==="adk_tool_timing"){
    if(!AGENT_TOOLS.includes(x.tool)||typeof x.success!=="boolean"||
       (x.error_kind!==null&&!TOOL_ERRORS.includes(x.error_kind)))
      return null;
    return {event:x.event,role:x.role,tool:x.tool,...taskFields,
      success:x.success,error_kind:x.error_kind,
      ...(!x.success&&TOOL_FAILURE_REASONS.includes(x.reason)?{reason:x.reason}:{})};
  }
  if(x.event==="adk_llm_timing"){
    if(!valid(x.turn,SIGNED_GEMINI_PILOT.maxTurnsPerTask[x.role])||
       x.turn===0||!valid(x.function_call_parts,200)||
       !valid(x.text_parts,200)||
       (x.finish_reason!==null&&!SAFE_FINISH_REASONS.includes(x.finish_reason)))
      return null;
    return {event:x.event,role:x.role,turn:x.turn,...taskFields,
      function_call_parts:x.function_call_parts,
      text_parts:x.text_parts,finish_reason:x.finish_reason};
  }
  if(!valid(x.model_turns,SIGNED_GEMINI_PILOT.maxTurnsPerTask[x.role])||
     !(x.event==="adk_task_outcome"?AGENT_ERRORS:MODEL_ERRORS)
       .includes(x.category))return null;
  const y={event:x.event,role:x.role,category:x.category,...taskFields,
    model_turns:x.model_turns};
  for(const key of AGENT_METRICS){
    if(!valid(x[key],300))return null;
    y[key]=x[key];
  }
  if(x.event==="adk_task_outcome"&&
     x.category==="repair_requires_new_approval"&&
     x.typecheck_scope_summary!==undefined){
    const s=x.typecheck_scope_summary;
    if(!s||typeof s!=="object"||Array.isArray(s)||
       Object.keys(s).sort().join(",")!=="missing_read_grants,missing_write_grants,parsed_locations"||
       !valid(s.parsed_locations,8)||!valid(s.missing_read_grants,8)||
       !valid(s.missing_write_grants,8)||
       s.missing_read_grants>s.parsed_locations||
       s.missing_write_grants>s.parsed_locations)return null;
    y.typecheck_scope_summary={
      parsed_locations:s.parsed_locations,
      missing_read_grants:s.missing_read_grants,
      missing_write_grants:s.missing_write_grants
    };
  }
  if(x.event==="adk_safe_diagnostic"){
    if(x.invalid_request_cause!==undefined&&
       x.invalid_request_cause!==null&&
       !SAFE_400_CAUSES.includes(x.invalid_request_cause))return null;
    // Sanitization runs twice: once in the isolated child and again on
    // the prefixed CI line. Preserve explicit nulls for absent metadata.
    if(x.function_call_messages!==undefined&&x.function_call_messages!==null&&
       !valid(x.function_call_messages,300))return null;
    if(x.function_call_messages_missing_signature!==undefined&&
       x.function_call_messages_missing_signature!==null&&
       !valid(x.function_call_messages_missing_signature,300))return null;
    if(x.function_call_messages_missing_signature!==null&&
       x.function_call_messages_missing_signature!==undefined&&
       (x.function_call_messages===null||
        x.function_call_messages===undefined||
        x.function_call_messages_missing_signature>x.function_call_messages))
      return null;
    y.http_status=valid(x.http_status,599)&&x.http_status>=100
      ?x.http_status:null;
    y.invalid_request_cause=x.invalid_request_cause??null;
    y.function_call_messages=x.function_call_messages??null;
    y.function_call_messages_missing_signature=
      x.function_call_messages_missing_signature??null;
  }
  return y;
}
export function safeGeminiPilotAgentObservations(raw,{reported=false}={}){
  const data=Buffer.isBuffer(raw)?raw.toString("utf8"):
    typeof raw==="string"?raw:"";
  if(Buffer.byteLength(data,"utf8")>2_200_000)return Object.freeze([]);
  const observations=[];
  for(const line of data.split(/\r?\n/u)){
    if(observations.length>=300)break;
    const payload=reported
      ?line.startsWith(AGENT_PREFIX)?line.slice(AGENT_PREFIX.length):null
      :line.startsWith("{")?line:null;
    if(!payload||payload.length>4096)continue;
    try{
      const observation=safeAgentObservation(JSON.parse(payload));
      if(observation)observations.push(Object.freeze(observation));
    }catch{/* Fail closed; never log private child data. */}
  }
  return Object.freeze(observations);
}
export function extractSafeGeminiPilotAgentSummary(log){
  const observations=safeGeminiPilotAgentObservations(log,{reported:true});
  if(!observations.length)return null;
  const roles={};
  for(const role of AGENT_ROLES){
    const own=observations.filter(x=>x.role===role);
    if(!own.length)continue;
    const failedTools=own.filter(x=>x.event==="adk_tool_timing"&&!x.success);
    const successfulTools=own.filter(x=>x.event==="adk_tool_timing"&&x.success);
    const modelCalls=own.filter(x=>x.event==="adk_llm_timing");
    const failures=own.filter(x=>x.event==="adk_safe_diagnostic"||
      x.event==="adk_task_outcome");
    const latest=failures.at(-1);
    const taskRefs=[...new Set(own.map(x=>x.task_ref).filter(Boolean))].slice(0,12);
    roles[role]={
      ...(taskRefs.length?{task_evidence:taskRefs.map(taskRef=>{
        const scoped=own.filter(x=>x.task_ref===taskRef);
        const llm=scoped.filter(x=>x.event==="adk_llm_timing");
        const tool=scoped.filter(x=>x.event==="adk_tool_timing");
        const latest=scoped.filter(x=>["adk_safe_diagnostic",
          "adk_task_outcome","d1_editor_revision"].includes(x.event)).at(-1);
        const lastModel=llm.at(-1);
        const rejected=tool.filter(x=>!x.success);
        const lastRejected=rejected.at(-1);
        // Correlate observations to the signed Task, never to an entire
        // role across D0 and D1. All fields survived strict double sanitization.
        const toolOperations=Object.fromEntries(AGENT_TOOLS.map(name=>
          [name,Object.freeze({
            attempted:tool.filter(x=>x.tool===name).length,
            confirmed:tool.filter(x=>x.tool===name&&x.success).length,
            rejected:tool.filter(x=>x.tool===name&&!x.success).length
          })]));
        return Object.freeze({
          task_ref:taskRef,observed_model_calls:llm.length,
          observed_tool_successes:tool.filter(x=>x.success).length,
          observed_tool_failures:rejected.length,
          tool_operations:Object.freeze(toolOperations),
          last_model_finish_reason:lastModel?.finish_reason??null,
          observed_function_call_parts:llm.reduce(
            (n,x)=>n+x.function_call_parts,0),
          observed_text_parts:llm.reduce((n,x)=>n+x.text_parts,0),
          ...(lastRejected?{last_rejected_tool:Object.freeze({
            operation:lastRejected.tool,
            error_kind:lastRejected.error_kind,
            ...(lastRejected.reason?{reason:lastRejected.reason}:{})
          })}:{}),
          ...(latest?{last_observed_failure:latest.category}:{}),
          ...(latest?.event==="d1_editor_revision"
            ?{d1_editor_revision:latest.category}:{})
        });
      })}:{}),
      ...(own.some(x=>x.event==="d1_editor_revision")?{
        d1_revision_failure:own.filter(x=>x.event==="d1_editor_revision").at(-1).category,
        d1_revision_evidence:Object.fromEntries(Object.entries(
          own.filter(x=>x.event==="d1_editor_revision").at(-1))
          .filter(([k])=>[...D1_OPERATION_COUNTERS,"task_write_count","runtime_write_count",
            "head_changed","d1_operation_status","task_ref"].includes(k)))}:{}),
      model_turns_with_shape_metadata:modelCalls.length,
      observed_function_call_parts:modelCalls.reduce((n,x)=>n+x.function_call_parts,0),
      observed_text_parts:modelCalls.reduce((n,x)=>n+x.text_parts,0),
      model_finish_reasons:Object.fromEntries(
        SAFE_FINISH_REASONS.filter(reason=>modelCalls.some(x=>
          x.finish_reason===reason)).map(reason=>[
          reason,modelCalls.filter(x=>x.finish_reason===reason).length
        ])),
      observed_function_tool_successes:successfulTools.length,
      observed_function_tool_failures:failedTools.length,
      failed_operations:Object.fromEntries(AGENT_TOOLS
        .filter(tool=>failedTools.some(x=>x.tool===tool))
        .map(tool=>[tool,Object.fromEntries([...TOOL_FAILURE_REASONS,"unclassified"]
          .map(reason=>[reason,failedTools.filter(x=>x.tool===tool&&
            (x.reason??"unclassified")===reason).length]).filter(([,count])=>count>0))])),
      last_function_tool_error:failedTools.length
        ?{tool:failedTools.at(-1).tool,
          error_kind:failedTools.at(-1).error_kind}:null,
      ...(latest?{agent_failure:{
        category:latest.category,
        model_turns:latest.model_turns,
        ...(latest.http_status!==undefined
          ?{http_status:latest.http_status}:{}),
        ...(latest.invalid_request_cause!==undefined
          ?{invalid_request_cause:latest.invalid_request_cause}:{}),
        ...(latest.function_call_messages!==undefined
          ?{function_call_messages:latest.function_call_messages}:{}),
        ...(latest.function_call_messages_missing_signature!==undefined
          ?{function_call_messages_missing_signature:
            latest.function_call_messages_missing_signature}:{}),
        ...(latest.typecheck_scope_summary!==undefined
          ?{typecheck_scope_summary:latest.typecheck_scope_summary}:{}),
        progress:Object.fromEntries(AGENT_METRICS.map(k=>[k,latest[k]]))
      }}:{})
    };
  }
  return Object.freeze({schema:"signed-gemini-agent-failure-v1",
    observations:observations.length,role_evidence:Object.freeze(roles)});
}
