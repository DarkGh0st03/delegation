import test from "node:test";
import assert from "node:assert/strict";
import {TrustedEffectStagingTaskRegistry} from
 "../src/trusted-effect-staging-task-registry.ts";
import {createAdkA2ATaskHandler} from "../src/adk-a2a-handler.ts";
import type {AgentTaskContext} from "../src/contracts.ts";

const runtime="dispatch_"+"A".repeat(22);
const path="apps/backend/src/users/account.ts";
const role="backend" as const,branch="feature/account-suspension";
const pins=()=>{
 const calls:string[]=[];
 return {calls,binding:{
  runtimeTaskId:runtime,planTaskId:"r320-backend",role,
  childCredentialId:"urn:r320:child:backend",
  presenterId:"did:thesis:backend-agent",
  branch,operation:"update_file" as const,path,
  effectStager:{async stage(requestId:string){
   calls.push(requestId);return {provider_write_authorized:false};
  }}
 }};
};
const context=():AgentTaskContext=>({
 task_id:"a2a-task-1",trusted_gateway_task_id:runtime,
 context_id:"a2a-context",role,
 subtask:{subtask_id:"r320-backend",
  instruction:"Update one approved file",branch,
  relevant_paths:[path],
  approved_file_permissions:[{path,operation:"update_file"}],
  approved_run_tests:false
 },
 delegation_evidence:{credential:"PRIVATE_CHILD_PAYLOAD",
  credential_id:"urn:r320:child:backend",
  presenter_id:"did:thesis:backend-agent"}
});
test("one owner-pinned Task selects the exact private stager once",async()=>{
 const f=pins(),registry=new TrustedEffectStagingTaskRegistry();
 registry.bindTask(f.binding);
 const stager=registry.selectFor(context());
 assert.deepEqual(await stager.stage("request-r320"),{provider_write_authorized:false});
 assert.deepEqual(f.calls,["request-r320"]);
 await assert.rejects(stager.stage("request-r320"),/already consumed or retired/u);
 registry.retireFor(runtime);
 assert.throws(()=>registry.selectFor(context()),/already dispatched/u);
});
test("a wrong or unbound A2A Task never gets owner effect access",async()=>{
 for(const patch of [
  {trusted_gateway_task_id:undefined},
  {trusted_gateway_task_id:"dispatch_"+"B".repeat(22)},
  {role:"frontend"},
  {subtask:{...context().subtask,subtask_id:"other-plan"}},
  {subtask:{...context().subtask,branch:"feature/foreign"}},
  {subtask:{...context().subtask,
    approved_file_permissions:[{path:"apps/backend/other.ts",operation:"update_file"}]}},
  {delegation_evidence:{...context().delegation_evidence,credential_id:"foreign-child"}},
  {delegation_evidence:{...context().delegation_evidence,presenter_id:"did:thesis:other-agent"}}
 ]){
  const f=pins(),registry=new TrustedEffectStagingTaskRegistry();
  registry.bindTask(f.binding);
  const forged={...context(),...patch} as AgentTaskContext;
  assert.throws(()=>registry.selectFor(forged),
   /Trusted ADK effect Task binding NO-GO/u);
  assert.deepEqual(f.calls,[]);
 }
});
test("wrong matching A2A candidate burns its slot and prevents retry",()=>{
 const f=pins(),registry=new TrustedEffectStagingTaskRegistry();
 registry.bindTask(f.binding);
 const forged={...context(),role:"frontend" as const};
 assert.throws(()=>registry.selectFor(forged),/differs from trusted owner/u);
 assert.throws(()=>registry.selectFor(context()),/already dispatched/u);
});
test("parallel owner prebindings never exchange Child or staging ports",async()=>{
 const f=pins(),registry=new TrustedEffectStagingTaskRegistry();
 const second={...pins().binding,
  runtimeTaskId:"dispatch_"+"B".repeat(22),
  planTaskId:"r320-frontend",role:"frontend" as const,
  presenterId:"did:thesis:frontend-agent",
  childCredentialId:"urn:r320:child:frontend",
  path:"apps/frontend/src/account.ts"};
 const called:string[]=[];second.effectStager={async stage(id:string){
  called.push(id);return {provider_write_authorized:false};
 }};
 registry.bindTask(f.binding);registry.bindTask(second);
 const backend=registry.selectFor(context());
 registry.retireFor(runtime);
 const frontendContext:AgentTaskContext={
  ...context(),trusted_gateway_task_id:second.runtimeTaskId,role:"frontend",
  subtask:{...context().subtask,subtask_id:second.planTaskId,
   relevant_paths:[second.path],approved_file_permissions:[
    {path:second.path,operation:"update_file"}]},
  delegation_evidence:{...context().delegation_evidence,
   credential_id:second.childCredentialId,presenter_id:second.presenterId}
 };
 const frontend=registry.selectFor(frontendContext);
 assert.deepEqual(await frontend.stage("frontend-request"),{provider_write_authorized:false});
 assert.deepEqual(called,["frontend-request"]);
 await assert.rejects(backend.stage("backend-request"),/retired/u);
 assert.deepEqual(f.calls,[]);
 registry.retireAll();
 await assert.rejects(frontend.stage("again"),/retired/u);
});
test("runner binding requires exact Test role, grant and no file path",async()=>{
 const f=pins(),registry=new TrustedEffectStagingTaskRegistry();
 const testPins={...f.binding,runtimeTaskId:"dispatch_"+"T".repeat(22),
  planTaskId:"r320-test",role:"test" as const,
  childCredentialId:"urn:r320:child:test",presenterId:"did:thesis:test-agent",
  operation:"run_tests" as const,path:undefined};
 registry.bindTask(testPins);
 const ctx={...context(),role:"test" as const,trusted_gateway_task_id:testPins.runtimeTaskId,
  subtask:{...context().subtask,subtask_id:testPins.planTaskId,
   approved_file_permissions:[],approved_run_tests:true},
  delegation_evidence:{...context().delegation_evidence,
   credential_id:testPins.childCredentialId,presenter_id:testPins.presenterId}
 };
 const port=registry.selectFor(ctx);
 await port.stage("test-request");
 assert.deepEqual(f.calls,["test-request"]);
});
test("duplicate Task/Child and invalid owner construction fail closed",()=>{
 const f=pins(),registry=new TrustedEffectStagingTaskRegistry();
 registry.bindTask(f.binding);
 assert.throws(()=>registry.bindTask(f.binding),/repeated Task/u);
 assert.throws(()=>registry.bindTask({...f.binding,
  runtimeTaskId:"dispatch_"+"X".repeat(22)}),/repeated Task/u);
 assert.throws(()=>new TrustedEffectStagingTaskRegistry().bindTask({
  ...f.binding,operation:"run_tests",role:"backend",path:undefined
 }),/run_tests must be an exact Test/u);
 assert.throws(()=>new TrustedEffectStagingTaskRegistry().bindTask({
  ...f.binding,path:"apps/backend-extra/../secret.ts"
 }),/canonical update path/u);
 registry.retireAll();
 assert.throws(()=>registry.bindTask({...f.binding,
  runtimeTaskId:"dispatch_"+"Y".repeat(22)}),/registry is retired/u);
});
test("ADK rejects stale unscoped owner-stager config at server assembly",()=>{
 assert.throws(()=>createAdkA2ATaskHandler({trustedEffectStager:{
  stage:async()=>{}
 }} as never),/unscoped_authority_only_effect_stager_retired/u);
 assert.throws(()=>createAdkA2ATaskHandler(
  ({trustedEffectTaskRegistry:{}} as never)
 ),/Invalid trusted effect Task registry/u);
});

test("R358 prebound read-only Task needs an exact signed file-read grant and burns its slot",async()=>{
 const f=pins();const registry=new TrustedEffectStagingTaskRegistry();
 const binding={...f.binding,operation:"read_file" as const};
 registry.bindTask(binding);
 const readContext:AgentTaskContext={...context(),subtask:{...context().subtask,
  approved_file_permissions:[{path,operation:"read_file"}]}};
 const port=registry.selectFor(readContext);
 assert.equal(port.stagedTool,"read_file");
 await port.stage("read-request");
 assert.deepEqual(f.calls,["read-request"]);
 await assert.rejects(port.stage("second-read"),/already consumed/u);
 const bad=new TrustedEffectStagingTaskRegistry();bad.bindTask(binding);
 assert.throws(()=>bad.selectFor(context()),/differs from trusted owner Task pins/u);
 assert.throws(()=>bad.selectFor(readContext),/already dispatched/u);
});

test("R359.5 mixed Task cannot stage update before native read attestation",async()=>{
 const f=pins(),calls:string[]=[];
 const reg=new TrustedEffectStagingTaskRegistry();
 reg.bindTask({...f.binding,operation:"read_then_update",
  effectStager:{stagedTool:"read_then_update",async stage(id){
   calls.push("stage:"+id);return {provider_write_authorized:false};
  },async attest(id,tool){calls.push("attest:"+tool+":"+id);}}
 });
 const contextMixed:AgentTaskContext={...context(),subtask:{...context().subtask,
  approved_file_permissions:[{path,operation:"read_file"},
   {path,operation:"update_file"}]}};
 const port=reg.selectFor(contextMixed);
 assert.equal(port.stagedTool,"read_then_update");
 await port.stage("read-r359");
 await assert.rejects(port.stage("write-too-early"),/out of sequence/u);
 await assert.rejects(port.attest!("foreign","read_file"),/cannot attest/u);
 await port.attest!("read-r359","read_file");
 await port.stage("update-r359");
 await port.attest!("update-r359","update_file");
 assert.deepEqual(calls,["stage:read-r359","attest:read_file:read-r359",
  "stage:update-r359","attest:update_file:update-r359"]);
 await assert.rejects(port.stage("third"),/out of sequence/u);
});
test("R359.5 mixed A2A cannot reuse a mismatched or enlarged operation grant",()=>{
 const f=pins(),reg=new TrustedEffectStagingTaskRegistry();
 reg.bindTask({...f.binding,operation:"read_then_update",
  effectStager:{stagedTool:"read_then_update",async stage(){},
   async attest(){}}
 });
 const forged:AgentTaskContext={...context(),subtask:{...context().subtask,
  approved_file_permissions:[{path,operation:"read_file"},
   {path:"apps/backend/other.ts",operation:"update_file"}]}};
 assert.throws(()=>reg.selectFor(forged),/differs from trusted owner/u);
 assert.throws(()=>reg.selectFor(context()),/already dispatched/u);
});

test("R377.3 Test repair binds one project test without Runner authority",()=>{
 const testPath="tests/frontend/account.test.tsx";
 const f=pins(),reg=new TrustedEffectStagingTaskRegistry();
 const binding={...f.binding,role:"test" as const,path:testPath,
  operation:"read_then_update" as const,
  effectStager:{stagedTool:"read_then_update" as const,async stage(){},async attest(){}}};
 assert.throws(()=>reg.bindTask({...binding,path:"poc/runner/acceptance/account.test.ts"}),
  /exact project test source/u);
 reg.bindTask(binding);
 const base=context();
 const repair:AgentTaskContext={...base,role:"test",subtask:{...base.subtask,
  relevant_paths:[testPath],approved_run_tests:false,
  approved_file_permissions:[{path:testPath,operation:"read_file"},
   {path:testPath,operation:"update_file"}]}};
 assert.equal(reg.selectFor(repair).stagedTool,"read_then_update");
 const invalid=new TrustedEffectStagingTaskRegistry();
 invalid.bindTask(binding);
 assert.throws(()=>invalid.selectFor({...repair,subtask:{...repair.subtask,approved_run_tests:true}}),
  /differs from trusted owner/u);
});

test("R383.8 signed CREATE Task requires exact file/role and one owner-private stage",async()=>{
 const f=pins(),registry=new TrustedEffectStagingTaskRegistry();
 const binding={...f.binding,operation:"create_file" as const,
  effectStager:{stagedTool:"create_file" as const,async stage(id:string){
   f.calls.push(id);return {provider_write_authorized:false};
  }}};
 registry.bindTask(binding);
 const ctx:AgentTaskContext={...context(),
  subtask:{...context().subtask,
   approved_file_permissions:[{path,operation:"create_file"}]}};
 const selected=registry.selectFor(ctx);
 assert.equal(selected.stagedTool,"create_file");
 assert.deepEqual(await selected.stage("create-3838"),
  {provider_write_authorized:false});
 await assert.rejects(selected.stage("create-3838"),/already consumed/u);
 assert.deepEqual(f.calls,["create-3838"]);
 const wrongPath=new TrustedEffectStagingTaskRegistry();
 wrongPath.bindTask(binding);
 assert.throws(()=>wrongPath.selectFor({
  ...ctx,subtask:{...ctx.subtask,
   relevant_paths:["apps/backend/src/other.ts"]}
 }),/differs from trusted owner Task/u);
 const wrongRole=new TrustedEffectStagingTaskRegistry();
 assert.throws(()=>wrongRole.bindTask({
  ...binding,role:"test"
 }),/one-shot effect port required/u);
 const missingStager=new TrustedEffectStagingTaskRegistry();
 assert.throws(()=>missingStager.bindTask({
  ...binding,effectStager:{async stage(){}}
 }),/one-shot effect port required/u);
});

test("R383.8 A2A CREATE extra grants, extra paths and Runner claim are not authority",()=>{
 const f=pins();
 const binding={...f.binding,operation:"create_file" as const,
  effectStager:{stagedTool:"create_file" as const,async stage(id:string){
   f.calls.push(id);return {provider_write_authorized:false};
  }}};
 const good:AgentTaskContext={...context(),
  subtask:{...context().subtask,
   approved_file_permissions:[{path,operation:"create_file"}]}};
 const forged=[
  {...good,subtask:{...good.subtask,approved_file_permissions:[
   {path,operation:"create_file"}, {path:"apps/backend/extra.ts",operation:"create_file"}]}},
  {...good,subtask:{...good.subtask,
   relevant_paths:[path,"apps/backend/extra.ts"]}},
  {...good,subtask:{...good.subtask,approved_run_tests:true}}
 ];
 for(const ctx of forged){
  const registry=new TrustedEffectStagingTaskRegistry();
  registry.bindTask(binding);
  assert.throws(()=>registry.selectFor(ctx as AgentTaskContext),
   /differs from trusted owner Task/u);
  assert.throws(()=>registry.selectFor(good),/already dispatched/u);
 }
 assert.deepEqual(f.calls,[]);
});
