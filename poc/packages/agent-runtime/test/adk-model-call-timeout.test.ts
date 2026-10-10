import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as sleep} from "node:timers/promises";
import {BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse} from "@google/adk";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";

class SlowApiModel extends BaseLlm{
  aborted=false;
  constructor(){super({model:"scripted-slow-provider"});}
  override async *generateContentAsync(
    _request:LlmRequest,_stream?:boolean,signal?:AbortSignal
  ):AsyncGenerator<LlmResponse,void>{
    signal?.addEventListener("abort",()=>{this.aborted=true;},{once:true});
    await sleep(3000,undefined,{signal});
    yield {content:{role:"model",parts:[{text:"Not expected"}]}};
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(new Error("Disabled in test"));
  }
}

test("ADK model API call timeout fails closed without 3-minute provider wait",async()=>{
  const model=new SlowApiModel();
  const handler=createAdkA2ATaskHandler({
    model,adapterBaseUrl:"http://adapter.invalid",
    gatewayBaseUrl:"http://gateway.invalid",
    adapterToken:"TEST_ONLY_NOT_REAL",
    maxModelTurns:3,maxModelCallMs:1000
  });
  const started=performance.now();
  await assert.rejects(()=>handler({
    task_id:"test-task-model-timeout",
    context_id:"test-context",
    role:"backend",
    subtask:{
      subtask_id:"backend-test",
      instruction:"Demonstrate timeout",
      branch:"feature/account-suspension",
      relevant_paths:["apps/backend/src/users/user.service.ts"]
    },
    delegation_evidence:{
      credential:"TEST_ONLY_NEVER_LOG_CREDENTIAL",
      credential_id:"urn:test:credential",
      presenter_id:"did:test:agent"
    }
  }),/api_inference_timeout/u);
  assert.equal(model.aborted,true);
  assert.ok(performance.now()-started<2600);
});

test("ADK model call timeout rejects unsafe configuration without network traffic",()=>{
  const valid={
    model:new SlowApiModel(),adapterBaseUrl:"http://adapter.invalid",
    gatewayBaseUrl:"http://gateway.invalid",adapterToken:"TEST_ONLY"
  };
  assert.throws(()=>createAdkA2ATaskHandler({
    ...valid,maxModelCallMs:0
  }),/1000..120000/u);
  assert.throws(()=>createAdkA2ATaskHandler({
    ...valid,maxModelCallMs:120001
  }),/1000..120000/u);
});

test("ADK generation configuration rejects unsafe values before any network traffic",()=>{
  const base={
    model:new SlowApiModel(),adapterBaseUrl:"http://adapter.invalid",
    gatewayBaseUrl:"http://gateway.invalid",adapterToken:"TEST_ONLY"
  };
  for(const generateContentConfig of [
    {maxOutputTokens:0,temperature:0},
    {maxOutputTokens:4097,temperature:0},
    {maxOutputTokens:1024,temperature:-1},
    {maxOutputTokens:1024,temperature:Infinity}
  ]){
    assert.throws(()=>createAdkA2ATaskHandler({
      ...base,generateContentConfig
    }),/Invalid explicit ADK generation configuration/u);
  }
  assert.doesNotThrow(()=>createAdkA2ATaskHandler({
    ...base,generateContentConfig:{maxOutputTokens:1024,temperature:0}
  }));
});
