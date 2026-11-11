/** D0 Account Suspension: exact production DAG gate, but a scripted ADK
 * Planner and synthetic baseline. Zero provider calls, approvals or writes.
 * This verifies contract plumbing, not real Gemini plan acceptance rates. */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {getApprovedOfflineScenario} from "../../test-runner-controller/fixtures/approved-scenarios.mjs";
import {makeOfflineReviewableDag} from "../../../packages/orchestrator-runtime/test/fixtures/offline-planning-dag.mjs";
import {compilePlanningProposal,TrustedAdkReadOnlyPlanner,safeExecutionPreflightRejection}
 from "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {preflightApprovedPilotDag} from "./approved-dag-preflight.mjs";
const scenario=getApprovedOfflineScenario("account-suspension");
const repository={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const base_revision="a".repeat(40),file="apps/backend/src/users/user.service.ts";
const files=Object.keys(scenario.files).filter(x=>x!==scenario.planning_intent.newTestFile);
const dirs=new Set([""]);
for(const name of Object.keys(scenario.files)){
 const a=name.split("/");for(let i=1;i<a.length;i++)dirs.add(a.slice(0,i).join("/"));
}
const snapshot={session_id:"d0_account_suspension",repository,base_revision,
 files,directories:[...dirs].sort()};
const agents={backend:{did:"did:example:backend",card_ref:"trusted:backend"},
 frontend:{did:"did:example:frontend",card_ref:"trusted:frontend"},
 test:{did:"did:example:test",card_ref:"trusted:test"}};
const config={snapshot,agents,requirement:scenario.requirement,
 planId:"d0_account_suspension",workBranch:scenario.workBranch};
const draft=()=>makeOfflineReviewableDag({snapshot,edits:scenario.planning_intent.edits,
 newTestFile:scenario.planning_intent.newTestFile,
 taskInstructions:scenario.planning_intent.taskInstructions});
const compile=raw=>compilePlanningProposal(raw,config);
const gate=p=>preflightApprovedPilotDag({plan:p.plan,
 grants:p.plan.requested_permissions,repo:repository,branch:scenario.workBranch});
class FakeAdkModel extends BaseLlm{
 constructor(drafts){super({model:"offline-d0-account"});this.drafts=drafts;this.requests=[];}
 async *generateContentAsync(request){
  this.requests.push(request);
  if(this.requests.length===1){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"pinned-read",name:"read_file",args:{branch:"main",path:file}
   }}]}};return;
  }
  const i=Math.min(this.requests.length-2,this.drafts.length-1);
  yield {content:{role:"model",parts:[{text:JSON.stringify(this.drafts[i])}]}};
 }
 connect(){return Promise.reject(Error("Offline only"));}
}
test("original requirement + executable native preflight accept structurally valid D0",()=>{
 assert.ok(scenario.requirement.includes("POST /api/users/:id/suspend"));
 assert.ok(scenario.requirement.includes("HTTP 409"));
 assert.equal(files.includes(scenario.planning_intent.newTestFile),false);
 const proposal=compile(draft()),result=gate(proposal);
 assert.equal(proposal.status,"unapproved_proposal");
 assert.equal(proposal.plan.requirement,scenario.requirement);
 assert.equal(result.approvedTaskCount,5);
 assert.equal(result.runnerTaskId,"test");
 assert.equal(result.reviewTaskId,"pr");
 assert.equal(result.createdTestFiles.length,1);
 assert.equal("approval" in proposal,false);
});
test("real ADK Planner receives bounded DAG rejection feedback and corrects unapproved proposal",async()=>{
 const bad=draft();bad.tasks.find(t=>t.id==="pr").depends_on=["branch"];
 const good=draft(),model=new FakeAdkModel([bad,good]),reads=[],events=[];
 const result=await new TrustedAdkReadOnlyPlanner({
  ...config,model,validateProposedPlan:gate,
  maxProposalRevisions:1,maxModelTurns:5,maxOutputTokens:16384,
  onObservation:x=>events.push(x),
  readPort:{async invoke(tool,args){
   reads.push([tool,args]);assert.equal(tool,"read_file");
   assert.deepEqual(args,{branch:"main",path:file});
   return {provider:"gitea",performed:true,tool,branch:"main",path:file,
    revision:base_revision,content:scenario.files[file]};
  }}
 }).propose();
 assert.equal(result.status,"unapproved_proposal");
 assert.equal(result.verified_source_reads,1);
 assert.equal(reads.length,1);
 assert.deepEqual(events.filter(x=>x.kind==="plan_rejection"),[
  {kind:"plan_rejection",stage:"contract",reason:"execution_pr_before_runner"}
 ]);
 assert.equal(model.requests.length,3);
 const feedback=JSON.stringify(model.requests[2].contents.at(-1));
 assert.ok(feedback.includes("execution_pr_before_runner"));
 assert.ok(feedback.includes("create_pull_request Task transitively depend"));
 assert.ok(feedback.includes("no new authority"));
 assert.deepEqual(result.plan.tasks,compile(good).plan.tasks);
 assert.deepEqual(result.plan.requested_permissions,compile(good).plan.requested_permissions);
 assert.equal(gate(result).approvedTaskCount,5);
});
test("native pilot preflight still rejects wrong PR ordering and missing read",()=>{
 const pr=draft();pr.tasks.find(t=>t.id==="pr").depends_on=["branch"];
 assert.throws(()=>gate(compile(pr)),e=>{
  assert.equal(safeExecutionPreflightRejection(e),"execution_pr_before_runner");return true;
 });
 const source=draft(),back=source.tasks.find(t=>t.id==="backend");
 const path=back.permissions.find(p=>p.operation==="update_file").path;
 back.permissions=back.permissions.filter(p=>!(p.operation==="read_file"&&p.path===path));
 assert.throws(()=>gate(compile(source)),e=>{
  assert.equal(safeExecutionPreflightRejection(e),"execution_update_without_read");return true;
 });
});

class TenReadsThenDag extends BaseLlm{
 constructor(dag,paths){super({model:"scripted-ten-read-gemini-replay"});
  this.dag=dag;this.paths=paths;this.calls=0;}
 async *generateContentAsync(){
  const n=++this.calls;
  if(n<=this.paths.length){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"read-"+n,name:"read_file",args:{
     branch:"main",path:this.paths[n-1]}
   }}]}};return;
  }
  yield {content:{role:"model",parts:[{text:JSON.stringify(this.dag)}]}};
 }
 connect(){return Promise.reject(Error("No network model"));}
}
test("replay ten verified file reads: 10 turns fails, 20 allows a complete valid D0 DAG",async()=>{
 const ten=files.slice(0,10);
 assert.equal(ten.length,10);
 const run=limit=>{
  const model=new TenReadsThenDag(draft(),ten),reads=[],events=[];
  const attempt=new TrustedAdkReadOnlyPlanner({
   ...config,model,validateProposedPlan:gate,
   maxModelTurns:limit,maxProposalRevisions:2,
   maxOutputTokens:12000,thinkingLevel:"LOW",
   onObservation:e=>events.push(e),
   readPort:{async invoke(tool,args){
    assert.equal(tool,"read_file");
    assert.ok(ten.includes(args.path));
    reads.push(args.path);
    return {provider:"gitea",performed:true,tool,
     branch:"main",path:args.path,revision:base_revision,
     content:scenario.files[args.path]};
   }}
  }).propose();
  return {attempt,model,reads,events};
 };
 const old=run(10);
 await assert.rejects(old.attempt,/no verified read-only grounded proposal/);
 assert.equal(old.reads.length,10);
 assert.equal(old.model.calls,10);
 assert.deepEqual(old.events.filter(e=>e.kind==="budget_exhausted"),[
  {kind:"budget_exhausted",budget:"model_turns",completed_turns:10,
   max_model_turns:10}
 ]);
 assert.equal(old.events.some(e=>e.kind==="proposal"),false);
 const fixed=run(20);
 const proposal=await fixed.attempt;
 assert.equal(fixed.model.calls,11);
 assert.equal(fixed.reads.length,10);
 assert.equal(proposal.verified_source_reads,10);
 assert.equal(gate(proposal).approvedTaskCount,5);
 assert.equal(fixed.events.some(e=>e.kind==="budget_exhausted"),false);
 assert.equal(fixed.events.filter(e=>e.kind==="proposal").length,1);
});
