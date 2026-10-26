import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedReviewedHandoffLifecycle}
  from "../src/trusted-reviewed-handoff-lifecycle.mjs";
import {trustedEngineerRunStatus}
  from "../src/trusted-engineer-run-status.mjs";
import {awaitTrustedPrivateRunCompletion}
  from "../../../packages/orchestrator-runtime/src/trusted-github-oidc-submit.ts";

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
  assert.equal(lifecycle.verifiedOutcome,"verified_complete");
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
  assert.equal(lifecycle.verifiedOutcome,"failed");
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
  assert.equal(lifecycle.verifiedOutcome,"failed");
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
  assert.equal(lifecycle.verifiedOutcome,"failed");
});


test("completion stays PENDING while signed DAG root closure is in flight",async()=>{
  let releaseClose,enterClose;
  const blocked=new Promise(resolve=>{releaseClose=resolve;});
  const entering=new Promise(resolve=>{enterClose=resolve;});
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){
      enterClose();
      await blocked;
    },
    approvedDag:{
      async executeApprovedDag(){return {completed:true};}
    }
  }));
  const executing=lifecycle.runApprovedDag({},executor());
  await entering;
  assert.equal(lifecycle.status,"closing");
  assert.equal(lifecycle.verifiedOutcome,"pending");
  releaseClose();
  assert.deepEqual(await executing,{completed:true});
  assert.equal(lifecycle.verifiedOutcome,"verified_complete");
  assert.equal(lifecycle.status,"closed");
});


test("late-bound owner creates Gateway branch only AFTER signed root startup",async()=>{
  const events=[];
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>{
    events.push("issued-operational-root");
    return {
      async close(){events.push("revoked-operational-root");},
      approvedDag:{async executeApprovedDag(execution){
        events.push("trusted-DAG-execute");
        assert.equal(typeof execution.invokeOrchestratorTask,"function");
        return {completed_task_ids:["branch","backend","frontend","tests"]};
      }}
    };
  });
  const result=await lifecycle.runApprovedDagWithFactory({},async()=>{
    events.push("bound-Gateway-provider-after-issuance");
    return executor();
  });
  assert.deepEqual(result.completed_task_ids,
    ["branch","backend","frontend","tests"]);
  assert.deepEqual(events,[
    "issued-operational-root",
    "bound-Gateway-provider-after-issuance",
    "trusted-DAG-execute",
    "revoked-operational-root"
  ]);
  assert.equal(lifecycle.verifiedOutcome,"verified_complete");
});

test("Gateway provider initialization failure revokes root without dispatch",async()=>{
  let revoked=0,dispatched=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    approvedDag:{async executeApprovedDag(){dispatched++;}},
    async close(){revoked++;}
  }));
  await assert.rejects(lifecycle.runApprovedDagWithFactory({},async()=>{
    throw Error("signed Gateway branch could not be loaded");
  }),/signed Gateway branch could not be loaded/);
  assert.equal(revoked,1);
  assert.equal(dispatched,0);
  assert.equal(lifecycle.verifiedOutcome,"failed");
  assert.equal(lifecycle.status,"closed");
  await assert.rejects(lifecycle.runApprovedDagWithFactory({},async()=>executor()),
    /already attempted/);
});

test("late executor factory cannot return unsigned or malformed Task ports",async()=>{
  let revoked=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){revoked++;},
    approvedDag:{async executeApprovedDag(){
      throw Error("unapproved task must never execute");
    }}
  }));
  await assert.rejects(lifecycle.runApprovedDagWithFactory({},async()=>({
    ...executor(),invokeOrchestratorTask:null
  })),/owner-provisioned signed DAG executor/);
  assert.equal(revoked,1);
  assert.equal(lifecycle.verifiedOutcome,"failed");
});

test("host close during async Gateway factory refuses late side effects",async()=>{
  let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;});
  const waiting=new Promise(resolve=>{release=resolve;});
  let dispatched=0,revoked=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){revoked++;},
    approvedDag:{async executeApprovedDag(){dispatched++;}}
  }));
  const running=lifecycle.runApprovedDagWithFactory({},async()=>{
    enter();
    await waiting;
    return executor();
  });
  await entered;
  const stopping=lifecycle.close();
  release();
  await assert.rejects(running,/closed while binding Gateway executor/);
  await stopping;
  assert.equal(dispatched,0);
  assert.equal(revoked,1);
  assert.equal(lifecycle.verifiedOutcome,"failed");
});

test("missing trusted factory never consumes a one-use admission",async()=>{
  let started=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>{
    started++;
    throw Error("must not start");
  });
  assert.throws(()=>lifecycle.runApprovedDagWithFactory({},null),
    /owner-provisioned execution factory/);
  assert.equal(started,0);
  assert.equal(lifecycle.status,"idle");
});


test("late nominal DAG result cannot certify canceled Engineer host",async()=>{
  let reached,finish;
  const inFlight=new Promise(resolve=>{reached=resolve;});
  const wait=new Promise(resolve=>{finish=resolve;});
  let revoked=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    approvedDag:{async executeApprovedDag(){
      reached();
      await wait;
      return {completed:true};
    }},
    async close(){revoked++;}
  }));
  const executing=lifecycle.runApprovedDagWithFactory({},async()=>executor());
  await inFlight;
  await lifecycle.close();
  assert.equal(lifecycle.status,"closed");
  finish();
  await assert.rejects(executing,/shutdown raced approved DAG completion/);
  assert.equal(lifecycle.verifiedOutcome,"failed");
  assert.equal(revoked,1);
});

test("runner state remains execution_active until original Rust/Gateway closure verifier settles",async()=>{
  let enterVerify,releaseProof;
  const verifying=new Promise(resolve=>{enterVerify=resolve;});
  const proof=new Promise(resolve=>{releaseProof=resolve;});
  let revocations=0,proofCalls=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){revocations++;},
    approvedDag:{async executeApprovedDag(){
      return {completed_task_ids:["backend","frontend","test"]};
    }}
  }),{
    async verifyTerminalClosure(){
      proofCalls++;
      enterVerify();
      await proof;
    }
  });
  const input={runId:"40123456789",sourceSha:"a".repeat(40),
    intakeUrl:"https://127.0.0.1:14430/v1/trusted/github/oidc-admission",
    tls:{ca:"offline-test-ca",cert:"offline-test-cert",
      key:"offline-test-key",
      expectedServerFingerprint256:"AA:".repeat(31)+"AA"},
    maxWaitMs:5000,pollEveryMs:1000};
  const state=()=>trustedEngineerRunStatus({
    hostClosed:false,selectedRunId:input.runId,queriedRunId:input.runId,
    coordinatorPhase:"closed",handoffStatus:lifecycle.status,
    verifiedOutcome:lifecycle.verifiedOutcome
  });
  const executed=lifecycle.runApprovedDag({},executor());
  await verifying;
  assert.equal(revocations,1);
  assert.equal(proofCalls,1);
  assert.equal(lifecycle.status,"closed");
  assert.equal(lifecycle.verifiedOutcome,"pending");
  assert.equal(state(),"execution_active");
  let checked=0;
  const worker=awaitTrustedPrivateRunCompletion({
    ...input,readState:async()=>{checked++;return state();},
    async sleep(){releaseProof();await new Promise(r=>setImmediate(r));}
  });
  const [dag,completed]=await Promise.all([executed,worker]);
  assert.equal(dag.completed_task_ids.length,3);
  assert.equal(completed.status,"verified_closed_no_runner_authority");
  assert.ok(checked>=2);
  assert.equal(state(),"completed_verified");
  assert.equal(lifecycle.verifiedOutcome,"verified_complete");
});

test("failed native retirement after DAG and listener close terminates runner without verified receipt",async()=>{
  let closes=0;
  const lifecycle=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){closes++;},
    approvedDag:{async executeApprovedDag(){return {completed:true};}}
  }),{
    async verifyTerminalClosure(){
      throw Error("native operational root revocation unconfirmed");
    }
  });
  await assert.rejects(lifecycle.runApprovedDag({},executor()),
    /native operational root revocation unconfirmed/);
  assert.equal(closes,1);
  assert.equal(lifecycle.status,"closed");
  assert.equal(lifecycle.verifiedOutcome,"failed");
  const state=trustedEngineerRunStatus({
    hostClosed:false,
    selectedRunId:"40123456789",queriedRunId:"40123456789",
    coordinatorPhase:"closed",handoffStatus:lifecycle.status,
    verifiedOutcome:lifecycle.verifiedOutcome
  });
  assert.equal(state,"terminated");
  await assert.rejects(awaitTrustedPrivateRunCompletion({
    intakeUrl:"https://127.0.0.1:14430/v1/trusted/github/oidc-admission",
    runId:"40123456789",sourceSha:"a".repeat(40),
    maxWaitMs:5000,pollEveryMs:1000,
    readState:async()=>state,async sleep(){}
  }),/terminated without verified closure/);
});
