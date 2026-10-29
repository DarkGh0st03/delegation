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
const AGENT_TYPES=["adk_task_outcome","adk_safe_diagnostic",
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
  if(x.event==="adk_tool_timing"){
    if(!AGENT_TOOLS.includes(x.tool)||typeof x.success!=="boolean"||
       (x.error_kind!==null&&!TOOL_ERRORS.includes(x.error_kind)))
      return null;
    return {event:x.event,role:x.role,tool:x.tool,
      success:x.success,error_kind:x.error_kind};
  }
  if(x.event==="adk_llm_timing"){
    if(!valid(x.turn,SIGNED_GEMINI_PILOT.maxTurnsPerTask[x.role])||
       x.turn===0||!valid(x.function_call_parts,200)||
       !valid(x.text_parts,200)||
       (x.finish_reason!==null&&!SAFE_FINISH_REASONS.includes(x.finish_reason)))
      return null;
    return {event:x.event,role:x.role,turn:x.turn,
      function_call_parts:x.function_call_parts,
      text_parts:x.text_parts,finish_reason:x.finish_reason};
  }
  if(!valid(x.model_turns,SIGNED_GEMINI_PILOT.maxTurnsPerTask[x.role])||
     !(x.event==="adk_task_outcome"?AGENT_ERRORS:MODEL_ERRORS)
       .includes(x.category))return null;
  const y={event:x.event,role:x.role,category:x.category,
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
    roles[role]={
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
