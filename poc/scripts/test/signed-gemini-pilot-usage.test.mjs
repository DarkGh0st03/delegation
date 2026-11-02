import test from "node:test";
import assert from "node:assert/strict";
import {extractSafeGeminiPilotUsage as extract,
  safeGeminiPilotChildObservations as sanitizeChild,
  safeGeminiPilotAgentObservations as agentObservations,
  safeF1RealGiteaPlanningFailure as safeF1Failure,
  extractSafeGeminiPilotAgentSummary as agentSummary} from
  "../signed-gemini-pilot-usage.mjs";
const event=obj=>JSON.stringify(obj);
const planner=(kind,turn,more={})=>"[signed-gemini-pilot] "+
  event({event:kind,turn,...more});
const role=(r,t,more={})=>event({
  event:"adk_llm_timing",role:r,turn:t,...more
});
test("host-observed provider usage is sanitized and distinct from cost",()=>{
  const secret="DO_NOT_ECHO_PRIVATE_API_KEY";
  const result=extract([
    planner("gemini_pilot_planner_turn",1),
    planner("gemini_pilot_planner_usage",1,{
      input_tokens:100,output_tokens:11,thinking_tokens:3
    }),
    role("backend",1,{input_tokens:200,output_tokens:20,thinking_tokens:7}),
    role("frontend",1,{input_tokens:300,output_tokens:30,thinking_tokens:5}),
    role("test",1,{input_tokens:400,output_tokens:40,thinking_tokens:2}),
    "irrelevant model text "+secret,
    event({event:"not_recognized",secret})
  ].join("\n"));
  assert.equal(result.observation_integrity,"valid");
  assert.equal(result.observed_delegate_calls,4);
  assert.equal(result.input_output_metadata_complete,true);
  assert.equal(result.provider_reported_input_tokens,1000);
  assert.equal(result.provider_reported_output_tokens,101);
  assert.equal(result.provider_reported_thinking_tokens,17);
  assert.equal(result.provider_billed_request_count,null);
  assert.equal(result.provider_invoice_usd,null);
  assert.equal(result.provider_project_spend_cap_verified,false);
  assert.equal(result.hard_monetary_spend_cap_enforced,false);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(Object.isFrozen(result));
});
test("missing usage is unknown, never free; zero counts are valid",()=>{
  const result=extract([
    planner("gemini_pilot_planner_turn",1),
    role("backend",1,{input_tokens:null,output_tokens:21}),
    role("frontend",1,{input_tokens:3,output_tokens:5}),
    role("test",1,{input_tokens:0,output_tokens:0})
  ].join("\n"));
  assert.equal(result.input_output_metadata_complete,false);
  assert.equal(result.provider_reported_input_tokens,null);
  assert.equal(result.provider_reported_output_tokens,null);
  assert.equal(result.role_usage.backend.provider_reported_input_tokens,null);
  assert.equal(result.role_usage.test.provider_reported_input_tokens,0);
});
test("same role-turn after new signed Task is a distinct model call",()=>{
  const result=extract([
    role("test",1,{input_tokens:10,output_tokens:1}),
    role("test",1,{input_tokens:20,output_tokens:2}),
    role("test",2,{input_tokens:30,output_tokens:3})
  ].join("\n"));
  assert.equal(result.observation_integrity,"valid");
  assert.equal(result.role_usage.test.observed_delegate_calls,3);
  assert.equal(result.role_usage.test.provider_reported_input_tokens,60);
});
test("bad counters, duplicate Planner evidence and spoofed lines fail closed",()=>{
  const cases=[
    [[planner("gemini_pilot_planner_turn",1),
      planner("gemini_pilot_planner_turn",1)],"duplicate_planner_turn"],
    [[planner("gemini_pilot_planner_turn",1),
      planner("gemini_pilot_planner_usage",1,{input_tokens:1,output_tokens:1}),
      planner("gemini_pilot_planner_usage",1,{input_tokens:1,output_tokens:1})],
      "duplicate_planner_usage"],
    [[role("backend",21,{input_tokens:1,output_tokens:1})],
      "invalid_role_or_turn"],
    [[role("backend",1,{input_tokens:-1,output_tokens:1})],
      "invalid_provider_counter"]
  ];
  for(const [lines,reason] of cases){
    const x=extract(lines.join("\n"));
    assert.equal(x.observation_integrity,reason);
    assert.equal(x.input_output_metadata_complete,false);
  }
  assert.equal(extract("untrusted "+role("backend",1,{input_tokens:1}))
    .observed_delegate_calls,0);
  const huge=extract("a".repeat(16_000_001));
  assert.equal(huge.observation_integrity,"log_unavailable_or_oversized");
  assert.equal(huge.provider_invoice_usd,null);
});

test("failed child stdout forwards numeric usage, not private source",()=>{
  const secret="PRIVATE_PROMPT_TOKEN_DO_NOT_LOG";
  const output=[
    planner("gemini_pilot_planner_turn",1),
    planner("gemini_pilot_planner_usage",1,{
      input_tokens:45,output_tokens:9,thinking_tokens:null,
      prompt:secret,apiKey:secret
    }),
    role("backend",1,{input_tokens:31,output_tokens:7,source:secret}),
    secret,
    "[signed-gemini-pilot] {invalid",
    event({event:"other",secret})
  ].join("\n");
  const safe=sanitizeChild(Buffer.from(output));
  assert.equal(safe.length,3);
  assert.ok(!JSON.stringify(safe).includes(secret));
  const report=extract(safe.map(e=>e.event==="adk_llm_timing"
    ?JSON.stringify(e):"[signed-gemini-pilot] "+JSON.stringify(e)).join("\n"));
  assert.equal(report.observed_delegate_calls,2);
  assert.equal(report.role_usage.planner.provider_reported_input_tokens,45);
  assert.equal(report.role_usage.backend.provider_reported_output_tokens,7);
  assert.equal(report.provider_invoice_usd,null);
  assert.deepEqual(sanitizeChild("x".repeat(2_200_001)),[]);
});

test("failed Agent tool diagnostic is whitelisted and source-free",()=>{
  const secret="PRIVATE_VP_OR_REPOSITORY_SOURCE";
  const progress={successful_reads:1,distinct_read_paths:1,
    duplicate_reads:0,failed_reads:0,successful_writes:0,failed_writes:1};
  const child=[
    event({event:"adk_tool_timing",role:"backend",tool:"update_file",
      success:false,error_kind:"authorization_denied",path:secret}),
    event({event:"adk_task_outcome",role:"backend",
      category:"controlled_tool_failures",model_turns:6,...progress,
      message:secret}),
    event({event:"adk_task_outcome",role:"bad_role",
      category:"controlled_tool_failures",model_turns:6,...progress}),
    event({event:"adk_tool_timing",role:"backend",tool:"update_file",
      success:false,error_kind:secret})
  ].join("\n");
  const safe=agentObservations(Buffer.from(child));
  assert.equal(safe.length,2);
  assert.ok(!JSON.stringify(safe).includes(secret));
  const log=safe.map(x=>
    "[trusted-positive-ci] gemini_agent_observation "+event(x)).join("\n");
  const result=agentSummary(log);
  assert.equal(result.role_evidence.backend.last_function_tool_error.error_kind,
    "authorization_denied");
  assert.equal(result.role_evidence.backend.agent_failure.category,
    "controlled_tool_failures");
  assert.equal(result.role_evidence.backend.agent_failure.progress.failed_writes,1);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(agentSummary("spoofed "+log.split("\n")[0]),null);
  assert.deepEqual(agentObservations("x".repeat(2_200_001)),[]);
});
test("missing repository evidence is not misreported as a denied tool",()=>{
  const progress={successful_reads:0,distinct_read_paths:0,
    duplicate_reads:0,failed_reads:0,successful_writes:0,failed_writes:0};
  const log="[trusted-positive-ci] gemini_agent_observation "+event({
    event:"adk_task_outcome",role:"backend",
    category:"no_confirmed_revision",model_turns:6,...progress
  });
  const observed=agentSummary(log).role_evidence.backend;
  assert.equal(observed.agent_failure.category,"no_confirmed_revision");
  assert.equal(observed.observed_function_tool_failures,0);
});

test("redacted model response shapes distinguish empty, tool and exhausted results",()=>{
  const secret="PRIVATE_MODEL_OUTPUT";
  const raw=[
    event({event:"adk_llm_timing",role:"backend",turn:1,
      function_call_parts:0,text_parts:1,finish_reason:"STOP",text:secret}),
    event({event:"adk_llm_timing",role:"backend",turn:2,
      function_call_parts:0,text_parts:1,finish_reason:"MAX_TOKENS",text:secret}),
    event({event:"adk_llm_timing",role:"backend",turn:3,
      function_call_parts:1,text_parts:0,finish_reason:"MALFORMED_FUNCTION_CALL"}),
    event({event:"adk_llm_timing",role:"backend",turn:4,
      function_call_parts:1,text_parts:0,finish_reason:secret}),
    event({event:"adk_llm_timing",role:"backend",turn:21,
      function_call_parts:1,text_parts:0,finish_reason:"STOP"})
  ].join("\n");
  const safe=agentObservations(raw);
  assert.equal(safe.length,3);
  assert.ok(!JSON.stringify(safe).includes(secret));
  const log=safe.map(e=>
    "[trusted-positive-ci] gemini_agent_observation "+event(e)).join("\n");
  const shape=agentSummary(log).role_evidence.backend;
  assert.equal(shape.model_turns_with_shape_metadata,3);
  assert.equal(shape.observed_function_call_parts,1);
  assert.equal(shape.observed_text_parts,2);
  assert.deepEqual(shape.model_finish_reasons,{
    STOP:1,MAX_TOKENS:1,MALFORMED_FUNCTION_CALL:1
  });
  assert.equal(shape.agent_failure,undefined);
});

test("fresh Engineer review is a fixed safe failure category",()=>{
  const privateSource="NEVER_LOG_UNAPPROVED_FILE_PATH";
  const progress={successful_reads:0,distinct_read_paths:0,
    duplicate_reads:0,failed_reads:0,successful_writes:0,failed_writes:0};
  const raw=JSON.stringify({event:"adk_task_outcome",role:"test",
    category:"repair_requires_new_approval",model_turns:5,...progress,
    typecheck_scope_summary:{parsed_locations:3,missing_read_grants:2,
      missing_write_grants:3},
    file_path:privateSource,model_text:privateSource});
  const safe=agentObservations(raw);
  assert.equal(safe.length,1);
  assert.equal(safe[0].category,"repair_requires_new_approval");
  assert.deepEqual(safe[0].typecheck_scope_summary,{
    parsed_locations:3,missing_read_grants:2,missing_write_grants:3});
  assert.ok(!JSON.stringify(safe).includes(privateSource));
  const report=agentSummary("[trusted-positive-ci] gemini_agent_observation "+
    JSON.stringify(safe[0]));
  assert.equal(report.role_evidence.test.agent_failure.category,
    "repair_requires_new_approval");
  assert.deepEqual(report.role_evidence.test.agent_failure.typecheck_scope_summary,{
    parsed_locations:3,missing_read_grants:2,missing_write_grants:3});
  assert.deepEqual(agentObservations(JSON.stringify({
    event:"adk_task_outcome",role:"test",
    category:"repair_requires_new_approval",model_turns:5,...progress,
    typecheck_scope_summary:{parsed_locations:1,missing_read_grants:2,
      missing_write_grants:0}
  })),[]);
});

test("MAX_TOKENS diagnostic stays source-free and separate from ADK provider failures",()=>{
  const progress={successful_reads:3,distinct_read_paths:3,
    duplicate_reads:0,failed_reads:0,successful_writes:0,failed_writes:0};
  const secret="DO_NOT_EXPOSE_PRIVATE_GENERATION_TEXT";
  const raw=event({event:"adk_safe_diagnostic",role:"backend",
    category:"model_output_truncated",model_turns:7,
    http_status:null,...progress,secret});
  const events=agentObservations(raw);
  assert.equal(events.length,1);
  assert.equal(events[0].category,"model_output_truncated");
  assert.ok(!JSON.stringify(events).includes(secret));
  const report=agentSummary("[trusted-positive-ci] gemini_agent_observation "+
    event(events[0]));
  assert.equal(report.role_evidence.backend.agent_failure.category,
    "model_output_truncated");
});

test("HTTP 400 reason and function-history integrity survive sanitized summary",()=>{
  const secret="PRIVATE_ORIGINAL_TOOL_PAYLOAD";
  const progress={successful_reads:1,distinct_read_paths:1,
    duplicate_reads:0,failed_reads:0,successful_writes:0,failed_writes:0};
  const eventPayload=event({
    event:"adk_safe_diagnostic",role:"backend",
    category:"api_invalid_request",model_turns:2,
    http_status:400,invalid_request_cause:"missing_thought_signature",
    function_call_messages:2,function_call_messages_missing_signature:1,
    message:secret,...progress
  });
  const observations=agentObservations(eventPayload);
  assert.equal(observations.length,1);
  // The private child sanitizes once; the public CI extractor sanitizes
  // the same fixed-label event again and must retain nullable fields.
  assert.equal(agentObservations(event(observations[0])).length,1);
  assert.ok(!JSON.stringify(observations).includes(secret));
  const report=agentSummary("[trusted-positive-ci] gemini_agent_observation "+
    event(observations[0]));
  const failure=report.role_evidence.backend.agent_failure;
  assert.equal(failure.category,"api_invalid_request");
  assert.equal(failure.http_status,400);
  assert.equal(failure.invalid_request_cause,"missing_thought_signature");
  assert.equal(failure.function_call_messages,2);
  assert.equal(failure.function_call_messages_missing_signature,1);
  for(const invalid of [
    {...observations[0],invalid_request_cause:secret},
    {...observations[0],function_call_messages_missing_signature:9},
    {...observations[0],function_call_messages:-1}
  ]){
    assert.equal(agentObservations(event(invalid)).length,0);
  }
});

test("re-sanitizing an error with absent optional 400 metadata keeps its evidence",()=>{
  const progress={successful_reads:1,distinct_read_paths:1,
    duplicate_reads:0,failed_reads:0,successful_writes:0,failed_writes:0};
  const base={event:"adk_safe_diagnostic",role:"backend",
    category:"api_invalid_request",model_turns:2,http_status:400,...progress};
  const once=agentObservations(event(base));
  assert.equal(once.length,1);
  assert.equal(once[0].invalid_request_cause,null);
  const twice=agentObservations(event(once[0]));
  assert.equal(twice.length,1);
  assert.deepEqual(twice,once);
  const combined=agentSummary("[trusted-positive-ci] gemini_agent_observation "+
    event(twice[0]));
  assert.equal(combined.role_evidence.backend.agent_failure.category,
    "api_invalid_request");
});

test("tool rejection histogram survives both sanitizers without leaking arbitrary data",()=>{
 const raw=[
  ["read_file","path_outside_signed_scope"],
  ["read_file","path_outside_signed_scope"],
  ["read_file","invalid_arguments"],
  ["read_file","SECRET/PATH"],
  ["update_file","gateway_prepare_rejected"]
 ].map(([tool,reason])=>JSON.stringify({event:"adk_tool_timing",role:"frontend",
  tool,reason,error_kind:"invalid_tool_call",success:false,path:"SECRET/PATH",content:"PRIVATE"})).join("\n");
 const sanitized=agentObservations(raw);
 const forwarded=sanitized.map(x=>"[trusted-positive-ci] gemini_agent_observation "+JSON.stringify(x)).join("\n");
 const summary=agentSummary(forwarded);
 assert.deepEqual(summary.role_evidence.frontend.failed_operations,{
  read_file:{invalid_arguments:1,path_outside_signed_scope:2,unclassified:1},
  update_file:{gateway_prepare_rejected:1}
 });
 assert.doesNotMatch(JSON.stringify(summary),/SECRET|PRIVATE/);
});

test("D1 editor revision failure survives both sanitizers without private receipt fields",()=>{
 const raw=JSON.stringify({event:"d1_editor_revision",role:"frontend",category:"no_confirmed_editor_write",path:"SECRET",credentialId:"PRIVATE"});
 const forwarded=agentObservations(raw).map(x=>"[trusted-positive-ci] gemini_agent_observation "+JSON.stringify(x)).join("\n");
 const summary=agentSummary(forwarded);
 assert.equal(summary.role_evidence.frontend.d1_revision_failure,"no_confirmed_editor_write");
 assert.doesNotMatch(JSON.stringify(summary),/SECRET|PRIVATE/);
 assert.deepEqual(agentObservations(raw.replace("no_confirmed_editor_write","PRIVATE")),[]);
});

test("R151.89 trusted prepare rejection stages survive double sanitization",()=>{
 const reasons=["request_validation_rejected","task_binding_rejected","signed_permission_rejected",
  "dependency_rejected","task_inactive_or_expired","runtime_scope_rejected","source_witness_missing","gateway_prepare_unclassified"];
 const raw=reasons.map(reason=>JSON.stringify({event:"adk_tool_timing",role:"frontend",tool:"read_file",
  success:false,error_kind:"invalid_tool_call",reason,path:"PRIVATE"})).join("\n");
 const forwarded=agentObservations(raw).map(x=>"[trusted-positive-ci] gemini_agent_observation "+JSON.stringify(x)).join("\n");
 const summary=agentSummary(forwarded);
 for(const reason of reasons)assert.equal(summary.role_evidence.frontend.failed_operations.read_file[reason],1);
 assert.doesNotMatch(JSON.stringify(summary),/PRIVATE/);
});


test("D1 confirmed-effect counts survive double sanitization with strict bounds",()=>{
 for(const role of ["backend","frontend","test"]){
  const raw=JSON.stringify({event:"d1_editor_revision",role,
   category:"no_confirmed_editor_write",task_write_count:0,runtime_write_count:1,
   head_changed:true,path:"SECRET",credentialId:"PRIVATE"});
  const forwarded=agentObservations(raw).map(x=>"[trusted-positive-ci] gemini_agent_observation "+JSON.stringify(x)).join("\n");
  assert.deepEqual(agentSummary(forwarded).role_evidence[role].d1_revision_evidence,
   {task_write_count:0,runtime_write_count:1,head_changed:true});
  assert.doesNotMatch(forwarded,/SECRET|PRIVATE/);
  const invalid=agentObservations(raw.replace('"task_write_count":0','"task_write_count":-1'));
  assert.equal("task_write_count" in invalid[0],false);
 }
});


test("D1 task-level attempts and provider effects survive safe double sanitization",()=>{
 for(const status of ["no_update_attempted","update_denied","update_not_confirmed","effect_correlation_failure"]){
  const raw=JSON.stringify({event:"d1_editor_revision",role:"frontend",category:"no_confirmed_editor_write",
   d1_operation_status:status,read_attempts:2,read_confirmed:1,read_denied:1,
   update_attempts:1,update_denied:0,update_provider_confirmed:1,
   runtimeTaskId:"SECRET",request_id:"PRIVATE"});
  const forwarded=agentObservations(raw).map(x=>
   "[trusted-positive-ci] gemini_agent_observation "+JSON.stringify(x)).join("\\n");
  const evidence=agentSummary(forwarded).role_evidence.frontend.d1_revision_evidence;
  assert.equal(evidence.d1_operation_status,status);
  assert.equal(evidence.read_attempts,2);
  assert.equal(evidence.update_provider_confirmed,1);
  assert.doesNotMatch(forwarded,/SECRET|PRIVATE/);
 }
});

test("F1 paid child failures preserve ONLY static diagnostics for string and Buffer stderr",()=>{
  const privateToken="PRIVATE_CREDENTIAL_DO_NOT_ECHO";
  const observation="[signed-gemini-pilot] "+JSON.stringify({
    stage:"gemini_planning",category:"planner_contract_rejected",
    planning_rejection:{stage:"contract",reason:"execution_update_without_read",
      secret:privateToken},
    model_turns_started:13,model_failure:"none",
    reason:privateToken,raw_response:privateToken,
    assertion_location:{module:"planning_harness",line:709},
    approved_task_counts:{backend:42,secret:privateToken}
  });
  const raw="invalid error "+privateToken+"\n"+observation+"\n"+
    "[signed-gemini-pilot] {bad-json}\n";
  const fromString=safeF1Failure(raw);
  const fromBuffer=safeF1Failure(Buffer.from(raw));
  assert.deepEqual(fromString,fromBuffer);
  assert.deepEqual(fromString,[{
    stage:"gemini_planning",category:"planner_contract_rejected",
    rejection_category:"execution_update_without_read",
    model_failure:"none",model_turns_started:13,
    approval_created:false,operational_root_issued:false,
    assertion_location:{module:"planning_harness",line:709}
  }]);
  assert.ok(!JSON.stringify(fromString).includes(privateToken));
  assert.ok(Object.isFrozen(fromString));
  assert.ok(Object.isFrozen(fromString[0]));
});
test("F1 diagnostic does not publish arbitrary provider text, paths or spoofed errors",()=>{
  const secret="PRIVATE_STUFF_NEVER_ECHO";
  const encoded=event=>"[signed-gemini-pilot] "+JSON.stringify(event);
  const rows=[
    encoded({stage:"gemini_planning",category:secret,
      model_turns_started:1}),
    encoded({stage:secret,category:"unclassified_failure",
      model_turns_started:1}),
    encoded({stage:"gemini_planning",category:"model_provider_failure",
      model_turns_started:999}),
    encoded({stage:"gemini_planning",category:"model_provider_failure",
      model_turns_started:7,model_failure:secret,
      planning_rejection:{reason:secret},
      assertion_location:{module:secret,line:1}})
  ];
  const safe=safeF1Failure(rows.join("\n"));
  assert.equal(safe.length,1);
  assert.equal(safe[0].rejection_category,"not_reported");
  assert.equal(safe[0].model_failure,"unknown");
  assert.equal(Object.hasOwn(safe[0],"assertion_location"),false);
  assert.ok(!JSON.stringify(safe).includes(secret));
  assert.deepEqual(safeF1Failure(null),[]);
  assert.deepEqual(safeF1Failure({toString:()=>secret}),[]);
  assert.deepEqual(safeF1Failure("x".repeat(2_200_001)),[]);
});
