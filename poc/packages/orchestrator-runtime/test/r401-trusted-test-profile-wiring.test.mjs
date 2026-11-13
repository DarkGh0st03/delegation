import test from 'node:test';
import assert from 'node:assert/strict';
import {BaseLlm} from '@google/adk';
import {TrustedAuthorityOnlyAdkDecisionProposer}
 from '../src/trusted-authority-only-adk-decision-proposer.mjs';
import {createTrustedProjectTestSourceProfile,IAM_CONSOLE_PROJECT_TEST_PROFILE}
 from '../../plan-contracts/src/gitea-permission-containment.mjs';

class NeverCalledModel extends BaseLlm {
 constructor(){super({model:'r401-offline-only'});}
 async *generateContentAsync(){throw Error('Never call inference in constructor test');}
 connect(){throw Error('Streaming disabled');}
}
const root='gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension';
const props=()=>({
 model:new NeverCalledModel(),requirement:'Verify one regression',
 branch:'feature/account-suspension',
 rootPermissions:[{resource:root+'/files/tests/backend/one.test.ts',operation:'read_file'}],
 agents:{test:{capabilities:['read_file']}},previousTasks:[],nextEpoch:1,
 decisionKind:'agent'
});
test('R401.1 ADK owner accepts only a provisioned repository test profile',()=>{
 const alt=createTrustedProjectTestSourceProfile({
  roots:['src/__tests__'],suffixes:['.spec.ts']
 });
 assert.doesNotThrow(()=>new TrustedAuthorityOnlyAdkDecisionProposer({
  ...props(),projectTestSourceProfile:alt
 }));
 assert.doesNotThrow(()=>new TrustedAuthorityOnlyAdkDecisionProposer({
  ...props(),projectTestSourceProfile:IAM_CONSOLE_PROJECT_TEST_PROFILE
 }));
 assert.throws(()=>new TrustedAuthorityOnlyAdkDecisionProposer({
  ...props(),projectTestSourceProfile:{
   roots:['src/__tests__'],suffixes:['.spec.ts']
  }
 }),/R351 authority-only model Task choice denied/u);
});

/** R434: a registered specialist is a trusted Card/Root intersection.
 * No additional agent process, signer, provider or model is created here. */
class ScriptedChoice extends BaseLlm {
 constructor(choice){super({model:'r434-zero-cost-registered-specialist'});this.choice=choice;this.calls=0;}
 async *generateContentAsync(){
  this.calls++;
  yield {content:{role:'model',parts:[{text:JSON.stringify(this.choice)}]}};
 }
 connect(){throw Error('R434 scripted test cannot connect to paid inference');}
}
const fileResource=root+'/files/apps/invoice.ts';
const permission=(operation,resource=fileResource)=>({resource,operation});
const choice=(agent_id,permissions)=>({action:'delegate',task:{
 task_id:'task-r434',agent_id,depends_on:[],permissions,
 instruction:'Perform one explicitly trusted file operation'
}});
const config=(proposal,options={})=>({
 model:new ScriptedChoice(proposal),requirement:'Update signed invoice code',
 branch:'feature/account-suspension',decisionKind:'adaptive',
 rootPermissions:[permission('read_file'),permission('update_file'),
  permission('create_file'),permission('run_tests',root)],
 agents:{orchestrator:{capabilities:['create_branch']},
  invoice:{capabilities:['read_file','update_file','create_file']},
  test:{capabilities:['read_file','update_file','create_file','run_tests']}},
 previousTasks:[],nextEpoch:1,
 executionProgress:{current_head_sha:'a'.repeat(40),completed_work:[]},
 ...options
});
test('R434 registered specialist may propose scoped READ, UPDATE, CREATE or same-file CAS',async()=>{
 for(const permissions of [
  [permission('read_file')],[permission('update_file')],[permission('create_file')],
  [permission('read_file'),permission('update_file')]
 ]){
  const request=choice('invoice',permissions),cfg=config(request);
  assert.deepEqual(await new TrustedAuthorityOnlyAdkDecisionProposer(cfg).propose(),request);
  assert.equal(cfg.model.calls,1);
 }
});
test('R434 denies unknown role, self-delegation, Test source escalation and ungranted effects',async()=>{
 const cases=[
  config(choice('unknown',[permission('read_file')])),
  config(choice('orchestrator',[permission('read_file')]),{
   agents:{orchestrator:{capabilities:['read_file']}}}),
  config(choice('test',[permission('update_file')])),
  config(choice('invoice',[permission('run_tests',root)]),{
   agents:{invoice:{capabilities:['run_tests']}}}),
  config(choice('invoice',[permission('update_file')]),{
   agents:{invoice:{capabilities:['read_file']}}}),
  config(choice('invoice',[permission('update_file')]),{
   rootPermissions:[permission('read_file')]}),
  config(choice('invoice',[permission('update_file',root+'/files/foreign.ts')]))
 ];
 for(const cfg of cases)
  await assert.rejects(new TrustedAuthorityOnlyAdkDecisionProposer(cfg).propose(),
   /R351 authority-only model Task choice denied/u);
});
test('R434 source excerpts require registered reader, authentic completed Task and current HEAD',async()=>{
 const sha='a'.repeat(40),digest='b'.repeat(64);
 const done={task_id:'trusted-read',agent_id:'invoice',
  operation:'read_file',instruction:'Read independently signed current source'};
 const observed={task_id:'trusted-read',agent_id:'invoice',path:'apps/invoice.ts',
  revision:sha,source_sha256:digest,source_bytes:12,excerpt:'const a=1;',
  excerpt_truncated:false,evidence_sha256:'c'.repeat(64)};
 const cfg=config({action:'blocked',reason:'Stop without additional authority'},{
  previousTasks:[{task_id:done.task_id,agent_id:done.agent_id}],nextEpoch:2,
  executionProgress:{current_head_sha:sha,completed_work:[done],
   source_observations:[observed]}
 });
 assert.deepEqual(await new TrustedAuthorityOnlyAdkDecisionProposer(cfg).propose(),
  {action:'blocked',reason:'Stop without additional authority'});
 for(const invalid of [
  {...cfg,agents:{invoice:{capabilities:['update_file']}}},
  {...cfg,executionProgress:{...cfg.executionProgress,
   source_observations:[{...observed,revision:'d'.repeat(40)}]}},
  {...cfg,executionProgress:{...cfg.executionProgress,
   source_observations:[{...observed,agent_id:'unknown'}]}}
 ])assert.throws(()=>new TrustedAuthorityOnlyAdkDecisionProposer(invalid),
  /R351 authority-only model Task choice denied/u);
});
test('R434 no-change evidence requires a registered specialist (Test included) with read+update',()=>{
 const stop={task_id:'read-but-unchanged',agent_id:'invoice',edited_path:'apps/invoice.ts',
  read_revision:'a'.repeat(40),read_evidence_sha256:'f'.repeat(64)};
 const cfg=config({action:'blocked',reason:'Stop'},{
  specialistNoChanges:[stop]
 });
 assert.doesNotThrow(()=>new TrustedAuthorityOnlyAdkDecisionProposer(cfg));
 // The Test agent may find that a failing test already checks the intended
 // behaviour (session s-7f5fb36e688c): the Orchestrator then repairs the code.
 assert.doesNotThrow(()=>new TrustedAuthorityOnlyAdkDecisionProposer(
  {...cfg,specialistNoChanges:[{...stop,agent_id:'test',edited_path:'tests/invoice.test.ts'}]}));
 for(const invalid of [
  {...cfg,agents:{invoice:{capabilities:['read_file']}}},
  {...cfg,specialistNoChanges:[{...stop,agent_id:'unregistered'}]},
  {...cfg,specialistNoChanges:[{...stop,agent_id:'orchestrator'}]},
  {...cfg,specialistNoChanges:[stop,stop]},
  {...cfg,specialistNoChanges:[]}
 ])assert.throws(()=>new TrustedAuthorityOnlyAdkDecisionProposer(invalid),
  /R351 authority-only model Task choice denied/u);
});

test('a single dependency written as a string is the same one-element list (session s-107efa00274b)',async()=>{
 const repo='gitea://gitea.local/thesis/iam-console-poc';
 const pr={resource:repo,operation:'create_pull_request'};
 const proposer=dependsOn=>new TrustedAuthorityOnlyAdkDecisionProposer({
  model:new ScriptedChoice({task_id:'task-12',agent_id:'orchestrator',depends_on:dependsOn,
   permissions:[pr],instruction:'Open the Draft PR for the tested commit'}),
  requirement:'Search users',branch:'feature/account-suspension',
  rootPermissions:[pr],agents:{orchestrator:{capabilities:['create_pull_request']},test:{capabilities:['run_tests']}},
  previousTasks:[{task_id:'task-11',agent_id:'test'}],nextEpoch:2,decisionKind:'pull_request'});
 assert.deepEqual((await proposer('task-11').propose()).depends_on,['task-11']);
 assert.deepEqual((await proposer(['task-11']).propose()).depends_on,['task-11']);
 // Still validated: an unknown dependency or a non-string value is refused.
 await assert.rejects(proposer('task-99').propose(),/R351 authority-only model Task choice denied/u);
 await assert.rejects(proposer(11).propose(),/R351 authority-only model Task choice denied/u);
});

test('the Orchestrator sees typecheck errors with their message; malformed ones are refused',async()=>{
 const err={file:'apps/invoice.ts',line:3,code:'TS2339',message:"Property 'workEmail' does not exist on type 'UserSummary'."};
 const failure=extra=>({failed_phase:'typecheck',source_evidence_sha256:'e'.repeat(64),
  typecheck_error_codes:['TS2339'],...extra});
 const history=[{failed_task_id:'t-run',failed_phase:'typecheck',source_evidence_sha256:'e'.repeat(64),
  tested_commit_sha:'a'.repeat(40)}];
 const cfg=config({action:'blocked',reason:'Stop'},{verifiedFailure:failure({typecheck_errors:[err]}),
  verifiedFailureHistory:history});
 const seen=[],original=cfg.model.generateContentAsync.bind(cfg.model);
 cfg.model.generateContentAsync=async function*(request){seen.push(request);yield* original(request);};
 await new TrustedAuthorityOnlyAdkDecisionProposer(cfg).propose();
 assert.match(JSON.stringify(seen),/typecheck_errors/u);
 assert.match(JSON.stringify(seen),/workEmail/u);
 for(const bad of [[{...err,message:'a\nb'}],[{...err,extra:1}]])
  assert.throws(()=>new TrustedAuthorityOnlyAdkDecisionProposer({...cfg,
   verifiedFailure:failure({typecheck_errors:bad})}),/R351 authority-only model Task choice denied/u);
});

class RawText extends BaseLlm {
 constructor(text){super({model:'raw-text-zero-cost'});this.text=text;}
 async *generateContentAsync(){yield {content:{role:'model',parts:[{text:this.text}]}};}
 connect(){throw Error('offline');}
}
test('a choice wrapped in ONE Markdown JSON fence is the same choice (session s-690b35c5d886)',async()=>{
 const repo='gitea://gitea.local/thesis/iam-console-poc';
 const pr={resource:repo,operation:'create_pull_request'};
 const json=JSON.stringify({task_id:'task-create-pr-1',agent_id:'orchestrator',depends_on:['task-run-tests-2'],
  permissions:[pr],instruction:'Open the Draft PR for the tested commit'},null,2);
 const proposer=text=>new TrustedAuthorityOnlyAdkDecisionProposer({model:new RawText(text),
  requirement:'Search users',branch:'feature/account-suspension',rootPermissions:[pr],
  agents:{orchestrator:{capabilities:['create_pull_request']},test:{capabilities:['run_tests']}},
  previousTasks:[{task_id:'task-run-tests-2',agent_id:'test'}],nextEpoch:2,decisionKind:'pull_request'});
 for(const text of ['```json\n'+json+'\n```','```\n'+json+'\n```',json])
  assert.equal((await proposer(text).propose()).task_id,'task-create-pr-1');
 // Anything else around the value is still refused.
 for(const text of ['Here it is:\n```json\n'+json+'\n```','```json\n'+json+'\n```\nDone.','```json\n'+json+'\n```\n```json\n{}\n```'])
  await assert.rejects(proposer(text).propose(),/R351 authority-only model Task choice denied/u);
});
