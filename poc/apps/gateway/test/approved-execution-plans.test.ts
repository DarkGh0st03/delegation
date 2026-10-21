import test from "node:test";
import assert from "node:assert/strict";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans} from "../src/approved-execution-plans.ts";
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
  simulated?:boolean;
  wrongPresenter?:boolean
}={}){
  const p=options.configuredPlan??plan();
  const a=approval(p,options.approvedIds);
  let attestCalls=0,providerCalls=0,verifiedCalls=0,opaCalls=0;
  const gates=new TrustedApprovedExecutionPlans({
    repository:repo,engineerDid:did,
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
      if(req.tool==="update_file")return{
        provider:"gitea",performed:true,tool:"update_file",
        branch:req.arguments.branch,path:req.arguments.path,
        revision:sha,commit_sha:sha,blob_sha:"b",precondition_blob_sha:"a"
      };
      if(req.tool==="run_tests")return{
        provider:"runner",performed:true,tool:"run_tests",
        branch:req.arguments.branch,revision:sha,tested_commit_sha:sha,
        runner_profile:"poc-default",status:"pass",phases:[]
      };
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
      assert.equal(input.approved_plan_digest,planDigest(p));
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
    const h=harness();await activated(h);
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
