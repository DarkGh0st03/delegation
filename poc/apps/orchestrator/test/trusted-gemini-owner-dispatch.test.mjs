import test from "node:test";
import assert from "node:assert/strict";
import {createProtectedGeminiOwnerDispatch}
  from "../src/trusted-gemini-owner-dispatch.mjs";

function deferred(){
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  return {promise,resolve,reject};
}
const roles=["backend","frontend","test"];
function fixture({verifySignedReview,runReviewedApprovedDagWithGateway,close}={}){
  const gateway=Object.freeze({
    gatewayBaseUrl:"http://127.0.0.1:8091",
    adapterBaseUrl:"http://127.0.0.1:8092",
    adapterToken:"original-private-adapter-token"
  });
  const coordinator={phase:"planning"};
  const reviewGate={approved:true},checkpointStore={verified:true};
  const planning=Object.freeze({gateway,coordinator,reviewGate,checkpointStore});
  const assembly=Object.freeze({planning,coordinator});
  const stats={reviews:0,handoffs:0,closes:0};
  const host={
    runReviewedApprovedDagWithGateway:args=>{
      stats.handoffs++;
      assert.equal(args.coordinator,coordinator);
      assert.equal(args.reviewGate,reviewGate);
      assert.equal(args.checkpointStore,checkpointStore);
      assert.equal(args.privateGatewayTransport.adapterToken,gateway.adapterToken);
      assert.equal(args.geminiApiKey,"fixture-private-api-key");
      return runReviewedApprovedDagWithGateway?.(args)??Promise.resolve({
        plan_digest:"a".repeat(64),completed_task_ids:["backend","frontend","test"]
      });
    },
    async close(){stats.closes++;return close?.();}
  };
  const owner=createProtectedGeminiOwnerDispatch({
    assembly,host,geminiApiKey:"fixture-private-api-key",
    verifySignedReview:async()=>{
      stats.reviews++;
      if(verifySignedReview)return verifySignedReview();
      return {authenticated_engineer_did:"did:example:engineer"};
    }
  });
  const input={
    runId:"40377700000",
    operationalRoot:{
      credential_id:"urn:approved-operational",
      valid_from:"2026-10-26T00:00:00Z",
      validity_seconds:900,
      credential_status:{statusPurpose:"revocation",statusListIndex:"991"}
    },
    ports:{backend:8131,frontend:8132,test:8133},
    transports:Object.fromEntries(roles.map((role,i)=>[role,{
      gatewayBaseUrl:gateway.gatewayBaseUrl,
      adapterBaseUrl:gateway.adapterBaseUrl,
      adapterToken:"separate-role-"+i+"-secret"
    }])),
    sendProtectedTask:async()=>({role:"test",status:"not-used"}),
    childStatusProvisioning:{
      reservationDirectory:"/private/child-allocations",
      statusListCredential:"https://example.test/status",
      indexByTask:{backend:202,frontend:203,test:204},
      excludedIndices:[201]
    }
  };
  return {owner,input,stats,coordinator};
}
test("unsigned review may be retried without consuming GitHub run; verified handoff remains one-shot",async()=>{
  let signed=false;
  const f=fixture({
    verifySignedReview:async()=>{
      if(!signed)throw Error("No independently signed Engineer receipt");
      return {authenticated_engineer_did:"did:example:engineer"};
    }
  });
  await assert.rejects(f.owner.runApprovedGeminiDag(f.input),
    /No independently signed Engineer receipt/);
  assert.equal(f.stats.handoffs,0);
  assert.equal(f.owner.status,"awaiting_human_review");
  signed=true;
  assert.equal((await f.owner.reviewReadiness()).authenticated_engineer_did,
    "did:example:engineer");
  const result=await f.owner.runApprovedGeminiDag(f.input);
  assert.equal(result.completed_task_ids.length,3);
  assert.equal(f.stats.handoffs,1);
  assert.throws(()=>f.owner.runApprovedGeminiDag(f.input),/already attempted/);
  await f.owner.close();
  await f.owner.close();
  assert.equal(f.stats.closes,1);
});
test("concurrent review and SIGTERM closes original host before any OIDC or operational root",async()=>{
  const gate=deferred(),closeStarted=deferred();
  const f=fixture({
    verifySignedReview:()=>gate.promise,
    close:()=>{closeStarted.resolve();}
  });
  const started=f.owner.runApprovedGeminiDag(f.input);
  assert.equal(f.owner.status,"signed_review_in_progress");
  assert.throws(()=>f.owner.runApprovedGeminiDag(f.input),/already attempted/);
  const stopping=f.owner.close();
  await closeStarted.promise;
  assert.equal(f.stats.closes,1);
  assert.equal(f.stats.handoffs,0);
  gate.resolve({authenticated_engineer_did:"did:example:engineer"});
  await assert.rejects(started,/signed review changed/);
  await stopping;
  assert.equal(f.stats.handoffs,0);
  assert.equal(f.owner.status,"closing_or_closed");
});
test("late A2A completion cannot override owner cancellation; close waits for in-flight result",async()=>{
  const dag=deferred(),hostClose=deferred();
  const f=fixture({
    runReviewedApprovedDagWithGateway:()=>dag.promise,
    close:()=>hostClose.promise
  });
  const started=f.owner.runApprovedGeminiDag(f.input);
  // The signed review is asynchronous, even though verification is local.
  await Promise.resolve();await Promise.resolve();
  assert.equal(f.stats.handoffs,1);
  const stopping=f.owner.close();
  assert.equal(f.owner.status,"closing_or_closed");
  assert.throws(()=>f.owner.runApprovedGeminiDag(f.input),/already attempted/);
  hostClose.resolve();
  dag.resolve({plan_digest:"a".repeat(64),completed_task_ids:["backend"]});
  await assert.rejects(started,/shutdown raced completed approved DAG/);
  await stopping;
  assert.equal(f.stats.closes,1);
  assert.equal(f.stats.handoffs,1);
});
test("unconfirmed native revocation cannot be reported as clean owner shutdown",async()=>{
  const f=fixture({close:async()=>{throw Error("native revocation unconfirmed");}});
  await assert.rejects(f.owner.close(),/native revocation unconfirmed/);
  await assert.rejects(f.owner.close(),/native revocation unconfirmed/);
  assert.equal(f.stats.closes,1);
  assert.equal(f.stats.handoffs,0);
});
test("forged execution arguments are rejected before Engineer receipt or GitHub admission",async()=>{
  const f=fixture();
  await assert.rejects(Promise.resolve().then(()=>f.owner.runApprovedGeminiDag({
    ...f.input,coordinator:{phase:"execution"}
  })),/Protected Gemini Execution binding denied/);
  assert.equal(f.stats.reviews,0);
  assert.equal(f.stats.handoffs,0);
  const result=await f.owner.runApprovedGeminiDag(f.input);
  assert.equal(result.completed_task_ids.length,3);
  assert.equal(f.stats.handoffs,1);
  await f.owner.close();
});
