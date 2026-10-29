import assert from "node:assert/strict";
import test from "node:test";
import type {LlmResponse} from "@google/adk";
import {safeAdkResponseShape,classifyAdkResponseFailure}
  from "../src/adk-response-diagnostics.ts";

test("safe response diagnostic reports max-token truncation and counts only",()=>{
  const response={finishReason:"MAX_TOKENS",
    content:{role:"model",parts:[
      {text:"NEVER_LOG_PRIVATE_REASONING"},
      {functionCall:{name:"update_file",args:{
        content:"NEVER_LOG_PRIVATE_REPOSITORY_CONTENT",
        branch:"feature/account-suspension",
        path:"NEVER_LOG_PRIVATE_PATH"
      }}}
    ]}} as LlmResponse;
  const diagnostic=safeAdkResponseShape(response);
  assert.deepEqual(diagnostic,{
    finish_reason:"MAX_TOKENS",function_call_parts:1,text_parts:1
  });
  assert.ok(!JSON.stringify(diagnostic).includes("NEVER_LOG"));
  assert.ok(!JSON.stringify(diagnostic).includes("update_file"));
});

test("safe response diagnostic preserves expected finish labels and redacts others",()=>{
  assert.equal(safeAdkResponseShape({finishReason:"STOP"} as LlmResponse).finish_reason,"STOP");
  assert.equal(safeAdkResponseShape({finishReason:"MALFORMED_FUNCTION_CALL"} as LlmResponse).finish_reason,
    "MALFORMED_FUNCTION_CALL");
  assert.equal(safeAdkResponseShape({} as LlmResponse).finish_reason,null);
  const injected='SECRET_TOKEN_12345\\n{"steal":true}';
  assert.equal(safeAdkResponseShape({
    finishReason:injected
  } as unknown as LlmResponse).finish_reason,"UNKNOWN");
});

test("MAX_TOKENS in final ADK event is diagnosed without masking provider errors",()=>{
  assert.equal(classifyAdkResponseFailure("adk_event_error","MAX_TOKENS"),
    "model_output_truncated");
  assert.equal(classifyAdkResponseFailure("sdk_model_exception","MAX_TOKENS"),
    "model_output_truncated");
  assert.equal(classifyAdkResponseFailure("api_rate_limit_or_quota","MAX_TOKENS"),
    "api_rate_limit_or_quota");
  assert.equal(classifyAdkResponseFailure("adk_event_error","STOP"),
    "adk_event_error");
  assert.equal(classifyAdkResponseFailure("adk_event_error",null),
    "adk_event_error");
});
