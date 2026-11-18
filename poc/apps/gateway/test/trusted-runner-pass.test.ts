import {SAMPLE_PROJECT_PROFILE} from "../../../packages/plan-contracts/test/fixtures/sample-project-profile.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {RunnerClient,assertTrustedRunnerClientResult}
 from "../src/runner-client.ts";
import {projectProfileDigest} from "../../../packages/plan-contracts/src/project-profile.mjs";
const PROFILE_SHA=projectProfileDigest(SAMPLE_PROJECT_PROFILE);
import {validateTrustedRunnerPass}
 from "../src/trusted-authority-only-runner-pass.ts";

const commit="a".repeat(40);
const request={
 request_id:"r303-request-1",repository:"gitea://gitea.local/thesis/sample-app",
 branch:"feature/sample-change",commit_sha:commit,
 profile:"poc-default" as const
};
const fixed=[
 "dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e"
];
const successful=()=>({
 request_id:request.request_id,repository:request.repository,
 branch:request.branch,tested_commit_sha:request.commit_sha,
 runner_profile:"poc-default",project_profile_sha256:PROFILE_SHA,status:"pass",
 phases:fixed.map(phase=>({
  phase,status:"pass"
 })),
 project_tests:{status:"pass",phases:fixed.map(phase=>({
  phase,status:"pass"
 }))},
 log_reference:"runner-log://12345678-1234-1234-1234-123456789abc"
});
function clientFor(payload:unknown){
 let calls=0;
 const client=new RunnerClient({projectProfile:SAMPLE_PROJECT_PROFILE,
  baseUrl:"http://runner.local:3001",gatewayToken:"owner-only",
  fetchFn:(async(_url:URL|string,init?:RequestInit)=>{
   calls++;
   assert.equal(init?.method,"POST");
   assert.equal((init.headers as Record<string,string>).authorization,
    "Bearer owner-only");
   assert.deepEqual(JSON.parse(String(init.body)),{...request,project_profile:SAMPLE_PROJECT_PROFILE,project_profile_sha256:PROFILE_SHA});
   return new Response(JSON.stringify(payload),{status:200});
  }) as typeof fetch
 });
 return {client,callCount:()=>calls};
}
test("R303.2 complete authenticated PASS is staged but never unlocks a Task",async()=>{
 const {client,callCount}=clientFor(successful());
 const result=await client.run(request);
 assertTrustedRunnerClientResult(client,request,result);
 const stage=validateTrustedRunnerPass(client,request,result);
 assert.equal(stage.runner_execution_authorized,false);
 assert.equal(stage.tested_commit_sha,commit);
 assert.equal(stage.completed_phases.length,6);
 assert.equal(stage.all_project_tests_passed,true);
 assert.equal(callCount(),1);
 await assert.rejects(async()=>validateTrustedRunnerPass(client,{
  ...request,commit_sha:"b".repeat(40)
 },result),/provenance/);
 assert.throws(()=>validateTrustedRunnerPass(client,request,
  structuredClone(result)),/provenance/);
 result.phases[2].status="fail";
 assert.throws(()=>validateTrustedRunnerPass(client,request,result),/provenance/);
});
test("R303.2 untrusted, contradictory or incomplete PASS cannot attest completion",async()=>{
 const badResults=[
  {...successful(),phases:successful().phases.slice(1)},
  {...successful(),phases:successful().phases.map((p,i)=>i===4?
    {...p,status:"skipped"}:p)},
  {...successful(),phases:successful().phases.map((p,i)=>i===5?
    {...p,phase:"backend_tests"}:p)},
  {...successful(),project_tests:{status:"fail",phases:successful().project_tests.phases}},
  {...successful(),project_tests:{status:"pass",phases:successful().project_tests.phases.slice(1)}},
  {...successful(),log_reference:"http://untrusted"},
  {...successful(),status:"fail"}
 ];
 for(const body of badResults){
  const {client}=clientFor(body);
  const result=await client.run(request);
  assert.throws(()=>validateTrustedRunnerPass(client,request,result),
   /Runner PASS claim|approved project phase|pinned Runner phases|not in the approved project profile/);
 }
});
test("R303.2 switched Child's Runner request, SHA or branch is not portable",async()=>{
 const {client}=clientFor(successful());
 const result=await client.run(request);
 for(const foreign of [
  {...request,request_id:"r303-other"},
  {...request,commit_sha:"b".repeat(40)},
  {...request,branch:"main"},
  {...request,repository:"gitea://gitea.local/foreign/repo"}
 ]){
  assert.throws(()=>validateTrustedRunnerPass(client,foreign,result),
   /provenance/);
 }
});

test("R303.2 contradictory PASS+failure artifacts fails before accepting Runner result",async()=>{
 const {client}=clientFor({...successful(),
  typecheck_error_codes:["TS2322"]});
 await assert.rejects(client.run(request),
  /contradictory failure evidence/);
});

test("a PASS with a phase outside the approved profile is refused",async()=>{
 const extra=successful();
 extra.phases=[...extra.phases,{phase:"extra_suite",status:"pass"}];
 const {client}=clientFor(extra);
 await assert.rejects(client.run(request),/not in the approved project profile/u);
});
