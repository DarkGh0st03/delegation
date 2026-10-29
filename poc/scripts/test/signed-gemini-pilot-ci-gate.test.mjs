import test from "node:test";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {verifyExactShaOfflineCiRuns,checkSignedGeminiCiGate} from
  "../signed-gemini-pilot-ci-gate.mjs";
const sha="a".repeat(40),REPO="DarkGh0st03/delegation",
  BRANCH="refactor/post-prof-plan-contracts-20261021";
const paths=[
  ".github/workflows/functional-signed-dag-e2e.yml",
  ".github/workflows/shared-mcp-real-positive-e2e.yml",
  ".github/workflows/cumulative-refactoring-offline.yml"
];
const green=(path)=>({
  path,head_sha:sha,head_branch:BRANCH,status:"completed",
  conclusion:"success",event:"push",
  repository:{full_name:REPO}
});
const valid=()=>({
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:REPO,
  GITHUB_REF:"refs/heads/"+BRANCH,
  GITHUB_SHA:sha,GITHUB_RUN_ID:"40698711111",
  DELEGATION_PINNED_COMMIT_SHA:sha,
  DELEGATION_BILLING_CAP_ACK:
    "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  GITHUB_TOKEN:"GITHUB_DRY_ONLY_TOKEN_NEVER_ECHO",
  DELEGATION_SIGNED_GEMINI_PILOT:"1",
  DELEGATION_GEMINI_MODEL:"gemini-3.8-flash",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES"
});
test("required signed-DAG CI automatically covers all live Gemini execution and recovery paths",()=>{
  const yaml=readFileSync(new URL(
    "../../../.github/workflows/functional-signed-dag-e2e.yml",
    import.meta.url),"utf8");
  for(const path of [
    "poc/apps/orchestrator/src/**",
    "poc/apps/orchestrator/test/**",
    "poc/packages/orchestrator-runtime/src/**",
    "poc/packages/orchestrator-runtime/test/**",
    "poc/packages/plan-contracts/src/**",
    "poc/packages/plan-contracts/test/**",
    "poc/scripts/check-gemini-planner-model-access.mjs",
    "poc/scripts/test/check-gemini-planner-model-access.test.mjs",
    "poc/scripts/signed-gemini-pilot-*.mjs",
    "poc/scripts/test/signed-gemini-pilot-*.test.mjs"
  ]){
    assert.ok(yaml.includes("'"+path+"'"),
      "Signed DAG exact-SHA CI must run on "+path);
  }
  assert.ok(yaml.includes("workflow_dispatch:"),
    "An independent free manual rerun must remain available");
});

test("three independent offline green workflows on same SHA allow a NO-INFERENCE readiness report",()=>{
  const r=verifyExactShaOfflineCiRuns(paths.map(green),sha);
  assert.equal(r.gemini_generation_calls,0);
  assert.equal(r.independent_workflows_verified,3);
  assert.equal(r.validated_commit_sha,sha);
  assert.equal(r.monetary_billing_cap_enforced,false);
  assert.ok(Object.isFrozen(r.validated_offline_workflow_paths));
});
test("missing, stale, failed or forged CI evidence must always deny",()=>{
  for(const i of [0,1,2]){
    const rows=paths.map(green);
    rows.splice(i,1);
    assert.throws(()=>verifyExactShaOfflineCiRuns(rows,sha),/NO-GO/);
  }
  for(const patch of [
    {head_sha:"b".repeat(40)},
    {head_branch:"main"},
    {status:"in_progress"},
    {conclusion:"cancelled"},
    {conclusion:"failure"},
    {event:"pull_request"},
    {repository:{full_name:"someone/else"}}
  ]){
    const rows=paths.map(green);
    rows[1]={...rows[1],...patch};
    assert.throws(()=>verifyExactShaOfflineCiRuns(rows,sha),/NO-GO/);
  }
  assert.throws(()=>verifyExactShaOfflineCiRuns([],sha),/NO-GO/);
  assert.throws(()=>verifyExactShaOfflineCiRuns(paths.map(green),"bad"),/NO-GO/);
});
test("remote check is GitHub GET ONLY and strips all tokens from receipt",async()=>{
  const env=valid();
  let calls=0;
  const result=await checkSignedGeminiCiGate(env,{
    request:async(url,options)=>{
      calls++;
      assert.equal(new URL(url).hostname,"api.github.com");
      assert.equal(new URL(url).searchParams.get("branch"),BRANCH);
      assert.equal(new URL(url).searchParams.get("head_sha"),sha,
        "API must query pinned SHA, not a lossy page of newer CI runs");
      assert.equal(options.method,"GET");
      assert.equal(options.headers.authorization,"Bearer "+env.GITHUB_TOKEN);
      return {status:200,text:async()=>JSON.stringify({
        workflow_runs:paths.map(green)
      })};
    }
  });
  assert.equal(calls,1);
  assert.equal(result.gemini_generation_calls,0);
  assert.ok(!JSON.stringify(result).includes(env.GITHUB_TOKEN));
});
test("invalid manual consent or Github token refuses BEFORE remote API call",async()=>{
  let calls=0;
  for(const env of [
    {...valid(),GITHUB_EVENT_NAME:"push"},
    {...valid(),GITHUB_SHA:"bad"},
    {...valid(),GITHUB_RUN_ATTEMPT:"2"},
    {...valid(),GITHUB_TOKEN:""}
  ]){
    await assert.rejects(checkSignedGeminiCiGate(env,{
      request:async()=>{calls++;throw Error("should never be called");}
    }),/NO-GO/);
  }
  assert.equal(calls,0);
});
test("GitHub errors and secret-bearing bodies are never echoed",async()=>{
  const env=valid();
  for(const response of [
    {status:403,text:async()=>JSON.stringify({secret:env.GITHUB_TOKEN})},
    {status:200,text:async()=>"{broken"},
    {status:200,text:async()=>JSON.stringify({workflow_runs:[]})}
  ]){
    await assert.rejects(checkSignedGeminiCiGate(env,{
      request:async()=>response
    }),error=>{
      assert.match(error.message,/NO-GO/);
      assert.ok(!error.message.includes(env.GITHUB_TOKEN));
      return true;
    });
  }
});
