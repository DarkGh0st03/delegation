import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {makeApproval,planDigest} from "../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../../apps/gateway/src/operation-catalog.ts";
import {SignedEngineerApprovalFileStore}
  from "../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedChildIssuanceJournal}
  from "../../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {observeR5UncertainChildIssuance}
  from "../r5-child-uncertain-reconciliation.mjs";

const SHA="a".repeat(40),DID="did:example:engineer";
const URI="gitea://gitea.local/thesis/console";
const FILE=URI+"/branches/feature%2Frecovery/files/src/main.ts";
const BRANCH=URI+"/branches/feature%2Frecovery";
const STEPS=[
  ["branch","orchestrator","create_branch",URI],
  ["backend","backend","read_file",FILE],
  ["frontend","frontend","read_file",FILE],
  ["test","test","run_tests",BRANCH],
  ["pr","orchestrator","create_pull_request",URI]
];
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"r5-uncertain-reconcile-"));
  const issueDir=join(root,"issuance"),approvalDir=join(root,"approval");
  await Promise.all([issueDir,approvalDir].map(x=>mkdir(x,{mode:0o700})));
  const plan={
    schema_version:"1.0.0",plan_id:"r5-uncertain-review",session_id:"r5-crashed",
    version:1,repository:{authority:"gitea.local",owner:"thesis",
      repository:"console"},base_revision:SHA,
    requirement:"Recover possible child issuance without replay",
    candidate_agents:["backend","frontend","test"].map(role=>({
      agent_id:role,did:"did:example:"+role,card_ref:"trusted:"+role
    })),
    tasks:STEPS.map(([id,agent_id,,resource],i)=>({
      id,agent_id,title:id,description:"Signed "+id,
      depends_on:i?[STEPS[i-1][0]]:[],resources:[resource]
    })),
    requested_permissions:STEPS.map(([task_id,agent_id,operation,resource])=>({
      id:"permit-"+task_id,task_id,agent_id,operation,resource,
      reason:"Approved "+task_id
    })),assumptions:[],uncertainties:[]
  };
  const digest=planDigest(plan);
  const kp=generateKeyPairSync("ed25519"),now=new Date().toISOString();
  const approval=makeApproval(plan,{
    allowedOperations:new Set(RUST_OPERATIONS),decision_id:"recovery-approval",
    approved_by:DID,approved_at:now,
    approved_permission_ids:STEPS.map(x=>"permit-"+x[0])
  });
  const envelope=signEngineerApproval({
    plan,approval,engineerDid:DID,keyId:"r5-ed25519-recovery",
    privateKeyPem:kp.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    issuedAt:now,expiresAt:new Date(Date.now()+15*60_000).toISOString()
  });
  const receiptPath=join(approvalDir,"r5-crashed.json");
  await writeFile(receiptPath,JSON.stringify(envelope),{mode:0o600});
  const approvalStore=new SignedEngineerApprovalFileStore({
    directory:approvalDir,engineerDid:DID,trustedKeys:{
      "r5-ed25519-recovery":{
        engineer_did:DID,
        public_key_pem:kp.publicKey.export({type:"spki",format:"pem"}).toString()
      }
    }
  });
  const journal=new TrustedChildIssuanceJournal({
    directory:issueDir,sessionId:"r5-crashed",baseRevision:SHA,
    planDigest:digest,parentCredentialId:"urn:r5:operational"
  });
  const intent=taskId=>({taskId,role:taskId,
    credentialId:"urn:r5:child:"+taskId,
    statusListCredential:"https://status.example/r5",
    statusListIndex:({backend:"51",frontend:"52",test:"53"})[taskId]
  });
  await journal.recordIntent(intent("backend"));
  await journal.recordVerifiedResponse({
    taskId:"backend",credentialId:"urn:r5:child:backend"
  });
  await journal.recordIntent(intent("frontend"));
  const args={journal,approvalStore,sessionId:"r5-crashed",
    baseRevision:SHA,planDigestPin:digest,
    parentCredentialId:"urn:r5:operational",
    adapterBaseUrl:"http://127.0.0.1:8191",
    gatewayVerifierToken:"protected-gateway-verifier-token"};
  return {root,issueDir,approvalDir,receiptPath,journal,intent,args,
    close:()=>rm(root,{recursive:true,force:true})};
}
function fakeAdapter(change=()=>{}){
  const calls=[];
  const fetchFn=async(url,options)=>{
    calls.push({url,options});
    const credential_id=JSON.parse(options.body).credential_id;
    const data={credential_id,status_purpose:"revocation",status_set:true,
      source:"evm_anchored_signed_jwt",anchor_version:9};
    await change(data,calls.length);
    return {status:200,ok:true,text:async()=>JSON.stringify(data)};
  };
  return {calls,fetchFn};
}
test("R5 observes ACKed and UNCERTAIN attempts without clearing or retrying issuance",async()=>{
  const f=await fixture();
  try{
    const fake=fakeAdapter();
    const result=await observeR5UncertainChildIssuance({
      ...f.args,fetchFn:fake.fetchFn
    });
    assert.equal(result.observed_child_intent_count,2);
    assert.equal(result.uncertain_issuance_count,1);
    assert.equal(result.acked_child_count,1);
    assert.equal(result.safe_to_retry_child_issuance,false);
    assert.equal(result.external_r5_go,false);
    assert.equal(result.independent_evm_attestation,false);
    assert.equal(fake.calls.length,2);
    assert.deepEqual(fake.calls.map(x=>JSON.parse(x.options.body).credential_id)
      .sort(),["urn:r5:child:backend","urn:r5:child:frontend"]);
    assert.ok(fake.calls.every(x=>x.url===
      "http://127.0.0.1:8191/v1/credentials/status/inspect"&&
      x.options.method==="POST"&&
      x.options.headers.authorization==="Bearer protected-gateway-verifier-token"));
    assert.equal((await f.journal.records())
      .find(x=>x.task_id==="frontend").observation,"issuance_uncertain");
    assert.equal(JSON.stringify(result).includes("gateway-verifier-token"),false);
  }finally{await f.close();}
});
test("R5 active, memory-only, swapped and malformed child revocation answers fail closed",async()=>{
  const f=await fixture();
  try{
    for(const mutate of [
      x=>{x.status_set=false;},
      x=>{x.source="adapter_memory_only";},
      x=>{x.credential_id="urn:wrong";},
      x=>{x.anchor_version=0;},
      x=>{x.status_purpose="suspension";},
      x=>{delete x.anchor_version;}
    ]){
      const fake=fakeAdapter((row,i)=>{if(i===2)mutate(row);});
      await assert.rejects(observeR5UncertainChildIssuance({
        ...f.args,fetchFn:fake.fetchFn
      }),/NO-GO/);
      assert.equal(fake.calls.length,2);
    }
    await assert.rejects(observeR5UncertainChildIssuance({
      ...f.args,fetchFn:async()=>({status:404,ok:false,text:async()=>""})
    }),/NO-GO/);
  }finally{await f.close();}
});
test("R5 additional issuance during Adapter observation makes snapshot stale",async()=>{
  const f=await fixture();
  try{
    const fake=fakeAdapter(async(_,i)=>{
      if(i===1)await f.journal.recordIntent(f.intent("test"));
    });
    await assert.rejects(observeR5UncertainChildIssuance({
      ...f.args,fetchFn:fake.fetchFn
    }),/NO-GO.*changed during/);
    assert.equal((await f.journal.records()).length,3);
  }finally{await f.close();}
});
test("R5 wrong root, remote origin and forged real Engineer signature deny before HTTP",async()=>{
  const f=await fixture();
  try{
    for(const bad of [
      {parentCredentialId:"urn:other"},{baseRevision:"c".repeat(40)},
      {adapterBaseUrl:"http://example.org:8191"},
      {gatewayVerifierToken:"short"}
    ]){
      const fake=fakeAdapter();
      await assert.rejects(observeR5UncertainChildIssuance({
        ...f.args,...bad,fetchFn:fake.fetchFn
      }),/NO-GO/);
      assert.equal(fake.calls.length,0);
    }
    const receipt=JSON.parse(await readFile(f.receiptPath,"utf8"));
    receipt.approval.approved_permission_ids.pop();
    await writeFile(f.receiptPath,JSON.stringify(receipt));
    const fake=fakeAdapter();
    await assert.rejects(observeR5UncertainChildIssuance({
      ...f.args,fetchFn:fake.fetchFn
    }),/NO-GO/);
    assert.equal(fake.calls.length,0);
  }finally{await f.close();}
});
