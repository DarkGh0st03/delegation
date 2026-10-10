import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as sleep} from "node:timers/promises";
import {inspectGeminiModelMetadata} from "../scripts/gemini-model-metadata.mjs";

const model="gemini-3.8-flash";
const target="models/"+model;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json"}
});

test("metadata probe makes exactly two authorized GETs, never generation",async()=>{
  const calls:string[]=[];
  const key="TEST_SECRET_NO_LOG";
  const result=await inspectGeminiModelMetadata({
    apiKey:key,model,
    fetchFn:async(url,options)=>{
      calls.push(url);
      assert.equal(options.method,"GET");
      assert.equal(options.headers["x-goog-api-key"],key);
      assert.equal("body" in options,false);
      assert.equal(typeof options.signal?.aborted,"boolean");
      if(url.endsWith("?pageSize=1000")) return json({
        models:[{name:target,supportedGenerationMethods:["generateContent","countTokens"]}],
      });
      if(url.endsWith("/"+model)) return json({
        name:target, supportedGenerationMethods:["generateContent"],
        inputTokenLimit:1048576,outputTokenLimit:65536
      });
      throw new Error("Unexpected URL");
    }
  });
  assert.equal(calls.length,2);
  assert.equal(calls[0],"https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.equal(calls[1],"https://generativelanguage.googleapis.com/v1beta/models/"+model);
  assert.equal(result.list.target_listed,true);
  assert.equal(result.list.complete,true);
  assert.equal(result.get.target_matches,true);
  assert.equal(result.get.generate_content_advertised,true);
  assert.equal(result.get.input_token_limit,1048576);
  assert.equal(result.get.output_token_limit,65536);
  assert.equal(result.requests,2);
  assert.equal(JSON.stringify(result).includes(key),false);
});

test("metadata probe separates list-only access from get 404 without raw error",async()=>{
  let count=0;
  const result=await inspectGeminiModelMetadata({
    apiKey:"SECRET",
    fetchFn:async(url)=>{
      count++;
      if(url.includes("pageSize="))
        return json({models:[{name:"models/different-model"}],nextPageToken:"TOPSECRET"});
      return json({error:{message:"DO_NOT_SHOW_PROVIDER_BODY"}},404);
    }
  });
  assert.equal(count,2);
  assert.equal(result.list.http_status,200);
  assert.equal(result.list.complete,false);
  assert.equal(result.list.target_listed,false);
  assert.equal(result.get.http_status,404);
  assert.equal(result.get.category,"api_model_not_found");
  assert.equal(JSON.stringify(result).includes("TOPSECRET"),false);
  assert.equal(JSON.stringify(result).includes("DO_NOT_SHOW_PROVIDER_BODY"),false);
});

test("metadata probe records structured HTTP 503 from both GETs",async()=>{
  let count=0;
  const result=await inspectGeminiModelMetadata({
    apiKey:"SECRET",fetchFn:async()=>{
      count++;
      return json({error:{message:"private"}},503);
    }
  });
  assert.equal(count,2);
  assert.equal(result.list.http_status,503);
  assert.equal(result.get.http_status,503);
  assert.equal(result.list.category,"api_service_unavailable");
  assert.equal(result.get.category,"api_service_unavailable");
  assert.equal(result.get.valid_payload,false);
  assert.equal(JSON.stringify(result).includes("private"),false);
});

test("metadata probe never propagates network details and still checks both endpoints",async()=>{
  let count=0;
  const result=await inspectGeminiModelMetadata({
    apiKey:"SECRET",fetchFn:async()=>{
      count++;
      throw new TypeError("PRIVATE_NETWORK_ERROR");
    }
  });
  assert.equal(count,2);
  assert.equal(result.list.http_status,null);
  assert.equal(result.list.category,"api_network_failure");
  assert.equal(result.get.category,"api_network_failure");
  assert.equal(JSON.stringify(result).includes("PRIVATE_NETWORK_ERROR"),false);
});

test("metadata timeout fails safely with no provider responses",async()=>{
  const result=await inspectGeminiModelMetadata({
    apiKey:"SECRET",timeoutMs:10,
    fetchFn:async(_url,{signal})=>{
      await sleep(70,undefined,{signal});
      throw new Error("SHOULD_NOT_FINISH");
    }
  });
  assert.equal(result.list.category,"api_inference_timeout");
  assert.equal(result.get.category,"api_inference_timeout");
  assert.equal(result.requests,2);
});

test("metadata probe rejects invalid model/timeout before requesting",async()=>{
  await assert.rejects(()=>inspectGeminiModelMetadata({apiKey:""}),/key/u);
  await assert.rejects(()=>inspectGeminiModelMetadata({apiKey:"S",model:"hello"}),/model/u);
  await assert.rejects(()=>inspectGeminiModelMetadata({apiKey:"S",timeoutMs:25000}),/timeout/u);
});
