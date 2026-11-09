import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyR462GeminiRegistrationPr as audit,
 verifyR462GeminiRegistrationPrSnapshot as check}
 from '../r462-gemini-registration-pr-audit.mjs';

const REPO='DarkGh0st03/delegation';
const DEV='refactor/post-prof-plan-contracts-20261021';
const REG='chore/r5-private-registration-draft-20261109';
const WF='.github/workflows/trusted-gemini-private-session-hold.yml';
const BLOB='5db9d8862aa4de257ffada67171b56431c11440a';
const HEAD='9027178c2385a1f4604e3528665e77572ea17085';
const dev='a'.repeat(40),main='b'.repeat(40);
const pins={expectedDevelopmentSha:dev,expectedMainSha:main};
const plain=()=>({
 ...pins,repository:{full_name:REPO,default_branch:'main'},
 main:{name:'main',commit:{sha:main}},
 development:{name:DEV,commit:{sha:dev}},
 registration:{name:REG,commit:{sha:HEAD}},
 pr:{number:39,state:'open',draft:true,merged:false,additions:63,deletions:0,
     changed_files:1,
     head:{ref:REG,sha:HEAD,repo:{full_name:REPO}},
     base:{ref:'main',sha:main,repo:{full_name:REPO}}},
 files:[{filename:WF,status:'added',sha:BLOB,additions:63,deletions:0}],
 developmentWorkflow:{type:'file',path:WF,sha:BLOB},
 registrationWorkflow:{type:'file',path:WF,sha:BLOB},
 mainWorkflowAbsent:true
});
function fixture(overrides={},opts={}){
 const state={...plain(),...overrides};
 const called=[];
 const fetchFn=async(url,request)=>{
  called.push({url,request});
  assert.equal(request.method,'GET');
  assert.equal(request.redirect,'error');
  assert.equal(request.headers.authorization,undefined);
  const p=new URL(url).pathname;
  const q=new URL(url).searchParams.get('ref');
  if(opts.outage)throw Error('upstream leaked sensitive header');
  if(p.endsWith('/delegation'))return res(state.repository);
  if(p.endsWith('/branches/main'))return res(state.main);
  if(p.endsWith('/branches/'+encodeURIComponent(DEV)))return res(state.development);
  if(p.endsWith('/branches/'+encodeURIComponent(REG)))return res(state.registration);
  if(p.endsWith('/pulls/39'))return res(state.pr);
  if(p.endsWith('/pulls/39/files'))return res(state.files);
  if(p.endsWith('/contents/'+WF)){
   if(q==='main')return state.mainWorkflowAbsent?{ok:false,status:404}:res(state.developmentWorkflow);
   if(q===DEV)return res(state.developmentWorkflow);
   if(q===REG)return res(state.registrationWorkflow);
  }
  throw Error('Unexpected route '+url);
 };
 return {fetchFn,called};
}
const res=value=>({ok:true,status:200,async json(){return value;}});

test('R462 one-file PR39 is pinned but never registered or dispatched',async()=>{
 const f=fixture();
 const verified=await audit({...pins,fetchFn:f.fetchFn});
 assert.equal(verified.pull_request,39);
 assert.equal(verified.status,'reviewed_paid_workflow_registration_draft_only_not_merged');
 assert.equal(verified.workflow_registered_on_main,false);
 assert.equal(verified.private_runner_verified,false);
 assert.equal(verified.private_engineer_host_verified,false);
 assert.equal(verified.charged_model_calls,0);
 assert.equal(verified.r5_go,false);
 assert.equal(f.called.length,9);
 assert.equal(f.called.every(x=>x.url.startsWith('https://api.github.com/repos/'+REPO)),true);
 assert.equal(f.called.some(x=>/dispatches|merge|approval|runs/.test(x.url)),false);
});

test('R462 rejects PR drift, extra files, merged state and unreviewed workflow blob',async()=>{
 const variants=[
  v=>{v.pr.draft=false;},
  v=>{v.pr.state='closed';},
  v=>{v.pr.base.sha='c'.repeat(40);},
  v=>{v.pr.head.sha='c'.repeat(40);},
  v=>{v.registration.commit.sha='c'.repeat(40);},
  v=>{v.files.push({...v.files[0],filename:'other.yml'});},
  v=>{v.pr.changed_files=2;},
  v=>{v.pr.additions=64;},
  v=>{v.files[0].sha='c'.repeat(40);},
  v=>{v.registrationWorkflow.sha='c'.repeat(40);},
  v=>{v.developmentWorkflow.sha='c'.repeat(40);},
  v=>{v.mainWorkflowAbsent=false;},
  v=>{v.main.commit.sha='c'.repeat(40);},
  v=>{v.development.commit.sha='c'.repeat(40);}
 ];
 for(const mutate of variants){
  const value=plain();mutate(value);
  assert.throws(()=>check(value),/R462 Gemini registration PR NO-GO/u);
 }
});

test('R462 rejects missing independent SHA pins before GET and hides API failure',async()=>{
 const f=fixture();
 await assert.rejects(audit({expectedMainSha:'bad',expectedDevelopmentSha:dev,fetchFn:f.fetchFn}),
  /missing review pins/u);
 assert.equal(f.called.length,0);
 const outage=fixture({}, {outage:true});
 await assert.rejects(audit({...pins,fetchFn:outage.fetchFn}),error=>{
  assert.match(error.message,/GitHub public information unavailable/u);
  assert.doesNotMatch(error.message,/sensitive header/u);
  return true;
 });
});
