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
 await assert.rejects(f.stager.stage("update"),/first typed effect must read/u);
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
 await assert.rejects(f.stager.stage("update"),/exact independently read file/u);
 assert.deepEqual(f.calls,["begin","stage_read","attest_read"]);
});

test("R359.7 a missing Gateway Prepare consumes the typed owner slot",async()=>{
 const f=await fixture();
 await assert.rejects(f.stager.stage("nonexistent"),/original Task, path or expected HEAD/u);
 await assert.rejects(f.stager.stage("read"),/terminated owner effect/u);
 assert.deepEqual(f.calls,["begin"]);
});
