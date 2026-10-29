import test from "node:test";
import assert from "node:assert/strict";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans,
  type TrustedCompletionEvidence} from "../src/approved-execution-plans.ts";
import {GatewayRuntime} from "../src/runtime.ts";
import {InMemoryAuditSink,InMemoryRequestStore} from "../src/prepare.ts";
import {MockExecutor} from "../src/mock-executor.ts";
import {GatewayError} from "../src/errors.ts";
import type {
  AgentRole,ExecutionPort,ExecutionResult,PreparedRequestRecord
} from "../src/types.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const uri="gitea://gitea.local/thesis/iam-console-poc";
const branch="feature/approved";
const file=uri+"/branches/feature%2Fapproved/files/apps/backend/user.ts";
const testBranch=uri+"/branches/feature%2Fapproved";
const sha="a".repeat(40),did="did:thesis:engineer";
const operations=new Set<string>(RUST_OPERATIONS);
const plan=()=>({
  schema_version:"1.0.0",plan_id:"p1",session_id:"session-approval",
  version:1,repository:repo,base_revision:sha,
  requirement:"Work only within a reviewed task plan",
  candidate_agents:[
    {agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"},
    {agent_id:"test",did:"did:thesis:test",card_ref:"trusted:test"}
  ],
  tasks:[
    {id:"bootstrap",agent_id:"orchestrator",title:"Prepare branch",
     description:"Create approved working branch",depends_on:[],resources:[uri]},
    {id:"backend-task",agent_id:"backend",title:"Implement backend",
     description:"Update one approved file",depends_on:["bootstrap"],resources:[file]},
    {id:"tests",agent_id:"test",title:"Run exact tests",
     description:"Check implementation",depends_on:["backend-task"],resources:[testBranch]}
  ],
  requested_permissions:[
    {id:"p-branch",task_id:"bootstrap",agent_id:"orchestrator",resource:uri,
     operation:"create_branch",reason:"Create feature branch"},
    {id:"p-backend",task_id:"backend-task",agent_id:"backend",resource:file,
     operation:"update_file",reason:"Change approved file"},
    {id:"p-test",task_id:"tests",agent_id:"test",resource:testBranch,
     operation:"run_tests",reason:"Run approved tests"}
  ],
  assumptions:[],uncertainties:[]
});
function approval(p:ReturnType<typeof plan>,ids=["p-branch","p-backend","p-test"]){
  return makeApproval(p,{allowedOperations:operations,
    decision_id:"decision-1",approved_by:did,
    approved_at:"2026-10-21T09:00:00Z",
    approved_permission_ids:ids});
}

type Access=ReturnType<typeof harness>;
function harness(options:{
  configuredPlan?:ReturnType<typeof plan>;
  approvedIds?:string[];
  correctEngineer?:boolean;
  attestation?:boolean;
  onAttestation?:(planTaskId:string,evidence:Readonly<TrustedCompletionEvidence>)=>Promise<void>;
  simulated?:boolean;
  wrongPresenter?:boolean;
  skipPolicyDigestCheck?:boolean;
  incompleteRunnerAcceptance?:boolean;
  fullRunnerPassPhases?:boolean;
  runnerRevisions?:string[];
  testWriteRevisions?:string[];
  operationalLeaseMs?:number;
  nowMs?:()=>number;
}={}){
  const p=options.configuredPlan??plan();
  const a=approval(p,options.approvedIds);
  let attestCalls=0,providerCalls=0,verifiedCalls=0,opaCalls=0;
  let testWrites=0,runnerRuns=0;
  const gates=new TrustedApprovedExecutionPlans({
    repository:repo,engineerDid:did,
    ...(options.operationalLeaseMs===undefined?{}:{
      operationalLeaseMs:options.operationalLeaseMs,
      ...(options.nowMs?{nowMs:options.nowMs}:{})
    }),
    approvals:{async loadAuthenticatedApproval(sessionId){
      assert.equal(sessionId,"session-approval");
      return {
        plan:structuredClone(p),approval:structuredClone(a),
        authenticated_engineer_did:options.correctEngineer===false?
          "did:thesis:attacker":did
      };
    }},
    completionAttestor:{async confirmCompleted(e){
      attestCalls++;
      assert.match(e.plan_digest,/^[a-f0-9]{64}$/u);
      assert.ok(e.successful_gateway_request_ids.length>0);
      if(options.onAttestation)await options.onAttestation(e.plan_task_id,e);
      return options.attestation!==false;
    }}
  });
  const audit=new InMemoryAuditSink(),store=new InMemoryRequestStore();
  const executor:ExecutionPort=options.simulated?new MockExecutor():{
    provider:"gitea",
    providerFor(record){return record.request.tool==="run_tests"?"runner":"gitea";},
    async execute(record):Promise<ExecutionResult>{
      providerCalls++;
      const req=record.request;
      if(req.tool==="create_branch")return{
        provider:"gitea",performed:true,tool:"create_branch",
        branch:req.arguments.branch,base_branch:req.arguments.base_branch,
        revision:sha,commit_sha:sha
      };
      if(req.tool==="read_file")return {
        provider:"gitea",performed:true,tool:"read_file",
        branch:req.arguments.branch,path:req.arguments.path,
        revision:sha,blob_sha:"safe-blob-sha",last_commit_sha:sha,
        size:31,encoding:"utf-8",
        content:"PRIVATE_REPOSITORY_SOURCE_NOT_FOR_ATTESTATION"
      };
      if(req.tool==="update_file"){
        const revision=record.agent_role==="test"
          ?(options.testWriteRevisions?.[testWrites++]??sha):sha;
        return {
          provider:"gitea",performed:true,tool:"update_file",
          branch:req.arguments.branch,path:req.arguments.path,
          revision,commit_sha:revision,blob_sha:"b",precondition_blob_sha:"a"
        };
      }
      if(req.tool==="run_tests"){
        const revision=options.runnerRevisions?.[runnerRuns++]??sha;
        return {
        provider:"runner",performed:true,tool:"run_tests",
        branch:req.arguments.branch,revision,tested_commit_sha:revision,
        runner_profile:"poc-default",status:"pass",
        phases:options.fullRunnerPassPhases?[
          "dependency_install","typecheck","backend_tests",
          "frontend_tests","build","playwright_e2e",
          "researcher_acceptance"
        ].map(phase=>({phase,status:"pass" as const})):[],
        ...(options.incompleteRunnerAcceptance?{}:{
          project_tests:{status:"pass"},
          researcher_acceptance:{status:"pass"}
        })
        };
      }
      throw Error("unapproved provider operation");
    }
  };
  const runtime=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",request_ttl_ms:120_000,repository:repo},
    adapter_url:"http://none",adapter_gateway_token:"test-only",
    opa_url:"http://none",opa_timeout_ms:1000,
    provider_mode:"mock",gitea_timeout_ms:1000
  },{
    approvedPlans:gates,store,audit,executor,
    verifier:{async verify(request){
      verifiedCalls++;
      return {
        presenter_id:options.wrongPresenter && request.presenter==="backend"
          ? "did:thesis:attacker" : "did:thesis:"+request.presenter,
        issuer_id:did,credential_id:"urn:delegation:delegated",
        permissions:[request.required_permission],hierarchy_depth:1,
        expiration:"999999999999999"
      };
    }},
    policy:{async evaluate(input){
      opaCalls++;
      if(!options.skipPolicyDigestCheck) {
        assert.equal(input.approved_plan_digest,planDigest(p));
      }
      return {allow:true,policy_version:"policy-test"};
    }}
  });
  let i=0;
  const invoke=async(runtimeTaskId:string,role:AgentRole,tool:string,
      args:Record<string,unknown>)=>{
    const prepared=runtime.prepare({
      task_id:runtimeTaskId,agent_role:role,tool,arguments:args
    });
    const record=store.get(prepared.request_id);
    assert.equal(record?.approved_plan_digest,planDigest(p));
    assert.ok(record?.approved_plan_task_id);
    const response=await runtime.execute({
      request_id:prepared.request_id,signed_vp:"signed.vp.jwt"
    });
    i++;
    return response;
  };
  return {
    gates,runtime,store,audit,executor,invoke,
    get providerCalls(){return providerCalls;},
    get attestCalls(){return attestCalls;},
    get verifiedCalls(){return verifiedCalls;},
    get opaCalls(){return opaCalls;}
  };
}
async function activated(h:Access){
  assert.equal(await h.gates.activate("session-approval",sha),planDigest(plan()));
  h.gates.bindTask("session-approval","bootstrap","a2a-bootstrap","orchestrator");
  h.gates.bindTask("session-approval","backend-task","a2a-backend","backend");
  h.gates.bindTask("session-approval","tests","a2a-tests","test");
}
const branchArgs={base_branch:"main",branch};
const updateArgs={branch,path:"apps/backend/user.ts",content:"// approved update"};

test("approval activates exact SHA/digest, binds tasks and blocks dependent task until trusted completion",async()=>{
  const h=harness();
  await activated(h);
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-backend",agent_role:"backend",
    tool:"update_file",arguments:updateArgs
  }), (e:unknown)=>e instanceof GatewayError&&e.code==="approved_plan_denied");
  assert.equal(h.store.size(),0);
  const r=await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  assert.equal(r.execution.performed,true);
  assert.equal(h.providerCalls,1);
  assert.equal(h.verifiedCalls,1);
  assert.equal(h.opaCalls,1);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  assert.equal(h.attestCalls,1);
  await h.invoke("a2a-backend","backend","update_file",updateArgs);
  assert.equal(h.providerCalls,2);
  await h.gates.confirmTaskCompletion("a2a-backend");
  await h.invoke("a2a-tests","test","run_tests",{branch,profile:"poc-default"});
  assert.equal(h.providerCalls,3);
  const p=h.audit.events.find(e=>e.event==="authorization_prepared");
  assert.equal(p?.approved_plan_digest,planDigest(plan()));
  const result=h.audit.events.filter(e=>e.event==="authorization_executed").at(-1);
  assert.equal(result?.approved_plan_digest,planDigest(plan()));
});

test("R80 actual verified read-only Gateway Task attests metadata without retaining source",async()=>{
  const p=plan();
  const perm=p.requested_permissions.find(x=>x.id==="p-backend");
  assert.ok(perm);
  perm.operation="read_file";
  perm.reason="Read approved repository source without mutation";
  const h=harness({configuredPlan:p,onAttestation:async(taskId,evidence)=>{
    if(taskId!=="backend-task")return;
    assert.equal(evidence.provider_effects.length,1);
    const effect=evidence.provider_effects[0]!;
    assert.equal(effect.tool,"read_file");
    assert.equal(effect.execution.provider,"gitea");
    assert.equal(effect.execution.tool,"read_file");
    assert.equal("content" in effect.execution,false,
      "Raw repository contents must never be retained as Gateway attestation evidence");
    assert.ok(!JSON.stringify(evidence).includes(
      "PRIVATE_REPOSITORY_SOURCE_NOT_FOR_ATTESTATION"));
  }});
  assert.equal(await h.gates.activate("session-approval",sha),planDigest(p));
  h.gates.bindTask("session-approval","bootstrap","a2a-bootstrap","orchestrator");
  h.gates.bindTask("session-approval","backend-task","a2a-backend","backend");
  h.gates.bindTask("session-approval","tests","a2a-tests","test");
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  const read=await h.invoke("a2a-backend","backend","read_file",{
    branch,path:"apps/backend/user.ts"
  });
  assert.equal(read.execution.tool,"read_file");
  if(read.execution.tool==="read_file")
    assert.equal(read.execution.content,
      "PRIVATE_REPOSITORY_SOURCE_NOT_FOR_ATTESTATION");
  // A read-only Task can now be independently completed. This does NOT
  // confer write permissions, passing tests or downstream PR authority.
  await h.gates.confirmTaskCompletion("a2a-backend");
  assert.equal(h.attestCalls,2);
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-backend",agent_role:"backend",
    tool:"update_file",arguments:updateArgs
  }), (e:unknown)=>e instanceof GatewayError&&
    e.code==="approved_plan_denied");
});

test("valid VP+OPA cannot authorize unapproved operation, URI, wrong role, task or missing binding",async()=>{
  const h=harness();await activated(h);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  const denied=[
    {task_id:"a2a-backend",agent_role:"backend",tool:"read_file",
     arguments:{branch,path:"apps/backend/user.ts"}},
    {task_id:"a2a-backend",agent_role:"backend",tool:"update_file",
     arguments:{branch,path:"apps/frontend/other.ts",content:"x"}},
    {task_id:"a2a-backend",agent_role:"frontend",tool:"update_file",
     arguments:updateArgs},
    {task_id:"a2a-injected",agent_role:"backend",tool:"update_file",
     arguments:updateArgs},
    {task_id:"a2a-backend",agent_role:"backend",tool:"create_pull_request",
     arguments:{head_branch:branch,base_branch:"main",title:"unsafe"}}
  ];
  for(const body of denied){
    assert.throws(()=>h.runtime.prepare(body),
      (e:unknown)=>e instanceof GatewayError&&e.code==="approved_plan_denied");
  }
  assert.equal(h.providerCalls,1);
  assert.throws(()=>h.gates.bindTask("session-approval","backend-task","a2a-extra","frontend"),
    /not assigned/);
  assert.throws(()=>h.gates.bindTask("session-approval","backend-task","a2a-backend","backend"),
    /duplicate/);
});

test("approval store is authenticated, immutable and bound to exact Gitea base revision",async()=>{
  const h=harness({correctEngineer:false});
  await assert.rejects(h.gates.activate("session-approval",sha),/authenticated/);
  assert.equal(h.store.size(),0);
  await assert.rejects(h.gates.activate("session-approval",sha),/already installed or closed/);

  const h2=harness();
  await assert.rejects(h2.gates.activate("session-approval","b".repeat(40)),
    /does not match trusted Gitea snapshot/);
});

test("unapproved permission ID cannot be exercised even when assigned to a valid task",async()=>{
  const h=harness({approvedIds:["p-branch"]});
  await activated(h);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-backend",agent_role:"backend",
    tool:"update_file",arguments:updateArgs
  }),/approved plan/);
  assert.equal(h.providerCalls,1);
});

test("prepared authorization cannot execute after trusted plan session closure, even with VP/OPA allow",async()=>{
  const h=harness();await activated(h);
  const prepared=h.runtime.prepare({
    task_id:"a2a-bootstrap",agent_role:"orchestrator",tool:"create_branch",
    arguments:branchArgs
  });
  h.gates.closeSession("session-approval");
  await assert.rejects(h.runtime.execute({
    request_id:prepared.request_id,signed_vp:"signed.vp.jwt"
  }),(e:unknown)=>e instanceof GatewayError&&e.code==="approved_plan_denied");
  assert.equal(h.providerCalls,0);
  assert.equal(h.verifiedCalls,1);
  assert.equal(h.opaCalls,1);
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-bootstrap",agent_role:"orchestrator",tool:"create_branch",
    arguments:branchArgs
  }),/active/);
  const denied=h.audit.events.filter(e=>e.event==="authorization_executed").at(-1);
  assert.equal(denied?.reason,"approved_plan_denied");
  assert.equal(denied?.provider_result,"not_called");
});

test("task completion requires real provider effect and independent trusted attestation",async()=>{
  const h=harness({simulated:true});
  await activated(h);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await assert.rejects(h.gates.confirmTaskCompletion("a2a-bootstrap"),
    /confirmed provider effects/);
  const h2=harness({attestation:false});await activated(h2);
  await h2.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await assert.rejects(h2.gates.confirmTaskCompletion("a2a-bootstrap"),
    /No verified A2A task completion/);
  assert.throws(()=>h2.runtime.prepare({
    task_id:"a2a-backend",agent_role:"backend",
    tool:"update_file",arguments:updateArgs
  }),/approved plan/);
});

test("tampered prepared Task, role, plan digest or permission fails after VP/OPA",async()=>{
  for(const mutate of [
    (record:PreparedRequestRecord)=>{record.approved_plan_digest="f".repeat(64);},
    (record:PreparedRequestRecord)=>{record.approved_plan_task_id="backend-task";},
    (record:PreparedRequestRecord)=>{record.agent_role="backend";},
    (record:PreparedRequestRecord)=>{record.required_permission.operation="read_repository";}
  ]){
    const h=harness({skipPolicyDigestCheck:true});await activated(h);
    const p=h.runtime.prepare({
      task_id:"a2a-bootstrap",agent_role:"orchestrator",
      tool:"create_branch",arguments:branchArgs
    });
    const record=h.store.get(p.request_id)!;
    mutate(record);
    await assert.rejects(h.runtime.execute({
      request_id:p.request_id,signed_vp:"signed.jwt.vp"
    }),/approved plan|verified|denied/);
    assert.equal(h.providerCalls,0);
  }
});

test("runtime remains backward compatible when approved plan guard is not installed",async()=>{
  const executor=new MockExecutor();
  const runtime=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",request_ttl_ms:100_000,repository:repo},
    adapter_url:"http://unused",adapter_gateway_token:"unused",
    opa_url:"http://unused",opa_timeout_ms:1000,
    provider_mode:"mock",gitea_timeout_ms:1000
  },{
    executor,verifier:{async verify(req){
      return {presenter_id:"did:thesis:orchestrator",issuer_id:did,
        credential_id:"vc",permissions:[req.required_permission],
        hierarchy_depth:1,expiration:"999999999"};
    }},policy:{async evaluate(){return {allow:true,policy_version:"baseline"};}}
  });
  const p=runtime.prepare({
    task_id:"legacy-task",agent_role:"orchestrator",
    tool:"create_branch",arguments:branchArgs
  });
  const result=await runtime.execute({request_id:p.request_id,signed_vp:"jwt"});
  assert.equal(result.execution.provider,"mock");
  assert.equal(executor.callCount,1);
});

test("valid VP/OPA permission cannot authorize the wrong DID for an approved agent",async()=>{
  const h=harness({wrongPresenter:true});
  await activated(h);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  const p=h.runtime.prepare({
    task_id:"a2a-backend",agent_role:"backend",
    tool:"update_file",arguments:updateArgs
  });
  await assert.rejects(h.runtime.execute({
    request_id:p.request_id,signed_vp:"signed"
  }),(error:unknown)=>error instanceof GatewayError&&
      error.code==="approved_plan_denied");
  assert.equal(h.opaCalls,2);
  assert.equal(h.providerCalls,1);
});


test("trusted signed-plan working branch restricts even repository-root create_branch permission",async()=>{
 const h=harness();
 await activated(h);
 assert.equal(h.store.size(),0);
 for(const wrong of ["feature/attacker","main","feature/account-suspension"]){
   assert.throws(()=>h.runtime.prepare({
     task_id:"a2a-bootstrap",agent_role:"orchestrator",
     tool:"create_branch",arguments:{base_branch:"main",branch:wrong}
   }),(e:unknown)=>e instanceof GatewayError&&e.code==="approved_plan_denied");
 }
 assert.throws(()=>h.runtime.prepare({
   task_id:"a2a-bootstrap",agent_role:"orchestrator",
   tool:"create_branch",arguments:{base_branch:"develop",branch}
 }),(e:unknown)=>e instanceof GatewayError&&e.code==="approved_plan_denied");
 assert.equal(h.store.size(),0);
 assert.equal(h.providerCalls,0);
 await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
 assert.equal(h.providerCalls,1);
 assert.equal(h.opaCalls,1);
});


test("Gateway lease after Engineer crash denies new Prepare and previously prepared VP even if OPA allows",async()=>{
  let now=1_000_000;
  const h=harness({operationalLeaseMs:30_000,nowMs:()=>now});
  assert.equal(h.gates.operationalLeaseConfigured(),true);
  await activated(h);
  const pre=h.runtime.prepare({
    task_id:"a2a-bootstrap",agent_role:"orchestrator",
    tool:"create_branch",arguments:branchArgs
  });
  assert.equal(h.store.size(),1);
  // The Engineer disappears: there is NO close event and no renewal.
  // Independently enforced expiry is checked by the live Gateway itself.
  now+=30_000;
  await assert.rejects(h.runtime.execute({
    request_id:pre.request_id,signed_vp:"signed.vp.jwt"
  }), (e:unknown)=>e instanceof GatewayError&&
      e.code==="approved_plan_denied");
  assert.equal(h.providerCalls,0);
  assert.equal(h.verifiedCalls,1);
  assert.equal(h.opaCalls,1);
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-bootstrap",agent_role:"orchestrator",
    tool:"create_branch",arguments:branchArgs
  }), /No active trusted plan/);
  assert.throws(()=>h.gates.renewLease(
    "session-approval",planDigest(plan())
  ),/No active trusted plan/);
  now-=29_000; // time rollback must never reopen an expired lease
  assert.throws(()=>h.gates.renewLease(
    "session-approval",planDigest(plan())
  ),/No active trusted plan/);
});

test("only a live exact-digest Gateway lease renews; stale/foreign lease cannot resurrect",async()=>{
  let now=1_000_000;
  const h=harness({operationalLeaseMs:45_000,nowMs:()=>now});
  await activated(h);
  assert.throws(()=>h.gates.renewLease(
    "session-approval","a".repeat(64)
  ),/digest mismatch/);
  now+=15_000;
  h.gates.renewLease("session-approval",planDigest(plan()));
  now+=35_000; // beyond initial 45 sec, inside renewed 60 sec
  const prepare=h.runtime.prepare({
    task_id:"a2a-bootstrap",agent_role:"orchestrator",
    tool:"create_branch",arguments:branchArgs
  });
  assert.ok(prepare.request_id);
  now+=10_000;
  assert.throws(()=>h.gates.bindTask(
    "session-approval","bootstrap","new-task","orchestrator"
  ),/plan/);
  await assert.rejects(h.runtime.execute({
    request_id:prepare.request_id,signed_vp:"signed.vp.jwt"
  }),/approved plan/);
  assert.equal(h.providerCalls,0);
  assert.throws(()=>new TrustedApprovedExecutionPlans({
    repository:repo,engineerDid:did,
    approvals:{async loadAuthenticatedApproval(){return{
      plan:plan(),approval:approval(plan()),authenticated_engineer_did:did
    };}},
    completionAttestor:{async confirmCompleted(){return true;}},
    operationalLeaseMs:900_000
  }),/10-120 seconds/);
});


test("approved PR is pinned to trusted completed Runner SHA, not model text",async()=>{
  const p=plan();
  p.tasks.push({
    id:"pr",agent_id:"orchestrator",title:"Request reviewed PR",
    description:"Open tested feature for human review",
    depends_on:["tests"],resources:[uri]
  });
  p.requested_permissions.push({
    id:"p-pr",task_id:"pr",agent_id:"orchestrator",
    resource:uri,operation:"create_pull_request",reason:"Human review"
  });
  const h=harness({configuredPlan:p,
    approvedIds:["p-branch","p-backend","p-test","p-pr"]});
  await h.gates.activate("session-approval",sha);
  h.gates.bindTask("session-approval","bootstrap","a2a-bootstrap","orchestrator");
  h.gates.bindTask("session-approval","backend-task","a2a-backend","backend");
  h.gates.bindTask("session-approval","tests","a2a-tests","test");
  h.gates.bindTask("session-approval","pr","a2a-pr","orchestrator");
  const request={task_id:"a2a-pr",agent_role:"orchestrator",
    tool:"create_pull_request",arguments:{
      head_branch:branch,base_branch:"main",title:"Review tested revision"}};
  assert.throws(()=>h.runtime.prepare(request),
    (e:unknown)=>e instanceof GatewayError&&e.code==="approved_plan_denied");
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  await h.invoke("a2a-backend","backend","update_file",updateArgs);
  await h.gates.confirmTaskCompletion("a2a-backend");
  await h.invoke("a2a-tests","test","run_tests",{
    branch,profile:"poc-default"
  });
  assert.throws(()=>h.runtime.prepare(request),
    (e:unknown)=>e instanceof GatewayError&&e.code==="approved_plan_denied");
  await h.gates.confirmTaskCompletion("a2a-tests");
  const prepared=h.runtime.prepare(request);
  const row=h.store.get(prepared.request_id);
  assert.equal(row?.approved_tested_head_sha,sha);
  // Even after an approved Prepare, the exact authenticated SHA must remain
  // unchanged at Execute; public caller args have no trusted-SHA field.
  if(!row)throw Error("Missing prepared record");
  row.approved_tested_head_sha="b".repeat(40);
  await assert.rejects(()=>h.runtime.execute({
    request_id:prepared.request_id,signed_vp:"signed.vp.jwt"
  }),(e:unknown)=>e instanceof GatewayError&&
     e.code==="approved_plan_denied");
});


test("signed test Task with incomplete Runner outcome NEVER enables PR",async()=>{
  const p=plan();
  p.tasks.push({id:"pr",agent_id:"orchestrator",title:"Submit tested PR",
    description:"Human review of completed work",
    depends_on:["tests"],resources:[uri]});
  p.requested_permissions.push({id:"p-pr",task_id:"pr",
    agent_id:"orchestrator",resource:uri,operation:"create_pull_request",
    reason:"Review only"});
  const h=harness({configuredPlan:p,incompleteRunnerAcceptance:true,
    approvedIds:["p-branch","p-backend","p-test","p-pr"]});
  await h.gates.activate("session-approval",sha);
  for(const [planTask,runtimeTask,role] of [
    ["bootstrap","a2a-bootstrap","orchestrator"],
    ["backend-task","a2a-backend","backend"],
    ["tests","a2a-tests","test"],
    ["pr","a2a-pr","orchestrator"]
  ] as const)h.gates.bindTask("session-approval",planTask,runtimeTask,role);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  await h.invoke("a2a-backend","backend","update_file",updateArgs);
  await h.gates.confirmTaskCompletion("a2a-backend");
  await h.invoke("a2a-tests","test","run_tests",{branch,profile:"poc-default"});
  // Legacy fixtures may still attest a Task's completion, but cannot
  // smuggle an incomplete Runner result into the new exact-SHA PR gate.
  await h.gates.confirmTaskCompletion("a2a-tests");
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-pr",agent_role:"orchestrator",
    tool:"create_pull_request",
    arguments:{head_branch:branch,base_branch:"main",title:"Unverified PR"}
  }),(e:unknown)=>e instanceof GatewayError&&
      e.code==="approved_plan_denied");
  assert.equal(h.providerCalls,3);
});

test("model-proposed PR permission omitted from signed Engineer receipt is denied",async()=>{
  const p=plan();
  p.tasks.push({id:"pr",agent_id:"orchestrator",title:"Submit PR",
    description:"Human review of exact tested changes",
    depends_on:["tests"],resources:[uri]});
  p.requested_permissions.push({id:"p-pr",task_id:"pr",
    agent_id:"orchestrator",resource:uri,operation:"create_pull_request",
    reason:"Request review"});
  const h=harness({configuredPlan:p,
    approvedIds:["p-branch","p-backend","p-test"]});
  await h.gates.activate("session-approval",sha);
  h.gates.bindTask("session-approval","pr","a2a-pr","orchestrator");
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-pr",agent_role:"orchestrator",
    tool:"create_pull_request",
    arguments:{head_branch:branch,base_branch:"main",title:"Unapproved PR"}
  }),(e:unknown)=>e instanceof GatewayError&&
      e.code==="approved_plan_denied");
  assert.equal(h.providerCalls,0);
  assert.equal(h.store.size(),0);
});


test("an approved file edit AFTER passing tests invalidates the earlier PR SHA",async()=>{
  const p=plan();
  const latePath="apps/backend/audit.ts";
  const lateUri=testBranch+"/files/"+latePath;
  p.tasks.push({
    id:"late-edit",agent_id:"backend",title:"Late approved edit",
    description:"An independent approved change after initial acceptance",
    depends_on:["tests"],resources:[lateUri]
  },{
    id:"pr",agent_id:"orchestrator",title:"Request final review",
    description:"PR requires fresh acceptance after every edit",
    depends_on:["tests","late-edit"],resources:[uri]
  });
  p.requested_permissions.push({
    id:"p-late",task_id:"late-edit",agent_id:"backend",
    resource:lateUri,operation:"update_file",
    reason:"Engineer explicitly permitted late edit"
  },{
    id:"p-pr",task_id:"pr",agent_id:"orchestrator",
    resource:uri,operation:"create_pull_request",
    reason:"Request review after final acceptance"
  });
  const h=harness({configuredPlan:p,approvedIds:[
    "p-branch","p-backend","p-test","p-late","p-pr"
  ]});
  await h.gates.activate("session-approval",sha);
  for(const [planTask,runtimeTask,role] of [
    ["bootstrap","a2a-bootstrap","orchestrator"],
    ["backend-task","a2a-backend","backend"],
    ["tests","a2a-tests","test"],
    ["late-edit","a2a-late","backend"],
    ["pr","a2a-pr","orchestrator"]
  ] as const)h.gates.bindTask("session-approval",planTask,runtimeTask,role);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  await h.invoke("a2a-backend","backend","update_file",updateArgs);
  await h.gates.confirmTaskCompletion("a2a-backend");
  await h.invoke("a2a-tests","test","run_tests",{
    branch,profile:"poc-default"
  });
  await h.gates.confirmTaskCompletion("a2a-tests");
  await h.invoke("a2a-late","backend","update_file",{
    branch,path:latePath,content:"// approved late edit"
  });
  await h.gates.confirmTaskCompletion("a2a-late");
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-pr",agent_role:"orchestrator",
    tool:"create_pull_request",
    arguments:{head_branch:branch,base_branch:"main",title:"Stale acceptance"}
  }),(e:unknown)=>e instanceof GatewayError&&
      e.code==="approved_plan_denied");
  assert.equal(h.providerCalls,4);
});

test("PR refuses a prior Docker PASS when Test writes a newer SHA; rerun restores exact-SHA authority",async()=>{
  const p=plan();
  p.tasks.find(t=>t.id==="tests")!.resources.push(file);
  p.requested_permissions.push({
    id:"p-test-update",task_id:"tests",agent_id:"test",
    resource:file,operation:"update_file",reason:"Approved same-task repair"
  });
  p.tasks.push({
    id:"pr",agent_id:"orchestrator",title:"Review tested revision",
    description:"Open only accepted final SHA",depends_on:["tests"],
    resources:[uri]
  });
  p.requested_permissions.push({
    id:"p-pr",task_id:"pr",agent_id:"orchestrator",
    resource:uri,operation:"create_pull_request",reason:"Human review"
  });
  const testRequest={branch,profile:"poc-default"};
  const prRequest={
    task_id:"a2a-pr",agent_role:"orchestrator",
    tool:"create_pull_request",arguments:{
      head_branch:branch,base_branch:"main",title:"Reviewed final SHA"
    }
  };
  async function prepareCase(rerun:boolean){
    const finalSha="b".repeat(40);
    const h=harness({configuredPlan:p,approvedIds:[
      "p-branch","p-backend","p-test","p-test-update","p-pr"
    ],runnerRevisions:[sha,finalSha],testWriteRevisions:[finalSha]});
    await h.gates.activate("session-approval",sha);
    for(const [task,id,role] of [
      ["bootstrap","a2a-bootstrap","orchestrator"],
      ["backend-task","a2a-backend","backend"],
      ["tests","a2a-tests","test"],
      ["pr","a2a-pr","orchestrator"]
    ] as const)h.gates.bindTask("session-approval",task,id,role);
    await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
    await h.gates.confirmTaskCompletion("a2a-bootstrap");
    await h.invoke("a2a-backend","backend","update_file",updateArgs);
    await h.gates.confirmTaskCompletion("a2a-backend");
    await h.invoke("a2a-tests","test","run_tests",testRequest);
    await h.invoke("a2a-tests","test","update_file",updateArgs);
    if(rerun)await h.invoke("a2a-tests","test","run_tests",testRequest);
    await h.gates.confirmTaskCompletion("a2a-tests");
    return h;
  }
  const stale=await prepareCase(false);
  assert.throws(()=>stale.runtime.prepare(prRequest),
    (error:unknown)=>error instanceof GatewayError&&
      error.code==="approved_plan_denied",
    "An earlier PASS must never authorize a newer untested commit");
  const repaired=await prepareCase(true);
  const prepared=repaired.runtime.prepare(prRequest);
  const record=repaired.store.get(prepared.request_id);
  assert.equal(record?.approved_tested_head_sha,"b".repeat(40),
    "The last approved and passing Runner uniquely binds the PR head");
});


test("async completion rejects a late provider effect even when a second Docker PASS has the same SHA",async()=>{
  // A prepared authorization may outlive the start of a trusted, async
  // completion check. The attestor must see exactly the effects later
  // committed as completed, not a subset collected before the late run.
  let release!:()=>void;
  let entered!:()=>void;
  const pendingAttestation=new Promise<void>(resolve=>{release=resolve;});
  const attesting=new Promise<void>(resolve=>{entered=resolve;});
  const h=harness({onAttestation:async task=>{
    if(task==="tests"){
      entered();
      await pendingAttestation;
    }
  }});
  await activated(h);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  await h.invoke("a2a-backend","backend","update_file",updateArgs);
  await h.gates.confirmTaskCompletion("a2a-backend");
  const testRequest={branch,profile:"poc-default"};
  await h.invoke("a2a-tests","test","run_tests",testRequest);
  // This VP-bound request was legitimately prepared before completion began.
  const prepared=h.runtime.prepare({
    task_id:"a2a-tests",agent_role:"test",
    tool:"run_tests",arguments:testRequest
  });
  const completion=h.gates.confirmTaskCompletion("a2a-tests");
  await attesting;
  // No NEW tool requests may be prepared after the completion snapshot.
  assert.throws(()=>h.runtime.prepare({
    task_id:"a2a-tests",agent_role:"test",
    tool:"run_tests",arguments:testRequest
  }),(error:unknown)=>error instanceof GatewayError&&
     error.code==="approved_plan_denied");
  // The older prepared request can finish while the external attestor is
  // pending. It produces a new real provider effect (same tested SHA).
  const response=await h.runtime.execute({
    request_id:prepared.request_id,signed_vp:"signed.vp.jwt"
  });
  assert.equal(response.execution.provider,"runner");
  release();
  await assert.rejects(completion,(error:unknown)=>
    error instanceof GatewayError&&
    error.code==="approved_plan_denied"&&
    /effects changed during Task attestation/u.test(error.message));
  // The task remains uncompleted and can be freshly verified with the
  // complete, updated Gateway effects. No permissions were expanded.
  assert.equal(h.providerCalls,4);
  await h.gates.confirmTaskCompletion("a2a-tests");
  await assert.rejects(h.gates.confirmTaskCompletion("a2a-tests"),
    (error:unknown)=>error instanceof GatewayError&&
      error.code==="approved_plan_denied");
});

test("R97 trusted Gateway returns exact-SHA Runner PASS only after Test completion and retirement",async()=>{
  const h=harness({fullRunnerPassPhases:true});
  await activated(h);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  await h.invoke("a2a-backend","backend","update_file",updateArgs);
  await h.gates.confirmTaskCompletion("a2a-backend");
  await h.invoke("a2a-tests","test","run_tests",{branch,profile:"poc-default"});
  const q={session_id:"session-approval",task_id:"tests",
    branch,tested_commit_sha:sha};
  assert.throws(()=>h.gates.readVerifiedRunnerEffect(q),
    /retired signed Test acceptance/u);
  await h.gates.confirmTaskCompletion("a2a-tests");
  assert.throws(()=>h.gates.readVerifiedRunnerEffect(q),
    /retired signed Test acceptance/u);
  await h.gates.retireSession("session-approval");
  const result=h.gates.readVerifiedRunnerEffect(q);
  assert.equal(result.status,"pass");
  assert.equal(result.tested_commit_sha,sha);
  assert.equal(result.phases.length,7);
  assert.deepEqual(result.phases.map(x=>x.status),Array(7).fill("pass"));
  assert.equal(Object.isFrozen(result),true);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REPOSITORY_SOURCE|log_reference|SIGNED_VP/u);
  for(const bad of [
    {...q,task_id:"backend-task"},
    {...q,tested_commit_sha:"b".repeat(40)},
    {...q,branch:"feature/attacker"},
    {...q,session_id:"unknown-session"}
  ])assert.throws(()=>h.gates.readVerifiedRunnerEffect(bad),/Test|Runner/u);
});

test("R97 incomplete phase receipt cannot masquerade as a complete accepted Docker run",async()=>{
  const h=harness(); // Legacy minimal fixture has no fixed phase breakdown.
  await activated(h);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  await h.invoke("a2a-backend","backend","update_file",updateArgs);
  await h.gates.confirmTaskCompletion("a2a-backend");
  await h.invoke("a2a-tests","test","run_tests",{branch,profile:"poc-default"});
  await h.gates.confirmTaskCompletion("a2a-tests");
  await h.gates.retireSession("session-approval");
  assert.throws(()=>h.gates.readVerifiedRunnerEffect({
    session_id:"session-approval",task_id:"tests",
    branch,tested_commit_sha:sha
  }),/Incomplete trusted exact-SHA Runner acceptance/u);
});

test("R97.3 lease expiration must NOT impersonate trusted Gateway shutdown for post-run attestation",async()=>{
  let now=100_000;
  const h=harness({
    fullRunnerPassPhases:true,operationalLeaseMs:10_000,
    nowMs:()=>now
  });
  await activated(h);
  await h.invoke("a2a-bootstrap","orchestrator","create_branch",branchArgs);
  await h.gates.confirmTaskCompletion("a2a-bootstrap");
  await h.invoke("a2a-backend","backend","update_file",updateArgs);
  await h.gates.confirmTaskCompletion("a2a-backend");
  await h.invoke("a2a-tests","test","run_tests",{branch,profile:"poc-default"});
  await h.gates.confirmTaskCompletion("a2a-tests");
  now=111_000;
  assert.throws(()=>h.gates.renewLease("session-approval",planDigest(plan())),
    /lease expired/u);
  assert.throws(()=>h.gates.readVerifiedRunnerEffect({
    session_id:"session-approval",task_id:"tests",
    branch,tested_commit_sha:sha
  }),/retired signed Test acceptance/u);
});
