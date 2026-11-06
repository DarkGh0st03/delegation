/** Actual ADK loop; owner hooks below are explicit offline simulations.
 * These tests verify control flow, not native provider/credential evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BaseLlm} from '@google/adk';
import {runTrustedAuthorityOnlyAdaptiveWorkLoop} from '../src/trusted-authority-only-adaptive-work-loop.mjs';
const branch='feature/account-suspension',repo='gitea://gitea.local/thesis/iam-console-poc';
const grant=role=>({operation:role==='test'?'run_tests':'update_file',
 resource:repo+'/branches/feature%2Faccount-suspension'+(role==='test'?'':'/files/apps/'+role+'.ts')});
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
test('R355 retirement failure is reported as unconfirmed',async()=>{
 const f=fixture(),model=new Decisions([{action:'ready_for_pr',reason:'Premature'}]);
 f.hooks.retire=async()=>{throw Error('native unavailable');};
 await assert.rejects(runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks:f.hooks}),/retirement unconfirmed/);
});
