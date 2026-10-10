import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as sleep} from "node:timers/promises";
import {classifyAdkFailure, inspectAdkFailure} from "../src/adk-failure-categories.ts";
import {runGeminiApiHealthSmoke} from "../scripts/gemini-api-health-smoke.mjs";

test("ADK diagnostics categorize numeric HTTP status without exposing raw errors",()=>{
  for (const [status,expected] of [
    [400,"api_invalid_request"],[401,"api_authentication"],
    [403,"api_permission_denied"],[404,"api_model_not_found"],
    [408,"api_network_failure"],[422,"api_invalid_request"],
    [429,"api_rate_limit_or_quota"],[500,"api_service_unavailable"],
    [502,"api_service_unavailable"],[503,"api_service_unavailable"],
    [504,"api_service_unavailable"]
  ] as const) {
    const result = inspectAdkFailure({status,message:"PRIVATE_PROVIDER_PAYLOAD"});
    assert.equal(result.category,expected);
    assert.equal(result.http_status,status);
    assert.equal(result.classification_source,"http_status");
    assert.equal(JSON.stringify(result).includes("PRIVATE_PROVIDER_PAYLOAD"),false);
    assert.equal(classifyAdkFailure({status}),expected);
  }
});

test("structured SDK response/cause status is distinguished from text containing 503",()=>{
  const nested = inspectAdkFailure({name:"ApiError", response:{status:503, data:"PRIVATE"}});
  assert.deepEqual(nested,{
    category:"api_service_unavailable",http_status:503,
    classification_source:"http_status",error_type:"api_error"
  });
  const cause = inspectAdkFailure({cause:{statusCode:502}});
  assert.equal(cause.http_status,502);
  const textOnly = inspectAdkFailure(new Error("service unavailable 503 SECRET"));
  assert.equal(textOnly.category,"api_service_unavailable");
  assert.equal(textOnly.http_status,null);
  assert.equal(textOnly.classification_source,"message_pattern");
  const codeOnly = inspectAdkFailure({errorCode:"RESOURCE_EXHAUSTED"});
  assert.equal(codeOnly.category,"api_rate_limit_or_quota");
  assert.equal(codeOnly.classification_source,"error_code");
  assert.equal(codeOnly.http_status,null);
});

test("ADK diagnostics distinguish SDK/model/network exceptions and stay sanitized",()=>{
  assert.equal(classifyAdkFailure(new Error("RESOURCE_EXHAUSTED")), "api_rate_limit_or_quota");
  assert.equal(classifyAdkFailure({errorCode:"INVALID_ARGUMENT"}),"api_invalid_request");
  assert.equal(classifyAdkFailure(new Error("function call schema malformed")),"tool_schema_or_validation");
  assert.equal(classifyAdkFailure(new Error("ETIMEDOUT")),"api_network_failure");
  assert.equal(classifyAdkFailure(new Error("unknown provider internal detail")),"sdk_model_exception");
  const privateValue="NEVER_PRINT_PRIVATE_DELEGATION_EVIDENCE";
  const unsafe = inspectAdkFailure({name:privateValue, code:privateValue,
    message:"Unexpected "+privateValue,status:"503"});
  assert.equal(unsafe.http_status,null);
  assert.equal(unsafe.error_type,"other");
  assert.equal(JSON.stringify(unsafe).includes(privateValue),false);
  assert.equal(classifyAdkFailure(null,"adk_event_error"),"adk_event_error");
});

test("Gemini API-only synthetic smoke performs exactly one request and never returns secrets",async()=>{
  const secret="PRIVATE_TEST_KEY_NO_LOG";
  let requests=0;
  const result=await runGeminiApiHealthSmoke({
    apiKey:secret, model:"gemini-3.8-flash",
    fetchFn:async(url,options)=>{
      requests++;
      assert.match(url,/^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/u);
      assert.equal(options.method,"POST");
      assert.equal(options.headers["x-goog-api-key"],secret);
      assert.equal(typeof options.signal?.aborted,"boolean");
      assert.equal(JSON.parse(options.body).contents[0].parts[0].text,"Reply with exactly READY.");
      return {ok:true,status:200,json:async()=>({
        candidates:[{content:{parts:[{text:"READY"}]}}]
      })};
    }
  });
  assert.equal(requests,1);
  assert.equal(result.result,"gemini-api-health-pass");
  assert.equal(result.http_status,200);
  assert.equal(result.requests,1);
  assert.equal(JSON.stringify(result).includes(secret),false);
});

test("Gemini API health smoke exposes only safe numeric error status, with no retry",async()=>{
  let calls=0;
  const result=await runGeminiApiHealthSmoke({
    apiKey:"NEVER_LOG_ME",fetchFn:async()=>{
      calls++;
      return {ok:false,status:503,json:async()=>{throw new Error("should never read body");}};
    }
  });
  assert.equal(calls,1);
  assert.equal(result.result,"gemini-api-health-fail");
  assert.equal(result.http_status,503);
  assert.equal(result.category,"api_service_unavailable");
  assert.equal(result.classification_source,"http_status");
  assert.equal(JSON.stringify(result).includes("NEVER_LOG_ME"),false);
});

test("Gemini API health smoke separates network errors and local timeouts",async()=>{
  const network=await runGeminiApiHealthSmoke({
    apiKey:"SENSITIVE",fetchFn:async()=>{throw new TypeError("SENSITIVE DNS ERROR");}
  });
  assert.equal(network.category,"api_network_failure");
  assert.equal(network.http_status,null);
  assert.equal(network.classification_source,"network_exception");
  assert.equal(JSON.stringify(network).includes("SENSITIVE"),false);
  const timeout=await runGeminiApiHealthSmoke({
    apiKey:"SENSITIVE",timeoutMs:15,
    // An actual referenced timer keeps the event loop alive; the AbortSignal
    // timeout itself is unref'd in Node, so an unresolved Promise alone does not.
    fetchFn:async(_url,{signal})=>{
      await sleep(100,undefined,{signal});
      throw new Error("SENSITIVE SHOULD NEVER FINISH");
    }
  });
  assert.equal(timeout.category,"api_inference_timeout");
  assert.equal(timeout.classification_source,"runtime_timeout");
  assert.equal(timeout.http_status,null);
  assert.equal(JSON.stringify(timeout).includes("SENSITIVE"),false);
});

test("Gemini API health smoke rejects invalid 200 payload and unsafe configuration",async()=>{
  const bad=await runGeminiApiHealthSmoke({
    apiKey:"SENSITIVE",
    fetchFn:async()=>({ok:true,status:200,json:async()=>({
      candidates:[{content:{parts:[{text:"NOT_READY_PRIVATE"}]}}]
    })})
  });
  assert.equal(bad.category,"invalid_response");
  assert.equal(JSON.stringify(bad).includes("NOT_READY_PRIVATE"),false);
  await assert.rejects(()=>runGeminiApiHealthSmoke({apiKey:""}),/API key is required/u);
  await assert.rejects(()=>runGeminiApiHealthSmoke({apiKey:"hi",model:"bad-model"}),/Invalid Gemini/u);
  await assert.rejects(()=>runGeminiApiHealthSmoke({apiKey:"hi",timeoutMs:20_001}),/timeout/u);
});


test("Gemini generateContent captures allowlisted provider UNAVAILABLE status on HTTP 503",async()=>{
  let calls=0;
  const response=new Response(JSON.stringify({error:{
    code:503,status:"UNAVAILABLE",message:"SENSITIVE_GOOGLE_PROVIDER_MESSAGE",
    details:[{reason:"SENSITIVE_REASON",metadata:{evidence:"PRIVATE_DELEGATION_EVIDENCE"}}]
  }}),{status:503,headers:{"content-type":"application/json"}});
  const result=await runGeminiApiHealthSmoke({
    apiKey:"NEVER_PRINT_GEMINI_KEY",
    fetchFn:async(_url, options)=>{
      calls++;
      assert.equal(options.method,"POST");
      return response;
    }
  });
  assert.equal(calls,1);
  assert.equal(result.requests,1);
  assert.equal(result.result,"gemini-api-health-fail");
  assert.equal(result.http_status,503);
  assert.equal(result.category,"api_service_unavailable");
  assert.equal(result.classification_source,"http_status");
  assert.equal(result.google_error_status,"UNAVAILABLE");
  assert.equal(result.google_error_code,503);
  for(const sensitive of ["NEVER_PRINT_GEMINI_KEY",
    "SENSITIVE_GOOGLE_PROVIDER_MESSAGE","SENSITIVE_REASON",
    "PRIVATE_DELEGATION_EVIDENCE"])
    assert.equal(JSON.stringify(result).includes(sensitive),false);
});

test("Gemini generateContent distinguishes allowlisted INVALID_ARGUMENT from unsupported string",async()=>{
  const valid=await runGeminiApiHealthSmoke({apiKey:"TOP_SECRET",
    fetchFn:async()=>new Response(JSON.stringify({error:{
      code:400,status:"INVALID_ARGUMENT",message:"NEVER_LOG_ME"
    }}),{status:400})
  });
  assert.equal(valid.http_status,400);
  assert.equal(valid.google_error_status,"INVALID_ARGUMENT");
  assert.equal(valid.google_error_code,400);
  assert.equal(JSON.stringify(valid).includes("NEVER_LOG_ME"),false);

  const unsafe=await runGeminiApiHealthSmoke({apiKey:"TOP_SECRET",
    fetchFn:async()=>new Response(JSON.stringify({error:{
      code:503,status:"INJECTED_INTERNAL_UNTRUSTED",message:"NEVER_LOG_ME",
      details:[{private:"DO_NOT_LOG"}]
    }}),{status:400})
  });
  assert.equal(unsafe.http_status,400);
  assert.equal(unsafe.google_error_status,null);
  assert.equal(unsafe.google_error_code,null);
  assert.equal(JSON.stringify(unsafe).includes("DO_NOT_LOG"),false);
  assert.equal(JSON.stringify(unsafe).includes("INJECTED_INTERNAL_UNTRUSTED"),false);
  assert.equal(JSON.stringify(unsafe).includes("TOP_SECRET"),false);
});

test("Gemini generateContent retains numeric HTTP status if error body is malformed",async()=>{
  let calls=0;
  const result=await runGeminiApiHealthSmoke({apiKey:"PRIVATE",
    fetchFn:async()=>{
      calls++;
      return new Response("SENSITIVE_RAW_PROVIDER_ERROR",{
        status:503,headers:{"content-type":"text/plain"}
      });
    }
  });
  assert.equal(calls,1);
  assert.equal(result.http_status,503);
  assert.equal(result.google_error_status,null);
  assert.equal(result.google_error_code,null);
  assert.equal(JSON.stringify(result).includes("SENSITIVE_RAW_PROVIDER_ERROR"),false);
  assert.equal(JSON.stringify(result).includes("PRIVATE"),false);
});

test("Gemini generateContent has null provider fields for successful synthetic response",async()=>{
  const result=await runGeminiApiHealthSmoke({apiKey:"SECRET",
    fetchFn:async()=>new Response(JSON.stringify({
      candidates:[{content:{parts:[{text:"READY"}]}}]
    }),{status:200,headers:{"content-type":"application/json"}})
  });
  assert.equal(result.result,"gemini-api-health-pass");
  assert.equal(result.google_error_status,null);
  assert.equal(result.google_error_code,null);
  assert.equal(JSON.stringify(result).includes("SECRET"),false);
});


test("Gemini HTTP 200 MAX_TOKENS without text reports only bounded metadata",async()=>{
  let requests=0;
  const result=await runGeminiApiHealthSmoke({
    apiKey:"TEST_KEY_PRIVATE",
    fetchFn:async()=>{
      requests++;
      return new Response(JSON.stringify({
        candidates:[{finishReason:"MAX_TOKENS",content:{parts:[]},
          safetyRatings:[{category:"PRIVATE_SAFETY_CATEGORY"}]}],
        usageMetadata:{promptTokenCount:11,candidatesTokenCount:0,
          totalTokenCount:27,thoughtsTokenCount:16,
          promptTokensDetails:[{modality:"SECRET_MODALITY"}]},
        promptFeedback:{blockReasonMessage:"SECRET_PROVIDER_FEEDBACK"}
      }),{status:200});
    }
  });
  assert.equal(requests,1);
  assert.equal(result.result,"gemini-api-health-fail");
  assert.equal(result.http_status,200);
  assert.equal(result.category,"invalid_response");
  assert.deepEqual(result.generation_diagnostic,{
    candidate_count:1,part_count:0,text_part_count:0,has_text:false,
    finish_reason:"MAX_TOKENS",prompt_token_count:11,
    candidate_token_count:0,total_token_count:27,thoughts_token_count:16
  });
  for(const value of ["TEST_KEY_PRIVATE","PRIVATE_SAFETY_CATEGORY",
    "SECRET_MODALITY","SECRET_PROVIDER_FEEDBACK"])
    assert.equal(JSON.stringify(result).includes(value),false);
});

test("Gemini HTTP 200 non-READY text yields has_text true without exposing content",async()=>{
  const result=await runGeminiApiHealthSmoke({
    apiKey:"HIDDEN_KEY",
    fetchFn:async()=>new Response(JSON.stringify({
      candidates:[{finishReason:"STOP",content:{
        parts:[{text:"THIS_TEXT_MUST_NOT_BE_LOGGED"}]
      }}],
      usageMetadata:{promptTokenCount:12,candidatesTokenCount:7,
        totalTokenCount:19,thoughtsTokenCount:0},
      modelVersion:"HIDDEN_MODEL_VERSION"
    }),{status:200})
  });
  assert.equal(result.http_status,200);
  assert.equal(result.result,"gemini-api-health-fail");
  assert.equal(result.generation_diagnostic.has_text,true);
  assert.equal(result.generation_diagnostic.text_part_count,1);
  assert.equal(result.generation_diagnostic.part_count,1);
  assert.equal(result.generation_diagnostic.finish_reason,"STOP");
  assert.equal(result.generation_diagnostic.candidate_token_count,7);
  assert.equal(result.generation_diagnostic.thoughts_token_count,0);
  for(const secret of ["HIDDEN_KEY","THIS_TEXT_MUST_NOT_BE_LOGGED","HIDDEN_MODEL_VERSION"])
    assert.equal(JSON.stringify(result).includes(secret),false);
});

test("Gemini HTTP 200 READY captures only first candidate and safe token counts",async()=>{
  const result=await runGeminiApiHealthSmoke({
    apiKey:"SECRET",
    fetchFn:async()=>new Response(JSON.stringify({
      candidates:[
        {finishReason:"STOP",content:{parts:[{text:"REA"},{text:"DY"}]}},
        {finishReason:"OTHER",content:{parts:[{text:"SENSITIVE_SECOND_CANDIDATE"}]}}
      ],
      usageMetadata:{promptTokenCount:8,candidatesTokenCount:2,
        totalTokenCount:10,thoughtsTokenCount:0,
        cachedContentTokenCount:12345}
    }),{status:200})
  });
  assert.equal(result.result,"gemini-api-health-pass");
  assert.equal(result.generation_diagnostic.candidate_count,2);
  assert.equal(result.generation_diagnostic.part_count,2);
  assert.equal(result.generation_diagnostic.text_part_count,2);
  assert.equal(result.generation_diagnostic.has_text,true);
  assert.equal(result.generation_diagnostic.finish_reason,"STOP");
  assert.equal(result.generation_diagnostic.prompt_token_count,8);
  assert.equal(result.generation_diagnostic.total_token_count,10);
  assert.equal(JSON.stringify(result).includes("SENSITIVE_SECOND_CANDIDATE"),false);
  assert.equal(JSON.stringify(result).includes("cachedContentTokenCount"),false);
});

test("Gemini generation metrics reject unknown reasons, untrusted text and invalid tokens",async()=>{
  const result=await runGeminiApiHealthSmoke({
    apiKey:"SECRET",
    fetchFn:async()=>new Response(JSON.stringify({
      candidates:[{finishReason:"PRIVATE_UNTRUSTED_REASON",content:{
        parts:[{text:"PRIVATE_REPLY_DO_NOT_PRINT",functionCall:{name:"PRIVATE_TOOL"}}]
      }}],
      usageMetadata:{promptTokenCount:-1,candidatesTokenCount:"123",
        totalTokenCount:1.5,thoughtsTokenCount:Number.MAX_SAFE_INTEGER+1}
    }),{status:200})
  });
  assert.equal(result.result,"gemini-api-health-fail");
  assert.equal(result.generation_diagnostic.finish_reason,null);
  assert.equal(result.generation_diagnostic.has_text,true);
  assert.equal(result.generation_diagnostic.prompt_token_count,null);
  assert.equal(result.generation_diagnostic.candidate_token_count,null);
  assert.equal(result.generation_diagnostic.total_token_count,null);
  assert.equal(result.generation_diagnostic.thoughts_token_count,null);
  for(const value of ["PRIVATE_UNTRUSTED_REASON","PRIVATE_REPLY_DO_NOT_PRINT","PRIVATE_TOOL"])
    assert.equal(JSON.stringify(result).includes(value),false);
});

test("Malformed or absent Gemini response metadata uses null rather than guessed values",async()=>{
  const absent=await runGeminiApiHealthSmoke({
    apiKey:"SECRET",fetchFn:async()=>new Response(JSON.stringify({
      candidateCount:"NOT_REAL",usageMetadata:{promptTokenCount:"4"}
    }),{status:200})
  });
  assert.equal(absent.result,"gemini-api-health-fail");
  assert.equal(absent.generation_diagnostic.candidate_count,null);
  assert.equal(absent.generation_diagnostic.part_count,null);
  assert.equal(absent.generation_diagnostic.text_part_count,null);
  assert.equal(absent.generation_diagnostic.has_text,false);
  assert.equal(absent.generation_diagnostic.finish_reason,null);
  assert.equal(absent.generation_diagnostic.prompt_token_count,null);

  const malformed=await runGeminiApiHealthSmoke({
    apiKey:"SECRET",
    fetchFn:async()=>new Response("DO_NOT_PRINT_INVALID_JSON",{status:200})
  });
  assert.equal(malformed.result,"gemini-api-health-fail");
  assert.equal(malformed.generation_diagnostic,null);
  assert.equal(JSON.stringify(malformed).includes("DO_NOT_PRINT_INVALID_JSON"),false);

  const failed=await runGeminiApiHealthSmoke({
    apiKey:"SECRET",fetchFn:async()=>new Response(JSON.stringify({
      error:{status:"UNAVAILABLE",code:503,message:"DONT_LOG_ERROR"}
    }),{status:503})
  });
  assert.equal(failed.generation_diagnostic,null);
  assert.equal(failed.google_error_status,"UNAVAILABLE");
  assert.equal(JSON.stringify(failed).includes("DONT_LOG_ERROR"),false);
});
