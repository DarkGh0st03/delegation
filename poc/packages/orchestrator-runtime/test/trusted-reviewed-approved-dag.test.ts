import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SignedEngineerApprovalFileStore}
  from "../src/signed-approval-store.ts";
import {TrustedExecutionCoordinator}
  from "../src/trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate}
  from "../src/trusted-planning-review-gate.ts";
import {createReviewedApprovedDagExecution}
  from "../src/trusted-reviewed-approved-dag.ts";

const sha="a".repeat(40),digest="b".repeat(64);
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),"reviewed-dag-bridge-"));
  const pair=generateKeyPairSync("ed25519");
  const store=new SignedEngineerApprovalFileStore({
    directory,engineerDid:"did:test:engineer",
    trustedKeys:{pin:{
      engineer_did:"did:test:engineer",
      public_key_pem:pair.publicKey.export({format:"pem",type:"spki"}).toString()
    }}
  });
  const snapshot={
    session_id:"reviewed-session",base_revision:sha,
    repository:{authority:"gitea.local",owner:"demo",repository:"sample"},
    directories:["","src"],files:["src/service.ts"]
  };
  const gate=new TrustedPlanningReviewGate({
    snapshot,expectedWorkBranch:"feature/reviewed",
    authenticatedEngineerDid:"did:test:engineer",
    signedApprovals:store,planningIsActive:()=>false
  });
  const coordinator=new TrustedExecutionCoordinator({
    authority:{} as any,approvedGatewayPlans:{} as any,credentials:{} as any,
    sessionId:snapshot.session_id,baseRevision:sha
  });
  const running={
    readiness:{
      session_id:snapshot.session_id,
      base_revision:sha,plan_digest:digest,
      authenticated_engineer_did:"did:test:engineer"
    },
    operational_root_id:"urn:reviewed:root",
    endpoints:{
      backend:"http://127.0.0.1:18001",
      frontend:"http://127.0.0.1:18002",
      test:"http://127.0.0.1:18003"
    }
  };
  return {directory,gate,coordinator,running,close:()=>rm(directory,{
    recursive:true,force:true
  })};
}
test("private reviewed DAG bridge never executes before an active operational root",async()=>{
  const f=await fixture();
  try{
    let checked=0,closed=0;
    const bridge=createReviewedApprovedDagExecution({
      coordinator:f.coordinator,reviewGate:f.gate,running:f.running as any,
      async verifyLiveRun(){checked++;},
      async close(){closed++;}
    });
    assert.deepEqual(Object.keys(bridge),["executeApprovedDag"]);
    await assert.rejects(bridge.executeApprovedDag({} as any),
      /operational Execution is not active/);
    assert.equal(checked,1);
    assert.equal(closed,1);
    await assert.rejects(bridge.executeApprovedDag({} as any),
      /one-shot; retry forbidden/);
    assert.equal(checked,1);
    assert.equal(closed,1);
  }finally{await f.close();}
});
test("GitHub run freshness refusal blocks dispatcher and closes the session",async()=>{
  const f=await fixture();
  try{
    let closed=0;
    const bridge=createReviewedApprovedDagExecution({
      coordinator:f.coordinator,reviewGate:f.gate,running:f.running as any,
      async verifyLiveRun(){throw Error("GitHub job no longer active");},
      async close(){closed++;}
    });
    await assert.rejects(bridge.executeApprovedDag({} as any),
      /GitHub job no longer active/);
    assert.equal(closed,1);
  }finally{await f.close();}
});
test("reviewed DAG never accepts arbitrary endpoints, SHA or Engineer authority",async()=>{
  const f=await fixture();
  try{
    const base={
      coordinator:f.coordinator,reviewGate:f.gate,
      async verifyLiveRun(){},
      async close(){}
    };
    for(const endpoints of [
      {...f.running.endpoints,backend:"http://remote.example:9876"},
      {...f.running.endpoints,backend:f.running.endpoints.frontend},
      {...f.running.endpoints,test:"http://127.0.0.1:0"}
    ])assert.throws(()=>createReviewedApprovedDagExecution({
      ...base,running:{...f.running,endpoints} as any
    }),/distinct localhost/);
    for(const readiness of [
      {...f.running.readiness,base_revision:"bad"},
      {...f.running.readiness,plan_digest:"unapproved"},
      {...f.running.readiness,authenticated_engineer_did:"not-a-did"}
    ])assert.throws(()=>createReviewedApprovedDagExecution({
      ...base,running:{...f.running,readiness} as any
    }),/authenticated signed plan/);
  }finally{await f.close();}
});
