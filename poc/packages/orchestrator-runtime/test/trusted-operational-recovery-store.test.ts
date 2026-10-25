import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readdir,readFile,writeFile,chmod} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {TrustedOperationalRecoveryStore,reconcileOrphanedOperationalRoots}
  from "../src/trusted-operational-recovery-store.ts";
import {TrustedPlanningRecoveryStore,reconcileOrphanedPlanningRoots}
  from "../src/trusted-planning-recovery-store.ts";

const sessionId="signed-engineer-handoff-crash",baseRevision="b".repeat(40);
const preliminary={sessionId,baseRevision,credentialId:"urn:test:provisional-issue"};
const operational={sessionId,baseRevision,credentialId:"urn:test:operational-issue"};
async function setup(){
  const home=await mkdtemp(join(tmpdir(),"two-root-crash-recovery-"));
  const planningDir=join(home,"planning"),operationalDir=join(home,"operational");
  const {mkdir}=await import("node:fs/promises");
  await mkdir(planningDir,{mode:0o700});
  await mkdir(operationalDir,{mode:0o700});
  return {
    home,planningDir,operationalDir,
    planning:new TrustedPlanningRecoveryStore(planningDir),
    operational:new TrustedOperationalRecoveryStore(operationalDir),
    close:()=>rm(home,{recursive:true,force:true})
  };
}

test("crash after signed approval and ambiguous operational issuance never reuses either credential",async()=>{
  const f=await setup();
  try{
    // Both intents MUST exist before any external issuance. The Engineer's
    // already signed receipt is independent and cannot override these fences.
    await f.planning.recordIntent(preliminary);
    await f.operational.recordIntent(operational);
    const restartedPlanning=new TrustedPlanningRecoveryStore(f.planningDir);
    const restartedOperational=new TrustedOperationalRecoveryStore(f.operationalDir);
    const events:string[]=[];
    await assert.rejects(reconcileOrphanedOperationalRoots({
      store:restartedOperational,
      gateway:{async retireSession(id){events.push("gateway-operational:"+id);}},
      credentials:{async revokeRoot(id){
        events.push("rust-uncertain:"+id);throw Error("native status unknown");
      }}
    }),/manual reconciliation required/);
    assert.equal((await restartedOperational.pending()).length,1);
    await assert.rejects(restartedOperational.assertFreshSession(sessionId),
      /orphaned root intent/);
    await assert.rejects(restartedOperational.recordIntent({
      ...operational,credentialId:"urn:test:second-operational-root"
    }),/orphaned root intent/);
    await assert.rejects(restartedPlanning.assertFreshSession(sessionId),
      /orphaned Planning root/);

    // Cold startup replays ONLY termination requests, not an already
    // signed authorization or operational-credential creation.
    assert.equal(await reconcileOrphanedOperationalRoots({
      store:restartedOperational,
      gateway:{async retireSession(id){events.push("gateway-operational:"+id);}},
      credentials:{async revokeRoot(id){events.push("rust-operational:"+id);}}
    }),1);
    assert.equal(await reconcileOrphanedPlanningRoots({
      store:restartedPlanning,
      gateway:{async retirePlanning(id){events.push("gateway-planning:"+id);}},
      credentials:{async revokeRoot(id){events.push("rust-planning:"+id);}}
    }),1);
    assert.deepEqual(events,[
      "gateway-operational:"+sessionId,
      "rust-uncertain:"+operational.credentialId,
      "gateway-operational:"+sessionId,
      "rust-operational:"+operational.credentialId,
      "gateway-planning:"+sessionId,
      "rust-planning:"+preliminary.credentialId
    ]);
    await restartedOperational.assertClean();
    await restartedPlanning.assertClean();
    await assert.rejects(restartedOperational.assertFreshSession(sessionId),
      /reconciled session cannot be reused/);
    await assert.rejects(restartedPlanning.assertFreshSession(sessionId),
      /retired session cannot be reused/);
    assert.equal(await reconcileOrphanedOperationalRoots({
      store:new TrustedOperationalRecoveryStore(f.operationalDir),
      gateway:{async retireSession(){throw Error("unexpected");}},
      credentials:{async revokeRoot(){throw Error("unexpected");}}
    }),0);
  }finally{await f.close();}
});

test("retired root tombstone cannot be overwritten by a duplicate pending record",async()=>{
  const f=await setup();
  try{
    await f.operational.recordIntent(operational);
    await f.operational.markReconciled(operational);
    const [retired]=await readdir(f.operationalDir);
    const retiredPath=join(f.operationalDir,retired);
    const original=await readFile(retiredPath,"utf8");
    // Even deliberate presence of both names is an integrity failure.
    const pending=join(f.operationalDir,retired.replace(".retired.",".pending."));
    await writeFile(pending,JSON.stringify({
      schema_version:1,
      session_id:sessionId,base_revision:baseRevision,
      credential_id:"urn:test:forged-new-root"})+"\n",{mode:0o600});
    await assert.rejects(f.operational.pending(),/duplicate retired and pending/);
    await assert.rejects(f.operational.markReconciled({
      ...operational,credentialId:"urn:test:forged-new-root"
    }),error=>(error as NodeJS.ErrnoException).code==="EEXIST");
    assert.equal(await readFile(retiredPath,"utf8"),original);
  }finally{await f.close();}
});

test("operational recovery rejects corrupted or publicly readable journal",async()=>{
  const f=await setup();
  try{
    await f.operational.recordIntent(operational);
    const [entry]=await readdir(f.operationalDir);
    const path=join(f.operationalDir,entry);
    await writeFile(path,"{");
    await assert.rejects(f.operational.pending(),/unsafe or incomplete recovery record/);
    await writeFile(path,"{"+ " ".repeat(90));
    await assert.rejects(f.operational.pending(),/Unexpected end of JSON input|Expected property name|JSON/);
    await rm(path);
    await chmod(f.operationalDir,0o755);
    await assert.rejects(f.operational.assertClean(),/owner-only/);
  }finally{await f.close();}
});
