/** R351.0: first model-driven, permission-only Task choice. Never grants
 * authority or issues a Child DC. The original trusted Coordinator is the
 * sole register/validate boundary after this unsigned proposal.
 * No tools, URLs, keys, DIDs, receipts, or model-supplied session pins. */
import {BaseLlm,LlmAgent,Runner,InMemorySessionService} from '@google/adk';
import {giteaPermissionCovers}
 from '../../plan-contracts/src/gitea-permission-containment.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const fail=()=>{throw Error('R351 authority-only model Task choice denied');};
const exact=(obj,fields)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k));
const pair=p=>JSON.stringify([p.operation,p.resource]);
class SingleDecisionModel extends BaseLlm{
 constructor(delegate,deadline){
  super({model:delegate.model});
  this.delegate=delegate;this.deadline=deadline;this.calls=0;
 }
 async *generateContentAsync(req,stream,signal){
  if(++this.calls!==1||this.deadline.aborted)fail();
  const bounded=AbortSignal.any([this.deadline,
   AbortSignal.timeout(25000),...(signal?[signal]:[])]);
  for await(const response of this.delegate.generateContentAsync(req,stream,bounded)){
   if(bounded.aborted||response.errorCode||response.errorMessage)fail();
   yield response;
  }
  if(bounded.aborted)fail();
 }
 connect(){throw Error('Streaming disabled for owner Task decision');}
}
export class TrustedAuthorityOnlyAdkDecisionProposer{
 #attempted=false;
 constructor({model,requirement,branch,rootPermissions,agents,previousTasks,verifiedFailure,verifiedFailureHistory,nextEpoch,decisionKind='agent',executionProgress}){
  if(!(model instanceof BaseLlm)||typeof requirement!=='string'||
     !requirement.trim()||requirement.length>6000||
     typeof branch!=='string'||!branch.startsWith('feature/')||
     !Array.isArray(rootPermissions)||!rootPermissions.length||
     !agents||typeof agents!=='object'||Array.isArray(agents)||
     !Object.keys(agents).length||!Array.isArray(previousTasks)||
     previousTasks.length>255||
     (nextEpoch!==undefined&&(!Number.isSafeInteger(nextEpoch)||
      nextEpoch<1||nextEpoch>256)))
   fail();
  if(!['agent','pull_request','branch','adaptive'].includes(decisionKind))fail();
  this.decisionKind=decisionKind;
  const roots=rootPermissions.map(p=>{
   if(!exact(p,['resource','operation'])||
      typeof p.resource!=='string'||typeof p.operation!=='string')
    fail();
   return Object.freeze({...p});
  });
  const pins={};
  for(const [role,profile] of Object.entries(agents)){
   if(!ID.test(role)||!exact(profile,['capabilities'])||
      !Array.isArray(profile.capabilities)||!profile.capabilities.length||
      profile.capabilities.some(x=>typeof x!=='string'))
    fail();
   pins[role]=Object.freeze([...profile.capabilities]);
  }
  const prior=previousTasks.map(p=>{
   if(!exact(p,['task_id','agent_id'])||!ID.test(p.task_id)||
      !Object.hasOwn(pins,p.agent_id))fail();
   return Object.freeze({...p});
  });
  if(new Set(prior.map(p=>p.task_id)).size!==prior.length)fail();
  this.model=model;this.requirement=requirement;this.branch=branch;
  this.roots=Object.freeze(roots);this.agents=Object.freeze(pins);
  this.previous=Object.freeze(prior);
  // A failed Test is registered but never counted as Gateway-completed.
  // Recovery epochs therefore cannot be inferred from prior successes.
  this.nextEpoch=nextEpoch??prior.length+1;
  if(decisionKind==='adaptive'){
   if(!exact(executionProgress,['current_head_sha','completed_work'])||
      !/^[a-f0-9]{40}$/u.test(executionProgress.current_head_sha)||
      !Array.isArray(executionProgress.completed_work)||
      executionProgress.completed_work.length!==prior.length)fail();
   const ids=new Set();
   for(const item of executionProgress.completed_work){
    if(!exact(item,['task_id','agent_id','operation','instruction'])||ids.has(item.task_id)||
       !prior.some(p=>p.task_id===item.task_id&&p.agent_id===item.agent_id)||
       !['create_branch','update_file','run_tests','create_pull_request'].includes(item.operation)||
       typeof item.instruction!=='string'||!item.instruction.trim()||
       item.instruction.length>4000||/[\x00-\x1f\x7f]/u.test(item.instruction))fail();
    ids.add(item.task_id);
   }
   this.executionProgress=Object.freeze(structuredClone(executionProgress));
  }else if(executionProgress!==undefined)fail();
  if(verifiedFailureHistory!==undefined){
   const phases=new Set(['typecheck','backend_tests','frontend_tests',
    'build','playwright_e2e','researcher_acceptance']);
   if(decisionKind!=='adaptive'||!Array.isArray(verifiedFailureHistory)||
      !verifiedFailureHistory.length||verifiedFailureHistory.length>2||
      verifiedFailure===undefined)fail();
   const seen=new Set();
   for(const row of verifiedFailureHistory){
    if(!exact(row,['failed_task_id','failed_phase','source_evidence_sha256','tested_commit_sha'])||
       typeof row.failed_task_id!=='string'||!ID.test(row.failed_task_id)||
       seen.has(row.failed_task_id)||!phases.has(row.failed_phase)||
       typeof row.source_evidence_sha256!=='string'||
       !/^[a-f0-9]{64}$/u.test(row.source_evidence_sha256)||
       typeof row.tested_commit_sha!=='string'||
       !/^[a-f0-9]{40}$/u.test(row.tested_commit_sha))fail();
    seen.add(row.failed_task_id);
   }
   const last=verifiedFailureHistory.at(-1);
   if(last.failed_phase!==verifiedFailure.failed_phase||
      last.source_evidence_sha256!==verifiedFailure.source_evidence_sha256)
    fail();
   this.verifiedFailureHistory=Object.freeze(structuredClone(verifiedFailureHistory));
  }
  if(verifiedFailure!==undefined){
   const phases=new Set(['typecheck','backend_tests','frontend_tests',
    'build','playwright_e2e','researcher_acceptance']);
   const base=['failed_phase','source_evidence_sha256'];
   const codes=Object.hasOwn(verifiedFailure,'typecheck_error_codes');
   if(!(exact(verifiedFailure,base)||
        exact(verifiedFailure,[...base,'typecheck_error_codes']))||
      !phases.has(verifiedFailure.failed_phase)||
      typeof verifiedFailure.source_evidence_sha256!=='string'||
      !/^[a-f0-9]{64}$/u.test(verifiedFailure.source_evidence_sha256)||
      (codes&&(verifiedFailure.failed_phase!=='typecheck'||
       !Array.isArray(verifiedFailure.typecheck_error_codes)||
       verifiedFailure.typecheck_error_codes.length<1||
       verifiedFailure.typecheck_error_codes.length>8||
       verifiedFailure.typecheck_error_codes.some((v,i)=>
        typeof v!=='string'||!/^TS[0-9]{4,5}$/u.test(v)||
        (i>0&&verifiedFailure.typecheck_error_codes[i-1]>=v)))))
    fail();
   this.verifiedFailure=Object.freeze({...verifiedFailure});
  }
 }
 async propose(){
  if(this.#attempted)fail();
  this.#attempted=true;
  const deadline=AbortSignal.timeout(30000);
  const model=new SingleDecisionModel(this.model,deadline);
  const agent=new LlmAgent({
   name:'owner_authority_only_task_decider',
   description:'Suggest one Task; trusted Coordinator validates and owns all grants',
   model,
   instruction:[
    this.decisionKind==='adaptive'?
     'Choose the next action from verified execution progress. Return {"action":"delegate","task":TASK} or {"action":"ready_for_pr","reason":"..."} or {"action":"blocked","reason":"..."}. TASK has exactly task_id,agent_id,depends_on,permissions,instruction. Do not claim completion: the owner independently verifies current Test evidence before PR readiness.':
    this.decisionKind==='branch'?
     'Propose exactly ONE orchestrator create_branch Task with no dependencies; never claim that a branch exists.':
    this.decisionKind==='pull_request'?
     'Propose exactly ONE orchestrator create_pull_request Task depending on the independently completed Test; never claim that a PR exists.':
     'Propose exactly ONE next software engineering Task; never claim approval or completion.',
    this.decisionKind==='adaptive'?'Return JSON only using the action schema above.':
     'Return JSON only with exactly task_id,agent_id,depends_on,permissions,instruction.',
    'Permissions are pairs of resource and operation and may use only existing delegated scope.',
    'Choose the specialist from registered agent IDs; dependencies may refer ONLY to independently Gateway-verified completed Task IDs.',
    'Never output keys, credentials, URLs, root status, signature, DID, epoch, or session details.',
    'The Coordinator independently validates every Task and does not trust this output.'
   ].join('\n'),
   disallowTransferToParent:true,disallowTransferToPeers:true
  });
  const sessions=new InMemorySessionService(),appName='r351_owner_decisions';
  const userId='trusted_owner',sessionId='r351_owner_task_choice';
  await sessions.createSession({appName,userId,sessionId});
  const runner=new Runner({agent,appName,sessionService:sessions});
  const context={requirement:this.requirement,work_branch:this.branch,
   allowed_roles:Object.entries(this.agents).map(([agent_id,capabilities])=>({
    agent_id,capabilities
   })),
   root_permission_ceiling:this.roots,
   independently_gateway_completed_tasks:this.previous,
   next_epoch:this.nextEpoch,
   ...(this.executionProgress?{verified_execution_progress:this.executionProgress}:{}),
   ...(this.verifiedFailureHistory?{
    independently_verified_test_failures:this.verifiedFailureHistory
   }:{}),
   ...(this.verifiedFailure?{
    independent_runner_failure:{
     failed_phase:this.verifiedFailure.failed_phase,
     source_evidence_sha256:this.verifiedFailure.source_evidence_sha256,
     status:'verified_failure_preflight_only_not_approval'
    }
   }:{})
  };
  let text='',failed=false;
  for await(const event of runner.runAsync({userId,sessionId,
   newMessage:{role:'user',parts:[{text:JSON.stringify(context)}]}})){
   if(deadline.aborted||event.errorCode||event.errorMessage)failed=true;
   if(event.author===agent.name&&event.content?.role==='model')
    for(const part of event.content.parts??[]){
     if(part.functionCall||part.functionResponse)failed=true;
     if(typeof part.text==='string'&&part.text.trim())text=part.text.trim();
    }
  }
  if(failed||deadline.aborted||model.calls!==1||!text||text.length>16000)fail();
  let raw;
  try{raw=JSON.parse(text);}catch{fail();}
  if(this.decisionKind==='adaptive'){
   if(exact(raw,['action','reason'])&&['ready_for_pr','blocked'].includes(raw.action)&&
      typeof raw.reason==='string'&&raw.reason.trim()&&raw.reason.length<=1000&&
      !/[\x00-\x1f\x7f]/u.test(raw.reason))
    return Object.freeze({action:raw.action,reason:raw.reason});
   if(!exact(raw,['action','task'])||raw.action!=='delegate')fail();
   raw=raw.task;
  }
  if(!exact(raw,['task_id','agent_id','depends_on','permissions','instruction'])||
     typeof raw.task_id!=='string'||!ID.test(raw.task_id)||
     typeof raw.agent_id!=='string'||!Object.hasOwn(this.agents,raw.agent_id)||
     typeof raw.instruction!=='string'||!raw.instruction.trim()||
     raw.instruction.length>4000||raw.instruction.includes('\0')||
     !Array.isArray(raw.depends_on)||raw.depends_on.length>this.previous.length||
     raw.depends_on.some(x=>typeof x!=='string'||!ID.test(x))||
     new Set(raw.depends_on).size!==raw.depends_on.length||
     !Array.isArray(raw.permissions)||!raw.permissions.length||
     raw.permissions.length>16)
   fail();
  const known=new Set(this.previous.map(p=>p.task_id));
  if(known.has(raw.task_id)||raw.depends_on.some(x=>!known.has(x)))fail();
  const seen=new Set(),selected=[];
  for(const p of raw.permissions){
   if(!exact(p,['resource','operation'])||
      typeof p.resource!=='string'||typeof p.operation!=='string'||
      seen.has(pair(p))||!this.agents[raw.agent_id].includes(p.operation)||
      !this.roots.some(parent=>giteaPermissionCovers(parent,p)))fail();
   seen.add(pair(p));selected.push(Object.freeze({...p}));
  }
  // The owner chooses the decision kind; model output cannot opt into PR authority.
  if(this.decisionKind==='branch'){
   if(raw.agent_id!=='orchestrator'||selected.length!==1||
      selected[0].operation!=='create_branch'||raw.depends_on.length!==0)fail();
  }else if(this.decisionKind==='pull_request'){
   if(raw.agent_id!=='orchestrator'||selected.length!==1||
      selected[0].operation!=='create_pull_request')fail();
  }else if(selected.some(p=>p.operation==='create_pull_request')||
    selected.filter(p=>p.operation==='update_file'||p.operation==='run_tests').length!==1)
   fail();
  const choice=Object.freeze({task_id:raw.task_id,agent_id:raw.agent_id,
   depends_on:Object.freeze([...raw.depends_on]),
   permissions:Object.freeze(selected),instruction:raw.instruction});
  return this.decisionKind==='adaptive'?Object.freeze({action:'delegate',task:choice}):choice;
 }
}
