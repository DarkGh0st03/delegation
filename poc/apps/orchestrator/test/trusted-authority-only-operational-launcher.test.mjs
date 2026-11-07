import test from 'node:test';
import assert from 'node:assert/strict';
import {runTrustedAuthorityOnlyOperationalWorkflow as launch}
 from '../src/trusted-authority-only-operational-launcher.mjs';

const SHA='a'.repeat(40);
function canonicalConfig(owner,pr){
 return {execution:owner,sdk:{agentBaseUrls:{backend:'http://localhost:1',
  frontend:'http://localhost:2',test:'http://localhost:3'},
  stageChannels:{backend:{},frontend:{},test:{}},
  agentBindingChannels:{backend:{},frontend:{},test:{}}},
  adaptive:{model:{},maxSteps:4,nextChildParameters:()=>({})},
  ...(pr?{draftPullRequest:pr}:{})};
}
function fakeOwner(status='owner_adaptive_work_ready_for_pr'){
 const events=[];
 const owner={
  gateway:{stagedCompletedTaskCount:0},
  async startSdkA2AOwner(){events.push('a2a');return {
   status:'owner_protected_a2a_started_no_provider_execution',
   gateway_execution_authorized:false};},
  async runAdaptiveWorkLoop(){events.push('adaptive');return {
   status,executed_tasks:3,pr_created:false,
   source_test_task_id:'verified-test',
   source_test_runtime_task_id:'dispatch_'+'T'.repeat(22),
   tested_commit_sha:SHA};},
  async proposeAndStageVerifiedPullRequestTask(){events.push('pr-proposal');
   return {status:'owner_pr_root_task_bound_no_provider_execution',
    runtime_task_id:'dispatch_'+'P'.repeat(22),
    tested_commit_sha:SHA,source_test_task_id:'verified-test',
    provider_executed:false,pull_request_created:false};},
  async stageEnrolledPullRequest(){events.push('pr-stage');return {};},
  async attestEnrolledPullRequestCompletion(){events.push('pr-attest');return {};}
 };
 return {owner,events};
}
const prConfig=()=>({
 model:{},headBranch:'feature/account-suspension',baseBranch:'main',
 title:'Review approved changes',body:'Independently attested Runner PASS',
 permission:{resource:'gitea://gitea.local/thesis/iam-console-poc',
  operation:'create_pull_request'},
 prepare:()=>{throw Error('provider should not be called');},
 execute:()=>{throw Error('provider should not be called');}
});
test('R370 readiness alone never issues PR, Child, root VP or provider effect',async()=>{
 const {owner,events}=fakeOwner();
 const result=await launch(canonicalConfig(owner));
 assert.equal(result.status,'owner_operational_ready_for_review_not_pr_authorized');
 assert.equal(result.pr_created,false);
 assert.equal(result.tested_commit_sha,SHA);
 assert.deepEqual(events,['a2a','adaptive']);
 assert.equal('credential_id' in result,false);
 assert.equal('signed_vp' in result,false);
});
test('R370 blocked adaptive result cannot fall through to PR',async()=>{
 const {owner,events}=fakeOwner('owner_adaptive_work_blocked');
 await assert.rejects(launch(canonicalConfig(owner,prConfig())),
  /PR forbidden without latest independently completed Test/);
 assert.deepEqual(events,['a2a','adaptive']);
});
test('R370 reject arbitrary Gateway signer/provider override before SDK startup',async()=>{
 const {owner,events}=fakeOwner();
 const cfg=canonicalConfig(owner);
 cfg.sdk.rootCredentialId='untrusted-root-from-model';
 await assert.rejects(launch(cfg),/trusted owner, protected A2A and bounded adaptive model required/);
 assert.deepEqual(events,[]);
});
test('R370 reject PR without exact Engineer grant, private native callbacks or main base',async()=>{
 for(const mutate of [
  x=>{x.permission.operation='update_file';},
  x=>{x.baseBranch='evil-base';},
  x=>{delete x.prepare;},
  x=>{x.execute=null;},
  x=>{x.title=' ';},
  x=>{x.geminiKey='should-not-appear';}
 ]){
  const {owner,events}=fakeOwner();
  const pr=prConfig();mutate(pr);
  await assert.rejects(launch(canonicalConfig(owner,pr)),
   /PR requires an original exact Engineer grant and private native transport/);
  assert.deepEqual(events,[]);
 }
});
test('R370 reject PR decision bound to another Test SHA before Gateway Prepare',async()=>{
 const {owner,events}=fakeOwner();
 owner.proposeAndStageVerifiedPullRequestTask=async()=>({
  status:'owner_pr_root_task_bound_no_provider_execution',
  runtime_task_id:'dispatch_'+'P'.repeat(22),
  tested_commit_sha:'b'.repeat(40),
  source_test_task_id:'verified-test',
  provider_executed:false,pull_request_created:false});
 await assert.rejects(launch(canonicalConfig(owner,prConfig())),
  /model-selected PR Task is not pinned/);
 assert.deepEqual(events,['a2a','adaptive']);
});
test('R370 one-shot private root PR follows Gateway Prepare, durable stage, native execute, independent attest',async()=>{
 const {owner,events}=fakeOwner();
 owner.proposeAndStageVerifiedPullRequestTask=async input=>{
  events.push('pr-proposal');
  return {status:'owner_pr_root_task_bound_no_provider_execution',
   task_id:'review-approved-pr',runtime_task_id:input.runtimeTaskId,
   tested_commit_sha:SHA,source_test_task_id:'verified-test',
   provider_executed:false,pull_request_created:false};
 };
 owner.stageEnrolledPullRequest=async()=>{events.push('pr-stage');return {
  status:'owner_pr_flight_reserved_no_provider_execution',
  tested_commit_sha:SHA,provider_executed:false};};
 owner.attestEnrolledPullRequestCompletion=async input=>{
  events.push('pr-attest');
  return {status:'owner_pr_completion_independently_observed',
   task_id:input.taskId,runtime_task_id:input.runtimeTaskId,
   gateway_execution_authorized:false};};
 const pr=prConfig();
 pr.prepare=async()=>{events.push('prepare');return {
  request_id:'trusted-opaque-request',audience:'cloud-access-gateway',
  challenge:'nonce-from-original-Gateway',
  required_permission:pr.permission};};
 pr.execute=async()=>{events.push('execute');return {
  decision:'allow',execution:{provider:'gitea',performed:true,
   tool:'create_pull_request',revision:SHA,pull_request_number:1}};};
 const outcome=await launch(canonicalConfig(owner,pr));
 assert.equal(outcome.status,'owner_operational_draft_pr_independently_attested');
 assert.equal(outcome.pr_created,true);
 assert.equal(outcome.pull_request_number,1);
 assert.equal(outcome.adaptive.pr_created,false);
 assert.equal(outcome.adaptive.source_test_task_id,'verified-test');
 assert.deepEqual(events,['a2a','adaptive','pr-proposal','prepare','pr-stage','execute','pr-attest']);
 assert.equal('signed_vp' in outcome,false);
 assert.equal('request_id' in outcome,false);
 assert.equal('credential_id' in outcome,false);
});

const branchCfg=()=>({
 model:{},branch:'feature/account-suspension',baseBranch:'main',
 permission:{resource:'gitea://gitea.local/thesis/iam-console-poc',
  operation:'create_branch'},
 prepare:()=>{throw Error('unreachable branch Prepare');},
 execute:()=>{throw Error('unreachable native branch execute');}
});
test('R371 original root Branch is independently attested before protected SDK A2A',async()=>{
 const {owner,events}=fakeOwner();
 owner.proposeAndStageBranchTask=async input=>{events.push('branch-proposal');return {
  status:'owner_branch_root_task_bound_no_provider_execution',
  task_id:'root-branch-task',runtime_task_id:input.runtimeTaskId,
  base_revision:SHA,provider_executed:false,gateway_execution_authorized:false
 };};
 owner.stageEnrolledBranch=async()=>{events.push('branch-stage');return {
  status:'owner_branch_flight_reserved_no_provider_execution',
  base_revision:SHA,provider_executed:false
 };};
 owner.attestEnrolledBranchCompletion=async input=>{
  events.push('branch-attested');return {
   status:'owner_branch_completion_independently_observed',
   task_id:input.taskId,runtime_task_id:input.runtimeTaskId
  };
 };
 const branch=branchCfg();
 branch.prepare=async request=>{events.push('branch-prepare');return {
  request_id:'prepared-branch-371',audience:'cloud-access-gateway',
  challenge:'native-owner-opaque-challenge',
  required_permission:{...branch.permission}
 };};
 branch.execute=async ({expectedMainSha})=>{
  events.push('branch-native-rust-opa-gitea');
  assert.equal(expectedMainSha,SHA);
  return {decision:'allow',execution:{
   provider:'gitea',performed:true,tool:'create_branch',revision:SHA
  }};
 };
 const result=await launch({...canonicalConfig(owner),createBranch:branch});
 assert.equal(result.status,'owner_operational_ready_for_review_not_pr_authorized');
 assert.equal(result.branch.status,'owner_original_branch_independently_attested');
 assert.equal(result.branch.base_revision,SHA);
 assert.deepEqual(events,['branch-proposal','branch-prepare','branch-stage',
  'branch-native-rust-opa-gitea','branch-attested','a2a','adaptive']);
});
test('R371 cannot launch SDK or workers when original Branch GET has not attested',async()=>{
 const {owner,events}=fakeOwner();
 owner.proposeAndStageBranchTask=async input=>{
  events.push('branch-proposal');return {
   status:'owner_branch_root_task_bound_no_provider_execution',
   task_id:'root-branch-task',runtime_task_id:input.runtimeTaskId,
   base_revision:SHA,provider_executed:false,gateway_execution_authorized:false
  };
 };
 owner.stageEnrolledBranch=async()=>({
  status:'owner_branch_flight_reserved_no_provider_execution',
  base_revision:SHA,provider_executed:false
 });
 owner.attestEnrolledBranchCompletion=async()=>({
  status:'owner_branch_completion_UNVERIFIED'
 });
 const branch=branchCfg();
 branch.prepare=async()=>({
  request_id:'371-p',audience:'cloud-access-gateway',challenge:'371-challenge',
  required_permission:branch.permission
 });
 branch.execute=async()=>({decision:'allow',execution:{
  provider:'gitea',performed:true,tool:'create_branch',revision:SHA
 }});
 await assert.rejects(launch({...canonicalConfig(owner),createBranch:branch}),
  /branch not independently attested/);
 assert.deepEqual(events,['branch-proposal']);
});
test('R371 deny wrong Branch permission or alternate base before private model',async()=>{
 for(const mutate of [
  b=>{b.baseBranch='development';},
  b=>{b.permission.operation='create_pull_request';},
  b=>{b.branch='feature/../main';},
  b=>{b.prepare=null;},
  b=>{b.model=null;},
  b=>{b.legacyAdapter='forbidden';}
 ]){
  const {owner,events}=fakeOwner(),branch=branchCfg();mutate(branch);
  await assert.rejects(launch({...canonicalConfig(owner),createBranch:branch}),
   /branch requires exact original Engineer grant and private native transport/);
  assert.deepEqual(events,[]);
 }
});
