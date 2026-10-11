import assert from "node:assert/strict";
import test from "node:test";
import type {LlmRequest} from "@google/adk";
import {safeAdkRequestShape} from "../src/adk-request-shape.ts";

test("ADK request shape counts only safe metrics and never leaks secrets",()=>{
  const secret="PRIVATE_CREDENTIAL_NEVER_PRINT";
  const request={
    contents:[
      {role:"user",parts:[{text:"SECRET"},{functionResponse:{
        name:"read_file",response:{secret}}}]},
      {role:"model",parts:[{text:"hello"}]}
    ],
    config:{
      systemInstruction:{parts:[{text:"DO_NOT_LOG"},{text:"SYS"}]},
      tools:[
        {functionDeclarations:[
          {name:"read_file",description:"SECRET_SCHEMA_DO_NOT_PRINT",
            parametersJsonSchema:{type:"object",properties:{path:{type:"string"}}}},
          {name:"update_file",parametersJsonSchema:{type:"object"}}
        ]},
        {googleSearch:{}}
      ],
      maxOutputTokens:1024,temperature:0
    }
  } as unknown as LlmRequest;
  const shape=safeAdkRequestShape(request);
  assert.equal(shape.content_messages,2);
  assert.equal(shape.content_text_parts,2);
  assert.equal(shape.content_text_chars,11);
  assert.equal(shape.system_instruction_text_chars,13);
  assert.equal(shape.declared_tool_groups,2);
  assert.equal(shape.function_declarations,2);
  assert.ok(shape.declaration_json_chars!==null && shape.declaration_json_chars>0);
  assert.equal(shape.max_output_tokens,1024);
  assert.equal(shape.temperature,0);
  assert.equal(shape.thinking_level,null);
  for(const sensitive of [
    secret,"SECRET","DO_NOT_LOG","SECRET_SCHEMA_DO_NOT_PRINT",
    "read_file","update_file","path"
  ]) {
    assert.equal(JSON.stringify(shape).includes(sensitive),false);
  }
  assert.deepEqual(Object.keys(shape).sort(),[
    "content_messages","content_text_parts","content_text_chars",
    "system_instruction_text_chars","declared_tool_groups",
    "function_declarations","declaration_json_chars",
    "max_output_tokens","temperature","thinking_level"
  ].sort());
});

test("ADK request shape handles absent, unusual, and unsafe metadata without text",()=>{
  const empty=safeAdkRequestShape({} as LlmRequest);
  assert.deepEqual(empty,{
    content_messages:null,content_text_parts:null,content_text_chars:null,
    system_instruction_text_chars:null,declared_tool_groups:null,
    function_declarations:null,declaration_json_chars:null,
    max_output_tokens:null,temperature:null,thinking_level:null
  });
  const malformed=safeAdkRequestShape({
    contents:[null,{parts:[null,{text:{private:"DO_NOT_PRINT"}}]}],
    config:{
      systemInstruction:"PRIVATE_USER_PROMPT",
      tools:[{functionDeclarations:[{secret:"HIDDEN", name:"x"}]}],
      maxOutputTokens:"1024",temperature:99
    }
  } as unknown as LlmRequest);
  assert.equal(malformed.content_messages,2);
  assert.equal(malformed.content_text_parts,0);
  assert.equal(malformed.content_text_chars,0);
  assert.equal(malformed.system_instruction_text_chars,"PRIVATE_USER_PROMPT".length);
  assert.equal(malformed.function_declarations,1);
  assert.equal(malformed.max_output_tokens,null);
  assert.equal(malformed.temperature,null);
  assert.equal(malformed.thinking_level,null);
  assert.equal(JSON.stringify(malformed).includes("PRIVATE_USER_PROMPT"),false);
  assert.equal(JSON.stringify(malformed).includes("HIDDEN"),false);
});

test("ADK request shape whitelists Gemini thinking level without leaking values",()=>{
  const allowed=safeAdkRequestShape({
    config:{thinkingConfig:{thinkingLevel:"LOW"},maxOutputTokens:16384,temperature:0}
  } as unknown as LlmRequest);
  assert.equal(allowed.thinking_level,"LOW");
  assert.equal(allowed.max_output_tokens,16384);
  const untrusted=safeAdkRequestShape({
    config:{thinkingConfig:{thinkingLevel:"PRIVATE_REASONING_NEVER_LOG"}}
  } as unknown as LlmRequest);
  assert.equal(untrusted.thinking_level,null);
  assert.ok(!JSON.stringify(untrusted).includes("PRIVATE_REASONING_NEVER_LOG"));
});
