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
 constructor({model,requirement,branch,rootPermissions,agents,previousTasks}){
  if(!(model instanceof BaseLlm)||typeof requirement!=='string'||
     !requirement.trim()||requirement.length>6000||
     typeof branch!=='string'||!branch.startsWith('feature/')||
     !Array.isArray(rootPermissions)||!rootPermissions.length||
     !agents||typeof agents!=='object'||Array.isArray(agents)||
     !Object.keys(agents).length||!Array.isArray(previousTasks)||
     previousTasks.length>255)
   fail();
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
    'Propose exactly ONE next software engineering Task; never claim approval or completion.',
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
   next_epoch:this.previous.length+1
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
  // The current native A2A dispatch admits one mutation OR one Runner effect.
  if(selected.filter(p=>p.operation==='update_file'||p.operation==='run_tests').length!==1)
   fail();
  return Object.freeze({task_id:raw.task_id,agent_id:raw.agent_id,
   depends_on:Object.freeze([...raw.depends_on]),
   permissions:Object.freeze(selected),instruction:raw.instruction});
 }
}
