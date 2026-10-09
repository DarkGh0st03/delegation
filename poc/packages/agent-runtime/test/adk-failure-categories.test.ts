import assert from "node:assert/strict";
import test from "node:test";
import {classifyAdkFailure} from "../src/adk-failure-categories.ts";

test("ADK diagnostics categorize provider status without exposing raw errors",()=>{
  assert.equal(classifyAdkFailure({status:429,message:"secret-payload-quota"}),"api_rate_limit_or_quota");
  assert.equal(classifyAdkFailure({status:401,message:"secret token"}),"api_authentication");
  assert.equal(classifyAdkFailure({status:403}),"api_permission_denied");
  assert.equal(classifyAdkFailure({status:404}),"api_model_not_found");
  assert.equal(classifyAdkFailure({status:400}),"api_invalid_request");
  assert.equal(classifyAdkFailure({status:503}),"api_service_unavailable");
});
test("ADK diagnostics distinguish model API, tool schema and network errors",()=>{
  assert.equal(classifyAdkFailure(new Error("RESOURCE_EXHAUSTED")), "api_rate_limit_or_quota");
  assert.equal(classifyAdkFailure({errorCode:"INVALID_ARGUMENT"}),"api_invalid_request");
  assert.equal(classifyAdkFailure(new Error("function call schema malformed")),"tool_schema_or_validation");
  assert.equal(classifyAdkFailure(new Error("ETIMEDOUT")),"api_network_failure");
  assert.equal(classifyAdkFailure(new Error("unknown provider internal detail")),"sdk_model_exception");
});
test("ADK diagnostics never include private error data in returned category",()=>{
  const secret="NEVER_PRINT_PRIVATE_DELEGATION_EVIDENCE";
  const category=classifyAdkFailure({message:"Unexpected "+secret});
  assert.equal(category,"sdk_model_exception");
  assert.equal(JSON.stringify({category}).includes(secret),false);
  assert.equal(classifyAdkFailure(null,"adk_event_error"),"adk_event_error");
});
