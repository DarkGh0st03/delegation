import test from "node:test";
import assert from "node:assert/strict";
import {extractSafeGeminiPilotUsage as extract,
  safeGeminiPilotChildObservations as sanitizeChild,
  safeGeminiPilotAgentObservations as agentObservations,
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
    [[role("backend",18,{input_tokens:1,output_tokens:1})],
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
