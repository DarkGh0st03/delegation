import test from "node:test";
import assert from "node:assert/strict";
import {resolveGeminiThinkingConfig, resolveRoleGeminiConfiguration, resolveGeminiOutputLimit} from "../gemini-thinking-policy.mjs";

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

test("Complete real workflow defaults to Gemini 3.8 Flash LOW for ALL three roles",()=>{
  const inputs={roleMode:"all",geminiModel:"gemini-3.8-flash",geminiThinking:"LOW"};
  for(const role of ["backend","frontend","test"]) {
    const resolved=resolveRoleGeminiConfiguration({...inputs,role});
    assert.deepEqual([resolved.model,resolved.thinkingLevel],
      ["gemini-3.8-flash","LOW"]);
    assert.deepEqual(resolved.thinkingConfig,{thinkingLevel:"LOW"});
  }
});
test("Stand-alone roles retain 3.8 Flash LOW defaults",()=>{
  for(const role of ["backend","frontend","test"]) {
    const resolved=resolveRoleGeminiConfiguration({roleMode:role,role,
      geminiModel:"gemini-3.8-flash",geminiThinking:"LOW",
      fullModel:"gemini-3.6-flash",fullThinking:"MINIMAL"});
    assert.deepEqual([resolved.model,resolved.thinkingLevel],["gemini-3.8-flash","LOW"]);
  }
});
test("Whole-workflow fallback can switch all roles to 3.8 Flash LOW",()=>{
  for(const role of ["backend","frontend","test"]) {
    const resolved=resolveRoleGeminiConfiguration({roleMode:"all",role,
      fullModel:"gemini-3.8-flash",fullThinking:"LOW"});
    assert.deepEqual([resolved.model,resolved.thinkingLevel],["gemini-3.8-flash","LOW"]);
  }
});
test("Reject 3.8 Flash MINIMAL and invalid roles before paid calls",()=>{
  for(const role of ["backend","frontend","test"])
    assert.throws(()=>resolveRoleGeminiConfiguration({roleMode:"all",role,
      fullModel:"gemini-3.8-flash",fullThinking:"MINIMAL"}),/unsupported/);
  assert.throws(()=>resolveRoleGeminiConfiguration({roleMode:"all",role:"unexpected"}),/role/);
});

test("Complete real workflow uses 32000 output tokens, isolated probes stay at 16384",()=>{
  assert.equal(resolveGeminiOutputLimit("all"),32000);
  for(const mode of ["", "backend","frontend","test"]){
    assert.equal(resolveGeminiOutputLimit(mode),16384);
  }
  assert.equal(resolveGeminiOutputLimit("all",16384),32000);
  assert.throws(()=>resolveGeminiOutputLimit("all",0),/Invalid/);
  assert.throws(()=>resolveGeminiOutputLimit("backend",32001),/Invalid/);
});
