import test from "node:test";
import assert from "node:assert/strict";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
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
}={}){
  const p=plan(options.workBranch);
  const ids=p.requested_permissions.map(x=>x.id);
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
    },
    async closeExecution(){log.push("close");coordinator.phase="closed";}
  };
  const runner={
    async issueAndRun(input:any){
      log.push("run:"+input.subtask.subtask_id+":"+input.trusted_gateway_task_id);
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
     /Invalid approved feature branch/);
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
   /Exactly one approved feature branch/);
});
