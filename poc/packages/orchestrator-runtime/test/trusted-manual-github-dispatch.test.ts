import assert from "node:assert/strict";
import test from "node:test";
import {verifyGithubManualGeminiDispatch}
  from "../src/trusted-manual-github-dispatch.ts";
const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const PATH=".github/workflows/trusted-gemini-dispatch-preflight.yml";
const SHA="b".repeat(40);
const pinned={repository:REPO,ref:REF,workflowPath:PATH,sourceSha:SHA};
const env={
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:REPO,
  GITHUB_REF:REF,GITHUB_WORKFLOW_REF:REPO+"/"+PATH+"@"+REF,
  GITHUB_SHA:SHA,GITHUB_RUN_ID:"39800000000"
};
const event={repository:{full_name:REPO},ref:REF,
  inputs:{
    authorization:"I AUTHORIZE GEMINI API CHARGES",
    model:"gemini-3.8-flash",max_model_turns:"12",
    max_output_tokens:"16000",max_model_call_ms:"120000"
  }
};
function check(patch:any={}){
  return verifyGithubManualGeminiDispatch({
    env:{...env,...patch.env},
    event:patch.event??event,
    pinned:{...pinned,...patch.pinned}
  });
}
test("manual Github event returns bounded inputs, never Engineer approval",()=>{
  const v=check();
  assert.equal(v.status,"manual_workflow_input_only_not_authorized");
  assert.equal(v.source_sha,SHA);
  assert.equal(v.model_name,"gemini-3.8-flash");
  assert.equal(v.max_model_turns,12);
  assert.equal(v.max_output_tokens,16000);
  assert.equal(v.max_model_call_ms,120000);
  assert.ok(Object.isFrozen(v));
  assert.equal("approved_permission_ids" in v,false);
  assert.equal("geminiApiKey" in v,false);
});
test("manual Github event rejects reruns, push and source substitution",()=>{
  for(const patch of [
    {env:{GITHUB_ACTIONS:"false"}},
    {env:{GITHUB_EVENT_NAME:"push"}},
    {env:{GITHUB_RUN_ATTEMPT:"2"}},
    {env:{GITHUB_REPOSITORY:"attacker/delegation"}},
    {env:{GITHUB_REF:"refs/heads/main"}},
    {env:{GITHUB_WORKFLOW_REF:REPO+"/.github/workflows/other.yml@"+REF}},
    {env:{GITHUB_SHA:"0".repeat(40)}},
    {env:{GITHUB_SHA:"../x"}},
    {env:{GITHUB_RUN_ID:"0"}},
    {pinned:{sourceSha:"0".repeat(40)}}
  ])assert.throws(()=>check(patch),/Trusted Github manual dispatch:/);
});
test("manual Github event rejects bypassed consent and unbounded model calls",()=>{
  for(const change of [
    {authorization:"I AUTHORIZE"},
    {model:"gpt"},{model:"gemini-3.8-flash/other"},
    {max_model_turns:"0"},{max_model_turns:"33"},
    {max_model_turns:"1.5"},{max_output_tokens:"32001"},
    {max_output_tokens:"0"},{max_model_call_ms:"999"},
    {max_model_call_ms:"360001"},{max_model_call_ms:"120000ms"},
    {unknown:"injected"}
  ])assert.throws(()=>check({
    event:{...event,inputs:{...event.inputs,...change}}
  }),/Trusted Github manual dispatch:/);
});
test("manual Github event rejects forged repository, ref and missing inputs",()=>{
  for(const candidate of [
    null,[],{},
    {...event,repository:{full_name:"attacker/delegation"}},
    {...event,ref:"refs/heads/main"},
    {...event,inputs:{model:"gemini-3.8-flash"}},
    {...event,inputs:null}
  ])assert.throws(()=>verifyGithubManualGeminiDispatch({
    env,event:candidate,pinned
  }),/Trusted Github manual dispatch:/);
});
