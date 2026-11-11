import test from "node:test";
import assert from "node:assert/strict";
import {canonicalBranchUri,canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {AuthenticatedRunnerFailureObserver}
 from "../../../apps/gateway/src/trusted-authority-only-runner-failure-evidence.ts";
import {preflightNativeD1FailureCandidate,observeTrustedNativeTestFailure}
 from "../src/trusted-native-runner-failure-d1-preflight.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension";
const uri=canonicalBranchUri(repo,branch);
const approved=[
 {resource:uri+"/directories/apps/backend",operation:"update_file" as const},
 {resource:uri,operation:"run_tests" as const}
];
const testPermission=[{resource:uri,operation:"run_tests" as const}];
const intent={
 schema:"authority-only-runner-intent-v1" as const,
 kind:"runner_test_commit_preflight_only" as const,
 session_id:"r339-session",authority_digest:"a".repeat(64),
 root_credential_id:"root-r339",task_id:"test-r339",
 runtime_task_id:"dispatch_"+"V".repeat(22),epoch:3,
 agent_did:"did:thesis:test",credential_id:"child-r339",
 request_id:"req-r339",request_fingerprint:"b".repeat(64),
 repository:"thesis/iam-console-poc",branch,
 expected_head_sha:"c".repeat(40),runner_profile:"poc-default" as const,
 prepared_at_ms:1762400000000,runner_execution_authorized:false as const
};
const root={
 session_id:intent.session_id,repository:repo,branch,
 authority_digest:intent.authority_digest,
 root_credential_id:intent.root_credential_id,
 root_permissions:approved,
 expires_at:new Date(Date.now()+60000).toISOString(),
 root_expires_at:new Date(Date.now()+60000).toISOString()
};
const row={
 status:"task_registered_preflight_only",task_id:intent.task_id,
 agent_id:"test",agent_did:intent.agent_did,epoch:intent.epoch,
 root_credential_id:intent.root_credential_id,
 authority_digest:intent.authority_digest,
 permissions:testPermission
};
const child={
 status:"native_child_response_verified_staged",task_id:intent.task_id,
 agent_id:"test",agent_did:intent.agent_did,epoch:intent.epoch,
 root_credential_id:intent.root_credential_id,
 authority_digest:intent.authority_digest,
 credential_id:intent.credential_id,permissions:testPermission
};
const flight={
 ...Object.fromEntries(["session_id","authority_digest",
  "root_credential_id","task_id","runtime_task_id","epoch",
  "agent_did","credential_id","request_id","request_fingerprint"]
  .map(k=>[k,intent[k as keyof typeof intent]])),
 status:"gateway_original_test_flight_preflight_only",
 gateway_task_completed:false,recovery_authorized:false,
 gateway_execution_authorized:false
};
const expected={
 ...Object.fromEntries(["session_id","authority_digest",
  "root_credential_id","task_id","runtime_task_id","epoch",
  "agent_did","credential_id","request_id","request_fingerprint"]
  .map(k=>[k,intent[k as keyof typeof intent]])),
 status:"owner_authenticated_runner_failure_observed_staged",
 tested_commit_sha:intent.expected_head_sha,
 first_failed_phase:"typecheck",repair_candidate:true,
 evidence_sha256:"f".repeat(64),
 gateway_task_completed:false,recovery_authorized:false
};
const candidate={role:"backend" as const,permissions:[{
 resource:canonicalFileUri(repo,branch,"apps/backend/src/users/user.service.ts"),
 operation:"update_file" as const
}]};
function fixture(patch?:{root?:typeof root;row?:typeof row;child?:typeof child;
 flight?:typeof flight;expected?:typeof expected;secondRoot?:typeof root}){
 let checks=0,reads=0;
 const coordinator=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
  assertTrustedGatewayAuthorityBinding:()=>{
   checks++;return checks>1?(patch?.secondRoot??patch?.root??root):
    (patch?.root??root);
  },
  assertTrustedGatewayRegisteredTask:()=>patch?.row??row
 });
 Object.defineProperty(coordinator,"phase",{value:"active"});
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
  assertTrustedIssuedChild:()=>patch?.child??child
 });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
  assertTrustedFailedRunnerFlight:()=>patch?.flight??flight
 });
 const observer=Object.assign(Object.create(
  AuthenticatedRunnerFailureObserver.prototype),{
  observe:async()=>{reads++;return patch?.expected??expected;}
 });
 return {config:{coordinator,childIssuer:issuer,gateway,failureObserver:observer,
  failedRunnerIntent:intent,candidate},get reads(){return reads;}};
}
test("R339 authentic Test FAIL only permits original-ceiling planning preflight",async()=>{
 const f=fixture();
 const output=await preflightNativeD1FailureCandidate(f.config);
 assert.equal(output.status,"native_d1_failure_source_preflight_only");
 assert.equal(output.failed_phase,"typecheck");
 assert.equal(output.tested_commit_sha,intent.expected_head_sha);
 assert.equal(output.candidate_role,"backend");
 assert.match(output.candidate_permissions_sha256,/^[0-9a-f]{64}$/);
 assert.equal(output.task_registered,false);
 assert.equal(output.gateway_task_completed,false);
 assert.equal(output.child_credential_issued,false);
 assert.equal(output.recovery_authorized,false);
 assert.equal(f.reads,1);
});
test("R339 foreign Child, Test Task, stale HEAD, non-actionable FAIL deny",async()=>{
 for(const bad of [
  {child:{...child,credential_id:"wrong"}},
  {row:{...row,agent_id:"backend"}},
  {expected:{...expected,tested_commit_sha:"e".repeat(40)}},
  {expected:{...expected,repair_candidate:false}},
  {expected:{...expected,first_failed_phase:"dependency_install"}},
  {secondRoot:{...root,root_credential_id:"foreign-root"}}
 ]){
  await assert.rejects(preflightNativeD1FailureCandidate(
   fixture(bad as never).config),/NO-GO/);
 }
});
test("R339 D1 cannot expand original signed resource or operation ceiling",async()=>{
 for(const permissions of [
  [{resource:canonicalFileUri(repo,branch,"apps/frontend/src/app.ts"),
    operation:"update_file"}],
  [{resource:canonicalFileUri(repo,branch,"apps/backend/src/users/user.service.ts"),
    operation:"create_file"}],
  [{resource:canonicalFileUri(repo,"feature/foreign","apps/backend/src/users/user.service.ts"),
    operation:"update_file"}],
  []
 ]){
  await assert.rejects(preflightNativeD1FailureCandidate({
   ...fixture().config,candidate:{role:"backend",permissions}
  } as never),/NO-GO/);
 }
});
test("R339 expired original root denies even a valid independent FAIL",async()=>{
 const f=fixture({root:{...root,expires_at:
  new Date(Date.now()-60000).toISOString()}});
 await assert.rejects(preflightNativeD1FailureCandidate(f.config),
  /NO-GO/);
 assert.equal(f.reads,0);
});

test("R340 original Gateway flight must be exact, never model-reconstructed",async()=>{
 for(const bad of [
  {request_id:"foreign"},
  {credential_id:"foreign-child"},
  {status:"untrusted"},
  {gateway_task_completed:true}
 ]){
  const f=fixture({flight:{...flight,...bad}} as never);
  await assert.rejects(preflightNativeD1FailureCandidate(f.config),/NO-GO/);
  assert.equal(f.reads,0);
 }
});

test("R355.3 authentic FAIL source is independently verifiable without a D1 candidate",async()=>{
 const f=fixture();
 const {candidate:unused,...source}=f.config;
 const proof=await observeTrustedNativeTestFailure(source);
 assert.equal(proof.status,"native_test_failure_evidence_verified_only");
 assert.equal(proof.failed_task_id,intent.task_id);
 assert.equal(proof.failed_runtime_task_id,intent.runtime_task_id);
 assert.equal(proof.failed_phase,"typecheck");
 assert.equal(proof.source_evidence_sha256,expected.evidence_sha256);
 assert.equal(proof.tested_commit_sha,intent.expected_head_sha);
 assert.equal(proof.gateway_task_completed,false);
 assert.equal(proof.recovery_authorized,false);
 assert.equal(proof.child_credential_issued,false);
 assert.equal(proof.task_registered,false);
 assert.equal("candidate_role" in proof,false);
 assert.equal("candidate_permissions_sha256" in proof,false);
 assert.equal(f.reads,1);
});
test("R355.3 candidate-free FAIL observation never accepts false provenance",async()=>{
 for(const bad of [
  {child:{...child,credential_id:"wrong-child"}},
  {flight:{...flight,request_fingerprint:"wrong"}},
  {expected:{...expected,first_failed_phase:"dependency_install"}},
  {expected:{...expected,tested_commit_sha:"d".repeat(40)}},
  {expected:{...expected,repair_candidate:false}},
  {secondRoot:{...root,root_credential_id:"foreign-root"}}
 ]){
  const f=fixture(bad as never);
  const {candidate:unused,...source}=f.config;
  await assert.rejects(observeTrustedNativeTestFailure(source),/NO-GO/);
 }
});

test("R377.5 FAIL paths are scoped to the original signed read grants",async()=>{
 const allowed="tests/backend/accounts/account.test.ts";
 const hidden="tests/backend/private.test.ts";
 const f=fixture({
  root:{...root,root_permissions:[...approved,
   {resource:uri+"/directories/tests/backend/accounts",operation:"read_file"}]},
  expected:{...expected,first_failed_phase:"backend_tests",
   failing_test_files:[allowed,hidden]}
 } as never);
 const proof=await observeTrustedNativeTestFailure(f.config);
 assert.deepEqual(proof.failing_test_files,[allowed]);
 assert.equal(proof.recovery_authorized,false);
});

/** R384.3: the native R384.2 CREATE effect may be a D1 candidate
 * only when the ORIGINAL Engineer approved that exact operation. The
 * prior Test FAIL is a genuine owner-observed MAC proof in this offline
 * fixture; D1 preflight never performs provider writes or checks absence.
 */
test("R384.3 authentic Runner FAIL allows create-only Backend/Frontend D1 under original Engineer ceiling",async()=>{
 const path="apps/backend/src/users/account-suspension-created.ts";
 const permission={
  resource:canonicalFileUri(repo,branch,path),operation:"create_file" as const
 };
 const expanded={...root,root_permissions:[
  ...approved,{resource:uri+"/directories/apps/backend",operation:"create_file" as const}
 ]};
 for(const role of ["backend","frontend"] as const){
  const f=fixture({root:expanded});
  const output=await preflightNativeD1FailureCandidate({
   ...f.config,candidate:{role,permissions:[permission]}
  });
  assert.equal(output.status,"native_d1_failure_source_preflight_only");
  assert.equal(output.candidate_role,role);
  assert.equal(output.failed_task_id,intent.task_id);
  assert.equal(output.failed_runtime_task_id,intent.runtime_task_id);
  assert.equal(output.tested_commit_sha,intent.expected_head_sha);
  assert.equal(output.recovery_authorized,false);
  assert.equal(output.child_credential_issued,false);
  assert.equal(output.gateway_task_completed,false);
  assert.equal(output.task_registered,false);
  assert.match(output.candidate_permissions_sha256,/^[0-9a-f]{64}$/u);
  assert.equal(f.reads,1);
 }
});
test("R384.3 CREATE recovery cannot expand scope, mix effects, change branch or gain Test role",async()=>{
 const newPath="apps/backend/src/users/account-suspension-created.ts";
 const exact={
  resource:canonicalFileUri(repo,branch,newPath),operation:"create_file"
 };
 const expanded={...root,root_permissions:[
  ...approved,{resource:uri+"/directories/apps/backend",operation:"create_file" as const}
 ]};
 const cases=[
  {role:"backend",permissions:[exact],signedRoot:root},
  {role:"test",permissions:[exact],signedRoot:expanded},
  {role:"backend",permissions:[exact,{
   resource:canonicalFileUri(repo,branch,newPath),operation:"read_file"
  }],signedRoot:expanded},
  {role:"backend",permissions:[exact,{
   resource:canonicalFileUri(repo,branch,newPath),operation:"update_file"
  }],signedRoot:expanded},
  {role:"backend",permissions:[exact,{
   resource:canonicalFileUri(repo,branch,"apps/backend/src/users/another.ts"),
   operation:"create_file"
  }],signedRoot:expanded},
  {role:"backend",permissions:[exact,exact],signedRoot:expanded},
  {role:"backend",permissions:[{
   resource:canonicalFileUri(repo,branch,"apps/frontend/src/foreign.ts"),
   operation:"create_file"
  }],signedRoot:expanded},
  {role:"backend",permissions:[{
   resource:canonicalFileUri(repo,"feature/foreign",newPath),
   operation:"create_file"
  }],signedRoot:expanded},
  {role:"backend",permissions:[{
   resource:uri+"/files/apps/backend/src/users/%2E%2E/escape.ts",
   operation:"create_file"
  }],signedRoot:expanded}
 ];
 for(const {role,permissions,signedRoot} of cases){
  const f=fixture({root:signedRoot});
  await assert.rejects(preflightNativeD1FailureCandidate({
   ...f.config,candidate:{role,permissions}
  } as never),/NO-GO/u);
  assert.equal(f.reads,0,
   "a malformed/excessive CREATE candidate cannot even consume native FAIL observation");
 }
});
test("R384.3 native CREATE recovery still rejects forged FAIL, stale HEAD or changed signed root",async()=>{
 const permission={
  resource:canonicalFileUri(repo,branch,"apps/backend/src/users/new.ts"),
  operation:"create_file" as const
 };
 const expanded={...root,root_permissions:[
  ...approved,{resource:uri+"/directories/apps/backend",operation:"create_file" as const}
 ]};
 for(const bad of [
  {child:{...child,credential_id:"foreign"}},
  {expected:{...expected,tested_commit_sha:"e".repeat(40)}},
  {expected:{...expected,repair_candidate:false}},
  {expected:{...expected,first_failed_phase:"dependency_install"}},
  {secondRoot:{...expanded,authority_digest:"b".repeat(64)}}
 ]){
  const f=fixture({root:expanded,...bad} as never);
  await assert.rejects(preflightNativeD1FailureCandidate({
   ...f.config,candidate:{role:"backend",permissions:[permission]}
  }),/NO-GO/u);
 }
});
