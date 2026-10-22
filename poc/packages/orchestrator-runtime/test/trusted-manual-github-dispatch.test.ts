import assert from "node:assert/strict";
import test from "node:test";
import {verifyGithubManualGeminiDispatch,verifyGithubManualRunViaApi}
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


test("trusted GitHub API corroborates a fresh in-progress first manual run",async()=>{
  const dispatch=check();
  const good={
    id:Number(dispatch.run_id),event:"workflow_dispatch",
    run_attempt:1,status:"in_progress",
    head_sha:SHA,head_branch:REF.slice("refs/heads/".length),
    path:PATH,head_repository:{full_name:REPO},
    created_at:new Date().toISOString()
  };
  const calls:any[]=[];
  const fetchFn=async(url:any,options:any)=>{
    calls.push({url,headers:options.headers});
    return new Response(JSON.stringify(good),{status:200});
  };
  await verifyGithubManualRunViaApi({
    dispatch,pinned,githubApiToken:"test-only-read-token",
    fetchFn:fetchFn as typeof fetch
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,
    "https://api.github.com/repos/"+REPO+"/actions/runs/"+dispatch.run_id);
  assert.equal(calls[0].headers.authorization,"Bearer test-only-read-token");
});
test("paid bridge rejects missing API attestation and tampered run metadata",async()=>{
  const dispatch=check();
  const good={
    id:Number(dispatch.run_id),event:"workflow_dispatch",
    run_attempt:1,status:"in_progress",
    head_sha:SHA,head_branch:REF.slice("refs/heads/".length),
    path:PATH,head_repository:{full_name:REPO},
    created_at:new Date().toISOString()
  };
  const run=(body:any,status=200)=>verifyGithubManualRunViaApi({
    dispatch,pinned,githubApiToken:"test-only-token",
    fetchFn:(async()=>new Response(JSON.stringify(body),{status})) as typeof fetch
  });
  await assert.rejects(verifyGithubManualRunViaApi({
    dispatch,pinned,githubApiToken:undefined
  }),/GitHub API token missing/);
  await assert.rejects(verifyGithubManualRunViaApi({
    dispatch,pinned:{...pinned,sourceSha:undefined},
    githubApiToken:"test"
  }),/independently pin/);
  for(const bad of [
    {event:"push"},{run_attempt:2},{status:"completed"},
    {head_sha:"0".repeat(40)},{head_branch:"main"},
    {path:".github/workflows/legacy.yml"},
    {id:100},{head_repository:{full_name:"attacker/delegation"}},
    {created_at:new Date(Date.now()-3*60*60*1000).toISOString()}
  ]){
    await assert.rejects(run({...good,...bad}),
      /Trusted Github manual dispatch:/);
  }
  await assert.rejects(run(good,401),/metadata rejected/);
});
