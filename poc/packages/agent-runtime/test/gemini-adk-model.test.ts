import assert from "node:assert/strict";
import test from "node:test";
import {createGeminiAdkModel} from "../src/index.ts";
test("Gemini factory rejects absent API keys",()=>{
  assert.throws(()=>createGeminiAdkModel({apiKey:""}),/GEMINI_API_KEY/u);
});
test("Gemini factory refuses non-Gemini model identifiers",()=>{
  assert.throws(()=>createGeminiAdkModel({apiKey:"fake",model:"openai"}),/Invalid Gemini/u);
});
test("Gemini provider is configured without network calls at startup",()=>{
  const model=createGeminiAdkModel({apiKey:"test-only-not-real",model:"gemini-3.8-flash"});
  assert.equal(model.model,"gemini-3.8-flash");
});
