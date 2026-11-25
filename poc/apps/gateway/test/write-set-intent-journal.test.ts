/** Phase W (W1): write-set intent journal limits and single reservation. */
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DurableAuthorityOnlyWriteSetIntentJournal,validateWriteSetIntent,MAX_WRITE_SET_BYTES}
 from "../src/trusted-authority-only-write-set-intent-journal.ts";

const F="gitea://gitea.local/thesis/app/branches/feature%2Fx/files/";
const item=(i:number,op:"update_file"|"create_file",bytes=10)=>({sequence:3+i,operation:op,
 path:`src/f${i}.ts`,resource:F+`src/f${i}.ts`,request_id:`req-${i}`,request_fingerprint:String(i).repeat(64),
 expected_blob_sha:op==="update_file"?"b".repeat(40):null,
 old_path_absent_at_pinned_head:op==="create_file",
 previous_content_sha256:op==="update_file"?"c".repeat(64):null,
 next_content_sha256:"d".repeat(64),next_content_bytes:bytes});
const intent=(items:ReturnType<typeof item>[])=>({schema:"authority-only-gitea-write-set-intent-v1" as const,
 session_id:"s",authority_digest:"a".repeat(64),root_credential_id:"urn:root",task_id:"t",
 runtime_task_id:"rt",epoch:1,agent_did:"did:thesis:backend",credential_id:"urn:child",
 repository:"thesis/app",branch:"feature/x",expected_head_sha:"e".repeat(40),challenge:"ch",
 items,total_content_bytes:items.reduce((a,i)=>a+i.next_content_bytes,0),prepared_at_ms:1,
 provider_write_authorized:false as const});

test("write-set intent: 2..8 items, canonical order, aggregate <= 4 MB, owner-observed facts only",()=>{
 validateWriteSetIntent(intent([item(0,"update_file"),item(1,"create_file")]));
 const bad:[string,unknown][]=[
  ["one item",intent([item(0,"update_file")])],
  ["nine items",intent(Array.from({length:9},(_,i)=>item(i,"create_file")))],
  ["unsorted",intent([{...item(1,"create_file"),sequence:3},{...item(0,"update_file"),sequence:4}])],
  ["aggregate over 4 MB",intent([item(0,"create_file",2_000_000),item(1,"create_file",2_000_000),
    {...item(2,"create_file",1)}])],
  ["update without blob",intent([{...item(0,"update_file"),expected_blob_sha:null},item(1,"create_file")])],
  ["create claiming a blob",intent([item(0,"update_file"),{...item(1,"create_file"),expected_blob_sha:"b".repeat(40)}])],
  ["no-op update",intent([{...item(0,"update_file"),previous_content_sha256:"d".repeat(64)},item(1,"create_file")])],
  ["file over 2 MB",intent([item(0,"create_file",2_000_001),item(1,"create_file")])],
  ["authorizes writes",{...intent([item(0,"update_file"),item(1,"create_file")]),provider_write_authorized:true}],
  ["wrong total",{...intent([item(0,"update_file"),item(1,"create_file")]),total_content_bytes:1}]
 ];
 for(const [label,x] of bad)assert.throws(()=>validateWriteSetIntent(x as never),undefined,label);
 assert.equal(MAX_WRITE_SET_BYTES,4_000_000);
});

test("write-set intent journal: at most ONE reservation per Task, read back validated",async()=>{
 const root=await mkdtemp(join(tmpdir(),"w1-intent-"));
 const dir=join(root,"p");await mkdir(dir,{mode:0o700});
 try{
  const j=new DurableAuthorityOnlyWriteSetIntentJournal(dir);
  const x=intent([item(0,"update_file"),item(1,"create_file")]);
  await j.reserve(x);
  await assert.rejects(j.reserve(x),/EEXIST/u);
  assert.deepEqual(await j.read("s","t"),x);
 }finally{await rm(root,{recursive:true,force:true});}
});
