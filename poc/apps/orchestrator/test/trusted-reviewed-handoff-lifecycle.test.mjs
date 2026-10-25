import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedReviewedHandoffLifecycle}
  from "../src/trusted-reviewed-handoff-lifecycle.mjs";

// No real model, JWT, Rust root or external API is used by these tests.
// They verify that the host-owned bridge always closes its delegated
// authority, including split-phase shutdown and one-shot races.
const executor=()=>({
  a2a:{},adapter:{},
  authorityForTask:async()=>({}),
  invokeOrchestratorTask:async()=>({})
});

test("owner's one-shot run executes exactly one approved DAG then closes",async()=>{
  let started=0,executed=0,closed=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async input=>{
    started++;
    assert.equal(input.session,"trusted");
    return {
      async close(){closed++;},
      approvedDag:{async executeApprovedDag(value){
        assert.equal(typeof value.authorityForTask,"function");
        executed++;
        return {completed:true};
      }}
    };
  });
  const output=await lifecycle.runApprovedDag({session:"trusted"},executor());
  assert.deepEqual(output,{completed:true});
  assert.deepEqual([started,executed,closed],[1,1,1]);
  assert.equal(lifecycle.status,"closed");
  await assert.rejects(lifecycle.runApprovedDag({},executor()),/already attempted/);
  assert.deepEqual([started,executed,closed],[1,1,1]);
});

test("missing owner executor is rejected without consuming admission",async()=>{
  let started=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>{
    started++;
    throw Error("should never start");
  });
  await assert.rejects(lifecycle.runApprovedDag({},{}),/owner-provisioned/);
  assert.equal(started,0);
  assert.equal(lifecycle.status,"idle");
});

test("dispatcher failure always closes and prevents retry",async()=>{
  let calls=0,closed=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){closed++;},
    approvedDag:{async executeApprovedDag(){
      calls++;
      throw Error("A2A provider offline");
    }}
  }));
  await assert.rejects(lifecycle.runApprovedDag({},executor()),/A2A provider offline/);
  assert.equal(lifecycle.status,"closed");
  assert.equal(closed,1);
  assert.equal(calls,1);
  await assert.rejects(lifecycle.runApprovedDag({},executor()),/already attempted/);
});

test("absence of the canonical signed dispatcher fails closed",async()=>{
  let closed=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){closed++;}
  }));
  await assert.rejects(lifecycle.runApprovedDag({},executor()),
    /missing canonical signed DAG dispatcher/);
  assert.equal(closed,1);
  assert.equal(lifecycle.status,"closed");
});

test("start rejection cannot be reported as a confirmed root revocation",async()=>{
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>{
    throw Error("issuance acknowledgment lost");
  });
  await assert.rejects(lifecycle.runApprovedDag({},executor()),
    /manual reconciliation required/);
  assert.equal(lifecycle.status,"closing");
});

test("host close racing asynchronous handoff prevents dispatch and closes authority",async()=>{
  let release,started=0,executed=0,closed=0;
  const waiting=new Promise(resolve=>{release=resolve;});
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>{
    started++;
    await waiting;
    return {
      async close(){closed++;},
      approvedDag:{async executeApprovedDag(){executed++;}}
    };
  });
  const running=lifecycle.runApprovedDag({},executor());
  await Promise.resolve();
  const stopping=lifecycle.close();
  release();
  await assert.rejects(running,/started after Engineer host shutdown/);
  await stopping;
  assert.deepEqual([started,executed,closed],[1,0,1]);
  assert.equal(lifecycle.status,"closed");
});

test("unconfirmed root closure is never masked as successful dispatch",async()=>{
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){throw Error("native revocation not confirmed");},
    approvedDag:{async executeApprovedDag(){return "task completed";}}
  }));
  await assert.rejects(lifecycle.runApprovedDag({},executor()),
    /native revocation not confirmed/);
  assert.equal(lifecycle.status,"closing");
});
