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

test("operational reservation failure revokes live provisional root without issuing a second root",async()=>{
  const f=await setup();
  try{
    // The session was used previously and is operationally retired.
    // Planning may have begun with an independently confirmed read-only
    // root; the handoff must not leave it active if the new reservation
    // fails before ANY Rust operational issuing request.
    await f.operational.recordIntent(operational);
    await f.operational.markReconciled(operational);
    const {TrustedExecutionCoordinator}=await import(
      "../src/trusted-execution-coordinator.ts");
    const revoked:string[]=[];
    let provisionalCancellations=0,operationalIssueAttempts=0;
    const coordinator=new TrustedExecutionCoordinator({
      sessionId,baseRevision,planningRecovery:f.planning,
      operationalRecovery:f.operational,
      credentials:{async revokeRoot(id:string){revoked.push(id);}},
      approvedGatewayPlans:{
        retireSession(){},async activate(){throw Error("never activate");},
        bindTask(){},async confirmTaskCompletion(){},closeSession(){}
      },
      authority:{
        async startPlanning(root:any){return {
          phase:"planning",credential_id:root.credential_id,permissions:[]
        };},
        async cancelPlanning(){
          provisionalCancellations++;
          revoked.push(preliminary.credentialId);
        },
        async approveAndIssueOperationalRoot(){
          operationalIssueAttempts++;
          throw Error("must not issue");
        }
      } as any
    });
    await coordinator.beginPlanning({credential_id:preliminary.credentialId} as any);
    await assert.rejects(coordinator.beginExecution({
      credential_id:"urn:test:second-operational"
    } as any),/reconciled session cannot be reused/);
    assert.equal(coordinator.phase,"failed_closed");
    assert.equal(provisionalCancellations,1);
    assert.deepEqual(revoked,[preliminary.credentialId]);
    assert.equal(operationalIssueAttempts,0);
    await f.planning.assertClean();
    await assert.rejects(f.planning.assertFreshSession(sessionId),
      /retired session cannot be reused/);
    await assert.rejects(coordinator.beginExecution({
      credential_id:"urn:test:third-operational"
    } as any),/requires prior Planning/);
  }finally{await f.close();}
});

test("uncertain preliminary revocation after failed operational reservation retains Planning intent",async()=>{
  const f=await setup();
  try{
    await f.operational.recordIntent(operational);
    await f.operational.markReconciled(operational);
    const {TrustedExecutionCoordinator}=await import(
      "../src/trusted-execution-coordinator.ts");
    const coordinator=new TrustedExecutionCoordinator({
      sessionId,baseRevision,planningRecovery:f.planning,
      operationalRecovery:f.operational,
      credentials:{async revokeRoot(){}},
      approvedGatewayPlans:{
        retireSession(){},async activate(){throw Error("never");},
        bindTask(){},async confirmTaskCompletion(){},closeSession(){}
      },
      authority:{
        async startPlanning(root:any){return {
          phase:"planning",credential_id:root.credential_id,permissions:[]
        };},
        async cancelPlanning(){throw Error("Gateway Planning retirement unavailable");},
        async approveAndIssueOperationalRoot(){throw Error("must not issue");}
      } as any
    });
    await coordinator.beginPlanning({credential_id:preliminary.credentialId} as any);
    await assert.rejects(coordinator.beginExecution({
      credential_id:"urn:test:never-issue"
    } as any),/preliminary root revocation unconfirmed; manual reconciliation required/);
    assert.equal(coordinator.phase,"failed_closed");
    assert.equal((await f.planning.pending()).length,1);
    await assert.rejects(f.planning.assertFreshSession(sessionId),
      /orphaned Planning root/);
    await assert.rejects(f.operational.assertFreshSession(sessionId),
      /reconciled session cannot be reused/);
  }finally{await f.close();}
});
