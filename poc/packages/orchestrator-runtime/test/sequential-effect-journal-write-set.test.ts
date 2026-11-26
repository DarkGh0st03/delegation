/**
 * Phase W (W1): crash-durable write-set journal. One write-set flight per
 * Task, exact signed write plan, ordered and chained per-file evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DurableAuthorityOnlySequentialEffectJournal,isReadWriteSetPlan}
 from "../src/trusted-authority-only-sequential-effect-journal.ts";

const base={
 session_id:"w1-session",authority_digest:"a".repeat(64),
 root_credential_id:"urn:w1:root",task_id:"task-backend",
 runtime_task_id:"runtime-backend",epoch:1,credential_id:"urn:w1:child"
};
const F="gitea://gitea.local/thesis/app/branches/feature%2Fx/files/";
const writePlan=[
 {sequence:2,operation:"update_file" as const,resource:F+"src/a.ts"},
 {sequence:3,operation:"create_file" as const,resource:F+"src/n.ts"}
];
const manifest={...base,total_effects:3,
 effect_plan:["read_file","update_file","create_file"] as const,write_plan:writePlan};
const read={...base,total_effects:3,sequence:1,operation:"read_file" as const,
 previous_evidence_sha256:null,request_id:"req-read",request_fingerprint:"b".repeat(64)};
const readProof={...read,evidence_sha256:"c".repeat(64),completed_at_ms:1762340000000};
const items=[
 {sequence:2,operation:"update_file" as const,resource:F+"src/a.ts",request_id:"req-w1",request_fingerprint:"d".repeat(64)},
 {sequence:3,operation:"create_file" as const,resource:F+"src/n.ts",request_id:"req-w2",request_fingerprint:"e".repeat(64)}
];
const writeSet={...base,total_effects:3,first_sequence:2,
 previous_evidence_sha256:"c".repeat(64),write_set_digest:"f".repeat(64),items};
const ev=(i:number,prev:string,evidence:string)=>({...base,total_effects:3,
 sequence:items[i]!.sequence,operation:items[i]!.operation,
 previous_evidence_sha256:prev,request_id:items[i]!.request_id,
 request_fingerprint:items[i]!.request_fingerprint,evidence_sha256:evidence,
 completed_at_ms:1762340001000+i});

async function fixture(fn:(j:DurableAuthorityOnlySequentialEffectJournal,dir:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),"w1-journal-"));
 const directory=join(root,"protected");
 await mkdir(directory,{mode:0o700});
 try{await fn(new DurableAuthorityOnlySequentialEffectJournal(directory),directory);}
 finally{await rm(root,{recursive:true,force:true});}
}

test("write-set plan: R >= 0 reads then 2..8 writes, total <= 16",()=>{
 assert.ok(isReadWriteSetPlan(["read_file","update_file","create_file"],3));
 assert.ok(isReadWriteSetPlan(["create_file","create_file"],2));
 assert.ok(isReadWriteSetPlan([...Array(8).fill("read_file"),...Array(8).fill("update_file")],16));
 assert.equal(isReadWriteSetPlan(["read_file","update_file"],2),false);
 assert.equal(isReadWriteSetPlan(["update_file","read_file","create_file"],3),false);
 assert.equal(isReadWriteSetPlan(Array(9).fill("create_file"),9),false);
 assert.equal(isReadWriteSetPlan([...Array(9).fill("read_file"),...Array(8).fill("update_file")],17),false);
});

test("write-set: one durable flight, exact signed plan, ordered chained evidence, final",async()=>{
 await fixture(async j=>{
  await j.reserveManifest(manifest);
  // Reads first; a write cannot be reserved before them nor individually.
  await assert.rejects(j.reserveWriteSet(writeSet),/ENOENT|attested/u);
  await j.reserveEffect(read);
  await j.reserveEvidence(readProof);
  await assert.rejects(j.reserveEffect({...base,total_effects:3,sequence:2,
   operation:"update_file",previous_evidence_sha256:"c".repeat(64),
   request_id:"req-w1",request_fingerprint:"d".repeat(64)}),/individual flight/u);
  await j.reserveWriteSet(writeSet);
  // At most ONE write-set per Task (O_EXCL), even if identical.
  await assert.rejects(j.reserveWriteSet(writeSet),/EEXIST/u);
  // Evidence strictly in order and chained.
  await assert.rejects(j.reserveEvidence(ev(1,"9".repeat(64),"2".repeat(64))),/ENOENT|order/u);
  await assert.rejects(j.reserveEvidence(ev(0,"9".repeat(64),"1".repeat(64))),/order/u);
  await j.reserveEvidence(ev(0,"c".repeat(64),"1".repeat(64)));
  await assert.rejects(j.reserveEvidence(ev(1,"c".repeat(64),"2".repeat(64))),/order/u);
  await j.reserveEvidence(ev(1,"1".repeat(64),"2".repeat(64)));
  await j.reserveTaskFinal({...manifest,latest_evidence_sha256:"2".repeat(64)});
 });
});

test("write-set must equal the immutable signed write plan",async()=>{
 await fixture(async (j,dir)=>{
  await j.reserveManifest(manifest);
  await j.reserveEffect(read);await j.reserveEvidence(readProof);
  for(const [label,bad] of [
   ["swapped order",{...writeSet,items:[{...items[1]!,sequence:2},{...items[0]!,sequence:3}]}],
   ["foreign resource",{...writeSet,items:[{...items[0]!,resource:F+"src/x.ts"},items[1]!]}],
   ["other operation",{...writeSet,items:[{...items[0]!,operation:"create_file" as const},items[1]!]}],
   ["unchained",{...writeSet,previous_evidence_sha256:"9".repeat(64)}],
   ["duplicate request",{...writeSet,items:[items[0]!,{...items[1]!,request_id:"req-w1"}]}]
  ] as const){
   await assert.rejects(j.reserveWriteSet(bad as never),undefined,label);
  }
  assert.equal((await readdir(dir)).some(n=>n.endsWith(".writeset.json")),false);
 });
});

test("manifest validation: write_plan must be the canonical suffix of a write-set plan",async()=>{
 await fixture(async j=>{
  await assert.rejects(j.reserveManifest({...manifest,write_plan:[writePlan[1]!,writePlan[0]!]} as never),/invalid/u);
  await assert.rejects(j.reserveManifest({...manifest,effect_plan:["read_file","read_file","update_file"]} as never),/invalid/u);
  await assert.rejects(j.reserveManifest({...base,total_effects:2,
   effect_plan:["read_file","update_file"],write_plan:[writePlan[0]!]} as never),/invalid/u);
  // Baseline single-write manifests are unchanged.
  await j.reserveManifest({...base,task_id:"task-single",total_effects:2,effect_plan:["read_file","update_file"]});
 });
});

test("create-only write-set (no reads) starts the chain at sequence 1",async()=>{
 await fixture(async j=>{
  const plan=[{sequence:1,operation:"create_file" as const,resource:F+"src/m.ts"},
   {sequence:2,operation:"create_file" as const,resource:F+"src/n.ts"}];
  const m={...base,total_effects:2,effect_plan:["create_file","create_file"] as const,write_plan:plan};
  await j.reserveManifest(m);
  const ws={...base,total_effects:2,first_sequence:1,previous_evidence_sha256:null,
   write_set_digest:"f".repeat(64),items:plan.map((p,i)=>({...p,request_id:"c"+i,request_fingerprint:String(i).repeat(64)}))};
  await assert.rejects(j.reserveWriteSet({...ws,previous_evidence_sha256:"c".repeat(64)}),/invalid/u);
  await j.reserveWriteSet(ws);
  const e=(i:number,prev:string|null,evd:string)=>({...base,total_effects:2,sequence:i+1,
   operation:"create_file" as const,previous_evidence_sha256:prev,request_id:"c"+i,
   request_fingerprint:String(i).repeat(64),evidence_sha256:evd,completed_at_ms:1762340002000});
  await j.reserveEvidence(e(0,null,"1".repeat(64)));
  await j.reserveEvidence(e(1,"1".repeat(64),"2".repeat(64)));
  await j.reserveTaskFinal({...m,latest_evidence_sha256:"2".repeat(64)});
 });
});
