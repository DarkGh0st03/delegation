import test from "node:test";
import assert from "node:assert/strict";
import {awaitTrustedPrivateRunCompletion,readTrustedPrivateRunState}
  from "../src/trusted-github-oidc-submit.ts";

const base={
  intakeUrl:"https://127.0.0.1:14430/v1/trusted/github/oidc-admission",
  tls:{ca:"TEST-CA",cert:"TEST-CERT",key:"TEST-KEY",
    expectedServerFingerprint256:"AA:".repeat(31)+"AA"},
  runId:"40123456789",sourceSha:"a".repeat(40),
  maxWaitMs:5000,pollEveryMs:1000
};

test("protected runner keeps SAME job active until host reports verified signed DAG closure",async()=>{
  const states=["waiting_for_owner","execution_active","completed_verified"];
  let visits=0,sleeps=0;
  const done=await awaitTrustedPrivateRunCompletion({
    ...base,readState:async(input)=>{
      assert.equal(input.runId,base.runId);
      assert.equal(input.sourceSha,base.sourceSha);
      visits++;
      return states.shift() as any;
    },
    async sleep(){sleeps++;}
  });
  assert.deepEqual(done,{
    status:"verified_closed_no_runner_authority",
    run_id:base.runId,source_sha:base.sourceSha
  });
  assert.equal(visits,3);
  assert.equal(sleeps,2);
});

test("rejected Engineer decision or uncertain root revocation MUST fail GitHub job",async()=>{
  for(const history of [
    ["waiting_for_owner","terminated"],
    ["execution_active","terminated"],
    ["unknown_status"]
  ]){
    const values=[...history];
    await assert.rejects(awaitTrustedPrivateRunCompletion({
      ...base,
      readState:async()=>values.shift() as any,
      async sleep(){}
    }),/terminated without verified closure/);
  }
});

test("no admission or malformed runner session is never accepted as completion",async()=>{
  await assert.rejects(awaitTrustedPrivateRunCompletion({
    ...base,runId:"0",readState:async()=> "completed_verified",async sleep(){}
  }),/admission denied/);
  await assert.rejects(awaitTrustedPrivateRunCompletion({
    ...base,sourceSha:"bad",readState:async()=> "completed_verified",async sleep(){}
  }),/admission denied/);
  await assert.rejects(readTrustedPrivateRunState({
    ...base,runId:"0"
  }),/admission denied/);
});

test("a canceled runner cannot accept a delayed success from the host",async()=>{
  const stop=new AbortController();
  await assert.rejects(awaitTrustedPrivateRunCompletion({
    ...base,signal:stop.signal,
    readState:async()=>{
      stop.abort();
      return "completed_verified";
    },
    async sleep(){}
  }),/deadline|terminated without verified closure/);
});
