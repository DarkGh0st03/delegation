import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,writeFile,chmod,readdir,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {TrustedPlanningRecoveryStore,reconcileOrphanedPlanningRoots}
  from "../src/trusted-planning-recovery-store.ts";
const data={sessionId:"preliminary-2026",baseRevision:"a".repeat(40),
  credentialId:"urn:test:provisional"};
async function env(){
  const directory=await mkdtemp(join(tmpdir(),"trusted-provisional-"));
  return {directory,store:new TrustedPlanningRecoveryStore(directory),
    close:()=>rm(directory,{recursive:true,force:true})};
}
test("pre-issuance intent remains pending until confirmed and cannot be replayed",async()=>{
  const f=await env();
  try{
    await f.store.recordIntent(data);
    assert.equal((await f.store.pending()).length,1);
    await assert.rejects(f.store.recordIntent(data),/orphaned Planning root/);
    await assert.rejects(f.store.markReconciled({...data,credentialId:"wrong"}),
      /does not match immutable/);
    await f.store.markReconciled(data);
    await f.store.assertClean();
    await assert.rejects(f.store.recordIntent(data),/retired session cannot be reused/);
  }finally{await f.close();}
});
test("separate process finds root and retires Gateway before Rust revocation",async()=>{
  const f=await env();
  try{
    await f.store.recordIntent(data);
    const next=new TrustedPlanningRecoveryStore(f.directory),actions:string[]=[];
    assert.equal(await reconcileOrphanedPlanningRoots({
      store:next,gateway:{retirePlanning(id){actions.push("gateway:"+id);}},
      credentials:{async revokeRoot(id){actions.push("rust:"+id);}}
    }),1);
    assert.deepEqual(actions,["gateway:"+data.sessionId,"rust:"+data.credentialId]);
    await next.assertClean();
    assert.equal(await reconcileOrphanedPlanningRoots({
      store:next,gateway:{retirePlanning(){throw Error("unexpected");}},
      credentials:{async revokeRoot(){throw Error("unexpected");}}
    }),0);
  }finally{await f.close();}
});
test("unconfirmed Gateway or Rust retirement keeps pending root",async()=>{
  for(const fails of ["gateway","rust"]){
    const f=await env();
    try{
      await f.store.recordIntent(data);
      let gateway=0,rust=0;
      await assert.rejects(reconcileOrphanedPlanningRoots({
        store:f.store,
        gateway:{retirePlanning(){gateway++;if(fails==="gateway")throw Error("no Gateway");}},
        credentials:{async revokeRoot(){rust++;if(fails==="rust")throw Error("no Rust");}}
      }),/manual reconciliation required/);
      assert.equal(gateway,1);assert.equal(rust,1);
      assert.equal((await f.store.pending()).length,1);
    }finally{await f.close();}
  }
});
test("malformed record, unexpected names or public journal permissions fail closed",async()=>{
  const f=await env();
  try{
    await f.store.recordIntent(data);
    const [file]=await readdir(f.directory);
    await writeFile(join(f.directory,file),"{");
    // Truncated records are rejected at the bounded inode check.
    await assert.rejects(f.store.pending(),/unsafe or incomplete Planning journal/);
    // Full-sized syntactically invalid JSON is rejected independently.
    await writeFile(join(f.directory,file),"{"+" ".repeat(80));
    await assert.rejects(f.store.pending(),/invalid persistent Planning JSON/);
    await rm(join(f.directory,file));
    await writeFile(join(f.directory,"unknown"),"x",{mode:0o600});
    await assert.rejects(f.store.pending(),/unexpected journal file/);
    await rm(join(f.directory,"unknown"));
    await chmod(f.directory,0o755);
    await assert.rejects(f.store.assertClean(),/owner-only/);
  }finally{await f.close();}
});
