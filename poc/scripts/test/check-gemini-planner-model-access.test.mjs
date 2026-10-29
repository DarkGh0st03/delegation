import test from "node:test";
import assert from "node:assert/strict";
import {checkModelMetadataAccess,MODEL_ID} from
  "../check-gemini-planner-model-access.mjs";

test("non-generative access check uses GET and header, no generateContent",async()=>{
  let calls=0;
  const secret="FAKE_SECRET_MUST_NEVER_LEAK";
  const check=await checkModelMetadataAccess({
    apiKey:secret,
    request:async(url,init)=>{
      calls++;
      assert.equal(url,"https://generativelanguage.googleapis.com/v1beta/models/"+MODEL_ID);
      assert.equal(init.method,"GET");
      assert.equal(init.headers["x-goog-api-key"],secret);
      assert.equal(init.redirect,"error");
      return {status:200,json:async()=>({outputTokenLimit:65536,
        untrusted:"NEVER_LOG_PROVIDER_TEXT"})};
    }
  });
  assert.equal(calls,1);
  assert.equal(check.result,"model_metadata_accessible");
  assert.equal(check.required_output_tokens_per_call,20480);
  assert.equal(check.provider_output_token_limit,65536);
  assert.equal(check.output_capacity_verified,true);
  assert.ok(!JSON.stringify(check).includes("NEVER_LOG_PROVIDER_TEXT"));
  assert.equal(check.content_generation_requests,0);
  assert.equal(check.model_generation_permission,"not_proven_by_metadata_only");
  assert.ok(!JSON.stringify(check).includes(secret));
});

test("missing key fails before network access",async()=>{
  let calls=0;
  await assert.rejects(checkModelMetadataAccess({
    apiKey:" ",request:async()=>{calls++;return {status:200};}
  }),/Secret unavailable/);
  assert.equal(calls,0);
});

test("only allowlisted HTTP classification is emitted; body and secrets omitted",async()=>{
  for(const [status,result] of [
    [401,"authentication_failure"],
    [403,"permission_or_billing_failure"],
    [404,"model_not_found_or_not_accessible"],
    [429,"quota_or_rate_limit"],
    [500,"provider_server_error"],
    [400,"unexpected_http_response"]
  ]){
    const checked=await checkModelMetadataAccess({
      apiKey:"NO_LOG_SECRET",
      request:async()=>({status,json(){return {"key":"DO_NOT_LOG"};}})
    });
    assert.equal(checked.http_status,status);
    assert.equal(checked.result,result);
    assert.ok(!JSON.stringify(checked).includes("NO_LOG_SECRET"));
    assert.ok(!JSON.stringify(checked).includes("DO_NOT_LOG"));
  }
});

test("transport failures are classified without logging exception",async()=>{
  const checked=await checkModelMetadataAccess({
    apiKey:"NO_LOG_SECRET",
    request:async()=>{throw Error("network error with NO_LOG_SECRET");}
  });
  assert.equal(checked.result,"network_or_timeout");
  assert.equal(checked.http_status,null);
  assert.ok(!JSON.stringify(checked).includes("NO_LOG_SECRET"));
});

test("model metadata refuses configured output larger than provider capacity without generation",async()=>{
  for(const [limit,reason] of [
    [16384,"model_output_limit_insufficient"],
    [20479,"model_output_limit_insufficient"],
    [20480,"model_metadata_accessible"],
    [65536,"model_metadata_accessible"],
    [null,"model_output_limit_unverified"],
    ["65536","model_output_limit_unverified"],
    [1000001,"model_output_limit_unverified"]
  ]){
    let calls=0;
    const r=await checkModelMetadataAccess({
      apiKey:"FAKE_NON_BILLABLE_KEY",
      request:async()=>{calls++;return {status:200,
        json:async()=>({outputTokenLimit:limit,prompt:"HIDDEN_PRIVATE_TEXT"})};}
    });
    assert.equal(r.result,reason);
    assert.equal(r.required_output_tokens_per_call,20480);
    assert.equal(r.output_capacity_verified,reason==="model_metadata_accessible");
    assert.equal(r.content_generation_requests,0);
    assert.equal(calls,1);
    assert.ok(!JSON.stringify(r).includes("HIDDEN_PRIVATE_TEXT"));
  }
  const malformed=await checkModelMetadataAccess({
    apiKey:"FAKE_NON_BILLABLE_KEY",
    request:async()=>({status:200,json:async()=>{throw Error("PRIVATE_BROKEN_JSON");}})
  });
  assert.equal(malformed.result,"model_output_limit_unverified");
  assert.ok(!JSON.stringify(malformed).includes("PRIVATE_BROKEN_JSON"));
});
