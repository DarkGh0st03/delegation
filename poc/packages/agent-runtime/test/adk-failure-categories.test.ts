import assert from "node:assert/strict";
import test from "node:test";
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
    fetchFn:async(_url,{signal})=>new Promise((_resolve,reject)=>{
      signal.addEventListener("abort",()=>reject(new Error("SENSITIVE TIMEOUT")),{once:true});
    })
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
