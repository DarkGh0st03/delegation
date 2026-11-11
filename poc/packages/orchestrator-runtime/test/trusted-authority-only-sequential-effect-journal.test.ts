import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,chmod,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DurableAuthorityOnlySequentialEffectJournal}
 from "../src/trusted-authority-only-sequential-effect-journal.ts";

const base={
 session_id:"r301-session",
 authority_digest:"a".repeat(64),
 root_credential_id:"urn:r301:root",
 task_id:"task-backend",
 runtime_task_id:"runtime-backend",
 epoch:1,
 credential_id:"urn:r301:child"
};
const first={
 ...base,total_effects:2,sequence:1,
 previous_evidence_sha256:null,
 request_id:"request-1",request_fingerprint:"b".repeat(64)
};
const second={
 ...base,total_effects:2,sequence:2,
 previous_evidence_sha256:"c".repeat(64),
 request_id:"request-2",request_fingerprint:"d".repeat(64)
};
const firstProof={...first,evidence_sha256:"c".repeat(64),
 completed_at_ms:1762340000000};
const secondProof={...second,evidence_sha256:"e".repeat(64),
 completed_at_ms:1762340001000};
const finish={...base,total_effects:2,
 latest_evidence_sha256:"e".repeat(64)};
async function fixture(fn:(v:{
 journal:DurableAuthorityOnlySequentialEffectJournal,
 directory:string
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),"r301-effect-"));
 const directory=join(root,"protected");
 try{
  await mkdir(directory,{mode:0o700});
  await fn({journal:new DurableAuthorityOnlySequentialEffectJournal(
   directory),directory});
 }finally{await rm(root,{recursive:true,force:true});}
}
test("R301 manifest pins a bounded task effect count and refuses reenrollment",async()=>{
 await fixture(async({journal})=>{
  await journal.reserveManifest({...base,total_effects:2});
  await assert.rejects(journal.reserveManifest({...base,total_effects:2}),
   /EEXIST/);
  await assert.rejects(journal.reserveManifest({...base,total_effects:33}),
   /invalid pinned Task manifest/);
  await assert.rejects(journal.reserveManifest({
   ...base,total_effects:2,agent_claim:"success"
  } as never),/invalid pinned Task manifest/);
 });
});
test("R301 effect 2 cannot start before independent evidence for effect 1",async()=>{
 await fixture(async({journal,directory})=>{
  await journal.reserveManifest({...base,total_effects:2});
  await journal.reserveEffect(first);
  await assert.rejects(journal.reserveEffect(second),/ENOENT/);
  await assert.rejects(journal.reserveTaskFinal(finish),/ENOENT/);
  await assert.rejects(journal.reserveEvidence({
   ...firstProof,credential_id:"urn:foreign:child"
  }),/recorded Task manifest|does not match original/);
  await journal.reserveEvidence(firstProof);
  await assert.rejects(journal.reserveEffect({
   ...second,previous_evidence_sha256:"f".repeat(64)
  }),/previous effect not independently attested/);
  await journal.reserveEffect(second);
  await journal.reserveEvidence(secondProof);
  await journal.reserveTaskFinal(finish);
  await assert.rejects(journal.reserveTaskFinal(finish),/EEXIST/);
  await assert.rejects(journal.reserveEffect(second),/EEXIST/);
  // No unsafe journal directory deletion/reconstruction as a recovery.
  assert.ok(directory.endsWith("protected"));
 });
});
test("R301 foreign authority/Child/task/request cannot replace a durable effect flight",async()=>{
 await fixture(async({journal})=>{
  await journal.reserveManifest({...base,total_effects:2});
  await journal.reserveEffect(first);
  for(const bad of [
   {...firstProof,root_credential_id:"urn:foreign:root"},
   {...firstProof,credential_id:"urn:foreign:child"},
   {...firstProof,request_id:"request-injected"},
   {...firstProof,request_fingerprint:"f".repeat(64)},
   {...firstProof,epoch:2},
   {...firstProof,task_id:"other-task"}
  ]){
   await assert.rejects(journal.reserveEvidence(bad),/not match|ENOENT/);
  }
 });
});
test("R301 ambiguous first flight survives restart, cannot advance or redo",async()=>{
 await fixture(async({journal,directory})=>{
  await journal.reserveManifest({...base,total_effects:2});
  await journal.reserveEffect(first);
  const restart=new DurableAuthorityOnlySequentialEffectJournal(directory);
  await assert.rejects(restart.reserveEffect(first),/EEXIST/);
  await assert.rejects(restart.reserveEffect(second),/ENOENT/);
  await assert.rejects(restart.reserveTaskFinal(finish),/ENOENT/);
 });
});
test("R301 simultaneous duplicate sequence reservation accepts exactly one",async()=>{
 await fixture(async({journal,directory})=>{
  await journal.reserveManifest({...base,total_effects:2});
  const other=new DurableAuthorityOnlySequentialEffectJournal(directory);
  const outcomes=await Promise.allSettled([
   journal.reserveEffect(first),other.reserveEffect(first)
  ]);
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
 });
});
test("R301 journal rejects shared, symlinked, malformed or untrusted stores",async()=>{
 await fixture(async({journal,directory})=>{
  await chmod(directory,0o755);
  await assert.rejects(journal.reserveManifest({...base,total_effects:2}),
   /unsafe Task effect journal directory/);
  await chmod(directory,0o700);
  await journal.reserveManifest({...base,total_effects:2});
  const symlinkName=join(directory,"other");
  await writeFile(join(directory,"real"),"x",{mode:0o600});
  await symlink(join(directory,"real"),symlinkName);
  await assert.rejects(journal.reserveEffect({
   ...first,previous_evidence_sha256:"f".repeat(64)
  }),/invalid immutable effect sequence/);
 });
});

test("R359 immutable typed read-then-update manifest rejects reversed or untyped effects",async()=>{
 await fixture(async({journal})=>{
  const typed={...base,total_effects:2,effect_plan:["read_file","update_file"] as const};
  await journal.reserveManifest(typed);
  await assert.rejects(journal.reserveEffect(first),/immutable read-then-update manifest/u);
  await assert.rejects(journal.reserveEffect({...first,operation:"update_file"}),
   /immutable read-then-update manifest/u);
  await journal.reserveEffect({...first,operation:"read_file"});
  await assert.rejects(journal.reserveEffect({...second,operation:"update_file"}),/ENOENT/u);
  await journal.reserveEvidence({...firstProof,operation:"read_file"});
  await assert.rejects(journal.reserveEffect({...second,operation:"read_file"}),
   /immutable read-then-update manifest/u);
  await journal.reserveEffect({...second,operation:"update_file"});
  await assert.rejects(journal.reserveEvidence({...secondProof,operation:"read_file"}),
   /typed evidence operation differs from manifest/u);
  await journal.reserveEvidence({...secondProof,operation:"update_file"});
  await journal.reserveTaskFinal({...finish,effect_plan:typed.effect_plan});
  await assert.rejects(journal.reserveTaskFinal({...finish,effect_plan:typed.effect_plan}),/EEXIST/u);
 });
});
test("R359 typed operation cannot be added to an old read-only Task after approval",async()=>{
 await fixture(async({journal})=>{
  await journal.reserveManifest({...base,total_effects:2});
  await assert.rejects(journal.reserveEffect({...first,operation:"read_file"}),
   /legacy read-only manifest cannot accept typed mutation/u);
  await journal.reserveEffect(first);
  await assert.rejects(journal.reserveEvidence({...firstProof,operation:"read_file"}),
   /untyped read-only evidence cannot claim mutation/u);
  await journal.reserveEvidence(firstProof);
 });
});
test("R359 typed manifests cannot be silently swapped or widened at finalization",async()=>{
 await fixture(async({journal})=>{
  const typed={...base,total_effects:2,effect_plan:["read_file","update_file"] as const};
  await journal.reserveManifest(typed);
  await assert.rejects(journal.reserveManifest({...typed,total_effects:3}),
   /invalid pinned Task manifest/u);
  await assert.rejects(journal.reserveEffect({...first,operation:"read_file",
   total_effects:3}),/recorded Task manifest/u);
  await journal.reserveEffect({...first,operation:"read_file"});
  await journal.reserveEvidence({...firstProof,operation:"read_file"});
  await journal.reserveEffect({...second,operation:"update_file"});
  await journal.reserveEvidence({...secondProof,operation:"update_file"});
  await assert.rejects(journal.reserveTaskFinal(finish),
   /recorded Task manifest does not match/u);
  await journal.reserveTaskFinal({...finish,effect_plan:typed.effect_plan});
 });
});
