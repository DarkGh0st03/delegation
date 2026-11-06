import test from 'node:test';
import assert from 'node:assert/strict';
import {BaseLlm} from '@google/adk';
import {compileAuthorityOnlyPlanningProposal as compile} from '../src/authority-only-planning-proposal.ts';
import {TrustedAdkReadOnlyPlanner} from '../src/trusted-adk-planner.ts';
import {selectAuthorityOnlyGrant} from '../../plan-contracts/src/authority-only-approval.mjs';
import {RUST_OPERATIONS} from '../../../apps/gateway/src/operation-catalog.ts';
const snapshot={session_id:'authority-planning',repository:{authority:'gitea.local',owner:'thesis',repository:'iam-console-poc'},base_revision:'a'.repeat(40),directories:['','apps','apps/backend'],files:['apps/backend/user.ts']};
const cfg={snapshot,requirement:'Implement Account Suspension',workBranch:'feature/account-suspension'};
const draft=()=>({requested_permissions:[{operation:'update_file',resource_type:'directory',path:'apps/backend'}],assumptions:[],uncertainties:[]});
test('permission-only proposal feeds existing Engineer selection with no signed DAG',()=>{
 const r=compile(draft(),cfg);
 const g=selectAuthorityOnlyGrant(r.proposal,r.proposal.requested_permissions,{allowedOperations:new Set(RUST_OPERATIONS)});
 assert.equal(g.session_id,snapshot.session_id);
 assert.deepEqual(g.permissions,r.proposal.requested_permissions);
 for(const field of ['tasks','agents','depends_on','plan_id','signature'])
  assert.equal(Object.hasOwn(r.proposal,field),false);
});
for(const patch of [{tasks:[]},{agent_id:'backend'},{session_id:'foreign'},{signature:'forged'}]){
 test(`reject model-controlled authority metadata ${Object.keys(patch)}`,()=>{
  assert.throws(()=>compile({...draft(),...patch},cfg));
 });
}
for(const [type,path,op] of [['directory','apps/backend-extra','update_file'],['file','apps/backend/../secret','read_file'],['file','apps/backend/missing.ts','update_file'],['repository',null,'run_tests'],['branch',null,'update_file'],['file','apps/backend/user.ts','create_file']]){
 test(`deny incompatible or undiscovered ${type} ${String(path)} ${op}`,()=>{
  assert.throws(()=>compile({...draft(),requested_permissions:[{resource_type:type,path,operation:op}]},cfg));
 });
}
test('reject duplicate pairs and allow a known new-file parent',()=>{
 const d=draft();assert.throws(()=>compile({...d,requested_permissions:[...d.requested_permissions,...d.requested_permissions]},cfg));
 const r=compile({...d,requested_permissions:[{operation:'create_file',resource_type:'file',path:'apps/backend/new.ts'}]},cfg);
 assert.match(r.proposal.requested_permissions[0].resource,/files\/apps\/backend\/new.ts$/);
});
class Scripted extends BaseLlm {
 requests:any[]=[];
 constructor(){super({model:'free-authority-planning-test'});}
 async *generateContentAsync(req:any){
  this.requests.push(req);
  if(this.requests.length===1)yield {content:{role:'model',parts:[{functionCall:{id:'read',name:'read_file',args:{branch:'main',path:snapshot.files[0]}}}]}};
  else yield {content:{role:'model',parts:[{text:JSON.stringify(draft())}]}};
 }
 connect():never {throw Error('No live inference');}
}
function planner(model:Scripted,extra={}){return new TrustedAdkReadOnlyPlanner({...cfg,planId:'internal-planning-session',model,agents:{backend:{did:'did:thesis:backend',card_ref:'trusted:backend'},frontend:{did:'did:thesis:frontend',card_ref:'trusted:frontend'},test:{did:'did:thesis:test',card_ref:'trusted:test'}},readPort:{async invoke(){return {provider:'gitea',performed:true,tool:'read_file',branch:'main',path:snapshot.files[0],revision:snapshot.base_revision,content:'export const suspended=false;'};}},...extra});}
test('actual ADK read-only runner emits permission-only proposal with verified source',async()=>{
 const model=new Scripted(),p=planner(model),r=await p.proposeAuthority();
 assert.equal(r.status,'unapproved_authority_proposal');
 assert.equal(r.verified_source_reads,1);
 assert.equal(model.requests.length,2);
 assert.equal(Object.hasOwn(r,'plan'),false);
 const prompt=JSON.stringify(model.requests[0].config.systemInstruction);
 assert.match(prompt,/requested_permissions/);
 assert.doesNotMatch(prompt,/first Task creates a branch|Each Task has/);
 await assert.rejects(p.propose(),/already attempted/);
});
test('authority-only mode refuses legacy DAG hooks before any model call',async()=>{
 const model=new Scripted();
 await assert.rejects(planner(model,{pilotFullDag:true}).proposeAuthority(),/signed-DAG/);
 assert.equal(model.requests.length,0);
});
