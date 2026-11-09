/**
 * R459 scripted Planner -> owner-pinned reviewer -> real private HTTP A2A.
 * Native Rust, Gateway and Gitea remain fixture-only in this test; R458
 * independently tests those systems with real providers. No paid models.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {createServer} from "node:net";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TrustedAuthorityOnlyAdkDecisionProposer}
 from "../src/trusted-authority-only-adk-decision-proposer.mjs";
import {startTrustedAuthorityOnlySdkA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {startSpecializedAgentServer}
 from "../../agent-runtime/src/server.ts";
import {TrustedEffectStagingTaskRegistry,
 createTrustedEffectAgentBindingServer,connectTrustedOwnerEffectStagingClient}
 from "../../agent-runtime/src/index.ts";

const canonicalRoles=Object.freeze(["backend","frontend","test"]);
const roles=Object.freeze([...canonicalRoles,"reviewer"]);
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension",path="README.md",sha="a".repeat(40);
const taskId="r459-selected-reviewer",runtimeTaskId="dispatch_"+"R".repeat(22);
const did="did:thesis:owner-pinned-reviewer",childId="urn:r459:scripted-read-child";
const grant={resource:canonicalFileUri(repo,branch,path),operation:"read_file"};
const additionalRolePins={reviewer:{did,name:"Owner Read-Only Reviewer",
 skillId:"source-review",capabilities:["read_file"]}};
const selected={task_id:taskId,agent_id:"reviewer",depends_on:[],
 permissions:[grant],instruction:"Read only the approved pinned source"};
class Scripted extends BaseLlm{
 constructor(output){super({model:"r459-no-provider"});this.output=output;this.calls=0;}
 async *generateContentAsync(){
  assert.equal(++this.calls,1);
  yield {content:{role:"model",parts:[{text:JSON.stringify(this.output)}]}};
 }
 connect(){throw Error("No paid provider transport");}
}
const ctx={requirement:"Inspect approved source",branch,rootPermissions:[grant],
 decisionKind:"adaptive",nextEpoch:1,previousTasks:[],
 executionProgress:{current_head_sha:sha,completed_work:[]},
 agents:Object.fromEntries(roles.map(role=>[role,{capabilities:
  role==="reviewer"?["read_file"]:role==="test"?["run_tests"]:
   ["read_file","update_file"]}]))};
async function propose(task){
 const model=new Scripted({action:"delegate",task});
 try{
  const result=await new TrustedAuthorityOnlyAdkDecisionProposer({
   ...ctx,model
  }).propose();
  assert.equal(model.calls,1);
  return result;
 }catch(error){assert.equal(model.calls,1);throw error;}
}
async function port(){
 const server=createServer();
 await new Promise((ok,bad)=>{
  server.once("error",bad);server.listen(0,"127.0.0.1",ok);
 });
 const addr=server.address();
 if(!addr||typeof addr==="string")throw Error("no loopback port");
 await new Promise((ok,bad)=>server.close(err=>err?bad(err):ok()));
 return addr.port;
}
test("R459 scripted Planner selects pinned fourth-role real A2A; only fixture-backed Gateway completes",async()=>{
 assert.deepEqual(canonicalRoles,["backend","frontend","test"]);
 assert.deepEqual(roles,["backend","frontend","test","reviewer"]);
 assert.equal(process.env.GEMINI_API_KEY,undefined);
 assert.equal(process.env.OPENAI_API_KEY,undefined);
 for(const wrong of [
  {...selected,agent_id:"auditor"},
  {...selected,permissions:[{...grant,operation:"update_file"}]},
  {...selected,depends_on:["invented-prior-task"]}
 ])await assert.rejects(propose(wrong),/R351 authority-only model Task choice denied/u);
 const decision=await propose(selected);
 assert.equal(decision.action,"delegate");
 assert.deepEqual(decision.task,selected);
 const dir=await mkdtemp(join(tmpdir(),"r459-"));
 const bindingServers=[],agentServers=[],usedPorts=new Set();
 const stageChannels={},agentBindingChannels={},agentBaseUrls={},registries={};
 let owner,registered=false,transferred=0,staged=0,completed=0,handled=0;
 const root={session_id:"r459-offline",repository:repo,branch,
  authority_digest:"e".repeat(64),root_credential_id:"r459-fixture-root",
  base_revision:sha,requirement_sha256:"f".repeat(64),
  engineer_did:"did:thesis:engineer",
  root_expires_at:new Date(Date.now()+180000).toISOString(),
  expires_at:new Date(Date.now()+180000).toISOString(),
  root_permissions:[grant]};
 const row={status:"task_registered_preflight_only",session_id:root.session_id,
  task_id:taskId,epoch:1,agent_id:"reviewer",agent_did:did,
  card_ref:"trusted:reviewer",depends_on:[],permissions:[grant],
  root_credential_id:root.root_credential_id,authority_digest:root.authority_digest,
  execution_authorized:false,child_credential_issued:false,gateway_registered:false};
 const child={status:"native_child_response_verified_staged",
  session_id:root.session_id,task_id:taskId,epoch:1,agent_id:"reviewer",
  agent_did:did,root_credential_id:root.root_credential_id,
  credential_id:childId,authority_digest:root.authority_digest,permissions:[grant],
  status_list_credential:"https://status.invalid/r459",status_list_index:"1",
  expires_at:new Date(Date.now()+120000).toISOString(),
  gateway_execution_authorized:false};
 const coordinator=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
   assertTrustedGatewayAuthorityBinding:()=>root,
   assertTrustedGatewayRegisteredTask:(id)=>{
    assert.equal(id,taskId);assert.equal(registered,true);return row;
   },
   async registerTask(input){
    assert.equal(registered,false);
    assert.equal(input.task_id,decision.task.task_id);
    assert.equal(input.agent_id,decision.task.agent_id);
    assert.deepEqual(input.depends_on,decision.task.depends_on);
    assert.deepEqual(input.permissions,decision.task.permissions);
    registered=true;return row;
   }
  });
 Object.defineProperty(coordinator,"phase",{value:"active"});
 const issuer=Object.assign(Object.create(TrustedAuthorityOnlyChildIssuer.prototype),{
  assertTrustedIssuedChild:(id)=>{
   assert.equal(id,taskId);assert.equal(registered,true);return child;
  },
  takeTrustedIssuedChildCredential:(id)=>{
   assert.equal(id,taskId);assert.equal(++transferred,1);
   return {id:childId,credentialSubject:{sub:did,per:[grant]},
    proof:{type:"TestOnly",proofValue:"FIXTURE_NOT_NATIVE"}};
  }
 });
 const gateway=Object.assign(Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype),{
  assertTrustedOwnerRemoteEffectBinding:(id,rt)=>{
   assert.equal(id,taskId);assert.equal(rt,runtimeTaskId);
   return {status:"gateway_owner_child_task_preflight_only",
    task_id:id,runtime_task_id:rt,agent_id:"reviewer",agent_did:did,
    credential_id:childId,authority_digest:root.authority_digest,
    gateway_execution_authorized:false};
  },
  attestTrustedTaskCompletion:async(id,rt)=>{
   assert.equal(id,taskId);assert.equal(rt,runtimeTaskId);
   assert.equal(staged,1);assert.equal(++completed,1);
   return {status:"task_completion_observed_staged",
    task_id:id,runtime_task_id:rt,gateway_execution_authorized:false};
  }
 });
 Object.defineProperty(gateway,"phase",{value:"active"});
 try{
  for(const role of roles){
   const ch=async direction=>{
    const socketPath=join(dir,role+"-"+direction+".sock");
    const secretFile=join(dir,role+"-"+direction+".hex");
    await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
     {mode:0o600,flag:"wx"});
    return {socketPath,secretFile};
   };
   stageChannels[role]=await ch("stage");
   agentBindingChannels[role]=await ch("bind");
   registries[role]=new TrustedEffectStagingTaskRegistry();
   const binder=await createTrustedEffectAgentBindingServer({
    ...agentBindingChannels[role],registry:registries[role],expectedRole:role,
    ownerStageClient:await connectTrustedOwnerEffectStagingClient(stageChannels[role])
   });
   bindingServers.push(binder);await binder.start();
  }
  for(const role of roles){
   let p=await port();while(usedPorts.has(p))p=await port();
   usedPorts.add(p);
   const server=await startSpecializedAgentServer({
    role,port:p,host:"127.0.0.1",capabilityProfile:"approved-plan",
    delegatedAuthorization:true,
    ...(role==="reviewer"?{ownerAdditionalCardPin:additionalRolePins.reviewer}:{}),
    taskHandler:async context=>{
     handled++;
     if(role!=="reviewer")throw Error("Wrong specialist");
     assert.equal(context.role,decision.task.agent_id);
     assert.equal(context.trusted_gateway_task_id,runtimeTaskId);
     assert.equal(context.delegation_evidence.presenter_id,did);
     assert.equal(context.subtask.subtask_id,decision.task.task_id);
     assert.equal(context.subtask.instruction,decision.task.instruction);
     assert.deepEqual(context.subtask.approved_file_permissions,
      [{path,operation:"read_file"}]);
     await registries[role].selectFor(context).stage("r459-read");
     return {role:"reviewer",summary:"Read staged through owner fixture",
      files_modified:[],files_created:[],branch,revision:sha,commit_sha:sha,
      test_outcome:"not_run",errors:[]};
    }
   });
   agentServers.push(server);agentBaseUrls[role]=server.baseUrl;
  }
  await coordinator.registerTask({task_id:decision.task.task_id,
   agent_id:decision.task.agent_id,depends_on:decision.task.depends_on,
   permissions:decision.task.permissions});
  owner=await startTrustedAuthorityOnlySdkA2AOwner({
   coordinator,childIssuer:issuer,gateway,stageChannels,agentBindingChannels,
   agentBaseUrls,additionalRolePins,
   a2aPolling:{deadlineMs:12000,initialIntervalMs:20,maxIntervalMs:70}
  });
  assert.equal(owner.verifiedAgentProfiles.reviewer.did,did);
  assert.deepEqual(owner.verifiedAgentProfiles.reviewer.capabilities,["read_file"]);
  const report=await owner.dispatchIssuedTask({
   taskId:decision.task.task_id,runtimeTaskId,
   instruction:decision.task.instruction,
   effectStager:{stagedTool:"read_file",async stage(requestId){
    assert.equal(requestId,"r459-read");assert.equal(++staged,1);
    return {provider_write_authorized:false};
   }}
  });
  assert.equal(report.role,decision.task.agent_id);
  assert.equal(report.status,"a2a_report_not_gateway_completed");
  assert.equal(report.provider_completion_attested,false);
  assert.equal(completed,0);
  assert.equal(handled,1);assert.equal(transferred,1);assert.equal(staged,1);
  await owner.attestIndependentGatewayCompletion(taskId,runtimeTaskId);
  assert.equal(completed,1);
  await assert.rejects(owner.dispatchIssuedTask({
   taskId,runtimeTaskId,instruction:"replay",effectStager:{
    stagedTool:"read_file",async stage(){throw Error("replay");}
   }
  }),/closed or malformed owner-selected Task/u);
 }finally{
  const results=await Promise.allSettled([
   ...(owner?[owner.close()]:[]),
   ...agentServers.reverse().map(server=>server.close()),
   ...bindingServers.reverse().map(server=>server.close())
  ]);
  await rm(dir,{recursive:true,force:true});
  for(const result of results)if(result.status==="rejected")throw result.reason;
 }
});
