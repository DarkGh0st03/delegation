/** Actual ADK loop; owner hooks below are explicit offline simulations.
 * These tests verify control flow, not native provider/credential evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BaseLlm} from '@google/adk';
import {runTrustedAuthorityOnlyAdaptiveWorkLoop} from '../src/trusted-authority-only-adaptive-work-loop.mjs';
const branch='feature/account-suspension',repo='gitea://gitea.local/thesis/iam-console-poc';
const grant=role=>({operation:role==='test'?'run_tests':'update_file',
 resource:repo+'/branches/feature%2Faccount-suspension'+(role==='test'?'':'/files/apps/'+role+'.ts')});
const diagnosticRead=()=>({operation:'read_file',
 resource:repo+'/branches/feature%2Faccount-suspension/files/apps/backend.ts'});
const candidate=(role,index,permissions=[grant(role)])=>({action:'delegate',task:{
 task_id:'task-'+index,agent_id:role,depends_on:index?['task-'+(index-1)]:[],permissions,
 instruction:'Perform '+role+' approved work'}});
class Decisions extends BaseLlm{
 calls=0;requests=[];
 constructor(sequence,onTurn){super({model:'r355-free-scripted-adaptive-adk'});this.sequence=sequence;this.onTurn=onTurn;}
 async *generateContentAsync(req){this.requests.push(req);const turn=this.calls++;this.onTurn?.(turn);
  const response=this.sequence[this.calls-1];
  yield {content:{role:'model',parts:[{text:JSON.stringify(response)}]}};
 }
 connect(){throw Error('Paid models forbidden');}
}
function fixture({a2aOnly=false,failTask=false}={}){
 const verified=[],events=[];let head='a'.repeat(40),retired=false;
 const hooks={
  async readContext(){if(retired)throw Error('retired');return {requirement:'Implement Account Suspension',branch,
   rootPermissions:['backend','frontend','test'].map(grant),
   agents:Object.fromEntries(['backend','frontend','test'].map(agent_id=>[agent_id,{capabilities:[grant(agent_id).operation]}])),
   previousTasks:verified.map(p=>({task_id:p.task_id,agent_id:p.agent_id})),nextEpoch:verified.length+1,
   executionProgress:{current_head_sha:head,completed_work:verified.map(p=>({task_id:p.task_id,agent_id:p.agent_id,
    operation:grant(p.agent_id).operation,instruction:p.instruction}))}};},
  async beforeDecision(){events.push('decision');},
  async executeTask(task){
   events.push('dispatch:'+task.agent_id);
   if(failTask)throw Error('original provider failed');
   if(a2aOnly)return {status:'a2a_completed',provider_completion_attested:true};
   if(task.agent_id!=='test')head=(verified.length+11).toString(16).repeat(40).slice(0,40);
   verified.push({...task,tested:task.agent_id==='test'?head:undefined});events.push('gateway_attested:'+task.agent_id);
  },
  async confirmReady(){
   events.push('independent_current_test');
   const last=verified.filter(p=>p.agent_id==='test').at(-1);
   if(!last||last.tested!==head)throw Error('no independent current Test');
   return {status:'owner_verified_tested_head_not_pr_authorized',tested_commit_sha:head,
    task_id:last.task_id,runtime_task_id:'runtime-'+last.task_id};
  },
  async retire(){retired=true;events.push('retire');}
 };
 return {hooks,verified,events,move:()=>{head='f'.repeat(40);},get retired(){return retired;}};
}
for(const roles of [['frontend','backend','test'],['backend','test']]){
 test('R355 model selects work order '+roles.join(' -> '),async()=>{
  const f=fixture(),model=new Decisions([...roles.map((r,i)=>candidate(r,i)),{action:'ready_for_pr',reason:'Validation is complete'}]);
  const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks});
  assert.equal(result.status,'owner_adaptive_work_ready_for_pr');assert.equal(result.pr_created,false);
  assert.equal(result.executed_tasks,roles.length);assert.equal(f.retired,false);
  assert.deepEqual(f.events.filter(x=>x.startsWith('dispatch:')),roles.map(r=>'dispatch:'+r));
  assert.equal(model.calls,roles.length+1);
  for(let i=0;i<roles.length;i++)assert.ok(f.events.indexOf('gateway_attested:'+roles[i])<f.events.lastIndexOf('decision'));
  assert.equal(JSON.stringify(model.requests).includes('private-child-token'),false);
 });
}
for(const mode of ['premature','stale-test','a2a-only','provider-failed','scope-escalation','branch-child','head-race','budget','aborted','extra-fields']){
 test('R355 adaptive loop fails closed '+mode,async()=>{
  const f=fixture({a2aOnly:mode==='a2a-only',failTask:mode==='provider-failed'}),abort=new AbortController();
  let sequence=[candidate('backend',0),{action:'ready_for_pr',reason:'Request PR'}];
  if(mode==='premature')sequence=[{action:'ready_for_pr',reason:'Premature'}];
  if(mode==='stale-test')sequence=[candidate('test',0),candidate('backend',1),{action:'ready_for_pr',reason:'Old test'}];
  if(mode==='scope-escalation')sequence=[candidate('backend',0,[{operation:'update_file',resource:repo+'/branches/main/files/secrets.ts'}])];
  if(mode==='branch-child')sequence=[candidate('backend',0,[{operation:'create_branch',resource:repo}])];
  if(mode==='extra-fields')sequence=[{...candidate('backend',0),root_credential_id:'untrusted-root'}];
  const model=new Decisions(sequence,()=>{if(mode==='head-race')f.move();if(mode==='aborted')abort.abort();});
  await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks,
   maxSteps:mode==='budget'?1:8,signal:abort.signal}));
  assert.equal(f.retired,true);assert.equal(f.events.at(-1),'retire');
  if(['premature','scope-escalation','branch-child','head-race','aborted','extra-fields'].includes(mode))
   assert.equal(f.verified.length,0);
  if(mode==='a2a-only')assert.equal(model.calls,1,'unattested A2A output cannot unlock another model turn');
 });
}
test('R355 model can stop blocked without fabricating completion',async()=>{
 const f=fixture(),model=new Decisions([{action:'blocked',reason:'Required authority is unavailable'}]);
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks});
 assert.equal(result.status,'owner_adaptive_work_blocked');assert.equal(result.executed_tasks,0);
 assert.equal(f.retired,true);assert.equal(result.pr_created,false);
});

/** R355.2: the simulated owner is the ONLY party allowed to convert the
 * original controlled Runner FAIL into an authenticated observation. The
 * scripted LLM cannot provide a digest, change the root or complete the FAIL. */
function verifiedFailureFixture({forgery,failRole='test',throwTest=false,failCount=1,failAfter=0,acceptanceFailure,failingTestFiles}={}){
 const done=[],events=[],history=[];let epoch=1,head='a'.repeat(40),failure,retired=false,failedAttempts=0;
 const permission=grant;
 const hooks={
  async readContext(){if(retired)throw Error('retired');
   return {
    requirement:'Implement Account Suspension',branch,
    rootPermissions:[...['backend','frontend','test'].map(permission),diagnosticRead()],
    agents:Object.fromEntries(['backend','frontend','test'].map(agent_id=>[
     agent_id,{capabilities:[permission(agent_id).operation,
      ...(agent_id==='backend'?['read_file']:[])]}])),
    previousTasks:done.map(p=>({task_id:p.task_id,agent_id:p.agent_id})),
    nextEpoch:epoch,
    executionProgress:{current_head_sha:head,completed_work:done.map(p=>({
     task_id:p.task_id,agent_id:p.agent_id,
     operation:p.permissions.find(g=>g.operation==='update_file'||g.operation==='run_tests')?.operation??'read_file',
     instruction:p.instruction}))},
    ...(failure?{verifiedFailure:{failed_phase:failure.failed_phase,
     source_evidence_sha256:failure.source_evidence_sha256,
     ...(failure.failing_test_files?{failing_test_files:failure.failing_test_files}:{}),
     ...(failure.acceptance_failure?{acceptance_failure:failure.acceptance_failure}:{})},
     verifiedFailureHistory:history.map(f=>({
      failed_task_id:f.failed_task_id,failed_phase:f.failed_phase,
      source_evidence_sha256:f.source_evidence_sha256,
      tested_commit_sha:f.tested_commit_sha
     }))}:{})
   };
  },
  async beforeDecision(){events.push('decision');},
  async executeTask(task){
   events.push('dispatch:'+task.task_id);epoch++;
   const runsTests=task.permissions.some(g=>g.operation==='run_tests');
   if(task.agent_id===failRole&&(failRole!=='test'||runsTests)&&
      done.length>=failAfter&&failedAttempts<failCount){
    failedAttempts++;
    events.push('original-runner-fail');
    if(task.agent_id!=='test'||throwTest)
     throw Error('A2A Test FAILED: untrusted error is NOT proof');
    return {status:'owner_verified_native_test_failure_preflight_only'};
   }
   if(task.permissions.some(g=>g.operation==='update_file'))head='b'.repeat(40);
   done.push({...task,tested:runsTests?head:undefined});
   events.push('gateway_attested:'+task.task_id);
  },
  async observeVerifiedTestFailure({task,context}){
   events.push('original-owner-observe-runner-fail');
   if(failedAttempts>2)throw Error('trusted owner recovery attempt budget exhausted');
   const original={status:'owner_verified_native_test_failure_preflight_only',
    failed_task_id:task.task_id,
    failed_runtime_task_id:'dispatch_'+'F'.repeat(22),
    gateway_task_completed:false,recovery_authorized:false,
    tested_commit_sha:context.executionProgress.current_head_sha,
    failed_phase:acceptanceFailure?'researcher_acceptance':failingTestFiles?'frontend_tests':'typecheck',
    ...(failingTestFiles?{failing_test_files:failingTestFiles}:{}),
    ...(acceptanceFailure?{acceptance_failure:acceptanceFailure}:{}),
    source_evidence_sha256:String.fromCharCode(98+failedAttempts).repeat(64)};
   if(forgery==='wrong-status')return {...original,status:'a2a_claimed_test_fail'};
   if(forgery==='wrong-head')return {...original,tested_commit_sha:'f'.repeat(40)};
   if(forgery==='wrong-digest')return {...original,source_evidence_sha256:'not-a-digest'};
   failure=original;
   history.push(original);
   return original;
  },
  async confirmReady(){events.push('independent_latest_runner_pass');
   const test=done.filter(p=>p.tested!==undefined).at(-1);
   if(!test||test.tested!==head)throw Error('no verified current Test');
   return {status:'owner_verified_tested_head_not_pr_authorized',
    task_id:test.task_id,runtime_task_id:'dispatch_'+'P'.repeat(22),
    tested_commit_sha:test.tested};
  },
  async retire(){retired=true;events.push('retire');}
 };
 return {hooks,done,events,get retired(){return retired;}};
}
test('R355.2 independently verified Test FAIL is observable, not a completed dependency',async()=>{
 const f=verifiedFailureFixture();
 const backend=candidate('backend',1);
 backend.task.depends_on=[];
 const model=new Decisions([candidate('test',0),backend,candidate('test',2),
  {action:'ready_for_pr',reason:'The replacement Test PASS is independently attested'}]);
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks});
 assert.equal(result.status,'owner_adaptive_work_ready_for_pr');
 assert.equal(result.executed_tasks,2,'original FAIL cannot count as completion');
 assert.equal(result.source_test_task_id,'task-2');
 assert.equal(result.pr_created,false);
 assert.equal(f.retired,false);
 assert.equal(f.events.filter(x=>x==='original-owner-observe-runner-fail').length,1);
 assert.equal(f.done.length,2);
 assert.equal(f.done.some(x=>x.task_id==='task-0'),false);
 assert.deepEqual(f.done.map(x=>x.task_id),['task-1','task-2']);
 const prompts=JSON.stringify(model.requests);
 assert.match(prompts,/independent_runner_failure/u);
 assert.match(prompts,/typecheck/u);
 assert.equal(prompts.includes('A2A Test FAILED: untrusted error'),false);
 assert.ok(f.events.indexOf('original-owner-observe-runner-fail')<
  f.events.indexOf('dispatch:task-1'));
});
for(const forgery of ['wrong-status','wrong-head','wrong-digest']){
 test('R355.2 forged Test FAIL cannot unlock model continuation: '+forgery,async()=>{
  const f=verifiedFailureFixture({forgery});
  const model=new Decisions([candidate('test',0),candidate('backend',1)]);
  await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
   /not independently verified/u);
  assert.equal(model.calls,1);
  assert.equal(f.retired,true);
  assert.equal(f.done.length,0);
 });
}
test('R355.2 Backend tool failure cannot masquerade as recoverable Test FAIL',async()=>{
 const f=verifiedFailureFixture({failRole:'backend'});
 const model=new Decisions([candidate('backend',0),candidate('test',1)]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
  /untrusted error is NOT proof/u);
 assert.equal(model.calls,1);
 assert.equal(f.retired,true);
 assert.equal(f.events.includes('original-owner-observe-runner-fail'),false);
});
test('R355.6 untrusted thrown Test A2A failure cannot invoke recovery observer',async()=>{
 const f=verifiedFailureFixture({throwTest:true});
 const model=new Decisions([candidate('test',0),candidate('backend',1)]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
  /untrusted error is NOT proof/u);
 assert.equal(model.calls,1);
 assert.equal(f.retired,true);
 assert.equal(f.events.includes('original-owner-observe-runner-fail'),false);
});
test('R376.0 verified Runner FAIL admits bounded read-only diagnosis before repair',async()=>{
 const f=verifiedFailureFixture();
 const inspect=candidate('backend',1,[diagnosticRead()]);
 inspect.task.depends_on=[];
 const edit=candidate('backend',2);
 edit.task.depends_on=['task-1'];
 const retest=candidate('test',3);
 retest.task.depends_on=['task-2'];
 const model=new Decisions([candidate('test',0),inspect,edit,retest,
  {action:'ready_for_pr',reason:'Latest independently verified Runner PASS'}]);
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks,maxSteps:5});
 assert.equal(result.status,'owner_adaptive_work_ready_for_pr');
 assert.equal(result.executed_tasks,3);
 assert.equal(result.source_test_task_id,'task-3');
 assert.deepEqual(f.done.map(x=>x.task_id),['task-1','task-2','task-3']);
 assert.equal(f.retired,false);
 assert.equal(f.events.filter(x=>x==='original-owner-observe-runner-fail').length,1);
 const afterRead=JSON.stringify(model.requests[2]);
 assert.match(afterRead,/read_file/u);
 assert.match(afterRead,/task-1/u);
 assert.match(afterRead,/independently_gateway_completed_tasks/u);
 assert.equal(JSON.stringify(model.requests).includes('A2A Test FAILED'),false);
});
test('R376.2 independently attested source excerpt reaches next ADK repair decision only at current HEAD',async()=>{
 const f=verifiedFailureFixture();
 const read=f.hooks.readContext;
 const excerpt='export const accountPending = true; // untrusted source DATA';
 f.hooks.readContext=async()=>{
  const state=await read();
  if(state.executionProgress.current_head_sha==='a'.repeat(40)&&
     state.previousTasks.some(row=>row.task_id==='task-1'))
   state.executionProgress.source_observations=[{
    task_id:'task-1',agent_id:'backend',path:'apps/backend.ts',
    revision:state.executionProgress.current_head_sha,
    source_sha256:'d'.repeat(64),source_bytes:excerpt.length,
    excerpt,excerpt_truncated:false,evidence_sha256:'e'.repeat(64)
   }];
  return state;
 };
 const inspect=candidate('backend',1,[diagnosticRead()]);inspect.task.depends_on=[];
 const repair=candidate('backend',2);repair.task.depends_on=['task-1'];
 const retest=candidate('test',3);retest.task.depends_on=['task-2'];
 const model=new Decisions([candidate('test',0),inspect,repair,retest,
  {action:'ready_for_pr',reason:'Latest independently verified Test PASS'}]);
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks,maxSteps:5});
 assert.equal(result.status,'owner_adaptive_work_ready_for_pr');
 assert.equal(result.executed_tasks,3);
 assert.equal(result.source_test_task_id,'task-3');
 assert.equal(f.retired,false);
 const modelRepairInput=JSON.stringify(model.requests[2]);
 assert.match(modelRepairInput,/source_observations/u);
 assert.ok(modelRepairInput.includes(excerpt),'repair can use owner-attested read result');
 assert.ok(!JSON.stringify(model.requests[3]).includes(excerpt),
  'stale diagnostic bytes cannot follow a mutation to a different HEAD');
});
for(const kind of ['foreign-task','wrong-head','bad-digest','over-budget']){
 test('R376.2 malformed source observation cannot reach ADK: '+kind,async()=>{
  const f=verifiedFailureFixture();
  const orig=f.hooks.readContext;
  f.hooks.readContext=async()=>{
   const state=await orig();
   if(state.previousTasks.some(p=>p.task_id==='task-1')){
    const item={
     task_id:kind==='foreign-task'?'foreign':'task-1',
     agent_id:'backend',path:'apps/backend.ts',
     revision:kind==='wrong-head'?'f'.repeat(40):state.executionProgress.current_head_sha,
     source_sha256:kind==='bad-digest'?'nonsense':'a'.repeat(64),
     source_bytes:50,excerpt:kind==='over-budget'?'x'.repeat(4097):'bounded diagnostic',
     excerpt_truncated:false,evidence_sha256:'b'.repeat(64)
    };
    state.executionProgress.source_observations=[item];
   }
   return state;
  };
  const inspect=candidate('backend',1,[diagnosticRead()]);inspect.task.depends_on=[];
  const repair=candidate('backend',2);repair.task.depends_on=['task-1'];
  const model=new Decisions([candidate('test',0),inspect,repair]);
  await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({
   model,hooks:f.hooks,maxSteps:3
  }),/Task choice denied/u);
  assert.equal(model.calls,2);
  assert.deepEqual(f.done.map(x=>x.task_id),['task-1']);
  assert.equal(f.retired,true);
 });
}
test('R377.0 read-only investigation before any failure informs the next model turn',async()=>{
 const f=verifiedFailureFixture({failCount:0});
 const orig=f.hooks.readContext;
 const excerpt='export function suspendAccount() { return false; }';
 f.hooks.readContext=async()=>{
  const state=await orig();
  if(state.executionProgress.current_head_sha==='a'.repeat(40)&&
     state.previousTasks.some(p=>p.task_id==='task-0'))
   state.executionProgress.source_observations=[{
    task_id:'task-0',agent_id:'backend',path:'apps/backend.ts',
    revision:state.executionProgress.current_head_sha,
    source_sha256:'d'.repeat(64),source_bytes:excerpt.length,
    excerpt,excerpt_truncated:false,evidence_sha256:'e'.repeat(64)
   }];
  return state;
 };
 const inspect=candidate('backend',0,[diagnosticRead()]);
 const edit=candidate('backend',1);
 const verify=candidate('test',2);
 const model=new Decisions([inspect,edit,verify,
  {action:'ready_for_pr',reason:'Independent Test is current'}]);
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks,maxSteps:4});
 assert.equal(result.status,'owner_adaptive_work_ready_for_pr');
 assert.equal(result.executed_tasks,3);
 assert.deepEqual(f.done.map(p=>p.task_id),['task-0','task-1','task-2']);
 assert.equal(f.retired,false);
 assert.equal(f.events.some(e=>e==='original-owner-observe-runner-fail'),false);
 const next=JSON.stringify(model.requests[1]);
 assert.match(next,/source_observations/u);
 assert.ok(next.includes(excerpt),'model sees private independently attested read DATA');
 assert.ok(!JSON.stringify(model.requests[2]).includes(excerpt),
  'new HEAD invalidates prior source observation');
 assert.ok(!JSON.stringify(model.requests).includes('independently_verified_test_failures'),
  'no failure can be fabricated to authorize an investigation');
});
test('R377.0 pre-failure read outside signed Engineer root is denied',async()=>{
 const f=fixture();
 const read=f.hooks.readContext;
 f.hooks.readContext=async()=>{
  const ctx=await read();
  ctx.agents.backend.capabilities.push('read_file');
  // No read_file in the signed root: advertised capability cannot grant it.
  return ctx;
 };
 const model=new Decisions([candidate('backend',0,[diagnosticRead()])]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
  /Task choice denied/u);
 assert.equal(model.calls,1);
 assert.equal(f.verified.length,0);
 assert.equal(f.retired,true);
});
test('R377.0 read-only Test agent before any failure is denied',async()=>{
 const f=verifiedFailureFixture({failCount:0});
 const original=f.hooks.readContext;
 f.hooks.readContext=async()=>{
  const ctx=await original();
  ctx.agents.test.capabilities.push('read_file');
  return ctx;
 };
 const model=new Decisions([candidate('test',0,[diagnosticRead()])]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
  /Task choice denied/u);
 assert.equal(model.calls,1);
 assert.equal(f.done.length,0);
 assert.equal(f.retired,true);
});
test('R376.1 a Test-role read cannot replace signed run_tests authority',async()=>{
 const f=verifiedFailureFixture();
 const original=f.hooks.readContext;
 f.hooks.readContext=async()=>{
  const ctx=await original();
  // Even when a trusted registry advertises the capability, the Test
  // specialist cannot execute a recovery diagnosis disguised as a read.
  ctx.agents.test.capabilities.push('read_file');
  return ctx;
 };
 const inspect=candidate('test',1,[diagnosticRead()]);
 inspect.task.depends_on=[];
 const model=new Decisions([candidate('test',0),inspect]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
  /Task choice denied/u);
 assert.equal(model.calls,2);
 assert.equal(f.done.length,0);
 assert.equal(f.retired,true);
});
test('R376.0 diagnostic read outside immutable Engineer root is denied',async()=>{
 const f=verifiedFailureFixture();
 const inspect=candidate('backend',1,[{
  operation:'read_file',resource:repo+'/branches/main/files/private.ts'}]);
 inspect.task.depends_on=[];
 const model=new Decisions([candidate('test',0),inspect]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
  /Task choice denied/u);
 assert.equal(model.calls,2);
 assert.equal(f.done.length,0);
 assert.equal(f.retired,true);
});
test('R355.7 adaptive Test FAIL twice, two different corrections, final Test PASS',async()=>{
 const f=verifiedFailureFixture({failCount:2});
 const backend=candidate('backend',1);
 backend.task.depends_on=[];
 const frontend=candidate('frontend',3);
 frontend.task.depends_on=['task-1'];
 const model=new Decisions([
  candidate('test',0),backend,candidate('test',2),frontend,
  candidate('test',4),
  {action:'ready_for_pr',reason:'Last independent Test passes on current SHA'}
 ]);
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks,
  maxSteps:6});
 assert.equal(result.status,'owner_adaptive_work_ready_for_pr');
 assert.equal(result.source_test_task_id,'task-4');
 assert.equal(result.executed_tasks,3);
 assert.equal(f.retired,false);
 assert.equal(model.calls,6);
 assert.equal(f.events.filter(x=>x==='original-owner-observe-runner-fail').length,2);
 assert.deepEqual(f.done.map(x=>x.task_id),['task-1','task-3','task-4']);
 const second=JSON.stringify(model.requests[1]);
 const fourth=JSON.stringify(model.requests[3]);
 assert.ok(second.includes('c'.repeat(64)));
 assert.ok(fourth.includes('d'.repeat(64)));
 assert.ok(fourth.includes('c'.repeat(64)),'prior failure remains visible in bounded history');
 assert.ok(fourth.includes('independently_verified_test_failures'));
 assert.equal(JSON.stringify(model.requests).includes('A2A Test FAILED'),false);
});
test('R355.7 third Test FAIL exceeds owner recovery budget and retires root',async()=>{
 const f=verifiedFailureFixture({failCount:3});
 const backend=candidate('backend',1);
 backend.task.depends_on=[];
 const frontend=candidate('frontend',3);
 frontend.task.depends_on=['task-1'];
 const model=new Decisions([candidate('test',0),backend,
  candidate('test',2),frontend,candidate('test',4),
  {action:'ready_for_pr',reason:'Do not reach readiness'}]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({
  model,hooks:f.hooks,maxSteps:6}),/recovery attempt budget exhausted/u);
 assert.equal(f.retired,true);
 assert.equal(model.calls,5);
 assert.deepEqual(f.done.map(x=>x.task_id),['task-1','task-3']);
 assert.equal(f.events.filter(x=>x==='original-owner-observe-runner-fail').length,3);
});
for(const [field,value] of [
 ['source_evidence_sha256','not-an-authenticated-digest'],
 ['failed_task_id','other-test'],
 ['tested_commit_sha','f'.repeat(40)]
]){
 test('R377.2 owner proof must match appended failure history: '+field,async()=>{
  const f=verifiedFailureFixture();
  const read=f.hooks.readContext;
  f.hooks.readContext=async()=>{
   const data=await read();
   if(data.verifiedFailureHistory)data.verifiedFailureHistory[0][field]=value;
   return data;
  };
  const model=new Decisions([candidate('test',0)]);
  await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
   /FAIL history differs from the original owner proof/);
  assert.equal(model.calls,1);
  assert.equal(f.retired,true);
 });
}
test('R377.2 recovery cannot reuse a failed Task ID',async()=>{
 const f=verifiedFailureFixture();
 const model=new Decisions([candidate('test',0),candidate('backend',0)]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
  /Task choice denied/);
 assert.equal(f.events.filter(x=>x==='dispatch:task-0').length,1);
 assert.equal(f.retired,true);
});
test('R377.2 a newer FAIL invalidates an earlier PASS on the same HEAD',async()=>{
 const f=verifiedFailureFixture({failAfter:1});
 const model=new Decisions([candidate('test',0),candidate('test',1),
  {action:'ready_for_pr',reason:'Use the earlier PASS'}]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),
  /verified Test FAIL requires a new independently completed Test/);
 assert.deepEqual(f.done.map(p=>p.task_id),['task-0']);
 assert.equal(f.events.includes('independent_latest_runner_pass'),false);
 assert.equal(f.retired,true);
});
// R366: no PR readiness from an older/forged Test receipt or a HEAD
// change while the original owner awaits independent verification.
for(const mode of ['foreign-test-id','wrong-tested-head','head-moved-during-proof',
 'missing-runtime-task-id']){
 test('R366 adaptive ready proof stays bound to latest Test and current owner: '+mode,async()=>{
  const f=fixture();
  const original=f.hooks.confirmReady;
  f.hooks.confirmReady=async()=>{
   const proof=await original();
   if(mode==='foreign-test-id')return {...proof,task_id:'foreign-test'};
   if(mode==='wrong-tested-head')return {...proof,tested_commit_sha:'f'.repeat(40)};
   if(mode==='missing-runtime-task-id')return {...proof,runtime_task_id:''};
   f.move();
   return proof;
  };
  const model=new Decisions([candidate('test',0),
   {action:'ready_for_pr',reason:'Independent current Test required'}]);
  await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({
   model,hooks:f.hooks
  }),/independent current Test proof or original owner context changed/u);
  assert.equal(f.retired,true);
  assert.equal(model.calls,2);
  assert.equal(f.verified.length,1,'valid prior Test stays in the completion ledger');
 });
}
test('R355 retirement failure is reported as unconfirmed',async()=>{
 const f=fixture(),model=new Decisions([{action:'ready_for_pr',reason:'Premature'}]);
 f.hooks.retire=async()=>{throw Error('native unavailable');};
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),/retirement unconfirmed/);
});

test('R375 owner can complete 15 separately verified decisions without widening any Task',async()=>{
 const f=fixture();
 const sequence=[
  ...Array.from({length:13},(_,i)=>candidate('backend',i)),
  candidate('test',13),
  {action:'ready_for_pr',reason:'The latest real Test proof is independent'}
 ];
 const model=new Decisions(sequence);
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks,maxSteps:15});
 assert.equal(result.status,'owner_adaptive_work_ready_for_pr');
 assert.equal(result.executed_tasks,14);
 assert.equal(model.calls,15);
 assert.equal(f.verified.length,14);
 assert.equal(f.retired,false);
 assert.equal(result.pr_created,false);
});
test('R375 original adaptive owner rejects unbounded 17th decision',async()=>{
 const f=fixture();
 const model=new Decisions([candidate('backend',0)]);
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({
  model,hooks:f.hooks,maxSteps:17
 }),/invalid original owner loop configuration/u);
 assert.equal(model.calls,0);
 assert.equal(f.verified.length,0);
});

test('R377.3 verified FAIL can select a separate signed Test repair and then retest',async()=>{
 const f=verifiedFailureFixture();
 const resource=repo+'/branches/feature%2Faccount-suspension/files/tests/backend/account.test.ts';
 const permissions=['read_file','update_file'].map(operation=>({resource,operation}));
 const read=f.hooks.readContext;
 f.hooks.readContext=async()=>{
  const ctx=await read();
  ctx.rootPermissions.push(...permissions);
  ctx.agents.test.capabilities.push('read_file','update_file');
  return ctx;
 };
 const repair=candidate('test',1,permissions);
 repair.task.depends_on=[];
 const model=new Decisions([candidate('test',0),repair,candidate('test',2),
  {action:'ready_for_pr',reason:'The separate retest passed'}]);
 const result=await runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks});
 assert.equal(result.source_test_task_id,'task-2');
 assert.deepEqual(f.done.map(p=>[p.task_id,p.tested!==undefined]),
  [['task-1',false],['task-2',true]]);
});

for(const check of ['ui_pending_actions','untrusted raw assertion']){
 test('R377.4 adaptive ADK receives only catalogued acceptance labels: '+check,async()=>{
  const f=verifiedFailureFixture({acceptanceFailure:{
   failed_checks:[check],timed_out:false,unclassified_failure:false
  }});
  const repair=candidate('frontend',1);
  repair.task.depends_on=[];
  const model=new Decisions([candidate('test',0),repair,candidate('test',2),
   {action:'ready_for_pr',reason:'The separate retest passed'}]);
  const run=runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks});
  if(check==='ui_pending_actions'){
   assert.equal((await run).source_test_task_id,'task-2');
   const prompt=JSON.stringify(model.requests[1]);
   assert.match(prompt,/acceptance_failure/u);
   assert.match(prompt,/ui_pending_actions/u);
   assert.match(prompt,/verified_failure_preflight_only_not_approval/u);
  }else{
   await assert.rejects(run,/Task choice denied/u);
   assert.equal(model.calls,1);
   assert.equal(f.retired,true);
  }
 });
}

for(const authorized of [true,false]){
 test('R377.5 ADK Vitest path requires an original signed read: '+authorized,async()=>{
  const path='tests/frontend/account.test.tsx';
  const f=verifiedFailureFixture({failingTestFiles:[path]});
  const read=f.hooks.readContext;
  f.hooks.readContext=async()=>{
   const ctx=await read();
   if(authorized)ctx.rootPermissions.push({
    resource:grant('test').resource+'/files/'+path,operation:'read_file'
   });
   return ctx;
  };
  const model=new Decisions([candidate('test',0),{action:'blocked',reason:'Stop after diagnosis'}]);
  const run=runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks});
  if(authorized){
   assert.equal((await run).status,'owner_adaptive_work_blocked');
   assert.match(JSON.stringify(model.requests[1]),/failing_test_files/u);
   assert.match(JSON.stringify(model.requests[1]),/account\.test\.tsx/u);
  }else{
   await assert.rejects(run,/Task choice denied/u);
   assert.equal(model.calls,1);
  }
 });
}
