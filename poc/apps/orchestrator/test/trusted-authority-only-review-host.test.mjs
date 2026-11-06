/** Real ADK Runner, provenance/Engineer signatures, durable stores and
 * Coordinator; credential issuer and Gateway transport are offline fixtures.
 * No native Rust/EVM/OPA/provider or paid inference success is claimed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BaseLlm} from '@google/adk';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {generateKeyPairSync,randomBytes,scryptSync} from 'node:crypto';
import {createTrustedAuthorityOnlyReviewHost as createHost} from '../src/trusted-authority-only-review-host.mjs';
import {startOwnerControlledEngineerReviewHost} from '../src/trusted-engineer-host.mjs';
import {AuthorityPlanningCheckpointStore} from '../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts';
import {DurableAuthorityOnlyActivationJournal} from '../../../packages/orchestrator-runtime/src/authority-only-activation-journal.ts';
import {DurableAuthorityTaskJournal} from '../../../packages/orchestrator-runtime/src/trusted-authority-task-journal.ts';
import {preliminaryReadPermissions} from '../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts';
import {TrustedAuthorityOnlyEngineerSession} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-engineer-session.ts';
import {TrustedPlanningGatewayReadPort} from '../../../packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts';
import {selectAuthorityOnlyGrant,signAuthorityOnlyGrant} from '../../../packages/plan-contracts/src/authority-only-approval.mjs';
import {RUST_OPERATIONS} from '../../gateway/src/operation-catalog.ts';
const snapshot={session_id:'same-root-review',repository:{authority:'gitea.local',owner:'thesis',repository:'iam-console-poc'},base_revision:'a'.repeat(40),directories:['','apps'],files:['apps/user.ts']};
const requirement='Suspend accounts',branch='feature/account-suspension',did='did:thesis:engineer';
const draft={requested_permissions:[{operation:'update_file',resource_type:'file',path:'apps/user.ts'},{operation:'read_file',resource_type:'file',path:'apps/user.ts'}],assumptions:[],uncertainties:[]};
const pem=(k,type)=>k.export({format:'pem',type}).toString();
class Scripted extends BaseLlm{
 calls=0;
 constructor(){super({model:'free-owner-review-script'});}
 async *generateContentAsync(){
  this.calls++;
  if(this.calls===1)yield {content:{role:'model',parts:[{functionCall:{id:'read',name:'read_file',args:{branch:'main',path:snapshot.files[0]}}}]}};
  else yield {content:{role:'model',parts:[{text:JSON.stringify(draft)}]}};
 }
 connect(){throw Error('Paid inference forbidden');}
}
const root=(id,index,seconds=600)=>({credential_id:id,valid_from:new Date().toISOString(),validity_seconds:seconds,
 credential_status:{type:'BitstringStatusListEntry',statusPurpose:'revocation',statusListIndex:String(index),statusListCredential:'https://status.invalid/list'}});
async function fixture(t,flags={}){
 const home=await mkdtemp(join(tmpdir(),'r349-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const dirs=Object.fromEntries(['receipts','checkpoints','activation','tasks','keys'].map(k=>[k,join(home,k)]));
 for(const d of Object.values(dirs))await mkdir(d,{mode:0o700});
 const engineer=generateKeyPairSync('ed25519'),backend=generateKeyPairSync('ed25519');
 const privateKeyFile=join(dirs.keys,'engineer.pem');await writeFile(privateKeyFile,pem(engineer.privateKey,'pkcs8'),{mode:0o600});
 const store=new AuthorityPlanningCheckpointStore({directory:dirs.checkpoints,trust:{
  trustedKeys:{backend:{public_key_pem:pem(backend.publicKey,'spki')}},expectedSessionId:snapshot.session_id,
  expectedRepository:snapshot.repository,expectedBaseRevision:snapshot.base_revision,expectedWorkBranch:branch,expectedRequirement:requirement}});
 const salt=randomBytes(16),log=[],model=new Scripted();
 const options={snapshot,requirement,workBranch:branch,preliminaryRoot:root('urn:r349:preliminary',1),
  activationJournal:new DurableAuthorityOnlyActivationJournal(dirs.activation),taskJournal:new DurableAuthorityTaskJournal(dirs.tasks),
  checkpoint:{store,backendKeyId:'backend',backendPrivateKeyPem:pem(backend.privateKey,'pkcs8')},
  approval:{engineerDid:did,keyId:'engineer',privateKeyFile,publicKeyPem:pem(engineer.publicKey,'spki'),receiptDirectory:dirs.receipts,
   passwordSaltHex:salt.toString('hex'),passwordScryptHex:scryptSync('owner-password',salt,64).toString('hex')},
  planner:{model,planId:'owner-authority-review',maxModelTurns:3,maxProposalRevisions:0},
  trustedAgentRegistry:Object.fromEntries(['backend','frontend','test'].map(role=>[role,{did:'did:thesis:'+role,card_ref:'trusted:'+role,capabilities:[role==='test'?'run_tests':'update_file']} ])),
  credentials:{async issueScopedOrchestratorRoot(req){
   log.push('issue:'+req.credential_id);await flags.onIssue?.(req);
   return {id:req.credential_id,credentialSubject:{per:structuredClone(req.permissions)}};
  },async revokeRoot(id){log.push('revoke:'+id);if(flags.failRevoke)throw Error('Rust unavailable');await flags.onRevoke?.(id);}},
  planningRevisions:{async begin(id){log.push('begin:'+id);return {task_id:id,base_revision:snapshot.base_revision,expires_at:new Date(Date.now()+600000).toISOString()};},
   async end(id){log.push('end:'+id);if(flags.failEnd)throw Error('Gateway unavailable');}},
  gateway:{gatewayBaseUrl:'http://gateway.invalid',adapterBaseUrl:'http://adapter.invalid',adapterToken:'private-offline-token',fetchFn:async(url,init)=>{
   const body=JSON.parse(init.body),p=new URL(url).pathname;
   if(p.endsWith('/prepare')){
    assert.equal(body.task_id,snapshot.session_id);assert.equal(body.tool,'read_file');
    log.push('prepare');return Response.json({request_id:'read',audience:'gateway',challenge:'challenge',required_permission:preliminaryReadPermissions(snapshot).find(p=>p.operation==='read_file')});
   }
   if(p==='/v1/presentations'){
    assert.equal(body.credential_id,'urn:r349:preliminary');log.push('vp:same-preliminary');return Response.json({signed_vp:'offline-proof'});
   }
   assert.ok(p.endsWith('/execute'));log.push('execute');
   if(flags.failRead)return Response.json({error:'denied'},{status:403});
   return Response.json({execution:{provider:'gitea',performed:true,tool:'read_file',branch:'main',path:snapshot.files[0],revision:snapshot.base_revision,content:'export const suspended=false;'}});
  }}
 };
 let host;
 async function start(){host=await createHost(options);return host;}
 t.after(async()=>{if(host&&['planning','operational','revoked'].includes(host.phase))await host.close();});
 const call=(path,{body,cookie,csrf}={})=>new Promise(resolve=>{
  host.server.address=()=>({port:8787});
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
  req.method=body===undefined?'GET':'POST';req.url=path;req.headers={host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787','content-type':'application/json',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})};
  const headers={};let status;const res={setHeader(k,v){headers[k]=v;},writeHead(s,h){status=s;Object.assign(headers,h);},end(data){resolve(new Response(data,{status,headers}));}};
  host.server.emit('request',req,res);
 });
 async function review(){const r=await call('/api/login',{body:{password:'owner-password'}});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];const packet=await (await call('/api/review',{cookie})).json();return {cookie,packet};}
 async function approve(){const {cookie,packet}=await review();const r=await call('/api/approve',{cookie,csrf:packet.csrf_token,body:{proposal_digest:packet.proposal_digest,approved_permission_ids:['permission-1'],confirmation:'APPROVE '+packet.proposal_digest}});assert.equal(r.status,201);return packet;}
 return {options,start,log,model,call,review,approve,dirs,store,engineer};
}
test('same preliminary root feeds actual ADK review, then selected receipt retires it before independent root and Coordinator',async t=>{
 const f=await fixture(t),host=await f.start();
 assert.equal(host.phase,'planning');assert.equal(f.model.calls,2);
 assert.deepEqual(f.log,['begin:'+snapshot.session_id,'issue:urn:r349:preliminary','prepare','vp:same-preliminary','execute']);
 await assert.rejects(host.activateOperational(root('urn:r349:operational',2)),/ENOENT/);
 assert.equal(host.phase,'planning');
 const p=await f.approve();assert.equal(p.plan,undefined);assert.equal(host.phase,'planning');
 const result=await host.activateOperational(root('urn:r349:operational',2));
 assert.equal(result.coordinator.phase,'active');assert.equal(result.coordinator.registeredTaskCount,0);
 assert.equal(result.activation.execution_authorized,false);
 assert.deepEqual(f.log.slice(-3),['end:'+snapshot.session_id,'revoke:urn:r349:preliminary','issue:urn:r349:operational']);
 const receipt=JSON.parse(await readFile(join(f.dirs.receipts,snapshot.session_id+'.json'),'utf8'));
 assert.equal(receipt.authorization.permissions.length,1);assert.equal(receipt.authorization.tasks,undefined);
 await assert.rejects(host.activateOperational(root('urn:r349:duplicate',3)),/already attempted/);
 await host.close();assert.equal(host.phase,'revoked');assert.equal(f.log.at(-1),'revoke:urn:r349:operational');
 assert.throws(()=>result.coordinator.assertTrustedGatewayAuthorityBinding(),/root|active|retire/);
});
for(const flag of ['failEnd','failRevoke'])test(flag+' blocks operational issuance and replay',async t=>{
 const f=await fixture(t,{[flag]:true}),host=await f.start();await f.approve();
 await assert.rejects(host.activateOperational(root('urn:r349:operational',2)),/unconfirmed/);
 assert.equal(host.phase,'failed_closed');assert.equal(f.log.filter(x=>x.startsWith('issue:')).length,1);
 await assert.rejects(host.activateOperational(root('urn:r349:retry',3)),/already attempted/);
 await assert.rejects(host.close(),/uncertain/);
});
test('authenticated rejection retires the same root and never activates a Coordinator',async t=>{
 const f=await fixture(t),host=await f.start(),{cookie,packet}=await f.review();
 const r=await f.call('/api/reject',{cookie,csrf:packet.csrf_token,body:{proposal_digest:packet.proposal_digest,confirmation:'REJECT '+packet.proposal_digest}});
 assert.equal(r.status,200);assert.equal(host.phase,'revoked');
 await assert.rejects(host.activateOperational(root('urn:r349:operational',2)));
 assert.equal(f.log.filter(x=>x.startsWith('issue:')).length,1);
});
test('a valid Engineer signature for a different branch cannot activate the reviewed session',async t=>{
 const f=await fixture(t),host=await f.start();await f.approve();
 const p=(await f.store.load()).proposal;
 const other={...p,branch:'feature/foreign',requested_permissions:p.requested_permissions.map(x=>({...x,resource:x.resource.replace('feature%2Faccount-suspension','feature%2Fforeign')}))};
 const grant=selectAuthorityOnlyGrant(other,other.requested_permissions,{allowedOperations:new Set(RUST_OPERATIONS)});
 const now=Date.now(),signed=signAuthorityOnlyGrant({authorization:grant,engineerDid:did,keyId:'engineer',privateKeyPem:pem(f.engineer.privateKey,'pkcs8'),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),allowedOperations:new Set(RUST_OPERATIONS)});
 await writeFile(join(f.dirs.receipts,snapshot.session_id+'.json'),JSON.stringify(signed));
 await assert.rejects(host.activateOperational(root('urn:r349:operational',2)));
 assert.equal(host.phase,'planning');assert.equal(f.log.filter(x=>x.startsWith('issue:')).length,1);
});
test('Planning transport failure retires preliminary authority and exposes no review server',async t=>{
 const f=await fixture(t,{failRead:true});await assert.rejects(f.start());
 assert.deepEqual(f.log.slice(-2),['end:'+snapshot.session_id,'revoke:urn:r349:preliminary']);
 assert.equal(f.log.filter(x=>x.startsWith('issue:')).length,1);
});
test('legacy override or wrong backend key fails before root issue and model invocation',async t=>{
 const f=await fixture(t);
 await assert.rejects(createHost({...f.options,approval:{...f.options.approval,trustedPlanFile:'legacy'}}),/legacy/);
 await assert.rejects(createHost({...f.options,checkpoint:{...f.options.checkpoint,backendKeyId:'foreign'}}));
 assert.deepEqual(f.log,[]);assert.equal(f.model.calls,0);
});
test('shutdown waits for an in-flight transition and revokes a newly issued root before returning',async t=>{
 let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const f=await fixture(t,{onIssue:async req=>{if(req.credential_id==='urn:r349:operational'){entered();await gate;}}});
 const host=await f.start();await f.approve();
 const activation=host.activateOperational(root('urn:r349:operational',2));
 const failed=assert.rejects(activation,/closed during root transition/);
 await ready;const closing=host.close();release();await failed;await closing;
 assert.equal(host.phase,'revoked');assert.equal(f.log.at(-1),'revoke:urn:r349:operational');
});
test('canonical owner entry refuses unknown architecture and mixed legacy inputs before any root',async t=>{
 const f=await fixture(t);
 await assert.rejects(startOwnerControlledEngineerReviewHost({architecture:'unknown'}),/architecture/);
 await assert.rejects(startOwnerControlledEngineerReviewHost({architecture:'authority-only',planning:{},authority:f.options}),/separate explicit/);
 assert.deepEqual(f.log,[]);
});
test('retained Planning port rejects mismatched snapshot and expired or retired same-session authority before transport',async()=>{
 let now=Date.now(),fetches=0;
 const session=new TrustedAuthorityOnlyEngineerSession({snapshot,requirement,authenticatedEngineerDid:did,nowMs:()=>now,
  credentials:{async issueScopedOrchestratorRoot(r){return {id:r.credential_id,credentialSubject:{per:r.permissions}};},async revokeRoot(){}},
  approvals:{async loadAuthenticatedAuthority(){throw Error('No approval');}},
  journal:{async reservePlanning(){},async reserveOperational(){}},
  planningRevisions:{async begin(id){return {task_id:id,base_revision:snapshot.base_revision,expires_at:new Date(now+600000).toISOString()};},async end(){}}});
 await session.startPlanning(root('urn:r349:expiry',1));
 const config={coordinator:session,snapshot,gatewayBaseUrl:'http://gateway.invalid',adapterBaseUrl:'http://adapter.invalid',adapterToken:'private',fetchFn:async()=>{fetches++;throw Error('Unexpected transport');}};
 const port=new TrustedPlanningGatewayReadPort(config);
 assert.throws(()=>new TrustedPlanningGatewayReadPort({...config,snapshot:{...snapshot,repository:{...snapshot.repository,owner:'foreign'}}}),/snapshot mismatch/);
 port.assertTrustedPlanningBinding(session,snapshot);
 now+=600001;
 assert.throws(()=>session.trustedPlanningAuthority(),/expired/);
 await assert.rejects(port.invoke('read_file',{branch:'main',path:snapshot.files[0]}),/expired/);
 await session.cancelPlanning();
 await assert.rejects(port.invoke('read_file',{branch:'main',path:snapshot.files[0]}),/inactive/);
 assert.equal(fetches,0);
});
test('unconfirmed operational shutdown fences the live Coordinator and cannot claim success',async t=>{
 const flags={},f=await fixture(t,flags),host=await f.start();await f.approve();
 const result=await host.activateOperational(root('urn:r349:operational',2));
 flags.failRevoke=true;
 await assert.rejects(host.close(),/Rust unavailable/);assert.equal(host.phase,'failed_closed');
 assert.throws(()=>result.coordinator.assertTrustedGatewayAuthorityBinding(),/not active/);
});
test('explicit canonical owner entry serves real HTTP review and transitions only through its private handle',
 {skip:process.env.GITHUB_ACTIONS!=='true'},async t=>{
 const f=await fixture(t),host=await startOwnerControlledEngineerReviewHost({architecture:'authority-only',authority:f.options});
 t.after(()=>host.close());
 const call=(path,body,extra={})=>fetch(host.engineerUrl+path,{method:body?'POST':'GET',headers:{Origin:host.engineerUrl,'content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});
 const login=await call('/api/login',{password:'owner-password'});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const packet=await (await call('/api/review',null,{Cookie:cookie})).json();
 assert.equal(packet.protocol,'authority-only');
 assert.equal((await call('/api/activate',{}, {Cookie:cookie})).status,404);
 const approved=await call('/api/approve',{proposal_digest:packet.proposal_digest,
  approved_permission_ids:['permission-1'],confirmation:'APPROVE '+packet.proposal_digest},
  {Cookie:cookie,'X-CSRF-Token':packet.csrf_token});
 assert.equal(approved.status,201);assert.equal(host.phase,'planning');
 const result=await host.activateOperational(root('urn:r349:operational',2));
 assert.equal(result.coordinator.phase,'active');assert.equal(host.phase,'operational');
 await host.close();assert.equal(host.phase,'revoked');
});
