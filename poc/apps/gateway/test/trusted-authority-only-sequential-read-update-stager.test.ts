import test from "node:test";
import assert from "node:assert/strict";
import {InMemoryRequestStore} from "../src/prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions as Admissions}
 from "../src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight as Mutation}
 from "../src/trusted-authority-only-mutation-preflight.ts";
import {AuthenticatedGiteaMutationCompletionObserver as Observer}
 from "../src/trusted-authority-only-gitea-mutation-evidence.ts";
import {TrustedAuthorityOnlySequentialReadUpdateStager as Stager}
 from "../src/trusted-authority-only-sequential-read-update-stager.ts";

// Deliberately mocked ordering contract. These are NOT native-provider proofs.
const head="a".repeat(40),path="apps/backend/src/account.ts";
const runtime="dispatch_"+"A".repeat(22),task="r359-backend";
async function fixture(){
 const calls:string[]=[];
 const store=new InMemoryRequestStore();
 for(const [requestId,tool] of [["read","read_file"],["update","update_file"]] as const)
  store.put({request_id:requestId,task_id:runtime,
   request:{tool,arguments:{branch:"feature/account-suspension",path,
    ...(tool==="update_file"?{content:"const a=true;"}:{})}},
   pinned_revision:head,consumed:false,expires_at_ms:Date.now()+60_000} as never);
 const admissions=Object.assign(Object.create(Admissions.prototype),{
  async beginTrustedSequentialReadUpdateTask(){calls.push("begin");return {
   status:"sequential_read_update_manifest_reserved_staged",
   task_id:task,total_effects:2,gateway_execution_authorized:false};},
  async stageTrustedSequentialReadEffect(){calls.push("stage_read");return {
   status:"sequential_read_effect_reserved_staged",sequence:1,
   task_id:task,gateway_execution_authorized:false};},
  async attestTrustedSequentialReadEffect(){calls.push("attest_read");return {
   status:"sequential_read_effect_attested_staged",sequence:1,
   task_id:task,gateway_execution_authorized:false};},
  fenceTrustedSequentialTaskBeforeWrite(taskId:string,runtimeTaskId:string){
   calls.push("fence");
   return {status:"sequential_task_fenced_before_write",task_id:taskId,runtime_task_id:runtimeTaskId,
    read_revision:head,read_evidence_sha256:"b".repeat(64),
    gateway_task_completed:false,recovery_authorized:false};
  },
  async stageTrustedSequentialMutationEffect(){calls.push("stage_update");return {
   status:"sequential_mutation_effect_reserved_staged",sequence:2,
   task_id:task,gateway_execution_authorized:false};},
  async attestTrustedSequentialMutationEffect(){calls.push("attest_update");return {
   status:"sequential_mutation_effect_attested_staged",sequence:2,
   task_id:task,gateway_execution_authorized:false};},
  async finalizeTrustedSequentialReadTask(){calls.push("finalize");return {
   status:"sequential_read_task_complete_staged",total_effects:2,
   task_id:task,gateway_execution_authorized:false};}
 }) as Admissions;
 const mutation=Object.assign(Object.create(Mutation.prototype),{
  isForAdmissions:(gate:unknown)=>gate===admissions,
  async stageUpdate(){calls.push("cas_preflight");return {
   status:"gitea_update_intent_reserved_without_execution",provider_write_authorized:false};}
 }) as Mutation;
 const observer=Object.assign(Object.create(Observer.prototype),{
  toTrustedObserver:()=>({})
 }) as Observer;
 const stager=await Stager.begin({store,admissions,mutation,
  mutationObserver:observer,planTaskId:task,
  runtimeTaskId:runtime,expectedHeadSha:head});
 return {calls,store,stager};
}
test("R359.4 owner must attest the first read before any CAS preflight",async()=>{
 const f=await fixture();
 await assert.rejects(f.stager.stage("update"),/must precede the update/u);
 assert.deepEqual(f.calls,["begin"]);
 await assert.rejects(f.stager.stage("read"),/terminated owner effect/u);
});
test("R359.4 one source read, native update and final evidence follow exact order",async()=>{
 const f=await fixture();
 await f.stager.stage("read");
 await assert.rejects(f.stager.stage("update"),/out-of-order/u);
 await f.stager.attestRead("read");
 await f.stager.stage("update");
 await f.stager.attestMutation("update");
 assert.deepEqual(f.calls,["begin","stage_read","attest_read",
  "cas_preflight","stage_update","attest_update","finalize"]);
 await assert.rejects(f.stager.stage("read"),/terminated owner effect/u);
 await assert.rejects(f.stager.attestMutation("update"),/duplicate CAS result/u);
});
test("R359.4 a foreign source request cannot satisfy the first attestation",async()=>{
 const f=await fixture();await f.stager.stage("read");
 await assert.rejects(f.stager.attestRead("foreign"),/foreign or duplicate source/u);
 assert.deepEqual(f.calls,["begin","stage_read"]);
});
test("R359.4 changed pinned HEAD denies read before any trusted provider operation",async()=>{
 const f=await fixture();
 const changed=f.store.get("read")!;changed.pinned_revision="b".repeat(40);
 await assert.rejects(f.stager.stage("read"),/expected HEAD/u);
 changed.pinned_revision=head;
 await assert.rejects(f.stager.stage("read"),/terminated owner effect/u);
 assert.deepEqual(f.calls,["begin"]);
});
test("R359.4 update on a different file cannot use earlier read evidence",async()=>{
 const f=await fixture();await f.stager.stage("read");await f.stager.attestRead("read");
 const changed=f.store.get("update")!;changed.request.arguments.path="other.ts";
 await assert.rejects(f.stager.stage("update"),/independently read in this Task/u);
 assert.deepEqual(f.calls,["begin","stage_read","attest_read"]);
});

test("R359.7 a missing Gateway Prepare consumes the typed owner slot",async()=>{
 const f=await fixture();
 await assert.rejects(f.stager.stage("nonexistent"),/original Task, path or expected HEAD/u);
 await assert.rejects(f.stager.stage("read"),/terminated owner effect/u);
 assert.deepEqual(f.calls,["begin"]);
});

test("R377.7 owner fences an attested read without allowing a late update",async()=>{
 const f=await fixture();
 assert.throws(()=>f.stager.fenceBeforeWrite(),/independently attested read/u);
 await f.stager.stage("read");
 await f.stager.attestRead("read");
 const proof=f.stager.fenceBeforeWrite();
 assert.equal(proof.task_id,task);
 assert.equal(proof.runtime_task_id,runtime);
 assert.equal(proof.gateway_task_completed,false);
 assert.equal(proof.recovery_authorized,false);
 await assert.rejects(f.stager.stage("update"),/terminated owner effect/u);
 assert.throws(()=>f.stager.fenceBeforeWrite(),/no update attempt/u);
 assert.deepEqual(f.calls,["begin","stage_read","attest_read","fence"]);
});
test("R377.7 an in-flight write cannot be classified as a pre-write stop",async()=>{
 const f=await fixture();
 await f.stager.stage("read");
 await f.stager.attestRead("read");
 const update=f.stager.stage("update");
 assert.throws(()=>f.stager.fenceBeforeWrite(),/no update attempt/u);
 await update;
 assert.throws(()=>f.stager.fenceBeforeWrite(),/no update attempt/u);
 assert.deepEqual(f.calls,["begin","stage_read","attest_read","cas_preflight","stage_update"]);
});

test("R377.8 no-change signal binds the exact read request to the Gateway fence",async()=>{
 const f=await fixture();
 await f.stager.stage("read");
 await f.stager.attestRead("read");
 await assert.rejects(f.stager.reportNoChange("other"),/original read request/u);
 assert.equal(f.stager.getReportedNoChange(),undefined);
 await f.stager.reportNoChange("read");
 assert.equal(f.stager.getReportedNoChange()?.recovery_authorized,false);
 assert.equal(f.stager.getReportedNoChange()?.read_revision,head);
 await assert.rejects(f.stager.stage("update"),/terminated owner effect/u);
 assert.deepEqual(f.calls,["begin","stage_read","attest_read","fence"]);
});

// Signed Task: read a context file + read and update the edited file.
async function multiReadFixture(){
 const calls:string[]=[];
 const store=new InMemoryRequestStore();
 const context="packages/shared/src/account-status.ts";
 const put=(id:string,tool:"read_file"|"update_file",p:string)=>store.put({request_id:id,task_id:runtime,
  request:{tool,arguments:{branch:"feature/s-1",path:p,
   ...(tool==="update_file"?{content:"const a=true;"}:{})}},
  pinned_revision:head,consumed:false,expires_at_ms:Date.now()+60_000} as never);
 put("read-context","read_file",context);put("read-edited","read_file",path);
 put("read-again","read_file",context);put("update","update_file",path);
 put("update-context","update_file",context);
 let seq=0;
 const admissions=Object.assign(Object.create(Admissions.prototype),{
  async beginTrustedSequentialReadUpdateTask(){calls.push("begin");return {
   status:"sequential_read_update_manifest_reserved_staged",
   task_id:task,total_effects:3,gateway_execution_authorized:false};},
  async stageTrustedSequentialReadEffect(){calls.push("stage_read");return {
   status:"sequential_read_effect_reserved_staged",sequence:seq+1,
   task_id:task,gateway_execution_authorized:false};},
  async attestTrustedSequentialReadEffect(){calls.push("attest_read");seq++;return {
   status:"sequential_read_effect_attested_staged",sequence:seq,
   task_id:task,gateway_execution_authorized:false};},
  async stageTrustedSequentialMutationEffect(){calls.push("stage_update");return {
   status:"sequential_mutation_effect_reserved_staged",sequence:seq+1,
   task_id:task,gateway_execution_authorized:false};},
  async attestTrustedSequentialMutationEffect(){calls.push("attest_update");seq++;return {
   status:"sequential_mutation_effect_attested_staged",sequence:seq,
   task_id:task,gateway_execution_authorized:false};},
  async finalizeTrustedSequentialReadTask(){calls.push("finalize");return {
   status:"sequential_read_task_complete_staged",total_effects:3,
   task_id:task,gateway_execution_authorized:false};}
 }) as Admissions;
 const mutation=Object.assign(Object.create(Mutation.prototype),{
  isForAdmissions:(gate:unknown)=>gate===admissions,
  async stageUpdate(){calls.push("cas_preflight");return {
   status:"gitea_update_intent_reserved_without_execution",provider_write_authorized:false};}
 }) as Mutation;
 const observer=Object.assign(Object.create(Observer.prototype),{toTrustedObserver:()=>({})}) as Observer;
 const stager=await Stager.begin({store,admissions,mutation,mutationObserver:observer,
  planTaskId:task,runtimeTaskId:runtime,expectedHeadSha:head});
 return {calls,stager};
}
test("multi-read Task: every granted read once, in any order, then one CAS update",async()=>{
 const f=await multiReadFixture();
 await f.stager.stage("read-context");await f.stager.attestRead("read-context");
 // The update needs ALL granted reads first.
 await assert.rejects(f.stager.stage("update"),/must precede the update/u);
});
test("multi-read Task completes with context read, edited read, update",async()=>{
 const f=await multiReadFixture();
 await f.stager.stage("read-context");await f.stager.attestRead("read-context");
 await f.stager.stage("read-edited");await f.stager.attestRead("read-edited");
 await f.stager.stage("update");await f.stager.attestMutation("update");
 assert.deepEqual(f.calls,["begin","stage_read","attest_read","stage_read","attest_read",
  "cas_preflight","stage_update","attest_update","finalize"]);
});
test("multi-read Task refuses a repeated read of the same file",async()=>{
 const f=await multiReadFixture();
 await f.stager.stage("read-context");await f.stager.attestRead("read-context");
 await assert.rejects(f.stager.stage("read-again"),/read only once per Task/u);
});
test("multi-read Task refuses reads after all granted reads and a second write path",async()=>{
 const f=await multiReadFixture();
 await f.stager.stage("read-context");await f.stager.attestRead("read-context");
 await f.stager.stage("read-edited");await f.stager.attestRead("read-edited");
 // Stager allows only files read in this Task; the Gateway then requires the
 // signed update_file grant, which exists for the edited file only.
 await assert.rejects(f.stager.stage("read-again"),/independently read in this Task|out-of-order/u);
});
