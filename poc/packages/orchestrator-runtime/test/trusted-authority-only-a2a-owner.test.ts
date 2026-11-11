import test from "node:test";
import assert from "node:assert/strict";
import {TaskState} from "@a2a-js/sdk";
import {canonicalBranchUri,canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyCreateEffectStager}
 from "../../../apps/gateway/src/trusted-authority-only-create-effect-stager.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight}
 from "../../../apps/gateway/src/trusted-authority-only-create-preflight.ts";
import {DurableAuthorityOnlyGiteaCreateIntentJournal}
 from "../../../apps/gateway/src/trusted-authority-only-create-intent-journal.ts";
import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {InMemoryRequestStore} from "../../../apps/gateway/src/prepare.ts";
import {TrustedAuthorityOnlyRemoteEffectBootstrap}
 from "../src/trusted-authority-only-remote-effect-bootstrap.ts";
import {TrustedAuthorityOnlyA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension",file="apps/backend/src/users/account.ts";
const taskId="r325-backend",runtimeTaskId="dispatch_"+"G".repeat(22);
const id="urn:r325:native:child",did="did:thesis:backend-agent";
const effect={resource:canonicalFileUri(repo,branch,file),
 operation:"update_file" as const};
const root={
 session_id:"r325-root-session",repository:repo,branch,
 authority_digest:"a".repeat(64),root_credential_id:"native-root-r325",
 base_revision:"b".repeat(40),requirement_sha256:"c".repeat(64),
 engineer_did:"did:thesis:engineer",
 root_expires_at:new Date(Date.now()+60000).toISOString(),
 expires_at:new Date(Date.now()+60000).toISOString(),
 root_permissions:[effect]
};
const row={
 status:"task_registered_preflight_only" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:did,card_ref:"trusted:backend",
 depends_on:[],permissions:[effect],root_credential_id:root.root_credential_id,
 authority_digest:root.authority_digest,
 execution_authorized:false as const,child_credential_issued:false as const,
 gateway_registered:false as const
};
const child={
 status:"native_child_response_verified_staged" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:did,root_credential_id:root.root_credential_id,
 credential_id:id,authority_digest:root.authority_digest,permissions:[effect],
 status_list_credential:"https://issuer.invalid/status",status_list_index:"1",
 expires_at:new Date(Date.now()+60000).toISOString(),
 gateway_execution_authorized:false as const
};
const signed={
 "@context":["https://www.w3.org/2018/credentials/v1"],
 type:["VerifiableCredential"],id,issuer:"did:thesis:rust",
 validFrom:new Date(Date.now()-1000).toISOString(),
 credentialStatus:{
  type:"BitstringStatusListEntry",statusPurpose:"revocation",
  statusListCredential:child.status_list_credential,statusListIndex:"1"
 },
 credentialSubject:{sub:did,per:[effect]},
 proof:{type:"Ed25519Signature2020",proofValue:"fixture-only-not-cryptographic"}
};
const receipt={
 status:"gateway_owner_child_task_preflight_only" as const,
 task_id:taskId,runtime_task_id:runtimeTaskId,agent_id:"backend",
 agent_did:did,credential_id:id,
 authority_digest:root.authority_digest,gateway_execution_authorized:false as const
};
const artifact={
 role:"backend",summary:"Applied authorized file update",
 files_modified:[file],files_created:[],branch,
 revision:"d".repeat(40),commit_sha:"d".repeat(40),
 test_outcome:"not_run",errors:[]
};
const goodResponse=()=>{
 return {card:{name:"Backend Agent"},task:{
  id:"a2a-task-r325",status:{state:TaskState.TASK_STATE_COMPLETED},
  artifacts:[{parts:[{content:{$case:"data",value:artifact}}]}]
 }};
};
function fixture(patch?:{
 row?:typeof row;child?:typeof child;root?:typeof root;
 receipt?:typeof receipt;signed?:typeof signed;
 response?:unknown;failBind?:boolean;mixedComplete?:boolean;readComplete?:boolean;
 extraRole?:boolean;verifiedExtra?:boolean
 }){
 const calls:string[]=[];
 let takes=0,roots=0;
 const coord=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
  assertTrustedGatewayAuthorityBinding:()=>{roots++;return patch?.root??root;},
  assertTrustedGatewayRegisteredTask:()=>patch?.row??row
 });
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
  assertTrustedIssuedChild:()=>patch?.child??child,
  takeTrustedIssuedChildCredential:()=>{
   takes++;if(takes>1)throw Error("already taken");
   return patch?.signed??signed;
  }
 });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
  assertTrustedOwnerRemoteEffectBinding:()=>patch?.receipt??receipt,
  assertTrustedCompletedSequentialReadUpdateTask:(task:string,rt:string)=>{
   calls.push("gateway_sequential_completion");
   if(patch?.mixedComplete===false)throw Error("mixed Task not independently finalized");
   assert.equal(task,taskId);assert.equal(rt,runtimeTaskId);
   return {status:"sequential_read_update_task_completed_staged",
    task_id:task,runtime_task_id:rt,gateway_execution_authorized:false};
  },
  attestTrustedTaskCompletion:async(task:string,rt:string)=>{
   calls.push("gateway_independent_observer");
   if(patch?.readComplete===false)throw Error("missing independently verified project test read");
   assert.equal(task,taskId);assert.equal(rt,runtimeTaskId);
   return {status:"task_completion_observed_staged",task_id:task,
    runtime_task_id:rt,gateway_execution_authorized:false};
  }
 });
 const bootstrap=Object.assign(Object.create(
  TrustedAuthorityOnlyRemoteEffectBootstrap.prototype),{
  dispatchApprovedTask:async(input:{
   taskId:string;runtimeTaskId:string;dispatch:()=>Promise<unknown>
  })=>{
   calls.push("private_bind");
   if(patch?.failBind)throw Error("owner private bind denied");
   assert.equal(input.taskId,taskId);
   assert.equal(input.runtimeTaskId,runtimeTaskId);
   return input.dispatch();
  },
  cancelTask:async()=>{},
  close:async()=>{}
 });
 const transport={sendProtectedTask:async(input:unknown)=>{
  calls.push("a2a_send");
  const sent=input as {subtask:{branch:string;approved_file_permissions:unknown[];
    approved_run_tests:boolean;relevant_paths:string[]};
    delegation_evidence:{credential:string;credential_id:string;
     presenter_id:string};
    trusted_gateway_task_id:string;agent_base_url:string};
  const isTest=patch?.row?.agent_id==="test";
  assert.equal(sent.agent_base_url,patch?.row?.agent_id==="reviewer"?
   "http://127.0.0.1:8104":isTest?
   "http://127.0.0.1:8103":"http://127.0.0.1:8101");
  assert.equal(sent.trusted_gateway_task_id,runtimeTaskId);
  assert.equal(sent.subtask.branch,branch);
  const isMixed=patch?.row?.permissions.length===2&&
   patch.row.permissions.some(p=>p.operation==="read_file");
  const runsTests=isTest&&!!patch?.row?.permissions.some(p=>p.operation==="run_tests");
  const target=isTest?"tests/backend/account.test.ts":file;
  assert.deepEqual(sent.subtask.relevant_paths,runsTests?[]:[target]);
  const isCreate=patch?.row?.permissions.length===1&&
   String(patch.row.permissions[0]?.operation)==="create_file";
  assert.deepEqual(sent.subtask.approved_file_permissions,runsTests?[]:
   isMixed?[{path:target,operation:"read_file"},
    {path:target,operation:"update_file"}]:[{
     path:target,operation:isCreate?"create_file":
     patch?.row?.permissions[0]?.operation==="read_file"?"read_file":"update_file"
    }]);
  assert.equal(sent.subtask.approved_run_tests,runsTests);
  assert.equal(sent.delegation_evidence.credential_id,id);
  assert.equal(sent.delegation_evidence.presenter_id,patch?.row?.agent_did??did);
  assert.deepEqual(JSON.parse(sent.delegation_evidence.credential),patch?.signed??signed);
  return patch?.response??goodResponse();
 }};
 const owner=new TrustedAuthorityOnlyA2AOwner({
  coordinator:coord,childIssuer:issuer,gateway,bootstrap,
  a2a:transport,agentBaseUrls:{
   backend:"http://127.0.0.1:8101/",
   frontend:"http://127.0.0.1:8102/",
   test:"http://127.0.0.1:8103/",
   ...(patch?.extraRole?{reviewer:"http://127.0.0.1:8104/"}:{})
  },
  ...(patch?.extraRole&&patch.verifiedExtra!==false?{verifiedAgentProfiles:{
   backend:{did,capabilities:["read_file","update_file"]},
   frontend:{did:"did:thesis:frontend-agent",capabilities:["read_file","update_file"]},
   test:{did:"did:thesis:test-agent",capabilities:["read_file","run_tests"]},
   reviewer:{did:"did:thesis:reviewer-agent",capabilities:["read_file"]}
  }}:{})
 } as never);
 return {owner,gateway,calls,get takes(){return takes;},get roots(){return roots;}};
}
const request=()=>({taskId,runtimeTaskId,
 instruction:"Update the account status handler",
 effectStager:{async stage(){return {provider_write_authorized:false};}}
});
test("R325 actual owner handoff transfers native signed Child only after private A2A bind",async()=>{
 const f=fixture();
 const result=await f.owner.dispatchIssuedTask(request());
 assert.equal(result.status,"a2a_report_not_gateway_completed");
 assert.equal(result.provider_completion_attested,false);
 assert.equal(result.artifact.commit_sha,"d".repeat(40));
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 assert.equal(f.takes,1);
 assert.ok(f.roots>=2);
 await assert.rejects(f.owner.dispatchIssuedTask(request()),/closed or malformed owner-selected Task/u);
 assert.equal(f.takes,1);
});
test("R325 private binding failure cannot leak native Child into A2A or retry",async()=>{
 const f=fixture({failBind:true});
 await assert.rejects(f.owner.dispatchIssuedTask(request()),/owner private bind denied/u);
 assert.deepEqual(f.calls,["private_bind"]);
 assert.equal(f.takes,0);
 await assert.rejects(f.owner.dispatchIssuedTask(request()),/closed or malformed/u);
});
test("R325 signed Task/Child/Gateway mismatch fails before remote binding",async()=>{
 for(const patch of [
  {row:{...row,authority_digest:"f".repeat(64)}},
  {child:{...child,credential_id:"urn:other:child"}},
  {receipt:{...receipt,agent_did:"did:thesis:forged"}},
  {row:{...row,permissions:[{
    resource:canonicalBranchUri(repo,branch)+"/files/../bad",
    operation:"update_file" as const}]}},
  {row:{...row,permissions:[effect,{resource:canonicalBranchUri(repo,branch),
    operation:"run_tests" as const}]}}
 ]){
  const f=fixture(patch as never);
  await assert.rejects(f.owner.dispatchIssuedTask(request()),/NO-GO/u);
  assert.deepEqual(f.calls,[]);
  assert.equal(f.takes,0);
 }
});
test("R325 forged signed DC payload is rejected after private binding but before A2A",async()=>{
 const f=fixture({signed:{...signed,id:"urn:wrong:credential"}});
 await assert.rejects(f.owner.dispatchIssuedTask(request()),
  /native signed Child payload mismatches/u);
 assert.deepEqual(f.calls,["private_bind"]);
 assert.equal(f.takes,1);
});
test("R325 untrusted A2A status, extra artifact or bad branch is never Gateway completion",async()=>{
 const bad=[
  {card:{name:"Backend Agent"},task:{...goodResponse().task,
   status:{state:TaskState.TASK_STATE_FAILED}}},
  {card:{name:"Backend Agent"},task:{...goodResponse().task,
   artifacts:[...goodResponse().task.artifacts,...goodResponse().task.artifacts]}},
  {card:{name:"Backend Agent"},task:{...goodResponse().task,
   artifacts:[{parts:[{content:{$case:"data",value:{
    ...artifact,branch:"feature/foreign"
   }}}]}]}}
 ];
 for(const response of bad){
  const f=fixture({response});
  await assert.rejects(f.owner.dispatchIssuedTask(request()));
  assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 }
});
test("R325 only Test role may dispatch branch-pinned run_tests",async()=>{
 const branchPermission={resource:canonicalBranchUri(repo,branch),
  operation:"run_tests" as const};
 const testRow={...row,agent_id:"test",agent_did:"did:thesis:test-agent",
  permissions:[branchPermission]};
 const f=fixture({row:testRow as never,child:{
  ...child,agent_id:"test",agent_did:"did:thesis:test-agent",
  permissions:[branchPermission]
 } as never,receipt:{
  ...receipt,agent_id:"test",agent_did:"did:thesis:test-agent"
 } as never});
 // Fake transport fixture only expects Backend; this verifies that a
 // Test report cannot be fabricated without correctly pinned Test Child.
 await assert.rejects(f.owner.dispatchIssuedTask(request()));
 assert.ok(f.calls.includes("private_bind"));
});

test("R326 report by itself cannot unlock Gateway dependency; independent observer required",async()=>{
 const f=fixture();
 await assert.rejects(
  f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /no matching previous A2A report/u
 );
 const report=await f.owner.dispatchIssuedTask(request());
 assert.equal(report.provider_completion_attested,false);
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 const result=await f.owner.attestIndependentGatewayCompletion(
  taskId,runtimeTaskId
 );
 assert.equal(result.status,"owner_gateway_completion_independently_observed");
 assert.equal(result.gateway_execution_authorized,false);
 assert.deepEqual(f.calls,[
  "private_bind","a2a_send","gateway_independent_observer"
 ]);
 await assert.rejects(f.owner.attestIndependentGatewayCompletion(
  taskId,runtimeTaskId),/repeated independent completion/u);
});
test("R326 forged Task ID cannot trigger the Gateway completion observer",async()=>{
 const f=fixture();
 await f.owner.dispatchIssuedTask(request());
 await assert.rejects(f.owner.attestIndependentGatewayCompletion(
  "r325-foreign",runtimeTaskId),/no matching previous A2A report/u);
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
});
test("R326 rejected A2A report never reaches independent Gateway observer",async()=>{
 const f=fixture({response:{card:{name:"Bad"},task:{
  ...goodResponse().task,status:{state:TaskState.TASK_STATE_FAILED}
 }}});
 await assert.rejects(f.owner.dispatchIssuedTask(request()));
 await assert.rejects(f.owner.attestIndependentGatewayCompletion(
  taskId,runtimeTaskId),/no matching previous A2A report/u);
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
});

test("R334 Test FAIL report never reaches independent Gateway success observer",async()=>{
 const branchPermission={resource:canonicalBranchUri(repo,branch),
  operation:"run_tests" as const};
 const testDid="did:thesis:test-agent";
 const testRow={...row,agent_id:"test",agent_did:testDid,
  permissions:[branchPermission]};
 const testChild={...child,agent_id:"test",agent_did:testDid,
  permissions:[branchPermission]};
 const testReceipt={...receipt,agent_id:"test",agent_did:testDid};
 const testSigned={...signed,credentialSubject:{
  sub:testDid,per:[branchPermission]
 }};
 const failedTestArtifact={
  ...artifact,role:"test",summary:"Runner returned a failing test result",
  files_modified:[],test_outcome:"fail"
 };
 const response={card:{name:"Test Agent"},task:{
  ...goodResponse().task,
  artifacts:[{parts:[{content:{$case:"data",value:failedTestArtifact}}]}]
 }};
 const f=fixture({row:testRow as never,child:testChild as never,
  receipt:testReceipt as never,signed:testSigned as never,
  root:{...root,root_permissions:[branchPermission]} as never,
  response});
 const report=await f.owner.dispatchIssuedTask(request());
 assert.equal(report.role,"test");
 assert.equal(report.artifact.test_outcome,"fail");
 assert.equal(report.provider_completion_attested,false);
 await assert.rejects(
  f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /nonpassing Test report needs independently verified D1 failure gate/u
 );
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 await assert.rejects(
  f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /nonpassing Test report needs independently verified D1 failure gate/u
 );
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
});


test("R385.12 Test read-only Child is not a Test PASS and needs independent Gateway evidence",async()=>{
 const projectTest="tests/backend/account.test.ts";
 const permission={resource:canonicalFileUri(repo,branch,projectTest),operation:"read_file"};
 const payload={...artifact,role:"test",summary:"Investigated approved application test",
  files_modified:[],files_created:[],test_outcome:"not_run",errors:[]};
 const response=goodResponse();
 response.task.artifacts[0]!.parts[0]!.content.value=payload;
 const patch={root:{...root,root_permissions:[permission]},
  row:{...row,agent_id:"test",permissions:[permission]},
  child:{...child,agent_id:"test",permissions:[permission]},
  receipt:{...receipt,agent_id:"test"},
  signed:{...signed,credentialSubject:{sub:did,per:[permission]}},
  response};
 const ok=fixture(patch as never);
 const report=await ok.owner.dispatchIssuedTask(request());
 assert.equal(report.role,"test");
 assert.equal(report.artifact.test_outcome,"not_run");
 assert.equal(report.provider_completion_attested,false);
 assert.deepEqual(ok.calls,["private_bind","a2a_send"]);
 await ok.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId);
 assert.deepEqual(ok.calls,["private_bind","a2a_send","gateway_independent_observer"]);
 await assert.rejects(ok.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /closed or repeated independent completion attestation/u);

 const missing=fixture({...patch,readComplete:false} as never);
 await missing.owner.dispatchIssuedTask(request());
 await assert.rejects(missing.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /missing independently verified project test read/u);
 assert.deepEqual(missing.calls,["private_bind","a2a_send","gateway_independent_observer"]);
 await assert.rejects(missing.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /closed or repeated independent completion attestation/u);
});

for(const mode of ["source-outside-tests","acceptance-source",
 "claims-runner-pass","claims-runner-fail","claims-write"]){
 test("R385.12 Test diagnostic rejects untrusted grant or claim: "+mode,async()=>{
  const projectTest=mode==="source-outside-tests"?"apps/backend/src/users/account.ts":
   mode==="acceptance-source"?"poc/runner/acceptance/account.test.ts":
   "tests/backend/account.test.ts";
  const permission={resource:canonicalFileUri(repo,branch,projectTest),operation:"read_file"};
  const payload={...artifact,role:"test",summary:"Read a signed application test",
   files_modified:mode==="claims-write"?[projectTest]:[],
   files_created:[],errors:[],
   test_outcome:mode==="claims-runner-pass"?"pass":
    mode==="claims-runner-fail"?"fail":"not_run"};
  const response=goodResponse();
  response.task.artifacts[0]!.parts[0]!.content.value=payload;
  const f=fixture({
   root:{...root,root_permissions:[permission]},
   row:{...row,agent_id:"test",permissions:[permission]},
   child:{...child,agent_id:"test",permissions:[permission]},
   receipt:{...receipt,agent_id:"test"},
   signed:{...signed,credentialSubject:{sub:did,per:[permission]}},
   response
  } as never);
  await assert.rejects(f.owner.dispatchIssuedTask(request()),
   mode==="source-outside-tests"||mode==="acceptance-source"?
    /Test read requires exact signed project test source/u:
    mode==="claims-write"?/signed Test investigation cannot claim writes or failures/u:
    /Signed Test preparation Artifact must report not_run/u);
  assert.deepEqual(f.calls,
   mode==="source-outside-tests"||mode==="acceptance-source"?[]:["private_bind","a2a_send"]);
 });
}

for(const mode of ["two-updates","foreign-read-with-update",
 "update-with-foreign-read","runner-with-spare-read"]){
 test("R383.1 original A2A owner denies a multi-effect Child before transport: "+mode,async()=>{
  const foreignPath="apps/backend/src/users/audit.ts";
  const foreignUpdate={resource:canonicalFileUri(repo,branch,foreignPath),
   operation:"update_file" as const};
  const foreignRead={resource:foreignUpdate.resource,
   operation:"read_file" as const};
  const read={resource:effect.resource,operation:"read_file" as const};
  const runner={resource:canonicalBranchUri(repo,branch),
   operation:"run_tests" as const};
  const perms=mode==="two-updates"?[effect,foreignUpdate]:
   mode==="foreign-read-with-update"?[foreignRead,effect]:
   mode==="update-with-foreign-read"?[effect,foreignRead]:[runner,read];
  const testRole=mode==="runner-with-spare-read";
  const patchedRow={...row,agent_id:testRole?"test":"backend",permissions:perms};
  const patchedChild={...child,agent_id:patchedRow.agent_id,permissions:perms};
  const f=fixture({
   root:{...root,root_permissions:perms},
   row:patchedRow,child:patchedChild,
   receipt:{...receipt,agent_id:patchedRow.agent_id},
   signed:{...signed,credentialSubject:{sub:did,per:perms}}
  } as never);
  const action=request();
  await assert.rejects(f.owner.dispatchIssuedTask(action),
   /cannot combine unrelated read\/write\/Runner grants|Task needs one native read, mutation or Runner effect|Test run cannot escape approved branch/u);
  assert.deepEqual(f.calls,[],
   "never bind remote private port or send the signed credential");
 });
}

test("R359.6 a signed mixed A2A report cannot bypass native two-effect finalization",async()=>{
 const read={...effect,operation:"read_file" as const};
 const permissions=[read,effect];
 const patch={root:{...root,root_permissions:permissions},
  row:{...row,permissions},child:{...child,permissions},
  signed:{...signed,credentialSubject:{sub:did,per:permissions}}
 };
 const f=fixture({...patch,mixedComplete:false} as never);
 const mixed={taskId,runtimeTaskId,instruction:"Read then update one approved file",
  effectStager:{stagedTool:"read_then_update" as const,
   async stage(){},async attest(){}}
 };
 const result=await f.owner.dispatchIssuedTask(mixed);
 assert.equal(result.provider_completion_attested,false);
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 await assert.rejects(f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /mixed Task not independently finalized/u);
 assert.deepEqual(f.calls,["private_bind","a2a_send","gateway_sequential_completion"]);
 await assert.rejects(f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /repeated independent completion/u);
 const ok=fixture(patch as never);
 await ok.owner.dispatchIssuedTask(mixed);
 const verified=await ok.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId);
 assert.equal(verified.status,"owner_gateway_completion_independently_observed");
 assert.deepEqual(ok.calls,["private_bind","a2a_send","gateway_sequential_completion"]);
 const wrong=fixture(patch as never);
 await assert.rejects(wrong.owner.dispatchIssuedTask(request()),
  /requires owner-controlled mixed staging/u);
 assert.deepEqual(wrong.calls,[]);
});

for(const mode of ["project-test","application-source","acceptance","claims-pass"]){
 test("R377.3 Test repair scope and independent completion: "+mode,async()=>{
  const path=mode==="application-source"?file:
   mode==="acceptance"?"poc/runner/acceptance/account.test.ts":"tests/backend/account.test.ts";
  const resource=canonicalFileUri(repo,branch,path);
  const permissions=[{resource,operation:"read_file"},{resource,operation:"update_file"}];
  const response=goodResponse();
  response.task.artifacts[0]!.parts[0]!.content.value={
   ...artifact,role:"test",files_modified:[path],
   test_outcome:mode==="claims-pass"?"pass":"not_run"
  };
  const f=fixture({
   root:{...root,root_permissions:permissions},
   row:{...row,agent_id:"test",permissions},
   child:{...child,agent_id:"test",permissions},
   receipt:{...receipt,agent_id:"test"},
   signed:{...signed,credentialSubject:{sub:did,per:permissions}},
   response
  } as never);
  const mixed={...request(),effectStager:{stagedTool:"read_then_update" as const,
   async stage(){},async attest(){}}};
  if(mode==="application-source"||mode==="acceptance"){
   await assert.rejects(f.owner.dispatchIssuedTask(mixed),/exact project test repair grant/u);
   assert.deepEqual(f.calls,[]);
  }else if(mode==="claims-pass"){
   await assert.rejects(f.owner.dispatchIssuedTask(mixed),/must report not_run/u);
  }else{
   const report=await f.owner.dispatchIssuedTask(mixed);
   assert.equal(report.artifact.test_outcome,"not_run");
   assert.equal(report.provider_completion_attested,false);
   await f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId);
   assert.deepEqual(f.calls,["private_bind","a2a_send","gateway_sequential_completion"]);
  }
 });
}

function nativeCreateFixture(role:"backend"|"test"="backend",projectTestSource=false){
 const createPath=projectTestSource?"tests/backend/account.test.ts":file;
 const create={...effect,resource:canonicalFileUri(repo,branch,createPath),
  operation:"create_file" as const};
 const agentDid=role==="backend"?did:"did:thesis:test-agent";
 const nativeRow={...row,agent_id:role,agent_did:agentDid,permissions:[create]};
 const nativeChild={...child,agent_id:role,agent_did:agentDid,permissions:[create]};
 const nativeSigned={...signed,credentialSubject:{sub:agentDid,per:[create]}};
 const nativeReceipt={...receipt,agent_id:role,agent_did:agentDid};
 const createdArtifact={...artifact,role,summary:"Created original signed source",
  files_modified:[],files_created:[createPath]};
 const response={card:{name:"Backend Agent"},task:{
  id:"a2a-task-r3841",
  status:{state:TaskState.TASK_STATE_COMPLETED},
  artifacts:[{parts:[{content:{$case:"data",value:createdArtifact}}]}]
 }};
 const f=fixture({root:{...root,root_permissions:[create]} as never,
  row:nativeRow as never,child:nativeChild as never,
  receipt:nativeReceipt as never,signed:nativeSigned as never,response});
 const writer=new GiteaClient({
  baseUrl:"http://gitea.local:3000",owner:"thesis",
  repository:"iam-console-poc",token:"disposable-owner-fixture",
  fetchFn:async()=>{throw Error("No Gitea calls during A2A owner admission");}
 });
 const preflight=new TrustedAuthorityOnlyGiteaCreatePreflight({
  admissions:f.gateway,giteaClient:writer,
  journal:new DurableAuthorityOnlyGiteaCreateIntentJournal(
   "/tmp/r3841-opaque-unused-intent"),
  repository:"thesis/iam-console-poc",branch
 });
 const port=new TrustedAuthorityOnlyCreateEffectStager({
  store:new InMemoryRequestStore(),admissions:f.gateway,
  preflight,giteaClient:writer,
  repository:"thesis/iam-console-poc",branch,
  planTaskId:taskId,runtimeTaskId,expectedHeadSha:"b".repeat(40)
 });
 // Preserve the fixture's live getter counters (object spread freezes them).
 return Object.assign(f,{port});
}
test("R384.1 A2A owner accepts exactly one branded native CREATE Child and sends an exact create hint",async()=>{
 const f=nativeCreateFixture();
 const result=await f.owner.dispatchIssuedTask({
  taskId,runtimeTaskId,instruction:"Create one approved Backend source",
  effectStager:f.port
 });
 assert.equal(result.status,"a2a_report_not_gateway_completed");
 assert.equal(result.provider_completion_attested,false);
 assert.deepEqual(result.artifact.files_created,[file]);
 assert.deepEqual(result.artifact.files_modified,[]);
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 assert.equal(f.takes,1);
 await assert.rejects(f.owner.dispatchIssuedTask({
  taskId,runtimeTaskId,instruction:"try again",
  effectStager:f.port
 }),/closed or malformed owner-selected Task/u);
 assert.equal(f.takes,1);
});
test("R384.1 A2A owner rejects a forged CREATE stager before any Child disclosure",async()=>{
 const f=nativeCreateFixture();
 await assert.rejects(f.owner.dispatchIssuedTask({
  taskId,runtimeTaskId,instruction:"create one file",
  effectStager:{stagedTool:"create_file",
   async stage(){throw Error("forged");}}
 }),/CREATE A2A requires one original branded owner/u);
 assert.deepEqual(f.calls,[]);
 assert.equal(f.takes,0);
});
test("R384.1 original A2A owner rejects Test role CREATE even when Task and Child appear signed",async()=>{
 const f=nativeCreateFixture("test");
 await assert.rejects(f.owner.dispatchIssuedTask({
  taskId,runtimeTaskId,instruction:"create forbidden app source",
  effectStager:f.port
 }),/Test CREATE requires one exact signed project-test source/u);
 assert.deepEqual(f.calls,[]);
 assert.equal(f.takes,0);
});

test("R389 Test CREATE is a signed test-source mutation, never a Runner PASS",async()=>{
 const f=nativeCreateFixture("test",true);
 const report=await f.owner.dispatchIssuedTask({
  taskId,runtimeTaskId,instruction:"Create only tests/backend/account.test.ts",
  effectStager:f.port
 });
 assert.equal(report.status,"a2a_report_not_gateway_completed");
 assert.equal(report.role,"test");
 assert.equal(report.artifact.test_outcome,"not_run");
 assert.deepEqual(report.artifact.files_created,["tests/backend/account.test.ts"]);
 assert.deepEqual(report.artifact.files_modified,[]);
 assert.equal(f.takes,1);
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 const observed=await f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId);
 assert.equal(observed.status,"owner_gateway_completion_independently_observed");
 assert.deepEqual(f.calls,["private_bind","a2a_send","gateway_independent_observer"]);
 await assert.rejects(f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId),
  /closed or repeated independent completion/u);
});

test("Owner-dispatched fourth read-only specialist binds one Child and reports without self-attesting",async()=>{
 const reviewerDid="did:thesis:reviewer-agent";
 const read={resource:canonicalFileUri(repo,branch,file),
  operation:"read_file" as const};
 const reviewerRow={...row,agent_id:"reviewer",agent_did:reviewerDid,
  card_ref:"trusted:reviewer",permissions:[read]};
 const reviewerChild={...child,agent_id:"reviewer",agent_did:reviewerDid,
  permissions:[read]};
 const reviewerReceipt={...receipt,agent_id:"reviewer",agent_did:reviewerDid};
 const reviewerSigned={...signed,credentialSubject:{
  ...signed.credentialSubject,sub:reviewerDid,per:[read]
 }};
 const reviewerArtifact={...artifact,role:"reviewer",files_modified:[],
  summary:"Read authorized source; no repository write",test_outcome:"not_run"};
 const response={card:{name:"Read-only Reviewer"},task:{
  ...goodResponse().task,artifacts:[{parts:[{content:{
   $case:"data",value:reviewerArtifact
  }}]}]
 }};
 const configured={extraRole:true,root:{...root,root_permissions:[read]},
  row:reviewerRow,child:reviewerChild,receipt:reviewerReceipt,
  signed:reviewerSigned,response};
 // A fourth URL without the same independent verified owner Card is not
 // executable, even with a locally signed Child.
 assert.throws(()=>fixture({...configured,verifiedExtra:false} as never),
  /additional specialist lacks exactly matching verified owner Card pins/u);
 const f=fixture(configured as never);
 const report=await f.owner.dispatchIssuedTask(request());
 assert.equal(report.role,"reviewer");
 assert.equal(report.status,"a2a_report_not_gateway_completed");
 assert.equal(report.provider_completion_attested,false);
 assert.deepEqual(report.artifact.files_modified,[]);
 assert.equal(report.artifact.test_outcome,"not_run");
 assert.deepEqual(f.calls,["private_bind","a2a_send"]);
 assert.equal(f.takes,1);
 await f.owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId);
 assert.deepEqual(f.calls,["private_bind","a2a_send","gateway_independent_observer"]);
 // A forged or stale role cannot borrow the reviewer URL, Child or grant.
 for(const mutation of [
  {row:{...reviewerRow,agent_did:"did:thesis:forged"}},
  {row:{...reviewerRow,permissions:[{...read,operation:"run_tests" as const}]}},
  {response:{...response,task:{...response.task,artifacts:[{parts:[{
   content:{$case:"data",value:{...reviewerArtifact,role:"backend"}}
  }]}]}}}
 ]){
  const denied=fixture({...configured,...mutation} as never);
  await assert.rejects(denied.owner.dispatchIssuedTask(request()));
  assert.equal(denied.calls.includes("gateway_independent_observer"),false);
 }
});
