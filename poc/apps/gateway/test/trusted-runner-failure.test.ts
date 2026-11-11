import test from "node:test";
import assert from "node:assert/strict";
import {RunnerClient} from "../src/runner-client.ts";
import {validateTrustedRunnerFailure}
 from "../src/trusted-authority-only-runner-failure.ts";
const names=[
 "dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"
] as const;
const intent={
 schema:"authority-only-runner-intent-v1" as const,
 kind:"runner_test_commit_preflight_only" as const,
 session_id:"r335-session",authority_digest:"a".repeat(64),
 root_credential_id:"root-r335",task_id:"test-task-r335",
 runtime_task_id:"dispatch_"+"Q".repeat(22),epoch:3,
 agent_did:"did:thesis:test",credential_id:"child-r335",
 request_id:"request-r335",request_fingerprint:"b".repeat(64),
 repository:"thesis/iam-console-poc",
 branch:"feature/account-suspension",
 expected_head_sha:"c".repeat(40),runner_profile:"poc-default" as const,
 prepared_at_ms:1762400000000,runner_execution_authorized:false as const
};
const request={
 request_id:intent.request_id,repository:"gitea://gitea.local/"+intent.repository,
 branch:intent.branch,commit_sha:intent.expected_head_sha,
 profile:"poc-default" as const
};
const log="runner-log://12345678-1234-1234-1234-123456789abc";
function outcome(failedAt:number){
 const phases=names.map((phase,i)=>({
  phase,status:i<failedAt?"pass":i===failedAt?"fail":"skipped"
 }));
 return {
  request_id:request.request_id,repository:request.repository,
  branch:request.branch,tested_commit_sha:request.commit_sha,
  runner_profile:"poc-default",status:"fail",
  phases,project_tests:{
   status:failedAt===6?"pass":"fail",phases:phases.slice(0,6)
  },researcher_acceptance:phases[6],log_reference:log
 };
}
function harness(payload:unknown){
 const client=new RunnerClient({baseUrl:"http://runner.test",
  gatewayToken:"private-test",
  fetchFn:(async(_url:URL|string,init?:RequestInit)=>{
   assert.equal(init?.method,"POST");
   assert.deepEqual(JSON.parse(String(init?.body)),request);
   return new Response(JSON.stringify(payload),{status:200});
  }) as typeof fetch
 });
 return client;
}
test("R335 authenticated first failing phase is only a non-authorizing stage",async()=>{
 for(const index of [0,1,3,5,6]){
  const client=harness(outcome(index)),result=await client.run(request);
  const proof=validateTrustedRunnerFailure(client,request,result,intent);
  assert.equal(proof.first_failed_phase,names[index]);
  assert.equal(proof.repair_candidate,index!==0);
  assert.equal(proof.gateway_task_completed,false);
  assert.equal(proof.recovery_authorized,false);
  assert.equal(proof.child_credential_issued,false);
  assert.equal(proof.tested_commit_sha,request.commit_sha);
 }
});
test("R335 copied/tampered Runner output or mismatched Task/SHA cannot arm D1",async()=>{
 const client=harness(outcome(1)),result=await client.run(request);
 assert.throws(()=>validateTrustedRunnerFailure(client,request,
  structuredClone(result),intent),/provenance/);
 assert.throws(()=>validateTrustedRunnerFailure(client,request,result,{
  ...intent,credential_id:intent.root_credential_id
 }),/canonical native Task/);
 assert.throws(()=>validateTrustedRunnerFailure(client,request,result,{
  ...intent,expected_head_sha:"d".repeat(40)
 }),/original immutable Test intent/);
 assert.throws(()=>validateTrustedRunnerFailure(client,{
  ...request,request_id:"wrong"
 },result,intent),/provenance/);
 result.phases[2].status="pass";
 assert.throws(()=>validateTrustedRunnerFailure(client,request,result,intent),
  /provenance/);
});
test("R335 contradictory FAIL, missing/skipped phases, and PASS are refused",async()=>{
 const invalid=[
  {...outcome(1),phases:outcome(1).phases.slice(1)},
  {...outcome(1),phases:outcome(1).phases.map((p,i)=>i===3?
   {...p,status:"pass"}:p)},
  {...outcome(6),project_tests:{status:"fail",
   phases:outcome(6).phases.slice(0,6)}},
  {...outcome(1),status:"pass"},
  {...outcome(1),log_reference:"untrusted://output"}
 ];
 for(const response of invalid){
  const client=harness(response);
  const result=await client.run(request);
  assert.throws(()=>validateTrustedRunnerFailure(client,request,result,intent),
   /incomplete|inconsistent|differs/);
 }
});
