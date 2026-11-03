import test from "node:test";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {verifyExactShaOfflineCiRuns,checkSignedGeminiCiGate} from
  "../signed-gemini-pilot-ci-gate.mjs";
const sha="a".repeat(40),REPO="DarkGh0st03/delegation",
  BRANCH="refactor/post-prof-plan-contracts-20261021";
const paths=[
  ".github/workflows/functional-signed-dag-e2e.yml",
  ".github/workflows/ts2724-signed-d1-targeted.yml",
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
test("R168 checkpoint requires Cumulative + signed-DAG + real D1 recovery; never paid Gemini",()=>{
  const marker=".github/ci-checkpoints/full-ci-request.json";
  for(const name of ["functional-signed-dag-e2e","cumulative-refactoring-offline",
    "ts2724-signed-d1-targeted"]){
    const yaml=readFileSync(new URL("../../../.github/workflows/"+name+".yml",import.meta.url),"utf8");
    const start=yaml.indexOf("\non:");
    const end=yaml.indexOf("\npermissions:",start);
    assert.ok(start>=0&&end>start,"Expected GitHub trigger block");
    const triggers=yaml.slice(start,end);
    assert.ok(triggers.includes("workflow_dispatch:"));
    assert.ok(triggers.includes("refactor/post-prof-plan-contracts-20261021"));
    assert.ok(triggers.includes("- '"+marker+"'"),"Missing explicit checkpoint trigger");
    assert.ok(!triggers.includes("poc/**"),"Heavy CI cannot run on every source change");
    if(name==="ts2724-signed-d1-targeted"){
      assert.ok(triggers.includes("'.github/ci-checkpoints/full-ci-request.json'"));
      assert.ok(!triggers.includes("pull_request:"),
        "Targeted D1 must use verified SHA only on push/dispatch");
    }
  }
  const historical=readFileSync(new URL("../../../.github/workflows/shared-mcp-real-positive-e2e.yml",import.meta.url),"utf8");
  const historicHeader=historical.slice(0,historical.indexOf("\npermissions:"));
  assert.ok(historicHeader.includes("feat/shared-mcp-spike, main"));
  assert.ok(!historicHeader.includes(
    "feat/shared-mcp-spike, main, refactor/post-prof-plan-contracts-20261021"),
    "Historical sequential MCP must not run on development checkpoints");
  assert.ok(historicHeader.includes("pull_request:"));
  assert.ok(historicHeader.includes("workflow_dispatch:"));
  const r139=readFileSync(new URL("../../../.github/workflows/r139-real-docker-repair-e2e.yml",import.meta.url),"utf8");
  assert.ok(r139.includes("workflow_dispatch:"));
  assert.ok(!r139.includes("branches: [refactor/post-prof-plan-contracts-20261021]"));
  assert.equal(verifyExactShaOfflineCiRuns(paths.map(green),sha).independent_workflows_verified,3);
  assert.equal(verifyExactShaOfflineCiRuns(paths.map(p=>({...green(p),event:"workflow_dispatch"})),sha).independent_workflows_verified,3);
  assert.throws(()=>verifyExactShaOfflineCiRuns([{...green(paths[0]),path:".github/workflows/fast-ci.yml"}],sha));
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

test("narrow assertion E2E success never substitutes a required Full CI workflow",()=>{
 const narrow=green(".github/workflows/d1-private-assertion-e2e.yml");
 for(const missing of paths){
  assert.throws(()=>verifyExactShaOfflineCiRuns([
   ...paths.filter(path=>path!==missing).map(green),narrow
  ],sha),/NO-GO/);
 }
 assert.equal(verifyExactShaOfflineCiRuns([...paths.map(green),narrow],sha).independent_workflows_verified,3);
});

test("R168 green legacy MCP must never substitute actual signed D1 recovery",()=>{
 const legacyPath=".github/workflows/shared-mcp-real-positive-e2e.yml";
 const missingD1=paths.filter(p=>p!==
   ".github/workflows/ts2724-signed-d1-targeted.yml").map(green);
 assert.throws(()=>verifyExactShaOfflineCiRuns([...missingD1,green(legacyPath)],sha),
  /NO-GO/);
 assert.equal(verifyExactShaOfflineCiRuns([...paths.map(green),green(legacyPath)],sha)
  .independent_workflows_verified,3);
});
