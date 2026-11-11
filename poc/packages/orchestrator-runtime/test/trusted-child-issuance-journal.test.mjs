import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readdir,writeFile,chmod,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {TrustedChildIssuanceJournal}
  from "../src/trusted-child-issuance-journal.mjs";

const SHA="a".repeat(40),DIGEST="b".repeat(64);
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),"r5-child-intents-"));
  await chmod(directory,0o700);
  const pins={directory,sessionId:"original-session",
    baseRevision:SHA,planDigest:DIGEST,parentCredentialId:"urn:root:r5"};
  const journal=new TrustedChildIssuanceJournal(pins);
  const backend={taskId:"backend",role:"backend",
    credentialId:"urn:r5:child:backend",
    statusListCredential:"https://status.example/r5/children",
    statusListIndex:"1701"};
  return {directory,journal,pins,backend,
    close:()=>rm(directory,{recursive:true,force:true})};
}
test("R5 child pre-issuance intent is durable before network and a verified response adds only an ACK",async()=>{
 const f=await fixture();try{
  const result=await f.journal.recordIntent(f.backend);
  assert.equal(result.status,"pre_issuance_intent_durable");
  assert.equal((await f.journal.records())[0].observation,"issuance_uncertain");
  const files=await readdir(f.directory);
  assert.equal(files.length,1);
  assert.ok(files[0].endsWith(".intent.json"));
  const ack=await f.journal.recordVerifiedResponse({
    taskId:"backend",credentialId:f.backend.credentialId
  });
  assert.equal(ack.status,"adapter_response_verified_not_evm_attested");
  assert.equal((await f.journal.records())[0].observation,"adapter_response_verified");
  assert.equal((await readdir(f.directory)).length,2);
  await assert.rejects(f.journal.recordVerifiedResponse({
    taskId:"backend",credentialId:f.backend.credentialId
  }),/NO-GO/);
 }finally{await f.close();}
});
test("R5 crash/restart cannot erase a possibly issued child, duplicate or retry an uncertain request",async()=>{
 const f=await fixture();try{
  await f.journal.recordIntent(f.backend);
  const restarted=new TrustedChildIssuanceJournal(f.pins);
  assert.equal((await restarted.records())[0].observation,"issuance_uncertain");
  await assert.rejects(restarted.recordIntent(f.backend),/NO-GO/);
  await assert.rejects(restarted.recordIntent({...f.backend,taskId:"frontend",
    role:"frontend"}),/NO-GO/);
  await assert.rejects(restarted.recordVerifiedResponse({
    taskId:"backend",credentialId:"urn:wrong"
  }),/NO-GO/);
  assert.equal((await restarted.records())[0].observation,"issuance_uncertain");
 }finally{await f.close();}
});
test("R5 foreign root, malformed status entry and unprotected directory deny before writing",async()=>{
 const f=await fixture();try{
  assert.throws(()=>f.journal.assertBound({...f.pins,
    parentCredentialId:"urn:other"}),/NO-GO/);
  await assert.rejects(f.journal.recordIntent({...f.backend,
    statusListIndex:"x"}),/NO-GO/);
  await chmod(f.directory,0o755);
  await assert.rejects(f.journal.recordIntent(f.backend),/NO-GO/);
  assert.deepEqual(await readdir(f.directory),[]);
 }finally{await f.close();}
});
test("R5 manipulated, incomplete and orphaned journal records never become signed issuance proof",async()=>{
 const f=await fixture();try{
  await f.journal.recordIntent(f.backend);
  const [name]=await readdir(f.directory);
  const record={schema:"r5-child-issuance-response-v1",task_id:"backend",
    credential_id:f.backend.credentialId,intent_sha256:"c".repeat(64)};
  const ack=join(f.directory,name.replace(".intent.json",".ack.json"));
  await writeFile(ack,JSON.stringify(record),{mode:0o600});
  await assert.rejects(f.journal.records(),/NO-GO/);
  await rm(join(f.directory,name));
  await assert.rejects(f.journal.records(),/NO-GO/);
 }finally{await f.close();}
});
