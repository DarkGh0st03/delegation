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
