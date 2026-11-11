import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {makeApproval,planDigest,PLAN_SCHEMA_VERSION}
  from "../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../apps/gateway/src/operation-catalog.ts";
import {SignedEngineerApprovalFileStore}
  from "../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedChildIssuanceJournal}
  from "../../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {TrustedPlanningRecoveryStore}
  from "../../packages/orchestrator-runtime/src/trusted-planning-recovery-store.ts";
import {TrustedOperationalRecoveryStore}
  from "../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {observeR5IndependentDagRevocations}
  from "../r5-independent-dag-revocation-audit.mjs";

const SHA="a".repeat(40),DID="did:example:engineer";
const CHAIN="0x7a69",BLOCK="0x7",HASH="0x"+"cd".repeat(32);
const STATUS_URL="https://status.example/lists/signed-full-dag";
const ROOT="gitea://gitea.local/thesis/iam";
const BRANCH=ROOT+"/branches/feature%2Fapproved";
const FILE=BRANCH+"/files/src/main.ts";
const STEPS=[
  ["branch","orchestrator","create_branch",ROOT],
  ["backend","backend","read_file",FILE],
  ["frontend","frontend","read_file",FILE],
  ["test","test","run_tests",BRANCH],
  ["pr","orchestrator","create_pull_request",ROOT]
];
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"r5-whole-dag-block-"));
  const approvalDir=join(root,"approvals"),issueDir=join(root,"issuance"),
    planningDir=join(root,"planning"),operDir=join(root,"operational");
  await Promise.all([approvalDir,issueDir,planningDir,operDir].map(dir=>
    mkdir(dir,{mode:0o700})));
  const plan={
    schema_version:PLAN_SCHEMA_VERSION,plan_id:"r5-all-status",
    session_id:"r5-full-dag-review",version:1,
    repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
    base_revision:SHA,requirement:"Observe whole signed DAG after retirement",
    candidate_agents:["backend","frontend","test"].map(role=>({
      agent_id:role,did:"did:example:"+role,card_ref:"trusted:"+role
    })),
    tasks:STEPS.map(([id,agent_id,,resource],i)=>({
      id,agent_id,title:id,description:"Approved "+id,
      depends_on:i?[STEPS[i-1][0]]:[],resources:[resource]
    })),
    requested_permissions:STEPS.map(([task_id,agent_id,operation,resource])=>({
      id:"permit-"+task_id,task_id,agent_id,operation,resource,
      reason:"Signed "+task_id
    })),assumptions:[],uncertainties:[]
  };
  const digest=planDigest(plan);
  const keys=generateKeyPairSync("ed25519"),now=new Date().toISOString();
  const approval=makeApproval(plan,{
    allowedOperations:new Set(RUST_OPERATIONS),decision_id:"full-dag-review",
    approved_by:DID,approved_at:now,
    approved_permission_ids:STEPS.map(row=>"permit-"+row[0])
  });
  const signed=signEngineerApproval({
    plan,approval,engineerDid:DID,keyId:"test-key",
    privateKeyPem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    issuedAt:now,expiresAt:new Date(Date.now()+15*60_000).toISOString()
  });
  await writeFile(join(approvalDir,plan.session_id+".json"),
    JSON.stringify(signed),{mode:0o600});
  const approvalStore=new SignedEngineerApprovalFileStore({
    directory:approvalDir,engineerDid:DID,
    trustedKeys:{"test-key":{
      engineer_did:DID,
      public_key_pem:keys.publicKey.export({format:"pem",type:"spki"}).toString()
    }}
  });
  const rootPlanning="urn:root:planning",rootOperational="urn:root:execution";
  const planningRecoveryStore=new TrustedPlanningRecoveryStore(planningDir);
  const operationalRecoveryStore=new TrustedOperationalRecoveryStore(operDir);
  await planningRecoveryStore.recordIntent({
    sessionId:plan.session_id,baseRevision:SHA,credentialId:rootPlanning
  });
  await operationalRecoveryStore.recordIntent({
    sessionId:plan.session_id,baseRevision:SHA,credentialId:rootOperational
  });
  await planningRecoveryStore.markReconciled({
    sessionId:plan.session_id,baseRevision:SHA,credentialId:rootPlanning
  });
  await operationalRecoveryStore.markReconciled({
    sessionId:plan.session_id,baseRevision:SHA,credentialId:rootOperational
  });
  const inventory={
    schema:"r5-credential-issuance-inventory-v1",
    source_sha:SHA,github_run_id:"40470099125",session_id:plan.session_id,
    approved_plan_digest:digest,preliminary_root_id:rootPlanning,
    operational_root_id:rootOperational,
    task_children:["backend","frontend","test"].map(task_id=>({
      task_id,credential_id:"urn:child:"+task_id
    }))
  };
  const ownerEvidence={
    schema:"r5-scripted-owner-completion-v1",
    status:"verified_complete_local_owner_observation",
    source_sha:SHA,github_run_id:inventory.github_run_id,
    session_id:plan.session_id,approved_plan_digest:digest,
    approved_task_ids:STEPS.map(row=>row[0]),
    completed_task_ids:STEPS.map(row=>row[0]),
    authenticated_engineer_did:DID,coordinator_terminal_phase:"closed",
    original_runtime_returned_success:true,independently_attested:false,
    provider_model_calls_verified_here:false,external_r5_go:false
  };
  const issuanceJournal=new TrustedChildIssuanceJournal({
    directory:issueDir,sessionId:plan.session_id,baseRevision:SHA,
    planDigest:digest,parentCredentialId:rootOperational
  });
  for(const [i,child] of inventory.task_children.entries()){
    await issuanceJournal.recordIntent({
      taskId:child.task_id,role:child.task_id,credentialId:child.credential_id,
      statusListCredential:STATUS_URL,statusListIndex:String(103+i)
    });
    // Test also the uncertain-issued case: no ACK for 'test'.
    if(child.task_id!=="test")
      await issuanceJournal.recordVerifiedResponse({
        taskId:child.task_id,credentialId:child.credential_id
      });
  }
  const rootStatusEntries=[
    {credential_id:rootPlanning,status_list_credential:STATUS_URL,
      status_list_index:"101"},
    {credential_id:rootOperational,status_list_credential:STATUS_URL,
      status_list_index:"102"}
  ];
  const publicStatusLists=[
    {status_list_credential:STATUS_URL,signed_status_jwt:"test-signed-jwt".repeat(4)}
  ];
  const chainPins={rpcUrl:"http://127.0.0.1:8545",
    expectedChainId:CHAIN,registryAddress:"0x"+"11".repeat(20),
    issuerAddress:"0x"+"22".repeat(20),
    issuerDid:"did:ethr:0x7a69:0x"+"22".repeat(20),
    issuerPublicJwk:keys.publicKey.export({format:"jwk"})};
  const events=[];
  const verifyEntry=async req=>{
    events.push(req);
    // The verifier is separate; its Ed25519, Keccak and RPC behavior is
    // tested with genuine signed JWTs in r5-independent-status-evm-verifier.
    return {
      status:"public_jwt_signature_evm_anchor_and_revoked_bit_verified",
      anchor_version:2,chain_id:CHAIN,block_number:BLOCK,block_hash:HASH,
      adapter_status_endpoint_used:false,gateway_bearer_used:false,
      external_r5_go:false
    };
  };
  const args={ownerEvidence,inventory,approvalStore,issuanceJournal,
    planningRecoveryStore,operationalRecoveryStore,
    rootStatusEntries,publicStatusLists,chainPins,verifyEntry};
  return {root,issueDir,planningDir,operDir,args,events,
    close:()=>rm(root,{force:true,recursive:true})};
}
test("R5 verifies two roots and every original Host child on one block without promoting uncertain issuance",async()=>{
  const f=await fixture();try{
    const r=await observeR5IndependentDagRevocations(f.args);
    assert.equal(r.observed_root_count,2);
    assert.equal(r.original_host_root_tombstones_matched,true);
    assert.equal(r.observed_specialized_child_count,3);
    assert.equal(r.uncertain_child_issuance_count,1);
    assert.equal(r.observed_block_number,BLOCK);
    assert.equal(r.observed_block_hash,HASH);
    assert.equal(r.one_block_consistent,true);
    assert.equal(r.safe_to_retry_child_issuance,false);
    assert.equal(r.complete_issuer_issuance_ledger_independently_verified,false);
    assert.equal(r.external_r5_go,false);
    assert.deepEqual(f.events.slice(0,2).map(x=>x.statusListIndex),[101,102]);
    assert.deepEqual(f.events.slice(2).map(x=>x.statusListIndex)
      .sort((a,b)=>a-b),[103,104,105]);
    assert.equal(f.events[0].expectedBlockNumber,undefined);
    for(const call of f.events.slice(1)){
      assert.equal(call.expectedBlockNumber,BLOCK);
      assert.equal(call.expectedBlockHash,HASH);
      assert.equal(call.signedStatusJwt,f.args.publicStatusLists[0].signed_status_jwt);
    }
  }finally{await f.close();}
});
test("R5 missing or duplicated roots, child, slot or public artifact deny before RPC",async()=>{
  const changes=[
    x=>x.rootStatusEntries.pop(),
    x=>x.rootStatusEntries[0].credential_id="urn:forged:root",
    x=>x.rootStatusEntries[1].status_list_index="101",
    x=>x.inventory.task_children.pop(),
    x=>x.publicStatusLists.pop(),
    x=>x.publicStatusLists.push({...x.publicStatusLists[0]}),
    x=>x.rootStatusEntries[0].status_list_index="262144"
  ];
  for(const change of changes){
    const f=await fixture();try{
      change(f.args);
      await assert.rejects(observeR5IndependentDagRevocations(f.args),
        /NO-GO/);
      assert.equal(f.events.length,0);
    }finally{await f.close();}
  }
});
test("R5 missing or substituted original Host root tombstones deny before RPC",async()=>{
  for(const kind of ["planning","operational"]){
    const f=await fixture();try{
      const {readdir,rm:remove}=await import("node:fs/promises");
      const directory=kind==="planning"?f.planningDir:f.operDir;
      const file=(await readdir(directory)).find(name=>name.endsWith(".retired.json"));
      assert.ok(file);
      await remove(join(directory,file));
      await assert.rejects(observeR5IndependentDagRevocations(f.args),/recovery|Planning|operational|root/i);
      assert.equal(f.events.length,0);
    }finally{await f.close();}
  }
});
test("R5 a root retirement journal changing during Ethereum RPC aborts the audit",async()=>{
  const f=await fixture();try{
    const {readdir,rm:remove}=await import("node:fs/promises");
    let observed=false;
    await assert.rejects(observeR5IndependentDagRevocations({
      ...f.args,verifyEntry:async opts=>{
        if(!observed){
          observed=true;
          const name=(await readdir(f.operDir)).find(x=>x.endsWith(".retired.json"));
          await remove(join(f.operDir,name));
        }
        return f.args.verifyEntry(opts);
      }
    }),/recovery|operational|root/i);
    assert.equal(observed,true);
  }finally{await f.close();}
});
test("R5 a mismatched block hash across independently checked Status Lists is NO-GO",async()=>{
  const f=await fixture();try{
    let calls=0;
    await assert.rejects(observeR5IndependentDagRevocations({
      ...f.args,verifyEntry:async opts=>{
        calls++;
        const valid=await f.args.verifyEntry(opts);
        return calls===3?{...valid,block_hash:"0x"+"ef".repeat(32)}:valid;
      }
    }),/NO-GO/);
    assert.equal(calls,3);
  }finally{await f.close();}
});
test("R5 newly recorded child intent racing the EVM RPC invalidates the result",async()=>{
  const f=await fixture();try{
    let once=false;
    await assert.rejects(observeR5IndependentDagRevocations({
      ...f.args,verifyEntry:async opts=>{
        if(!once){
          once=true;
          await f.args.issuanceJournal.recordIntent({
            taskId:"extra",role:"backend",credentialId:"urn:child:extra",
            statusListCredential:STATUS_URL,statusListIndex:"110"
          });
        }
        return f.args.verifyEntry(opts);
      }
    }),/NO-GO.*changed/);
    assert.equal((await f.args.issuanceJournal.records()).length,4);
  }finally{await f.close();}
});
test("R5 malformed public verifier outputs can never be promoted to whole-DAG success",async()=>{
  const f=await fixture();try{
    await assert.rejects(observeR5IndependentDagRevocations({
      ...f.args,verifyEntry:async()=>({
        status:"public_jwt_signature_evm_anchor_and_revoked_bit_verified",
        chain_id:CHAIN,block_number:BLOCK,block_hash:HASH,
        external_r5_go:true,adapter_status_endpoint_used:false,
        gateway_bearer_used:false
      })
    }),/NO-GO/);
  }finally{await f.close();}
});
