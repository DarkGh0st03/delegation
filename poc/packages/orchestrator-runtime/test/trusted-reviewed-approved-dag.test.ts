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
import {TrustedApprovedA2ADispatcher}
  from "../src/trusted-approved-a2a-dispatcher.ts";

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


test("R5 GitHub cancellation during the LAST signed Task denies terminal success and still retires root",async t=>{
  const f=await fixture();
  let githubActive=true,checks=0,closed=0,lastTaskEffects=0;
  // Mock ONLY the Task dispatcher after signed admission. This isolated
  // regression exercises the real shared terminal guard: no external
  // provider, model, Adapter or GitHub API is invoked by the fixture.
  t.mock.method(TrustedApprovedA2ADispatcher,
    "loadWithScopedChildAuthority",async()=>({
      async executeApprovedDag({beforeTask,beforeCompletion}:any){
        await beforeTask("last-test");
        lastTaskEffects++;
        githubActive=false; // cancellation occurs DURING final provider effect
        await beforeCompletion(); // must reject before root retirement
        return {completed_task_ids:["last-test"]};
      }
    } as any));
  try{
    Object.defineProperty(f.coordinator,"phase",{
      configurable:true,get:()=>"execution"
    });
    Object.defineProperty(f.coordinator,"trustedOperationalAuthority",{
      configurable:true,value:()=>({
        credential_id:f.running.operational_root_id,
        plan_digest:f.running.readiness.plan_digest,permissions:[]
      })
    });
    const bridge=createReviewedApprovedDagExecution({
      coordinator:f.coordinator,reviewGate:f.gate,running:f.running as any,
      async verifyLiveRun(){
        checks++;
        if(!githubActive)throw Error("GitHub last Task job canceled");
      },
      async close(){closed++;}
    });
    await assert.rejects(bridge.executeApprovedDag({
      a2a:{},adapter:{},
      authorityForTask:async()=>{throw Error("not used");},
      invokeOrchestratorTask:async()=>{throw Error("not used");}
    } as any),/GitHub last Task job canceled/);
    assert.equal(checks,3,
      "must verify before load, before final Task AND after completion");
    assert.equal(lastTaskEffects,1);
    assert.equal(closed,1,"canceling the final Task must close authority");
    await assert.rejects(bridge.executeApprovedDag({} as any),
      /one-shot; retry forbidden/);
    assert.equal(closed,1);
  }finally{await f.close();}
});

test("R5 final GitHub revalidation accepts a still-active job before root retirement",async t=>{
  const f=await fixture();
  let checks=0,closed=0,phase="execution",preClose=0;
  t.mock.method(TrustedApprovedA2ADispatcher,
    "loadWithScopedChildAuthority",async()=>({
      async executeApprovedDag({beforeTask,beforeCompletion}:any){
        await beforeTask("last-test");
        await beforeCompletion();
        preClose++;
        phase="closed"; // mirrors actual awaited closeExecution()
        return {completed_task_ids:["last-test"]};
      }
    } as any));
  try{
    Object.defineProperty(f.coordinator,"phase",{
      configurable:true,get:()=>phase
    });
    Object.defineProperty(f.coordinator,"trustedOperationalAuthority",{
      configurable:true,value:()=>({
        credential_id:f.running.operational_root_id,
        plan_digest:f.running.readiness.plan_digest,permissions:[]
      })
    });
    const bridge=createReviewedApprovedDagExecution({
      coordinator:f.coordinator,reviewGate:f.gate,running:f.running as any,
      async verifyLiveRun(){checks++;},
      async close(){closed++;}
    });
    const result=await bridge.executeApprovedDag({
      a2a:{},adapter:{},
      authorityForTask:async()=>{throw Error("not used");},
      invokeOrchestratorTask:async()=>{throw Error("not used");}
    } as any);
    assert.deepEqual(result,{completed_task_ids:["last-test"]});
    assert.equal(checks,4,
      "initial, last Task, pre-retirement and post-retirement GitHub checks");
    assert.equal(preClose,1);
    assert.equal(phase,"closed");
    assert.equal(closed,1);
  }finally{await f.close();}
});


test("R5 cannot accept a successful Task reply if native root closure was skipped",async t=>{
  const f=await fixture();
  let checked=0,hostClosed=0,phase="execution";
  t.mock.method(TrustedApprovedA2ADispatcher,
    "loadWithScopedChildAuthority",async()=>({
      async executeApprovedDag({beforeTask,beforeCompletion}:any){
        await beforeTask("last-test");
        await beforeCompletion();
        // A fabricated dispatcher outcome must NOT bypass the actual
        // Coordinator's durable closeExecution() contract.
        return {completed_task_ids:["last-test"]};
      }
    } as any));
  try{
    Object.defineProperty(f.coordinator,"phase",{
      configurable:true,get:()=>phase
    });
    Object.defineProperty(f.coordinator,"trustedOperationalAuthority",{
      configurable:true,value:()=>({
        credential_id:f.running.operational_root_id,
        plan_digest:f.running.readiness.plan_digest,permissions:[]
      })
    });
    const bridge=createReviewedApprovedDagExecution({
      coordinator:f.coordinator,reviewGate:f.gate,running:f.running as any,
      async verifyLiveRun(){checked++;},
      async close(){hostClosed++;phase="closed";}
    });
    await assert.rejects(bridge.executeApprovedDag({
      a2a:{},adapter:{},
      authorityForTask:async()=>{throw Error("not used");},
      invokeOrchestratorTask:async()=>{throw Error("not used");}
    } as any),/operational root not closed after signed DAG completion/);
    assert.equal(checked,3);
    assert.equal(hostClosed,1);
  }finally{await f.close();}
});

test("R5 GitHub cancellation during durable root retirement denies success",async t=>{
  const f=await fixture();
  let checked=0,hostClosed=0,phase="execution",active=true;
  t.mock.method(TrustedApprovedA2ADispatcher,
    "loadWithScopedChildAuthority",async()=>({
      async executeApprovedDag({beforeTask,beforeCompletion}:any){
        await beforeTask("last-test");
        await beforeCompletion();
        phase="closed";
        active=false; // canceled while awaiting durable Gateway/Rust closure
        return {completed_task_ids:["last-test"]};
      }
    } as any));
  try{
    Object.defineProperty(f.coordinator,"phase",{
      configurable:true,get:()=>phase
    });
    Object.defineProperty(f.coordinator,"trustedOperationalAuthority",{
      configurable:true,value:()=>({
        credential_id:f.running.operational_root_id,
        plan_digest:f.running.readiness.plan_digest,permissions:[]
      })
    });
    const bridge=createReviewedApprovedDagExecution({
      coordinator:f.coordinator,reviewGate:f.gate,running:f.running as any,
      async verifyLiveRun(){
        checked++;
        if(!active)throw Error("GitHub canceled during root retirement");
      },
      async close(){hostClosed++;}
    });
    await assert.rejects(bridge.executeApprovedDag({
      a2a:{},adapter:{},
      authorityForTask:async()=>{throw Error("not used");},
      invokeOrchestratorTask:async()=>{throw Error("not used");}
    } as any),/GitHub canceled during root retirement/);
    assert.equal(checked,4);
    assert.equal(hostClosed,1);
  }finally{await f.close();}
});
