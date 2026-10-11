import test from "node:test";
import assert from "node:assert/strict";
import {resolveGeminiThinkingConfig} from "../gemini-thinking-policy.mjs";

test("Existing Gemini 3.8 Flash keeps validated LOW by default",()=>{
  assert.deepEqual(resolveGeminiThinkingConfig("gemini-3.8-flash"),{
    thinkingConfig:{thinkingLevel:"LOW"}
  });
});
test("Gemini 3.6 Flash explicitly permits economy MINIMAL mode",()=>{
  assert.deepEqual(resolveGeminiThinkingConfig("gemini-3.6-flash","MINIMAL"),{
    thinkingConfig:{thinkingLevel:"MINIMAL"}
  });
});
test("Gemini 3.8 Flash rejects unsupported MINIMAL before model inference",()=>{
  assert.throws(()=>resolveGeminiThinkingConfig("gemini-3.8-flash","MINIMAL"),/unsupported/);
});
test("Fail closed for malformed thinking setting and unknown models",()=>{
  assert.throws(()=>resolveGeminiThinkingConfig("gemini-3.6-flash","NONE"),/Unsupported/);
  assert.throws(()=>resolveGeminiThinkingConfig("made-up-model","MINIMAL"),/unsupported/);
  assert.throws(()=>resolveGeminiThinkingConfig(""),/Missing/);
});
