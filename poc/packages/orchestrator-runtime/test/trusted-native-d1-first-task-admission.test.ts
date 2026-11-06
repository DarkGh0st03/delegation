import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readdir,rm,readFile,chmod} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
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
import {enrollFirstNativeD1ChildAtGateway}
 from "../src/trusted-native-d1-child-gateway-bind.ts";
import {DurableNativeD1FirstTaskAdmissionJournal,
 admitFirstNativeD1RepairTask}
 from "../src/trusted-native-d1-first-task-admission.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension",branchUri=canonicalBranchUri(repo,branch);
const testPerm={resource:branchUri,operation:"run_tests" as const};
const writePerm={resource:canonicalFileUri(repo,branch,
 "apps/backend/src/users/user.service.ts"),operation:"update_file" as const};
const approved=[{resource:branchUri+"/directories/apps/backend",
 operation:"update_file" as const},testPerm];
const intent={
 schema:"authority-only-runner-intent-v1" as const,
 kind:"runner_test_commit_preflight_only" as const,
 session_id:"r341-session",authority_digest:"a".repeat(64),
 root_credential_id:"root-r341",task_id:"test-r341",
 runtime_task_id:"dispatch_"+"X".repeat(22),epoch:3,
 agent_did:"did:thesis:test",credential_id:"child-r341",
 request_id:"request-r341",request_fingerprint:"b".repeat(64),
 repository:"thesis/iam-console-poc",branch,
 expected_head_sha:"c".repeat(40),runner_profile:"poc-default" as const,
 prepared_at_ms:1762400000000,runner_execution_authorized:false as const
};
const pins=Object.fromEntries([
 "session_id","authority_digest","root_credential_id",
 "task_id","runtime_task_id","epoch","agent_did","credential_id",
 "request_id","request_fingerprint"
].map(k=>[k,intent[k as keyof typeof intent]]));
const root={
 session_id:intent.session_id,repository:repo,branch,
 base_revision:"d".repeat(40),
 requirement_sha256:"e".repeat(64),
 authority_digest:intent.authority_digest,
 root_credential_id:intent.root_credential_id,
 root_permissions:approved,
 expires_at:new Date(Date.now()+3600000).toISOString(),
 root_expires_at:new Date(Date.now()+3600000).toISOString()
};
const testTask={
 status:"task_registered_preflight_only" as const,
 session_id:intent.session_id,task_id:intent.task_id,
 epoch:3,agent_id:"test",agent_did:intent.agent_did,
 root_credential_id:intent.root_credential_id,
 authority_digest:intent.authority_digest,
 permissions:[testPerm],depends_on:["frontend-r341"]
};
const child={
 status:"native_child_response_verified_staged",
 session_id:intent.session_id,task_id:intent.task_id,
 epoch:3,agent_id:"test",agent_did:intent.agent_did,
 root_credential_id:intent.root_credential_id,
 authority_digest:intent.authority_digest,
 credential_id:intent.credential_id,
 permissions:[testPerm],
 expires_at:new Date(Date.now()+3600000).toISOString()
};
const flight={...pins,status:"gateway_original_test_flight_preflight_only",
 gateway_task_completed:false,recovery_authorized:false,
 gateway_execution_authorized:false};
const observed={...pins,status:"owner_authenticated_runner_failure_observed_staged",
 tested_commit_sha:intent.expected_head_sha,first_failed_phase:"typecheck",
 repair_candidate:true,evidence_sha256:"f".repeat(64),
 gateway_task_completed:false,recovery_authorized:false};
const candidate={role:"backend" as const,permissions:[writePerm]};

async function fixture(action:(f:{
 input:Parameters<typeof admitFirstNativeD1RepairTask>[0];
 directory:string;get calls():number;get registered():unknown;
})=>Promise<void>,opts?:{
 failure?:typeof observed;candidate?:typeof candidate;
 throwRegistration?:boolean;record?:typeof testTask;
 root?:typeof root;
}){
 const parent=await mkdtemp(join(tmpdir(),"r341-first-d1-"));
 const directory=join(parent,"admissions");
 await mkdir(directory,{mode:0o700});
 let newRow:Record<string,unknown>|undefined,calls=0;
 const auth=opts?.root??root;
 const coordinator=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
  assertTrustedGatewayAuthorityBinding:()=>auth,
  assertTrustedGatewayRegisteredTask:(id:string)=>{
   if(id===intent.task_id)return opts?.record??testTask;
   if(id===newRow?.task_id)return newRow;
   throw Error("unrecognized Task");
  },
  registerTask:async(raw:Record<string,unknown>)=>{
   calls++;
   if(opts?.throwRegistration)throw Error("simulated crash after reserve");
   assert.equal(raw.session_id,auth.session_id);
   assert.equal(raw.requirement_sha256,auth.requirement_sha256);
   assert.equal(raw.base_revision,auth.base_revision);
   assert.equal(raw.branch,auth.branch);
   assert.equal(raw.epoch,4);
   assert.equal(raw.agent_id,"backend");
   assert.deepEqual(raw.depends_on,["frontend-r341"]);
   assert.deepEqual(raw.permissions,[writePerm]);
   newRow={
    status:"task_registered_preflight_only",
    task_id:raw.task_id,epoch:raw.epoch,agent_id:raw.agent_id,
    session_id:auth.session_id,root_credential_id:auth.root_credential_id,
    authority_digest:auth.authority_digest,
    permissions:raw.permissions,agent_did:"did:thesis:backend",
    card_ref:"trusted:backend",depends_on:raw.depends_on,
    gateway_registered:false,child_credential_issued:false,
    execution_authorized:false
   };
   return newRow;
  }
 });
 Object.defineProperty(coordinator,"phase",{value:"active"});
 Object.defineProperty(coordinator,"registeredTaskCount",{
  get:()=>newRow?4:3
 });
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
  assertTrustedIssuedChild:()=>child
 });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
  assertTrustedFailedRunnerFlight:()=>flight
 });
 const observer=Object.assign(Object.create(
  AuthenticatedRunnerFailureObserver.prototype),{
  observe:async()=>opts?.failure??observed
 });
 const input={
  coordinator,childIssuer:issuer,gateway,failureObserver:observer,
  failedRunnerIntent:intent,candidate:opts?.candidate??candidate,
  journal:new DurableNativeD1FirstTaskAdmissionJournal(directory)
 };
 try{await action({input,directory,get calls(){return calls;},
  get registered(){return newRow;}});}
 finally{await rm(parent,{recursive:true,force:true});}
}
test("R341 genuine failed Test permits ONE new Coordinator Task, not new rights",async()=>{
 await fixture(async(f)=>{
  const result=await admitFirstNativeD1RepairTask(f.input);
  assert.equal(result.status,"native_d1_task_registered_without_gateway_or_child");
  assert.equal(result.task_registered,true);
  assert.equal(result.gateway_registered,false);
  assert.equal(result.child_credential_issued,false);
  assert.equal(result.recovery_execution_authorized,false);
  assert.equal(result.epoch,4);
  assert.match(result.task_id,/^d1-4-[0-9a-f]{20}$/);
  assert.equal(f.calls,1);
  const [file]=await readdir(f.directory);
  assert.ok(file?.endsWith(".d1-first-task.json"));
  const record=JSON.parse(await readFile(join(f.directory,file!),"utf8"));
  assert.equal(record.failed_test_task_id,intent.task_id);
  assert.equal(record.recovery_task_id,result.task_id);
  assert.equal(record.verified_fail_evidence_sha256,observed.evidence_sha256);
  assert.equal(record.original_root_credential_id,root.root_credential_id);
  await assert.rejects(admitFirstNativeD1RepairTask(f.input),/NO-GO/);
  assert.equal(f.calls,1);
 });
});
test("R341 missing actionability or foreign Engineer ceiling cannot write",async()=>{
 for(const bad of [
  {failure:{...observed,repair_candidate:false}},
  {failure:{...observed,tested_commit_sha:"e".repeat(40)}},
  {failure:{...observed,first_failed_phase:"dependency_install"}},
  {candidate:{role:"backend",permissions:[{resource:canonicalFileUri(repo,
   branch,"apps/frontend/src/main.tsx"),operation:"update_file"}]}}
 ]){
  await fixture(async f=>{
   await assert.rejects(admitFirstNativeD1RepairTask(f.input),/NO-GO/);
   assert.equal(f.calls,0);
   assert.deepEqual(await readdir(f.directory),[]);
  },bad as never);
 }
});
test("R341 ambiguous Coordinator failure keeps durable one-use reservation",async()=>{
 await fixture(async f=>{
  await assert.rejects(admitFirstNativeD1RepairTask(f.input),
   /simulated crash after reserve/);
  assert.equal(f.calls,1);
  assert.equal((await readdir(f.directory)).length,1);
  await assert.rejects(admitFirstNativeD1RepairTask(f.input),/EEXIST/);
  assert.equal(f.calls,1);
 },{throwRegistration:true});
});
test("R341 unsafe shared admission store is fail closed before Task registration",async()=>{
 await fixture(async f=>{
  await chmod(f.directory,0o755);
  await assert.rejects(admitFirstNativeD1RepairTask(f.input),/unsafe native D1/);
  assert.equal(f.calls,0);
 });
});

test("R342 original D1 Task is bound, native Child issued, Gateway enrolled, no effect",async()=>{
 await fixture(async f=>{
  const a=await admitFirstNativeD1RepairTask(f.input);
  const events:string[]=[];
  Object.assign(f.input.gateway,{
   bindTrustedTask:async(taskId:string,runtimeTaskId:string,role:string)=>{
    events.push("gateway_bind");
    assert.equal(taskId,a.task_id);
    assert.match(runtimeTaskId,/^dispatch_[a-f0-9]{22}$/);
    assert.equal(role,"backend");
    return {status:"gateway_task_bound_preflight_only",
     task_id:taskId,runtime_task_id:runtimeTaskId,
     authority_digest:root.authority_digest,
     gateway_execution_authorized:false};
   },
   enrollTrustedIssuedChild:async(taskId:string,runtimeTaskId:string)=>{
    events.push("gateway_enroll");
    assert.equal(taskId,a.task_id);
    assert.match(runtimeTaskId,/^dispatch_[a-f0-9]{22}$/);
    return {status:"gateway_child_enrolled_preflight_only",
     task_id:taskId,runtime_task_id:runtimeTaskId,
     credential_id:"child-r342",gateway_execution_authorized:false};
   }
  });
  Object.assign(f.input.childIssuer,{
   issueForRegisteredTask:async(taskId:string,parameters:Record<string,unknown>)=>{
    events.push("rust_issue");
    assert.equal(taskId,a.task_id);
    assert.equal((parameters.credential_status as any).statusListIndex,"29109");
    assert.match(String(parameters.credential_id),/^urn:d1:child:[a-f0-9]{24}$/);
    return {status:"native_child_response_verified_staged",
     task_id:taskId,epoch:a.epoch,session_id:root.session_id,
     root_credential_id:root.root_credential_id,
     authority_digest:root.authority_digest,
     agent_id:"backend",agent_did:"did:thesis:backend",
     permissions:[writePerm],credential_id:"child-r342",
     gateway_execution_authorized:false};
   }
  });
  const result=await enrollFirstNativeD1ChildAtGateway({
   ...f.input,admission:a,
   freshStatusEntry:{statusListCredential:"https://status.example/r342",
    statusListIndex:"29109"}
  });
  assert.equal(result.status,"native_d1_child_enrolled_no_provider_effect");
  assert.equal(result.original_root_credential_id,root.root_credential_id);
  assert.equal(result.epoch,4);
  assert.equal(result.native_child_issued,true);
  assert.equal(result.gateway_child_enrolled,true);
  assert.equal(result.provider_executed,false);
  assert.equal(result.recovery_completed,false);
  assert.equal(result.gateway_execution_authorized,false);
  assert.deepEqual(events,["gateway_bind","rust_issue","gateway_enroll"]);
 });
});
test("R342 forged R341 admission or reused status cannot reach native Rust",async()=>{
 await fixture(async f=>{
  const a=await admitFirstNativeD1RepairTask(f.input);
  let called=false;
  Object.assign(f.input.gateway,{
   bindTrustedTask:async()=>{called=true;throw Error("must not bind");}
  });
  for(const tamper of [
   {task_id:"foreign"},
   {source_evidence_sha256:"0".repeat(64)},
   {original_root_credential_id:"wrong-root"}
  ]){
   await assert.rejects(enrollFirstNativeD1ChildAtGateway({
    ...f.input,admission:{...a,...tamper},
    freshStatusEntry:{statusListCredential:"https://status.example/r342",
     statusListIndex:"29110"}
   }),/NO-GO/);
  }
  // The Test Child was minted for an existing status entry; never reuse it.
  await assert.rejects(enrollFirstNativeD1ChildAtGateway({
   ...f.input,admission:a,
   freshStatusEntry:{statusListCredential:child.status_list_credential,
    statusListIndex:child.status_list_index}
  }),/NO-GO/);
  assert.equal(called,false);
 });
});
