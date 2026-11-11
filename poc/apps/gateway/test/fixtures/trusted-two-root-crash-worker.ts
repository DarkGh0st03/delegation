/**
 * Disposable offline Engineer worker: deliberately killed by the test after
 * a signed handoff; subsequent processes can ONLY reconcile the journals.
 * Native Rust and provider effects are scripted, never claimed real here.
 */
import assert from "node:assert/strict";
import {readFile,appendFile} from "node:fs/promises";
import {SignedEngineerApprovalFileStore} from "../../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedEngineerAuthoritySession} from "../../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from "../../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedPlanningRecoveryStore,reconcileOrphanedPlanningRoots} from "../../../../packages/orchestrator-runtime/src/trusted-planning-recovery-store.ts";
import {TrustedOperationalRecoveryStore,reconcileOrphanedOperationalRoots} from "../../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {TrustedPlanIpcClient} from "../../src/trusted-plan-ipc.ts";

const c=JSON.parse(await readFile(process.env.TWO_ROOT_CRASH_CONFIG!,"utf8"));
const mode=process.env.TWO_ROOT_CRASH_MODE;
const ipc=await TrustedPlanIpcClient.connect({
  socketPath:c.socketPath,secretFile:c.secretFile
});
assert.equal(ipc.planningRetirementDurableConfigured(),true);
assert.equal(ipc.operationalLeaseConfigured(),true);
const preliminary=new TrustedPlanningRecoveryStore(c.planningDir);
const operational=new TrustedOperationalRecoveryStore(c.operationalDir);
const root=(id:string,index:string)=>({
  credential_id:id,valid_from:new Date(Date.now()-1000).toISOString(),
  validity_seconds:120,
  credential_status:{type:"BitstringStatusListEntry",
    statusPurpose:"revocation",statusListIndex:index,
    statusListCredential:"https://status.example/lists/sigkill-fixture"}
});
if(mode==="issue"){
  const approvals=new SignedEngineerApprovalFileStore({
    directory:c.approvalDir,engineerDid:c.engineerDid,
    trustedKeys:{[c.keyId]:{
      engineer_did:c.engineerDid,public_key_pem:c.publicKey
    }}
  });
  const trace:string[]=[];
  const credentials={
    async issueScopedOrchestratorRoot(request:any){
      trace.push("issue:"+request.credential_id);
      return {id:request.credential_id,issuer:c.engineerDid,
        credentialSubject:{sub:"did:thesis:orchestrator",per:request.permissions}};
    },
    async revokeRoot(id:string){trace.push("revoke:"+id);}
  };
  const authority=new TrustedEngineerAuthoritySession({
    snapshot:{session_id:c.sessionId,repository:c.repository,
      base_revision:c.baseRevision,directories:[""],files:[]},
    credentials,approvals,authenticatedEngineerDid:c.engineerDid
  });
  const coordinator=new TrustedExecutionCoordinator({
    authority,approvedGatewayPlans:ipc,credentials,
    sessionId:c.sessionId,baseRevision:c.baseRevision,
    planningRecovery:preliminary,operationalRecovery:operational
  });
  await coordinator.beginPlanning(root(c.planningRoot,"19001"));
  await coordinator.beginExecution(root(c.operationalRoot,"19002"));
  assert.equal(coordinator.phase,"execution");
  assert.deepEqual(trace,[
    "issue:"+c.planningRoot,"revoke:"+c.planningRoot,
    "issue:"+c.operationalRoot
  ]);
  await preliminary.assertClean();
  assert.equal((await operational.pending()).length,1);
  process.send?.({phase:"issued",pid:process.pid,trace});
  setInterval(()=>{},1000); // Parent must SIGKILL; never self-clean.
}else if(mode==="uncertain"||mode==="recover"||mode==="repeat"){
  const events:string[]=[];
  const gateway={
    async retireSession(id:string){
      assert.equal(id,c.sessionId);
      events.push("gateway:"+id);
      await ipc.retireSession(id);
    }
  };
  const credentials={
    async revokeRoot(id:string){
      assert.equal(id,c.operationalRoot);
      events.push("revoke:"+id);
      if(mode==="uncertain")throw Error("missing scripted Rust receipt");
      await appendFile(c.revocationLog,"revoked:"+id+"\n",{mode:0o600});
    }
  };
  if(mode==="uncertain"){
    await assert.rejects(reconcileOrphanedOperationalRoots({
      store:operational,gateway,credentials
    }),/manual reconciliation required/);
    assert.equal((await operational.pending()).length,1);
    await assert.rejects(operational.recordIntent({
      sessionId:c.sessionId,baseRevision:c.baseRevision,
      credentialId:"urn:process-crash:second-root"
    }),/orphaned root intent/);
    process.send?.({phase:"uncertain",pid:process.pid,events});
  }else if(mode==="recover"){
    assert.equal(await reconcileOrphanedOperationalRoots({
      store:operational,gateway,credentials
    }),1);
    assert.equal(await reconcileOrphanedPlanningRoots({
      store:preliminary,
      gateway:{retirePlanning:id=>ipc.retirePlanning(id)},
      credentials:{async revokeRoot(){
        throw Error("preliminary already revoked before SIGKILL");
      }}
    }),0);
    await ipc.retirePlanning(c.sessionId);
    await operational.assertClean();
    await preliminary.assertClean();
    await assert.rejects(operational.assertFreshSession(c.sessionId),
      /reconciled session cannot be reused/);
    await assert.rejects(preliminary.assertFreshSession(c.sessionId),
      /retired session cannot be reused/);
    process.send?.({phase:"recovered",pid:process.pid,events});
  }else{
    assert.equal(await reconcileOrphanedOperationalRoots({
      store:operational,gateway,credentials
    }),0);
    await assert.rejects(operational.recordIntent({
      sessionId:c.sessionId,baseRevision:c.baseRevision,
      credentialId:"urn:process-crash:third-root"
    }),/reconciled session cannot be reused/);
    await assert.rejects(ipc.activate(c.sessionId,c.baseRevision),
      /Gateway trusted control denied/);
    process.send?.({phase:"replay-blocked",pid:process.pid,events});
  }
}else{
  throw Error("Unknown trusted process crash test mode");
}
