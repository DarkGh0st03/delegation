/**
 * Phase W (W1, updated for W2): write-set Tasks in the REAL trusted
 * admissions (see fixtures/write-set-harness.ts). These tests drive the
 * admissions API directly; the Gateway Prepare/Execute path and the
 * executor are covered by write-set-gateway.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {setup,p,A,B,N1,N2,T,mixed,writesOf} from "./fixtures/write-set-harness.ts";
import {TrustedAuthorityOnlyWriteSetPreflight}
 from "../../../apps/gateway/src/trusted-authority-only-write-set-preflight.ts";

const BATCH="wbatch_w1";
async function staged(h:Awaited<ReturnType<typeof setup>>){
 await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
 await h.readAll([A,B]);
 const records=[h.prepare("create_file",N1,"export const n=1;\n"),
  h.prepare("update_file",B,"export const b=2;\n"),h.prepare("update_file",A,"export const a=2;\n")];
 await h.preflight.stageWriteSet(records,h.hash);
 const ws=await h.gate.stageTrustedWriteSet(h.preflight,records,BATCH);
 // Canonical order: A, B, N1.
 return {records,ordered:[records[2]!,records[1]!,records[0]!],ws};
}
function validateAll(h:Awaited<ReturnType<typeof setup>>,ordered:{consumed:boolean}[],digest:string){
 const vp=h.verified(writesOf(mixed));
 for(const r of ordered){r.consumed=true;h.gate.assertTrustedWriteSetItemBinding(r as never,vp as never,digest,BATCH);}
}

test("W1 end-to-end: reads, ONE write-set flight, ordered binding, single-use publication",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const begun=await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
  assert.deepEqual([begun.reads,begun.writes,begun.total_effects],[2,3,5]);
  await h.readAll([A,B]);
  const records=[h.prepare("create_file",N1,"n1\n"),h.prepare("update_file",B,"b2\n"),h.prepare("update_file",A,"a2\n")];
  const st=await h.preflight.stageWriteSet(records,h.hash);
  assert.deepEqual(st.intent.items.map(i=>[i.operation,i.path,i.old_path_absent_at_pinned_head]),
   [["update_file",A,false],["update_file",B,false],["create_file",N1,true]]);
  assert.ok(st.intent.items.slice(0,2).every(i=>/^[a-f0-9]{40}$/u.test(i.expected_blob_sha!)));
  const ws=await h.gate.stageTrustedWriteSet(h.preflight,records,BATCH);
  assert.equal(ws.first_sequence,3);assert.match(ws.write_set_digest,/^[a-f0-9]{64}$/u);
  await assert.rejects(h.gate.stageTrustedWriteSet(h.preflight,records,BATCH),/write-set lacks/u);
  const ordered=[records[2]!,records[1]!,records[0]!];
  const vp=h.verified(writesOf(mixed));
  for(const [i,r] of ordered.entries()){
   r.consumed=true;
   const b=h.gate.assertTrustedWriteSetItemBinding(r,vp as never,ws.write_set_digest,BATCH);
   assert.equal(b.sequence,3+i);assert.equal(b.validated_all,i===2);
  }
  h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest);
  assert.throws(()=>h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest),/once/u);
  assert.equal(h.gate.writeSetPhase("task-ws"),"publishing");
  h.gate.markTrustedWriteSetCasSent("task-ws","runtime-ws",ws.write_set_digest);
  assert.equal(h.gate.writeSetPhase("task-ws"),"cas_sent");
  await assert.rejects(h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws"),/incomplete/u);
  await assert.rejects(h.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws",ws.write_set_digest,h.wsObserver),
   /published write-set/u);
 }finally{await h.close();}
});

test("W1 binding: batch ID, order, presenter and exact VP scope; failures are terminal",async()=>{
 for(const fault of ["batch","order","presenter","partial_vp","digest","challenge"] as const){
  const h=await setup({permissions:mixed});
  try{
   await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
   await h.readAll([A,B]);
   const records=[h.prepare("update_file",A,"a2\n"),h.prepare("update_file",B,"b2\n"),
    fault==="challenge"?h.prepare("create_file",N1,"n1\n","other-challenge"):h.prepare("create_file",N1,"n1\n")];
   if(fault==="challenge"){
    await assert.rejects(h.preflight.stageWriteSet(records,h.hash),/does not match/u);continue;
   }
   await h.preflight.stageWriteSet(records,h.hash);
   const ws=await h.gate.stageTrustedWriteSet(h.preflight,records,BATCH);
   const vp=h.verified(writesOf(mixed));
   for(const r of records)r.consumed=true;
   const bind=(r:unknown,v:unknown,d=ws.write_set_digest,b=BATCH)=>
    h.gate.assertTrustedWriteSetItemBinding(r as never,v as never,d,b);
   if(fault==="digest"){assert.throws(()=>bind(records[0],vp,"0".repeat(64)),/no matching/u);continue;}
   if(fault==="batch")assert.throws(()=>bind(records[0],vp,ws.write_set_digest,"wbatch_other"),/another Gateway batch/u);
   if(fault==="order")assert.throws(()=>bind(records[1],vp),/out of order/u);
   if(fault==="presenter")assert.throws(()=>bind(records[0],{...vp,presenter_id:"did:thesis:frontend"}),/enrolled Child/u);
   if(fault==="partial_vp")assert.throws(()=>bind(records[0],{...vp,permissions:writesOf(mixed).slice(0,2)}),
    /exactly the signed writes/u);
   assert.equal(h.gate.writeSetPhase("task-ws"),"failed");
   assert.throws(()=>bind(records[0],vp),/not accepting/u);
   assert.throws(()=>h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",ws.write_set_digest),/validated/u);
   await assert.rejects(h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws"),/incomplete/u);
  }finally{await h.close();}
 }
});

test("W1/W2 state machine: before the CAS -> failed; after cas_sent only the publisher classifies",async()=>{
 for(const step of ["pre_cas","cas_sent_external","ambiguous","rejected"] as const){
  const h=await setup({permissions:mixed});
  try{
   const {ordered,ws}=await staged(h);
   validateAll(h,ordered,ws.write_set_digest);
   const d=ws.write_set_digest;
   h.gate.beginTrustedWriteSetPublication("task-ws","runtime-ws",d);
   if(step==="pre_cas"){
    assert.equal(h.gate.failTrustedWriteSet("task-ws","runtime-ws",d),"failed");
    assert.throws(()=>h.gate.markTrustedWriteSetCasSent("task-ws","runtime-ws",d),/no longer publishing/u);
   }else{
    h.gate.markTrustedWriteSetCasSent("task-ws","runtime-ws",d);
    // An external error/replay after the CAS request cannot classify it.
    assert.equal(h.gate.failTrustedWriteSet("task-ws","runtime-ws",d),"cas_sent");
    if(step==="ambiguous"){
     h.gate.recordTrustedWriteSetCasAmbiguous("task-ws","runtime-ws",d);
     assert.equal(h.gate.writeSetPhase("task-ws"),"ambiguous");
    }
    if(step==="rejected"){
     h.gate.recordTrustedWriteSetCasRejected("task-ws","runtime-ws",d);
     assert.equal(h.gate.writeSetPhase("task-ws"),"failed");
    }
    if(step==="cas_sent_external"){
     h.gate.recordTrustedWriteSetPublished("task-ws","runtime-ws",d,"c".repeat(40));
     assert.equal(h.gate.failTrustedWriteSet("task-ws","runtime-ws",d),"published");
     continue;
    }
   }
   assert.throws(()=>h.gate.recordTrustedWriteSetPublished("task-ws","runtime-ws",d,"c".repeat(40)),/not sent/u);
   await assert.rejects(h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws"),/incomplete/u);
  }finally{await h.close();}
 }
});

test("W1 create-only write-set (no reads); Test agent limited to project test sources",async()=>{
 const h=await setup({permissions:[p("create_file",N1),p("create_file",N2)]});
 try{
  const begun=await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
  assert.deepEqual([begun.reads,begun.writes],[0,2]);
  const records=[h.prepare("create_file",N2,"n2\n"),h.prepare("create_file",N1,"n1\n")];
  await h.preflight.stageWriteSet(records,h.hash);
  assert.equal((await h.gate.stageTrustedWriteSet(h.preflight,records,BATCH)).first_sequence,1);
 }finally{await h.close();}
 const t=await setup({agent:"test",permissions:[p("read_file",A),p("create_file",T),p("create_file",N1)]});
 try{
  await assert.rejects(t.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",t.hash),
   /exact native Child write-set/u);
 }finally{await t.close();}
});

test("W1 owner preflight: blob SHAs and absence only from owner Gitea reads",async()=>{
 for(const [label,files,content,pattern,moveHead] of [
  ["create of an existing file",{[N1]:"already\n"},undefined,/already exists/u,false],
  ["no-op update",{},"export const a=1;\n",/no-op update/u,false],
  ["HEAD moved during preflight",{},undefined,/HEAD changed/u,true]
 ] as const){
  const h=await setup({permissions:mixed,files:{[A]:"export const a=1;\n",[B]:"export const b=1;\n",...files}});
  try{
   await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
   await h.readAll([A,B]);
   const records=[h.prepare("update_file",A,content??"a2\n"),h.prepare("update_file",B,"b2\n"),
    h.prepare("create_file",N1,"n1\n")];
   if(moveHead){let moved=false;
    h.fake.onRequest=c=>{if(!moved&&c.startsWith("GET /contents")){moved=true;h.fake.advance("feature/sample-change");}};}
   await assert.rejects(h.preflight.stageWriteSet(records,h.hash),pattern,label);
   await assert.rejects(h.gate.stageTrustedWriteSet(h.preflight,records,BATCH),/no owner-reserved/u,label);
  }finally{await h.close();}
 }
});

test("W1 admission: exact signed set, attested reads first, genuine owner preflight; single-write paths refuse",async()=>{
 const h=await setup({permissions:mixed});
 try{
  await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
  const early=[h.prepare("update_file",A,"a2\n"),h.prepare("update_file",B,"b2\n"),h.prepare("create_file",N1,"n1\n")];
  assert.throws(()=>h.gate.assertTrustedWriteSetIntentBinding(early),/attested reads/u);
  await h.readAll([A,B]);
  assert.throws(()=>h.gate.assertTrustedWriteSetIntentBinding(early.slice(0,2)),/attested reads|signed write plan/u);
  const records=[h.prepare("update_file",A,"a2\n"),h.prepare("update_file",B,"b2\n"),h.prepare("create_file",N1,"n1\n")];
  await assert.rejects(h.gate.stageTrustedWriteSet(Object.create(TrustedAuthorityOnlyWriteSetPreflight.prototype),
   records,BATCH),/owner preflight/u);
  await assert.rejects(h.gate.stageTrustedSequentialMutationEffect(records[0]!),/update preflight has no exact signed Task/u);
  assert.throws(()=>h.gate.assertTrustedGiteaUpdateIntentBinding(records[0]!),/update preflight has no exact signed Task/u);
  assert.throws(()=>h.gate.assertTrustedGiteaCreateIntentBinding(records[2]!),/create preflight lacks original single-effect/u);
  await h.preflight.stageWriteSet(records,h.hash);
  await assert.rejects(h.gate.stageTrustedWriteSet(h.preflight,records,"bad batch id"),/batch ID/u);
  await h.gate.stageTrustedWriteSet(h.preflight,records,BATCH);
  await assert.rejects(h.gate.stageTrustedSequentialReadEffect(h.prepare("read_file",A)),/sequential read lacks trusted/u);
 }finally{await h.close();}
});

test("W1 disabled (default) or single-write grant: the write-set path is never available",async()=>{
 const off=await setup({permissions:mixed,batchWrites:false});
 try{
  assert.equal(off.gate.batchWritesEnabled,false);
  await assert.rejects(off.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",off.hash),/not enabled/u);
  assert.throws(()=>off.prepareBatch([{path:A,operation:"update_file",content:"a2\n"},
   {path:N1,operation:"create_file",content:"n\n"}]),/batch writes enabled/u);
 }finally{await off.close();}
 const single=await setup({permissions:[p("read_file",A),p("update_file",A)]});
 try{
  await assert.rejects(single.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",single.hash),/write-set grant/u);
  const base=await single.gate.beginTrustedSequentialReadUpdateTask("task-ws","runtime-ws",single.hash);
  assert.equal(base.write_operation,"update_file");
 }finally{await single.close();}
});
