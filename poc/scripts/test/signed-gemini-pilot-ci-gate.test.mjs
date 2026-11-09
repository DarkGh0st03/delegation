import test from "node:test";
import {readFileSync,existsSync} from "node:fs";
import assert from "node:assert/strict";
import {verifyExactShaOfflineCiRuns,checkSignedGeminiCiGate} from
  "../signed-gemini-pilot-ci-gate.mjs";
const sha="a".repeat(40),REPO="DarkGh0st03/delegation",
  BRANCH="refactor/post-prof-plan-contracts-20261021";
const paths=[
  ".github/workflows/engineer-direct-native-evm-e2e.yml",
  ".github/workflows/engineer-embedded-signed-dag-e2e.yml",
  ".github/workflows/engineer-embedded-signed-d1-e2e.yml",
  ".github/workflows/fast-ci.yml"
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
test("R267 native CI gate requires EVM + direct signed DAG + D1 + Fast CI",()=>{
 const native=[
  ["engineer-direct-native-evm-e2e",".github/ci-checkpoints/engineer-evm-request.json"],
  ["engineer-embedded-signed-dag-e2e",".github/ci-checkpoints/engineer-full-dag-request.json"],
  ["engineer-embedded-signed-d1-e2e",".github/ci-checkpoints/engineer-d1-request.json"]
 ];
 for(const [name,marker] of native){
   const yaml=readFileSync(new URL("../../../.github/workflows/"+name+".yml",import.meta.url),"utf8");
   const start=yaml.indexOf("\non:");
   const end=yaml.indexOf("\npermissions:",start);
   assert.ok(start>=0&&end>start,"Missing native workflow on/permissions sections");
   const triggers=yaml.slice(start,end);
   assert.ok(triggers.includes("workflow_dispatch:"));
   assert.doesNotMatch(triggers,/^  push:/mu);
   assert.equal(existsSync(new URL("../../../"+marker,import.meta.url)),false);
   assert.ok(!triggers.includes("poc/**"),"Native full CI must not run on normal source push");
 }
 const fast=readFileSync(new URL("../../../.github/workflows/fast-ci.yml",import.meta.url),"utf8");
 assert.match(fast,/refactor\/post-prof-plan-contracts-20261021/u);
 assert.equal(verifyExactShaOfflineCiRuns(paths.map(green),sha).independent_workflows_verified,4);
 assert.equal(verifyExactShaOfflineCiRuns(paths.map(p=>({...green(p),event:"workflow_dispatch"})),sha).independent_workflows_verified,4);
 assert.throws(()=>verifyExactShaOfflineCiRuns([{...green(paths[0]),path:".github/workflows/functional-signed-dag-e2e.yml"}],sha),/NO-GO/u);
});

test("four independent native/free green workflows on same SHA allow a NO-INFERENCE readiness report",()=>{
  const r=verifyExactShaOfflineCiRuns(paths.map(green),sha);
  assert.equal(r.gemini_generation_calls,0);
  assert.equal(r.independent_workflows_verified,4);
  assert.equal(r.validated_commit_sha,sha);
  assert.equal(r.monetary_billing_cap_enforced,false);
  assert.ok(Object.isFrozen(r.validated_offline_workflow_paths));
});
test("missing, stale, failed or forged CI evidence must always deny",()=>{
  for(const i of paths.keys()){
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
 assert.equal(verifyExactShaOfflineCiRuns([...paths.map(green),narrow],sha).independent_workflows_verified,4);
});

test("R168 green legacy MCP must never substitute actual signed D1 recovery",()=>{
 const legacyPath=".github/workflows/obsolete-sequential-mcp.yml";
 const missingD1=paths.filter(p=>p!==
   ".github/workflows/engineer-embedded-signed-d1-e2e.yml").map(green);
 assert.throws(()=>verifyExactShaOfflineCiRuns([...missingD1,green(legacyPath)],sha),
  /NO-GO/);
 assert.equal(verifyExactShaOfflineCiRuns([...paths.map(green),green(legacyPath)],sha)
  .independent_workflows_verified,4);
});

test("R384.6 archived manual Gemini workflow is disabled and cannot start legacy Adapter HTTP",()=>{
 const paid=readFileSync(new URL("../../../.github/workflows/gemini-paid-shared-mcp-final.yml",import.meta.url),"utf8");
 const triggers=/^on:\s*\n([\s\S]*?)^permissions:/mu.exec(paid);
 assert.ok(triggers&&triggers[1].includes("workflow_dispatch:"));
 for(const job of ["account-suspension","f1-real-gitea-planning"]){
  const offset=paid.indexOf("  "+job+":\n");
  assert.ok(offset>=0,"retired job must be accounted for: "+job);
  assert.match(paid.slice(offset,offset+300),/^    if: \$\{\{ false \}\}$/mu);
 }
 assert.doesNotMatch(triggers[1],/^  (push|schedule|pull_request):/mu);
 assert.equal((paid.match(/ENGINEER_CORE_NATIVE_MODE: "1"/gu)??[]).length,2);
 assert.equal((paid.match(/APPROVED_RUNNER_NATIVE_MCP: "1"/gu)??[]).length,2);
 assert.equal((paid.match(/libdelegation_engineer_node\.so/gu)??[]).length,2);
 assert.equal((paid.match(/assert_verification_ready\(\)/gu)??[]).length,2);
 assert.doesNotMatch(paid,/cargo run --manifest-path services\/delegation-adapter\/Cargo.toml/u);
 assert.doesNotMatch(paid,/cargo build --manifest-path services\/delegation-adapter\/Cargo.toml/u);
 assert.match(paid,/node poc\/scripts\/signed-gemini-pilot-ci-gate\.mjs --check-ci-no-inference/u);
 assert.equal((paid.match(/test ! -e \/tmp\/native-evm-adapter\.pid/gu)??[]).length,2);
});
test("R267 historical HTTP Adapter CI cannot masquerade as native proof",()=>{
 const historical=[
  ".github/workflows/functional-signed-dag-e2e.yml",
  ".github/workflows/ts2724-signed-d1-targeted.yml",
  ".github/workflows/cumulative-refactoring-offline.yml"
 ];
 assert.throws(()=>verifyExactShaOfflineCiRuns(historical.map(green),sha),/NO-GO/u);
 for(const required of paths)
  assert.throws(()=>verifyExactShaOfflineCiRuns([
    ...paths.filter(p=>p!==required).map(green),
    ...historical.map(green)
  ],sha),/NO-GO/u);
});

test("R384.6 retired D0/F1 jobs preserve original Rust DID references for audit only",()=>{
 const paid=readFileSync(new URL("../../../.github/workflows/gemini-paid-shared-mcp-final.yml",import.meta.url),"utf8");
 const free=readFileSync(new URL("../../../.github/workflows/f1-real-gitea-planning-parity.yml",import.meta.url),"utf8");
 const signed=readFileSync(new URL("../../../.github/workflows/engineer-embedded-signed-dag-e2e.yml",import.meta.url),"utf8");
 for(const [name,file] of [
   ["ADAPTER_DID_PUBLISHER_SCRIPT","publish-ed25519.mjs"],
   ["ADAPTER_DID_RESOLVER_SCRIPT","resolve-did-json.mjs"]
 ]){
   const path=name+": "+"$"+"{{ github.workspace }}/blockchain/did-client/"+file;
   assert.ok(free.includes(path),"Free F1 path reference must exist");
   assert.ok(signed.includes(path),"Free signed DAG path reference must exist");
   assert.equal(paid.split(path).length-1,2,"D0 and paid F1 must both pin "+name);
   assert.equal(paid.split('test -f "$'+name+'"').length-1,2);
   assert.equal(paid.split('case "$'+name+'" in /*) ;; *) exit 1 ;; esac').length-1,2);
 }
 assert.match(paid,/Block billed Gemini pilot unless SAME SHA passed all four native\/free CI gates/u);
 assert.doesNotMatch(paid,/\n  push:\s*\n/u);
});
