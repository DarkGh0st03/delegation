import test from "node:test";
import assert from "node:assert/strict";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {compilePlanningProposal}
  from "../src/trusted-adk-planner.ts";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedA2ADispatcher} from "../src/trusted-approved-a2a-dispatcher.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const uri="gitea://gitea.local/thesis/iam-console-poc";
const branch="feature/account-suspension",sha="a".repeat(40);
const did="did:thesis:engineer";
const file=uri+"/branches/feature%2Faccount-suspension/files/apps/backend/user.ts";
const frontendFile=uri+"/branches/feature%2Faccount-suspension/files/apps/frontend/page.tsx";
const testsBranch=uri+"/branches/feature%2Faccount-suspension";
function plan(workingBranch=branch){
 const fileUri=uri+"/branches/"+encodeURIComponent(workingBranch)+"/files/apps/backend/user.ts";
 const frontendUri=uri+"/branches/"+encodeURIComponent(workingBranch)+"/files/apps/frontend/page.tsx";
 const branchUri=uri+"/branches/"+encodeURIComponent(workingBranch);
 return {
  schema_version:"1.0.0",plan_id:"approved-dag",
  session_id:"signed-session",version:1,repository:repo,base_revision:sha,
  requirement:"Implement and test the agreed account change",
  candidate_agents:["backend","frontend","test"].map(agent_id=>({
    agent_id,did:"did:thesis:"+agent_id,card_ref:"trusted:"+agent_id
  })),
  tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Create isolated branch",
      description:"Prepare approved branch",depends_on:[],resources:[uri]},
    {id:"backend-task",agent_id:"backend",title:"Change backend",
      description:"Implement approved backend user modification",
      depends_on:["branch"],resources:[fileUri]},
    {id:"frontend-task",agent_id:"frontend",title:"Change frontend",
      description:"Implement approved frontend display",
      depends_on:["backend-task"],resources:[frontendUri]},
    {id:"tests",agent_id:"test",title:"Test the changes",
      description:"Run approved controlled test",
      depends_on:["frontend-task"],resources:[branchUri]}
  ],
  requested_permissions:[
    {id:"branch-perm",task_id:"branch",agent_id:"orchestrator",resource:uri,
      operation:"create_branch",reason:"Prepare branch"},
    {id:"backend-perm",task_id:"backend-task",agent_id:"backend",resource:fileUri,
      operation:"update_file",reason:"Implementation"},
    {id:"front-perm",task_id:"frontend-task",agent_id:"frontend",resource:frontendUri,
      operation:"update_file",reason:"UI change"},
    {id:"test-perm",task_id:"tests",agent_id:"test",resource:branchUri,
      operation:"run_tests",reason:"Verify work"}
  ],assumptions:[],uncertainties:[]
 };
}
function harness(options:{
  badDid?:boolean;badDigest?:boolean;denyBinding?:boolean;
  failResult?:boolean;removeApproval?:boolean;workBranch?:string;
  invalidArtifactBranch?:boolean;
  unapprovedCandidate?:boolean;
  approvedReadContext?:boolean;
  closeDuringA2A?:boolean;closeAfterGatewayConfirmation?:boolean;
  closeAfterBranchConfirmation?:boolean;failGatewayConfirmation?:boolean;
  /** Test-only plan source; the Dispatcher receives a compiled, signed plan. */
  alternativeApprovedPlan?:any;
}={}){
  const p=options.alternativeApprovedPlan??plan(options.workBranch);
  if(options.unapprovedCandidate){
    const extra=uri+"/branches/"+
      encodeURIComponent(options.workBranch??branch)+
      "/files/apps/backend/never-approved.ts";
    p.tasks[1]!.resources.push(extra);
    p.requested_permissions.push({
      id:"backend-candidate",task_id:"backend-task",agent_id:"backend",
      resource:extra,operation:"update_file",reason:"Proposed but not approved"
    });
  }
  if(options.approvedReadContext){
    const uriForRead=uri+"/branches/"+
      encodeURIComponent(options.workBranch??branch)+
      "/files/apps/backend/context.ts";
    p.tasks[1]!.resources.push(uriForRead);
    p.requested_permissions.push({
      id:"backend-read-context",task_id:"backend-task",agent_id:"backend",
      operation:"read_file",resource:uriForRead,
      reason:"Approved read-only source context"
    });
  }
  const ids=p.requested_permissions.map(x=>x.id)
    .filter(id=>id!=="backend-candidate");
  const approval=makeApproval(p,{allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"decision-dag",approved_by:did,approved_at:"2026-10-21T17:00:00Z",
    approved_permission_ids:options.removeApproval?ids.filter(x=>x!=="backend-perm"):ids
  });
  const log:string[]=[];
  const coordinator={
    phase:"execution",
    async bindDispatchedTask(taskId:string,id:string,role:string){
      log.push("bind:"+taskId+":"+role+":"+id);
      if(options.denyBinding && taskId==="backend-task")throw Error("Gateway denied binding");
    },
    async confirmTask(id:string,observation:any){
      log.push("confirm:"+id+":"+observation.role);
      if(options.failGatewayConfirmation&&observation.role==="backend")
        throw Error("trusted Gateway attestor denied Backend evidence");
      if((options.closeAfterGatewayConfirmation&&observation.role==="backend")||
         (options.closeAfterBranchConfirmation&&observation.role==="orchestrator"))
        coordinator.phase="closed";
    },
    async closeExecution(){log.push("close");coordinator.phase="closed";}
  };
  const runner={
    async issueAndRun(input:any){
      log.push("run:"+input.subtask.subtask_id+":"+input.trusted_gateway_task_id);
      if(options.closeDuringA2A&&input.role==="backend")
        coordinator.phase="closed";
      if(options.unapprovedCandidate||options.approvedReadContext){
        log.push("paths:"+input.subtask.relevant_paths.join(","));
        log.push("file-rights:"+JSON.stringify(
          input.subtask.approved_file_permissions));
      }
      return {
        role:options.failResult?"test":input.role,
        task_id:"sdk-remote-"+input.subtask.subtask_id,
        artifact:{
          role:input.role,
          branch:options.invalidArtifactBranch?"feature/unrelated":(options.workBranch??branch),
          revision:sha,commit_sha:sha,
          files_modified:[],files_created:[],test_outcome:"not_run",
          summary:"Validated by A2A runner",errors:[]
        }
      };
    }
  };
  const config={
    sessionId:p.session_id,expectedPlanDigest:options.badDigest?"b".repeat(64):planDigest(p),
    baseRevision:sha,expectedEngineerDid:did,
    approvals:{async loadAuthenticatedApproval(){
      return {plan:p,approval,authenticated_engineer_did:options.badDid?"did:attacker":did};
    }},
    coordinator,roleRunner:runner,
    agentBaseUrls:{
      backend:"http://127.0.0.1:8001",
      frontend:"http://127.0.0.1:8002",
      test:"http://127.0.0.1:8003"
    },
    async authorityForTask(id:string,role:string){
      log.push("allocate:"+id);
      return {
        parent_credential_id:"urn:trusted:operational-root",
        credential_id:"urn:task-child:"+id,
        valid_from:"2026-10-21T17:00:00Z",
        validity_seconds:300,
        credential_status:{
          type:"BitstringStatusListEntry",
          statusPurpose:"revocation",
          statusListIndex:id==="backend-task"?"8101":"8102",
          statusListCredential:"https://status.example/test-list"
        }
      };
    }
  };
  return {p,log,coordinator,config};
}
test("DAG verifies predecessor and Gateway binding precedes child issue/A2A send",async()=>{
 const h=harness();
 const dispatcher=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(dispatcher.dispatch("backend-task"),/dependencies/);
 assert.deepEqual(h.log,[]);
 // Trusted Orchestrator must have already bound/executed a Gateway create_branch.
 await dispatcher.runOrchestratorTask("branch",async (id)=>{h.log.push("provider:"+id);});
 const result=await dispatcher.dispatch("backend-task");
 assert.equal(result.role,"backend");
 assert.deepEqual(dispatcher.completedTaskIds,["branch","backend-task"]);
 assert.match(h.log[0],/^bind:branch:orchestrator:dispatch_/);
 assert.match(h.log[1],/^provider:dispatch_/);
 assert.match(h.log[2],/^confirm:dispatch_.*:orchestrator$/);
 assert.match(h.log[3],/allocate:backend-task/);
 assert.match(h.log[4],/^bind:backend-task:backend:dispatch_/);
 assert.match(h.log[5],/^run:backend-task:dispatch_/);
 assert.match(h.log[6],/^confirm:dispatch_.*:backend$/);
 const gatewayId=h.log[4].split(":").at(-1);
 assert.equal(h.log[5].split(":").at(-1),gatewayId);
 assert.equal(h.log[6].split(":")[1],gatewayId);
 await assert.rejects(dispatcher.dispatch("backend-task"),/already dispatched/);
 const front=await dispatcher.dispatch("frontend-task");
 assert.equal(front.role,"frontend");
 assert.deepEqual(dispatcher.completedTaskIds,["branch","backend-task","frontend-task"]);
});
test("Planner-approved Backend subtasks dispatch independently with task-specific authority and Gateway confirmation",async()=>{
  // The test host must NOT collapse two signed Backend Tasks into one
  // Backend role dispatch. The follow-up is allowed to edit the same file
  // only after the first Task completed and was independently corroborated.
  const p=plan();
  const nextFile=p.tasks[1]!.resources[0]!;
  p.tasks.splice(2,0,{
    id:"backend-followup",agent_id:"backend",title:"Second Backend operation",
    description:"Independently approved follow-up on the same source file",
    depends_on:["backend-task"],resources:[nextFile]
  });
  p.tasks.find(t=>t.id==="frontend-task")!.depends_on=["backend-followup"];
  p.requested_permissions.push({
    id:"backend-followup-perm",task_id:"backend-followup",agent_id:"backend",
    operation:"update_file",resource:nextFile,
    reason:"Separate, scoped follow-up change"
  });
  const h=harness({alternativeApprovedPlan:p});
  const dispatcher=await TrustedApprovedA2ADispatcher.load(h.config as any);
  await assert.rejects(dispatcher.dispatch("backend-followup"),/dependencies/);
  const done=await dispatcher.executeApprovedDag({
    async invokeOrchestratorTask(taskId,gatewayTaskId){
      assert.equal(taskId,"branch");
      h.log.push("provider:"+gatewayTaskId);
    }
  });
  assert.deepEqual(done.completed_task_ids,[
    "branch","backend-task","backend-followup","frontend-task","tests"
  ]);
  assert.deepEqual(done.specialized_results.map(x=>x.role),[
    "backend","backend","frontend","test"
  ]);
  const firstRun=h.log.findIndex(x=>x.startsWith("run:backend-task:"));
  const secondAllocation=h.log.findIndex(x=>x==="allocate:backend-followup");
  const secondRun=h.log.findIndex(x=>x.startsWith("run:backend-followup:"));
  const firstConfirmation=h.log.findIndex(x=>
    x.startsWith("confirm:")&&x.endsWith(":backend"));
  const frontendRun=h.log.findIndex(x=>x.startsWith("run:frontend-task:"));
  assert.ok(firstRun>=0&&firstRun<firstConfirmation&&
    firstConfirmation<secondAllocation&&secondAllocation<secondRun&&
    secondRun<frontendRun,"Each Backend Task must have its own signed dispatch");
  assert.equal(h.log.filter(x=>x.startsWith("allocate:backend-")).length,2);
  const binds=h.log.filter(x=>x.startsWith("bind:backend-"));
  assert.equal(binds.length,2);
  assert.notEqual(binds[0]!.split(":").at(-1),binds[1]!.split(":").at(-1),
    "Independent Backend Task dispatch IDs must be different");
  assert.equal(h.coordinator.phase,"closed");
});

test("Seven signed Tasks (2 Orchestrator, 2 Backend, 1 Frontend, 2 Test) execute the full reviewed DAG",async()=>{
  const p=plan();
  const backendPath=p.tasks.find(t=>t.id==="backend-task")!.resources[0]!;
  const testFile=uri+"/branches/feature%2Faccount-suspension/files/tests/regression.test.ts";
  p.tasks.splice(2,0,{
    id:"backend-followup",agent_id:"backend",title:"Second backend change",
    description:"Separate signed follow-up",depends_on:["backend-task"],
    resources:[backendPath]
  });
  p.tasks.find(t=>t.id==="frontend-task")!.depends_on=["backend-followup"];
  p.tasks.splice(p.tasks.findIndex(t=>t.id==="tests"),0,{
    id:"test-preparation",agent_id:"test",title:"Prepare regression test",
    description:"Create one test before acceptance",depends_on:["frontend-task"],
    resources:[testFile]
  });
  p.tasks.find(t=>t.id==="tests")!.depends_on=["test-preparation"];
  p.tasks.push({
    id:"pr",agent_id:"orchestrator",title:"Open reviewed PR",
    description:"Only after final Docker acceptance",depends_on:["tests"],
    resources:[uri]
  });
  p.requested_permissions.push(
    {id:"backend-followup-write",task_id:"backend-followup",
     agent_id:"backend",resource:backendPath,operation:"update_file",
     reason:"Same file is allowed only with approved dependency"},
    {id:"test-prep-write",task_id:"test-preparation",
     agent_id:"test",resource:testFile,operation:"create_file",
     reason:"Signed Test preparation"},
    {id:"pr-perm",task_id:"pr",agent_id:"orchestrator",
     resource:uri,operation:"create_pull_request",
     reason:"Verified final review"}
  );
  const h=harness({alternativeApprovedPlan:p});
  const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
  const approvedProviderTasks:string[]=[];
  const done=await d.executeApprovedDag({
    async invokeOrchestratorTask(taskId,gatewayTaskId){
      approvedProviderTasks.push(taskId);
      h.log.push("provider:"+gatewayTaskId);
    }
  });
  assert.deepEqual(done.completed_task_ids,[
    "branch","backend-task","backend-followup","frontend-task",
    "test-preparation","tests","pr"
  ]);
  assert.deepEqual(done.specialized_results.map(result=>result.role),[
    "backend","backend","frontend","test","test"
  ]);
  assert.deepEqual(approvedProviderTasks,["branch","pr"]);
  assert.equal(h.log.filter(x=>x.startsWith("allocate:")).length,5);
  assert.equal(h.coordinator.phase,"closed");
});


test("Approved Test preparation may precede Backend, but final Test still depends on implementation",async()=>{
  const p=plan();
  const testFile=uri+"/branches/feature%2Faccount-suspension/files/tests/early.test.ts";
  p.tasks.splice(1,0,{
    id:"test-preparation",agent_id:"test",title:"Prepare regression early",
    description:"Create the approved test before implementation",
    depends_on:["branch"],resources:[testFile]
  });
  p.tasks.find(t=>t.id==="tests")!.depends_on=[
    "frontend-task","test-preparation"
  ];
  p.requested_permissions.push({
    id:"early-test-create",task_id:"test-preparation",agent_id:"test",
    operation:"create_file",resource:testFile,
    reason:"Independent signed preparation before Backend"
  });
  const h=harness({alternativeApprovedPlan:p});
  const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
  const done=await d.executeApprovedDag({
    async invokeOrchestratorTask(_id,gatewayTaskId){
      h.log.push("provider:"+gatewayTaskId);
    }
  });
  assert.deepEqual(done.completed_task_ids,[
    "branch","test-preparation","backend-task","frontend-task","tests"
  ]);
  assert.deepEqual(done.specialized_results.map(x=>x.role),[
    "test","backend","frontend","test"
  ]);
  const preparation=h.log.findIndex(x=>x.startsWith("run:test-preparation:"));
  const backend=h.log.findIndex(x=>x.startsWith("run:backend-task:"));
  const front=h.log.findIndex(x=>x.startsWith("run:frontend-task:"));
  const finalTest=h.log.findIndex(x=>x.startsWith("run:tests:"));
  assert.ok(preparation>=0&&preparation<backend&&backend<front&&front<finalTest,
    "The approved DAG may prepare tests early but verifies only after changes");
  assert.equal(h.coordinator.phase,"closed");
});

test("unapproved second Backend Task fails closed before any DAG provider effect",async()=>{
  const p=plan();
  const nextFile=p.tasks[1]!.resources[0]!;
  p.tasks.splice(2,0,{
    id:"backend-followup",agent_id:"backend",title:"Unapproved follow-up",
    description:"Must not run without an Engineer-granted permission",
    depends_on:["backend-task"],resources:[nextFile]
  });
  p.tasks.find(t=>t.id==="frontend-task")!.depends_on=["backend-followup"];
  p.requested_permissions.push({
    id:"backend-followup-perm",task_id:"backend-followup",
    agent_id:"backend",operation:"update_file",resource:nextFile,
    reason:"Not selected by Engineer"
  });
  const h=harness({alternativeApprovedPlan:p});
  h.config.approvals.loadAuthenticatedApproval=async()=>({
    plan:p,
    approval:makeApproval(p,{
      allowedOperations:new Set(RUST_OPERATIONS),
      decision_id:"partial-approval",approved_by:did,
      approved_at:"2026-10-21T17:00:00Z",
      approved_permission_ids:p.requested_permissions.map(x=>x.id)
        .filter(id=>id!=="backend-followup-perm")
    }),
    authenticated_engineer_did:did
  });
  const dispatcher=await TrustedApprovedA2ADispatcher.load(h.config as any);
  await assert.rejects(dispatcher.executeApprovedDag({
    invokeOrchestratorTask:async()=>{h.log.push("unexpected-provider-call");}
  }),/Task without Engineer-granted permissions/);
  assert.deepEqual(h.log,[]);
});
test("Two approved Test Tasks independently prepare a test and run final Docker acceptance",async()=>{
  const p=plan();
  const testResource=uri+"/branches/feature%2Faccount-suspension/files/tests/regression.test.ts";
  const originalTest=p.tasks.find(t=>t.id==="tests")!;
  p.tasks.splice(p.tasks.findIndex(t=>t.id==="tests"),0,{
    id:"test-preparation",agent_id:"test",title:"Prepare regression source",
    description:"Create the approved regression test without running Docker",
    depends_on:["frontend-task"],resources:[testResource]
  });
  originalTest.depends_on=["test-preparation"];
  p.requested_permissions.push({
    id:"test-preparation-write",task_id:"test-preparation",
    agent_id:"test",operation:"create_file",resource:testResource,
    reason:"Approved Test preparation without Runner"
  });
  const h=harness({alternativeApprovedPlan:p});
  const captured:any[]=[];
  const original=h.config.roleRunner.issueAndRun;
  h.config.roleRunner.issueAndRun=async(input:any)=>{
    captured.push(input);
    return original(input);
  };
  const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
  const completed=await d.executeApprovedDag({
    async invokeOrchestratorTask(_task,gatewayTaskId){
      h.log.push("provider:"+gatewayTaskId);
    }
  });
  assert.deepEqual(completed.completed_task_ids,[
    "branch","backend-task","frontend-task","test-preparation","tests"
  ]);
  assert.deepEqual(completed.specialized_results.map(x=>x.role),
    ["backend","frontend","test","test"]);
  const prep=captured.find(x=>x.approved_task_id==="test-preparation");
  const runner=captured.find(x=>x.approved_task_id==="tests");
  assert.ok(prep&&runner);
  assert.equal(prep.subtask.approved_run_tests,false);
  assert.deepEqual(prep.subtask.approved_file_permissions,[
    {operation:"create_file",path:"tests/regression.test.ts"}
  ]);
  assert.equal(runner.subtask.approved_run_tests,true);
  assert.deepEqual(runner.subtask.approved_file_permissions,[]);
  assert.notEqual(prep.credential_id,runner.credential_id);
  const prepCompletion=h.log.findIndex(x=>x.startsWith("confirm:")&&
    x.endsWith(":test"));
  const runnerBind=h.log.findIndex(x=>x.startsWith("bind:tests:"));
  assert.ok(prepCompletion>=0&&runnerBind>prepCompletion,
    "Runner starts only after independently confirmed Test preparation");
  assert.equal(h.coordinator.phase,"closed");
});

test("failed Gateway binding never reaches the A2A network, and ends Execution",async()=>{
 const h=harness({denyBinding:true});
 const dispatcher=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await dispatcher.runOrchestratorTask("branch",async (id)=>{h.log.push("provider:"+id);});
 await assert.rejects(dispatcher.dispatch("backend-task"),/Gateway denied binding/);
 assert.ok(!h.log.some(x=>x.startsWith("run:")));
 assert.equal(h.log.at(-1),"close");
 await assert.rejects(dispatcher.dispatch("backend-task"),/inactive/);
});
test("unexpected A2A task role fails closed, cannot advance the approved DAG",async()=>{
 const h=harness({failResult:true});
 const dispatcher=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await dispatcher.runOrchestratorTask("branch",async (id)=>{h.log.push("provider:"+id);});
 await assert.rejects(dispatcher.dispatch("backend-task"),/does not match/);
 assert.deepEqual(dispatcher.completedTaskIds,["branch"]);
 assert.equal(h.log.at(-1),"close");
});
test("unsigned changes or mismatched Engineer/digest cannot install a dispatcher",async()=>{
 for(const opts of [{badDid:true},{badDigest:true}]){
  const h=harness(opts);
  await assert.rejects(
    TrustedApprovedA2ADispatcher.load(h.config as any),/identity mismatch|digest\/SHA/);
  assert.deepEqual(h.log,[]);
 }
});
test("unapproved Task permissions and unassigned/missing Tasks fail before authority issuance",async()=>{
 const h=harness({removeApproval:true});
 const dispatcher=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await dispatcher.runOrchestratorTask("branch",async (id)=>{h.log.push("provider:"+id);});
 await assert.rejects(dispatcher.dispatch("backend-task"),/no granted permission/);
 await assert.rejects(dispatcher.dispatch("not-in-plan"),/not found/);
 assert.ok(!h.log.some(x=>x.startsWith("allocate:")));
});


test("signed plan selects arbitrary canonical feature branch and rejects unrelated A2A artifact",async()=>{
 const working="feature/engineer-approved-42";
 const h=harness({workBranch:working});
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 assert.equal(d.approvedBranch,working);
 await d.runOrchestratorTask("branch",async id=>{h.log.push("provider:"+id);});
 const task=await d.dispatch("backend-task");
 assert.equal(task.artifact.branch,working);
 assert.deepEqual(d.completedTaskIds,["branch","backend-task"]);
 const f=harness({workBranch:working,invalidArtifactBranch:true});
 const reject=await TrustedApprovedA2ADispatcher.load(f.config as any);
 await reject.runOrchestratorTask("branch",async()=>{});
 await assert.rejects(reject.dispatch("backend-task"),/does not match/);
 assert.equal(f.log.at(-1),"close");
});
test("branch is never inferred from unapproved, multiple or invalid repository locations",async()=>{
 for(const workBranch of ["main","feature/../exploit","feature/invalid.lock","feature/double//slash"]){
   if(workBranch.includes("..")){
     // Earlier schema validation also rejects traversal; either boundary
     // must fail before the dispatcher can install an executable plan.
     assert.throws(()=>harness({workBranch}),/Plan contract: resource/);
     continue;
   }
   const h=harness({workBranch});
   await assert.rejects(TrustedApprovedA2ADispatcher.load(h.config as any),
     /Approved branch: noncanonical or forbidden feature branch/);
   assert.deepEqual(h.log,[]);
 }
 const h=harness();
 const original=h.config.approvals.loadAuthenticatedApproval;
 h.config.approvals.loadAuthenticatedApproval=async()=>{
   const fetched=await original();
   const p=structuredClone(fetched.plan);
   // The tampered plan contains incompatible branches; even when a malicious
   // signer recomputes its digest, one Execution cannot span two branches.
   p.requested_permissions[2]!.resource=
     uri+"/branches/feature%2Fanother/files/apps/frontend/page.tsx";
   p.tasks[2]!.resources=[p.requested_permissions[2]!.resource];
   const approval=makeApproval(p,{allowedOperations:new Set(RUST_OPERATIONS),
     decision_id:"evil-second-branch",approved_by:did,
     approved_at:"2026-10-21T17:00:00Z",
     approved_permission_ids:p.requested_permissions.map(x=>x.id)
   });
   return {...fetched,plan:p,approval};
 };
 h.config.expectedPlanDigest=planDigest((await h.config.approvals.loadAuthenticatedApproval()).plan);
 await assert.rejects(TrustedApprovedA2ADispatcher.load(h.config as any),
   /Approved branch: multiple working branches/);
});

test("executeApprovedDag coordinates all three roles, confirms each dependency and closes root",async()=>{
 const h=harness();
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(d.executeApprovedDag(),/private Orchestrator provider callback/);
 assert.deepEqual(h.log,[]);
 const done=await d.executeApprovedDag({
   async invokeOrchestratorTask(id,gatewayTaskId){
     assert.equal(id,"branch");
     h.log.push("provider:"+gatewayTaskId);
   }
 });
 assert.equal(done.plan_digest,planDigest(h.p));
 assert.deepEqual(done.completed_task_ids,[
   "branch","backend-task","frontend-task","tests"
 ]);
 assert.deepEqual(done.specialized_results.map(x=>x.role),
   ["backend","frontend","test"]);
 assert.equal(h.coordinator.phase,"closed");
 const positions={
   backend:h.log.findIndex(x=>x.startsWith("confirm:")&&x.endsWith(":backend")),
   frontend:h.log.findIndex(x=>x.startsWith("bind:frontend-task:")),
   frontConfirmed:h.log.findIndex(x=>x.startsWith("confirm:")&&x.endsWith(":frontend")),
   tests:h.log.findIndex(x=>x.startsWith("bind:tests:"))
 };
 assert.ok(positions.backend>=0&&positions.backend<positions.frontend);
 assert.ok(positions.frontConfirmed>=0&&positions.frontConfirmed<positions.tests);
 assert.equal(h.log.at(-1),"close");
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{}
 }),/fresh approved Execution/);
});

test("trusted GitHub liveness is rechecked before EVERY signed Task",async()=>{
 const h=harness();
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 const visited:string[]=[];
 const done=await d.executeApprovedDag({
   async invokeOrchestratorTask(_id,gatewayTaskId){h.log.push("provider:"+gatewayTaskId);},
   async beforeTask(id){visited.push(id);}
 });
 assert.deepEqual(visited,["branch","backend-task","frontend-task","tests"]);
 assert.deepEqual(done.completed_task_ids,visited);
 assert.equal(h.coordinator.phase,"closed");
});

test("R5 final job check runs after ALL signed Tasks but BEFORE verified Gateway/Rust root close",async()=>{
 const h=harness();
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 let terminalChecks=0;
 const done=await d.executeApprovedDag({
   async invokeOrchestratorTask(_id,gatewayTaskId){
     h.log.push("provider:"+gatewayTaskId);
   },
   async beforeCompletion(){
     terminalChecks++;
     assert.equal(h.coordinator.phase,"execution");
     assert.equal(d.completedTaskIds.length,4);
     h.log.push("github-final");
   }
 });
 assert.equal(terminalChecks,1);
 assert.deepEqual(done.completed_task_ids,["branch",
   "backend-task","frontend-task","tests"]);
 assert.equal(h.coordinator.phase,"closed");
 const lastTask=h.log.findIndex(x=>x.startsWith("confirm:")&&
   x.endsWith(":test"));
 const finalCheck=h.log.indexOf("github-final");
 const rootClose=h.log.lastIndexOf("close");
 assert.ok(lastTask>=0&&lastTask<finalCheck&&finalCheck<rootClose);
});

test("R5 rejected final GitHub job check still closes root and never reports successful DAG",async()=>{
 const h=harness();
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 let checks=0;
 await assert.rejects(d.executeApprovedDag({
   async invokeOrchestratorTask(_id,gatewayTaskId){
     h.log.push("provider:"+gatewayTaskId);
   },
   async beforeCompletion(){
     checks++;
     assert.equal(h.coordinator.phase,"execution");
     throw Error("GitHub run canceled after final A2A Task");
   }
 }),/GitHub run canceled after final A2A Task/);
 assert.equal(checks,1);
 assert.deepEqual(d.completedTaskIds,
   ["branch","backend-task","frontend-task","tests"]);
 assert.equal(h.coordinator.phase,"closed");
 assert.equal(h.log.at(-1),"close");
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{}
 }),/fresh approved Execution session/);
});

test("lost GitHub run after Backend forbids Frontend and Test before side effects",async()=>{
 const h=harness();
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 const visited:string[]=[];
 await assert.rejects(d.executeApprovedDag({
   async invokeOrchestratorTask(_id,gatewayTaskId){h.log.push("provider:"+gatewayTaskId);},
   async beforeTask(id){
     visited.push(id);
     if(id==="frontend-task")throw Error("GitHub run became inactive");
   }
 }),/GitHub run became inactive/);
 assert.deepEqual(visited,["branch","backend-task","frontend-task"]);
 assert.deepEqual(d.completedTaskIds,["branch","backend-task"]);
 assert.ok(!h.log.some(x=>x.includes("bind:frontend-task:")||
   x.includes("bind:tests:")||x==="allocate:frontend-task"));
 assert.equal(h.coordinator.phase,"closed");
 assert.equal(h.log.at(-1),"close");
});

test("shutdown while verifying GitHub run forbids further approved Task",async()=>{
 const h=harness();
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(d.executeApprovedDag({
   async invokeOrchestratorTask(_id,gatewayTaskId){h.log.push("provider:"+gatewayTaskId);},
   async beforeTask(id){
     if(id==="backend-task")h.coordinator.phase="closed";
   }
 }),/operational session closed before Task/);
 assert.ok(!h.log.some(x=>x.startsWith("bind:backend-task:")));
});

test("executeApprovedDag never reaches Frontend or Test after failed Backend result",async()=>{
 const h=harness({failResult:true});
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{}
 }),/does not match/);
 assert.deepEqual(d.completedTaskIds,["branch"]);
 assert.equal(h.coordinator.phase,"closed");
 assert.ok(!h.log.some(x=>x.includes("bind:frontend-task:")||
    x.includes("bind:tests:")));
});

test("full DAG preflight rejects partial permission approval before ANY provider effects",async()=>{
 const h=harness({removeApproval:true});
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{throw Error("MUST NOT RUN");}
 }),/without Engineer-granted permissions/);
 assert.deepEqual(h.log,[]);
 assert.equal(h.coordinator.phase,"execution");
});
test("A2A relevant_paths excludes requested-but-not-approved source files",async()=>{
 const h=harness({unapprovedCandidate:true});
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await d.runOrchestratorTask("branch",async()=>{});
 await d.dispatch("backend-task");
 assert.ok(h.log.includes("paths:apps/backend/user.ts"));
 assert.ok(!JSON.stringify(h.log).includes("never-approved.ts"));
});


test("signed Dispatcher emits read_file context and update_file target as distinct grants",async()=>{
 const h=harness({approvedReadContext:true});
 const dispatcher=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await dispatcher.runOrchestratorTask("branch",async()=>{});
 await dispatcher.dispatch("backend-task");
 const declared=h.log.find(s=>s.startsWith("file-rights:"));
 assert.ok(declared);
 assert.deepEqual(JSON.parse(declared.slice("file-rights:".length)),[
   {operation:"update_file",path:"apps/backend/user.ts"},
   {operation:"read_file",path:"apps/backend/context.ts"}
 ]);
 assert.ok(h.log.some(x=>x==="paths:apps/backend/user.ts,apps/backend/context.ts"));
});


test("Engineer shutdown during in-flight Backend A2A blocks Gateway confirmation and all dependents",async()=>{
 const h=harness({closeDuringA2A:true});
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{}
 }),/A2A response arrived after operational shutdown/);
 assert.deepEqual(d.completedTaskIds,["branch"]);
 assert.equal(h.coordinator.phase,"closed");
 assert.ok(h.log.some(x=>x.startsWith("run:backend-task:")));
 assert.ok(!h.log.some(x=>x.startsWith("confirm:")&&x.endsWith(":backend")));
 assert.ok(!h.log.some(x=>x.startsWith("bind:frontend-task:")||
   x.startsWith("bind:tests:")));
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{}
 }),/fresh approved Execution/);
});

test("Gateway completion racing Engineer shutdown cannot release Frontend or Test",async()=>{
 const h=harness({closeAfterGatewayConfirmation:true});
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{}
 }),/A2A confirmation raced operational shutdown/);
 assert.deepEqual(d.completedTaskIds,["branch"]);
 assert.equal(h.coordinator.phase,"closed");
 assert.ok(h.log.some(x=>x.startsWith("confirm:")&&x.endsWith(":backend")));
 assert.ok(!h.log.some(x=>x.startsWith("bind:frontend-task:")||
   x.startsWith("bind:tests:")));
});

test("Orchestrator branch confirmation racing shutdown cannot unlock Backend A2A",async()=>{
 const h=harness({closeAfterBranchConfirmation:true});
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{}
 }),/Orchestrator confirmation raced operational shutdown/);
 assert.deepEqual(d.completedTaskIds,[]);
 assert.equal(h.coordinator.phase,"closed");
 assert.ok(!h.log.some(x=>x.startsWith("allocate:backend-task")||
   x.startsWith("run:backend-task:")));
});


test("Gateway attestation rejection revokes root and cannot release Frontend or Test",async()=>{
 const h=harness({failGatewayConfirmation:true});
 const d=await TrustedApprovedA2ADispatcher.load(h.config as any);
 await assert.rejects(d.executeApprovedDag({
   invokeOrchestratorTask:async()=>{}
 }),/trusted Gateway attestor denied Backend evidence/);
 assert.deepEqual(d.completedTaskIds,["branch"]);
 assert.equal(h.coordinator.phase,"closed");
 assert.equal(h.log.filter(x=>x==="close").length,1);
 assert.ok(h.log.some(x=>x.startsWith("confirm:")&&x.endsWith(":backend")));
 assert.ok(!h.log.some(x=>x.startsWith("bind:frontend-task:")||
   x.startsWith("bind:tests:")));
});


test("Blocco A: two distinct Planner-compiled DAGs reach the SAME signed approval and dispatcher without file or Task rewrites",async()=>{
 const branchTask=(id:string)=>({id,agent_id:"orchestrator",
   title:"Isolate repository",description:"Create approved branch",
   depends_on:[],permissions:[
     {operation:"create_branch",path:null,reason:"Separate work from main"}]});
 const feature=(id:string,role:"backend"|"frontend",parent:string,path:string)=>({
   id,agent_id:role,title:"Implement new requirement",
   description:"Modify the requested component using approved source",
   depends_on:[parent],permissions:[
     {operation:"read_file",path,reason:"Understand the code"},
     {operation:"update_file",path,reason:"Implement the requested change"}
   ]
 });
 const testTask=(depends_on:string[])=>({
   id:"verify",agent_id:"test",title:"Regression tests",
   description:"Write and run independent functionality tests",
   depends_on,permissions:[
     {operation:"create_file",path:"tests/feature.spec.ts",
       reason:"Add specific regression coverage"},
     {operation:"run_tests",path:null,
       reason:"Run reproducible acceptance tests"}
   ]
 });
 const prTask=()=>({id:"request-review",agent_id:"orchestrator",
   title:"Human review",description:"Create PR without merging",
   depends_on:["verify"],permissions:[
     {operation:"create_pull_request",path:null,reason:"Engineer review"}]});
 const snapshot={
   session_id:"signed-session",repository:repo,
   base_revision:sha,
   directories:["","apps","apps/backend","apps/frontend","tests"],
   files:["apps/backend/user.ts","apps/frontend/page.tsx",
     "apps/frontend/account-list.tsx"]
 };
 const agents={
   backend:{did:"did:thesis:backend",card_ref:"trusted:backend"},
   frontend:{did:"did:thesis:frontend",card_ref:"trusted:frontend"},
   test:{did:"did:thesis:test",card_ref:"trusted:test"}
 };
 const definitions=[
   {requirement:"Add an authenticated account search endpoint and visible filter",
    workBranch:"feature/account-search",raw:{
      tasks:[
        branchTask("open-work"),
        feature("backend-search","backend","open-work","apps/backend/user.ts"),
        feature("frontend-filter","frontend","backend-search","apps/frontend/page.tsx"),
        testTask(["frontend-filter"]),prTask()
      ],assumptions:[],uncertainties:[]},
    order:["open-work","backend-search","frontend-filter","verify","request-review"],
    roles:["backend","frontend","test"]},
   {requirement:"Improve account-list accessibility with regression coverage",
    workBranch:"feature/accessibility",raw:{
      tasks:[
        branchTask("open-work"),
        feature("accessible-list","frontend","open-work",
          "apps/frontend/account-list.tsx"),
        testTask(["accessible-list"]),prTask()
      ],assumptions:[],uncertainties:[]},
    order:["open-work","accessible-list","verify","request-review"],
    roles:["frontend","test"]}
 ];
 const digests=[];
 for(const [i,d] of definitions.entries()){
   // SAME compiler, approval, trusted dispatcher and role-runner binding.
   // The only differences are the operator's requirement and MODEL-like
   // proposal data: resources, Task identities, role selection, DAG and branch.
   const compiled=compilePlanningProposal(d.raw,{
     snapshot,requirement:d.requirement,
     planId:"independent-model-plan-"+i,
     workBranch:d.workBranch,agents
   });
   assert.equal(compiled.status,"unapproved_proposal");
   assert.ok(!Object.hasOwn(compiled,"approval"));
   const h=harness({
     workBranch:d.workBranch,
     alternativeApprovedPlan:compiled.plan
   });
   const dispatcher=await TrustedApprovedA2ADispatcher.load(h.config as any);
   const executed=await dispatcher.executeApprovedDag({
     async invokeOrchestratorTask(planTaskId:string,gatewayTaskId:string){
       assert.ok(["open-work","request-review"].includes(planTaskId));
       h.log.push("provider:"+planTaskId+":"+gatewayTaskId);
     }
   });
   assert.deepEqual(executed.completed_task_ids,d.order);
   assert.deepEqual(executed.specialized_results.map(x=>x.role),d.roles);
   assert.equal(executed.plan_digest,compiled.digest);
   assert.equal(h.coordinator.phase,"closed");
   assert.equal(h.log.filter(x=>x.startsWith("allocate:")).length,
     d.roles.length);
   assert.equal(h.log.filter(x=>x.startsWith("run:")).length,d.roles.length);
   assert.equal(h.log.filter(x=>x.startsWith("provider:")).length,2);
   digests.push(executed.plan_digest);
 }
 assert.notEqual(digests[0],digests[1]);
});
