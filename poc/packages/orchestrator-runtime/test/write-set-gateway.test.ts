/**
 * Phase W (W2): the write-set through the REAL Gateway Prepare/Execute,
 * admissions, owner preflight, write-set executor (ChangeFiles + HEAD-CAS)
 * and per-file evidence, over an in-memory Gitea (fixtures). Only the native
 * Rust VP verifier and OPA are fixtures (see fixtures/write-set-harness.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {setup,A,B,N1,mixed} from "./fixtures/write-set-harness.ts";
import {GiteaClient,WRITE_SET_STAGING_PREFIX} from "../../../apps/gateway/src/gitea-client.ts";
import {ProviderConflictError} from "../../../apps/gateway/src/errors.ts";
import {TrustedAuthorityOnlyWriteSetPreflight}
 from "../../../apps/gateway/src/trusted-authority-only-write-set-preflight.ts";

const WORK="feature/sample-change";
const changes=[{path:N1,operation:"create_file",content:"export const n=1;\n"},
 {path:B,operation:"update_file",content:"export const b=2;\n"},
 {path:A,operation:"update_file",content:"export const a=2;\n"}];
type H=Awaited<ReturnType<typeof setup>>;
async function prepared(h:H){
 await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
 await h.readAll([A,B]);
 const batch=h.prepareBatch(changes);
 await h.stageBatch(batch.batch_id);
 return batch;
}
const code=(c:string)=>(e:unknown)=>(e as {code?:string}).code===c;
const casCalls=(h:H)=>h.fake.calls.filter(c=>c.startsWith("PUT /branches/feature%2Fsample-change")).length;

test("W2 strict: one VP, items validated in canonical order, ONE commit, ONE CAS, second verification",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const batch=await prepared(h);
  assert.deepEqual(batch.items.map(i=>i.path),[A,B,N1]);
  const out=[];
  for(const item of batch.items.slice(0,2))out.push(await h.execute(item.request_id));
  assert.deepEqual(out.map(o=>(o.execution as {performed:boolean}).performed),[false,false]);
  assert.equal(h.fake.head(WORK),h.hash);  // nothing visible before the last item
  assert.equal(casCalls(h),0);
  out.push(await h.execute(batch.items[2]!.request_id));
  const pub=out[2]!.execution as unknown as {commit_sha:string;reverified:boolean;write_set_digest:string};
  assert.equal(pub.reverified,true);
  assert.equal(h.verifier.calls,2);          // first Execute + strict re-verification
  assert.equal(casCalls(h),1);
  assert.equal(h.fake.head(WORK),pub.commit_sha);
  const changed=await h.client().getCommitChanges(pub.commit_sha);
  assert.deepEqual(changed.parents,[h.hash]);
  assert.deepEqual(changed.files.map(f=>`${f.filename}:${f.status}`).sort(),
   [`${A}:modified`,`${B}:modified`,`${N1}:added`]);
  assert.equal(h.fake.fileAt(pub.commit_sha,A)!.content,"export const a=2;\n");
  // Private staging ref removed after success.
  assert.equal([...h.fake.branches.keys()].some(b=>b.startsWith(WRITE_SET_STAGING_PREFIX)),false);
  const events=h.audit.events.filter(e=>e.event==="authorization_executed");
  assert.deepEqual(events.map(e=>(e as {batch_verification?:string}).batch_verification),["performed","reused","reused"]);
  assert.ok(events.every(e=>(e as {write_batch_id?:string}).write_batch_id===batch.batch_id));
  assert.equal(events.every(e=>e.decision==="allow"),true);
  // Per-file evidence in order, bound to commit + digest; then the Task is final.
  for(let i=0;i<3;i++)
   await h.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws",pub.write_set_digest,h.wsObserver);
  assert.equal((await h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws")).total_effects,5);
 }finally{await h.close();}
});

test("W2 standard mode (experimental variant): a single verification, same publication",async()=>{
 const h=await setup({permissions:mixed,strict:false});
 try{
  const batch=await prepared(h);
  let last;for(const item of batch.items)last=await h.execute(item.request_id);
  assert.equal(h.verifier.calls,1);
  assert.equal((last!.execution as unknown as {reverified:boolean}).reverified,false);
 }finally{await h.close();}
});

test("W2 revocation between staging and publication: second verification fails, NO CAS, failed",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const batch=await prepared(h);
  h.verifier.revokeAfter=1;                  // revoked after the first (batch) verification
  await h.execute(batch.items[0]!.request_id);
  await h.execute(batch.items[1]!.request_id);
  await assert.rejects(h.execute(batch.items[2]!.request_id));
  assert.equal(casCalls(h),0);
  assert.equal(h.fake.head(WORK),h.hash);
  assert.equal(h.gate.writeSetPhase("task-ws"),"failed");
 }finally{await h.close();}
});

test("W2 certain rejection: HEAD moved right before the CAS -> 422, reread, failed, nothing published",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const batch=await prepared(h);
  let advanced="";
  h.fake.beforeCas=()=>{if(!advanced)advanced=h.fake.advance(WORK);};
  await h.execute(batch.items[0]!.request_id);await h.execute(batch.items[1]!.request_id);
  await assert.rejects(h.execute(batch.items[2]!.request_id),code("provider_conflict"));
  assert.equal(casCalls(h),1);
  assert.equal(h.fake.head(WORK),advanced);
  assert.equal(h.gate.writeSetPhase("task-ws"),"failed");
 }finally{await h.close();}
});

test("W2 CAS with stale old_commit_id is rejected even when the candidate descends from the current HEAD",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const c=h.client();
  const h1=h.fake.advance(WORK,"x.txt","1\n");
  // Candidate built on the CURRENT head (fast-forward possible), old id stale.
  const cand=await c.stageWriteSetCommit({branch:"feature/w2-write-set-"+"1".repeat(28),
   expectedHeadSha:h1,stagingBranch:"feature/w2-write-set-"+"1".repeat(28),message:"m",
   files:[{operation:"create_file",path:"y.txt",content:"y\n",expectedBlobSha:null},
    {operation:"create_file",path:"z.txt",content:"z\n",expectedBlobSha:null}]})
   .catch(e=>e);
  assert.ok(cand instanceof ProviderConflictError);   // the private ref is never a work branch
  const staged=await c.stageWriteSetCommit({branch:WORK,expectedHeadSha:h1,
   stagingBranch:"feature/w2-write-set-"+"2".repeat(28),message:"m",
   files:[{operation:"create_file",path:"y.txt",content:"y\n",expectedBlobSha:null},
    {operation:"create_file",path:"z.txt",content:"z\n",expectedBlobSha:null}]});
  assert.equal(await c.casBranchToCommit(WORK,h.hash,staged.commit_sha),"rejected");
  assert.equal(h.fake.head(WORK),h1);
 }finally{await h.close();}
});

for(const mode of ["lost_after_apply","lost_before_apply","error500","reread_fails"] as const){
 test(`W2 ambiguous CAS outcome (${mode}): ambiguous, never retried, never failed, Task not finalizable`,async()=>{
  const h=await setup({permissions:mixed});
  try{
   const batch=await prepared(h);
   h.fake.casMode=mode;
   await h.execute(batch.items[0]!.request_id);await h.execute(batch.items[1]!.request_id);
   await assert.rejects(h.execute(batch.items[2]!.request_id),code("provider_unavailable"));
   assert.equal(casCalls(h),1);                       // no retry
   assert.equal(h.gate.writeSetPhase("task-ws"),"ambiguous");
   await assert.rejects(h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws"),/incomplete/u);
  }finally{await h.close();}
 });
}

test("W2 published but evidence failed: changes on the branch, Task NOT finalized",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const batch=await prepared(h);
  let casDone=false;
  h.fake.onRequest=c=>{
   if(c.startsWith("PUT /branches/feature%2Fsample-change"))casDone=true;
   else if(casDone&&c.startsWith("GET /contents"))throw new TypeError("Gitea down after CAS");
  };
  await h.execute(batch.items[0]!.request_id);await h.execute(batch.items[1]!.request_id);
  await assert.rejects(h.execute(batch.items[2]!.request_id));
  assert.equal(h.gate.writeSetPhase("task-ws"),"published");
  assert.notEqual(h.fake.head(WORK),h.hash);           // the write-set is on the branch
  h.fake.onRequest=undefined;
  const digest=h.writeBatches.get(batch.batch_id)!.write_set_digest!;
  await assert.rejects(h.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws",digest,h.wsObserver),/ENOENT/u);
  // A failed attestation fails the whole Gateway session closed (existing rule).
  await assert.rejects(h.gate.finalizeTrustedSequentialReadTask("task-ws","runtime-ws"),
   /incomplete|no active trusted/u);
  assert.equal(h.gate.phase,"failed_closed");
 }finally{await h.close();}
});

test("W2 replay during the asynchronous publication: before the CAS -> failed and no CAS; after -> published",async()=>{
 for(const at of ["POST /contents","PUT /branches/feature%2Fsample-change"] as const){
  const h=await setup({permissions:mixed});
  try{
   const batch=await prepared(h);
   await h.execute(batch.items[0]!.request_id);await h.execute(batch.items[1]!.request_id);
   const replays:Promise<unknown>[]=[];
   h.fake.onRequest=c=>{if(c.startsWith(at)&&!replays.length)
    replays.push(h.execute(batch.items[0]!.request_id).catch(e=>e));};
   const last=h.execute(batch.items[2]!.request_id);
   if(at==="POST /contents"){
    await assert.rejects(last);
    assert.ok(code("replay_detected")(await replays[0]));
    assert.equal(casCalls(h),0);
    assert.equal(h.gate.writeSetPhase("task-ws"),"failed");
    assert.equal(h.fake.head(WORK),h.hash);
   }else{
    const r=await last;
    assert.ok(code("replay_detected")(await replays[0]));
    assert.equal((r.execution as {performed:boolean}).performed,true);
    assert.equal(h.gate.writeSetPhase("task-ws"),"published");
   }
  }finally{await h.close();}
 }
});

test("W2 byte binding: content changed after staging is never sent; foreign VP stops the batch",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const batch=await prepared(h);
  await h.execute(batch.items[0]!.request_id);await h.execute(batch.items[1]!.request_id);
  const last=h.store.get(batch.items[2]!.request_id)!;
  (last.request.arguments as {content:string}).content="TAMPERED\n";
  await assert.rejects(h.execute(batch.items[2]!.request_id));
  assert.equal(h.fake.calls.some(c=>c==="POST /contents"),false);
  assert.equal(casCalls(h),0);
 }finally{await h.close();}
 const v=await setup({permissions:mixed});
 try{
  const batch=await prepared(v);
  await v.execute(batch.items[0]!.request_id);
  await assert.rejects(v.execute(batch.items[1]!.request_id,"OTHER_VP"),code("verification_rejected"));
  await assert.rejects(v.execute(batch.items[2]!.request_id),code("verification_rejected"));
  assert.equal(v.gate.writeSetPhase("task-ws"),"failed");
 }finally{await v.close();}
});

test("W2 exact change set and modes: extra file, mode change, symlink target -> no CAS",async()=>{
 for(const fault of ["extra","mode","symlink"] as const){
  const h=await setup({permissions:mixed,...(fault==="symlink"?{modes:{[A]:"120000"}}:{})});
  try{
   const batch=await prepared(h);
   if(fault==="extra")h.fake.injectIntoChangeFiles={path:"apps/backend/evil.ts",content:"x\n"};
   if(fault==="mode")h.fake.modeOverride={path:A,mode:"100755"};
   await h.execute(batch.items[0]!.request_id);await h.execute(batch.items[1]!.request_id);
   await assert.rejects(h.execute(batch.items[2]!.request_id),
    fault==="extra"?/exactly the authorized change set/u:/mode|regular file/u);
   assert.equal(casCalls(h),0);
   assert.equal(h.fake.head(WORK),h.hash);
   assert.equal(h.gate.writeSetPhase("task-ws"),"failed");
  }finally{await h.close();}
 }
});

test("W2 evidence is bound to the common commit, write-set digest and batch",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const batch=await prepared(h);
  let pub;for(const item of batch.items)pub=await h.execute(item.request_id);
  const p=pub!.execution as unknown as {commit_sha:string;write_set_digest:string};
  const item=(await h.intentJournal.read("w-session","task-ws")).items[0]!;
  const expected={session_id:"w-session",authority_digest:h.store.get(item.request_id)!.authority_only_digest!,
   root_credential_id:"urn:w:operational",task_id:"task-ws",runtime_task_id:"runtime-ws",epoch:1,
   credential_id:"urn:w:child",agent_did:"did:thesis:backend",request_id:item.request_id,
   request_fingerprint:item.request_fingerprint};
  const pubOk={write_set_digest:p.write_set_digest,batch_id:batch.batch_id,commit_sha:p.commit_sha,previous_head_sha:h.hash};
  await h.wsObserver.observe({expected,publication:pubOk,item});
  for(const [label,bad] of [
   ["other commit",{...pubOk,commit_sha:"c".repeat(40)}],
   ["other write-set",{...pubOk,write_set_digest:"d".repeat(64)}],
   ["other batch",{...pubOk,batch_id:"wbatch_other"}]] as const)
   await assert.rejects(h.wsObserver.observe({expected,publication:bad,item}),/another write-set or commit/u,label);
  await assert.rejects(h.wsObserver.observe({expected,publication:pubOk,item:{...item,next_content_sha256:"e".repeat(64)}}),
   /authorized file/u);
  await assert.rejects(h.gate.attestTrustedWriteSetEffect("task-ws","runtime-ws","d".repeat(64),h.wsObserver),/no matching/u);
 }finally{await h.close();}
});

test("W2 private staging refs are never a work branch; batch request limits",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const c=h.client();
  const priv="feature/w2-write-set-"+"a".repeat(28);
  await assert.rejects(c.casBranchToCommit(priv,"a".repeat(40),"b".repeat(40)),ProviderConflictError);
  await assert.rejects(c.updateFileWithHeadCas({branch:priv,path:A,content:"x",message:"m",requestId:"r",
   expectedHeadSha:"a".repeat(40),expectedBlobSha:"b".repeat(40)}),ProviderConflictError);
  assert.throws(()=>new TrustedAuthorityOnlyWriteSetPreflight({admissions:h.gate,giteaClient:c,
   journal:h.intentJournal,repository:"thesis/sample-app",branch:priv}),/signed branch/u);
  await assert.rejects(c.deleteWriteSetStagingRef(WORK),ProviderConflictError);
  await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
  for(const [label,bad,pattern] of [
   ["one change",[changes[0]],/2-8/u],
   ["nine changes",Array.from({length:9},(_,i)=>({path:`apps/backend/x${i}.ts`,operation:"create_file",content:"x\n"})),/2-8/u],
   ["duplicate path",[changes[0],changes[0]],/2-8/u],
   ["extra key",[{...changes[0],mode:"100755"},changes[1]],/2-8/u],
   ["file over 2 MB",[{...changes[0],content:"x".repeat(2_000_001)},changes[1]],/2 MB/u],
   ["aggregate over 4 MB",[{...changes[0],content:"x".repeat(1_900_000)},{...changes[1],content:"y".repeat(1_900_000)},
     {...changes[2],content:"z".repeat(1_900_000)}],/4 MB/u],
   ["request over 6 MiB",[{...changes[0],content:"\u00e9".repeat(1_000_000)},{...changes[1],content:"\u00e9".repeat(1_000_000)},
     {...changes[2],content:"\u00e9".repeat(1_000_000)},{path:"apps/backend/q.ts",operation:"create_file",content:"\u00e9".repeat(900_000)}],/6 MiB|4 MB/u]
  ] as const)assert.throws(()=>h.prepareBatch(bad as never),pattern,label);
 }finally{await h.close();}
});

test("W2 baseline untouched: GiteaClient single-file CAS still rejects private prefixes it rejected before",async()=>{
 const c=new GiteaClient({baseUrl:"http://g.invalid",token:"t",owner:"thesis",repository:"sample-app",baseBranch:"main",
  fetchFn:async()=>Response.json({})});
 for(const b of ["feature/r302-internal-x","feature/r3832-create-x"])
  await assert.rejects(c.updateFileWithHeadCas({branch:b,path:"a",content:"x",message:"m",requestId:"r",
   expectedHeadSha:"a".repeat(40),expectedBlobSha:"b".repeat(40)}),ProviderConflictError);
});

test("W2 fix: the batch window expiring DURING the last HEAD reread stops the CAS",async()=>{
 const h=await setup({permissions:mixed});
 try{
  const batch=await prepared(h);
  await h.execute(batch.items[0]!.request_id);await h.execute(batch.items[1]!.request_id);
  let trees=0,advanced=false;
  h.fake.onRequest=c=>{
   if(c.startsWith("GET /git/trees"))trees++;
   // P4 done (two tree reads) -> the next work-branch read is the P6 HEAD reread.
   if(trees>=2&&!advanced&&c.startsWith("GET /branches/feature%2Fsample-change")){
    advanced=true;h.clock.now+=61_000;}
  };
  await assert.rejects(h.execute(batch.items[2]!.request_id),/window expired before the CAS/u);
  assert.equal(advanced,true);
  assert.equal(casCalls(h),0);
  assert.equal(h.fake.head(WORK),h.hash);
  assert.equal(h.gate.writeSetPhase("task-ws"),"failed");
 }finally{await h.close();}
});

test("W2 fix: a batch invalidated during the asynchronous staging never becomes staged",async()=>{
 // (a) external invalidation (no record consumed): the final state check refuses "staged".
 const h=await setup({permissions:mixed});
 try{
  await h.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",h.hash);
  await h.readAll([A,B]);
  const batch=h.prepareBatch(changes);
  let invalidated=false;
  h.fake.onRequest=c=>{if(c.startsWith("GET /contents")&&!invalidated){
   invalidated=true;h.writeBatches.failForRequest(batch.items[0]!.request_id);}};
  await assert.rejects(h.stageBatch(batch.batch_id),/invalidated during staging/u);
  assert.equal(invalidated,true);
  assert.equal(h.writeBatches.get(batch.batch_id)!.state,"failed");
  assert.equal(h.gate.writeSetPhase("task-ws"),"failed");   // the durable write-set is failed too
  await assert.rejects(h.execute(batch.items[0]!.request_id),code("verification_rejected"));
  assert.equal(casCalls(h),0);
 }finally{await h.close();}
 // (b) an early Execute during staging (record consumed): staging is refused, batch failed.
 const e=await setup({permissions:mixed});
 try{
  await e.gate.beginTrustedSequentialWriteSetTask("task-ws","runtime-ws",e.hash);
  await e.readAll([A,B]);
  const batch=e.prepareBatch(changes);
  const early:Promise<unknown>[]=[];
  e.fake.onRequest=c=>{if(c.startsWith("GET /contents")&&!early.length)
   early.push(e.execute(batch.items[0]!.request_id).catch(x=>x));};
  await assert.rejects(e.stageBatch(batch.batch_id));
  assert.ok(code("verification_rejected")(await early[0]));
  assert.equal(e.writeBatches.get(batch.batch_id)!.state,"failed");
  assert.equal(casCalls(e),0);
 }finally{await e.close();}
});
