import test from "node:test";
import assert from "node:assert/strict";
import {resolveGeminiThinkingConfig, resolveRoleGeminiConfiguration} from "../gemini-thinking-policy.mjs";

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

test("Complete real workflow chooses Gemini 3.8 LOW for Backend and Test and 3.6 MINIMAL only for Frontend",()=>{
  const inputs={roleMode:"all",geminiModel:"gemini-3.8-flash",geminiThinking:"LOW",
    frontendModel:"gemini-3.6-flash",frontendThinking:"MINIMAL"};
  const b=resolveRoleGeminiConfiguration({...inputs,role:"backend"});
  const f=resolveRoleGeminiConfiguration({...inputs,role:"frontend"});
  const t=resolveRoleGeminiConfiguration({...inputs,role:"test"});
  assert.deepEqual([b.model,b.thinkingLevel],["gemini-3.8-flash","LOW"]);
  assert.deepEqual([f.model,f.thinkingLevel],["gemini-3.6-flash","MINIMAL"]);
  assert.deepEqual([t.model,t.thinkingLevel],["gemini-3.8-flash","LOW"]);
});
test("Isolated Frontend probe ignores the full-workflow economy override",()=>{
  const f=resolveRoleGeminiConfiguration({roleMode:"frontend",role:"frontend",
    geminiModel:"gemini-3.8-flash",geminiThinking:"LOW",
    frontendModel:"gemini-3.6-flash",frontendThinking:"MINIMAL"});
  assert.deepEqual([f.model,f.thinkingLevel],["gemini-3.8-flash","LOW"]);
});
test("Explicit Frontend fallback can use 3.8 Flash with LOW",()=>{
  const f=resolveRoleGeminiConfiguration({roleMode:"all",role:"frontend",
    frontendModel:"gemini-3.8-flash",frontendThinking:"LOW"});
  assert.deepEqual([f.model,f.thinkingLevel],["gemini-3.8-flash","LOW"]);
});
test("An unsupported Frontend 3.8 MINIMAL pairing is rejected before paid inference",()=>{
  assert.throws(()=>resolveRoleGeminiConfiguration({roleMode:"all",role:"frontend",
    frontendModel:"gemini-3.8-flash",frontendThinking:"MINIMAL"}),/unsupported/);
  assert.throws(()=>resolveRoleGeminiConfiguration({roleMode:"all",role:"unexpected"}),/role/);
});
