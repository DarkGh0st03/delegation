import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,randomBytes,scryptSync} from 'node:crypto';
import {Readable} from 'node:stream';
import {runInNewContext} from 'node:vm';
import {createAuthenticatedEngineerServer} from '../src/engineer-approval-server.mjs';
import {AuthorityPlanningCheckpointStore,signAuthorityPlanningCheckpoint} from '../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts';
import {compileAuthorityOnlyPlanningProposal} from '../../../packages/orchestrator-runtime/src/authority-only-planning-proposal.ts';
import {SignedAuthorityOnlyFileStore} from '../../../packages/orchestrator-runtime/src/signed-authority-only-store.ts';
const root='http://127.0.0.1:8787',password='owner-password';
async function setup(t){
 const home=await mkdtemp(join(tmpdir(),'r348-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const checkpoints=join(home,'checkpoints'),receipts=join(home,'receipts'),keysDir=join(home,'keys');
 for(const dir of [checkpoints,receipts,keysDir])await mkdir(dir,{mode:0o700});
 const snapshot={session_id:'permission-review',repository:{authority:'gitea.local',owner:'thesis',repository:'iam-console-poc'},base_revision:'a'.repeat(40),directories:['','apps'],files:['apps/user.ts']};
 const proposal={...compileAuthorityOnlyPlanningProposal({requested_permissions:[{operation:'update_file',resource_type:'directory',path:'apps'},{operation:'read_file',resource_type:'directory',path:'apps'}],assumptions:[],uncertainties:[]},{snapshot,workBranch:'feature/account-suspension',requirement:'Suspend accounts'}),verified_source_reads:1};
 const backend=generateKeyPairSync('ed25519'),engineer=generateKeyPairSync('ed25519');
 const pem=(key,type)=>key.export({type,format:'pem'}).toString();
 const store=new AuthorityPlanningCheckpointStore({directory:checkpoints,trust:{trustedKeys:{backend:{public_key_pem:pem(backend.publicKey,'spki')}},expectedSessionId:snapshot.session_id,expectedRepository:snapshot.repository,expectedBaseRevision:snapshot.base_revision,expectedWorkBranch:proposal.proposal.branch,expectedRequirement:proposal.proposal.requirement}});
 const now=Date.now();await store.persistVerified(signAuthorityPlanningCheckpoint({snapshot,proposal,keyId:'backend',privateKeyPem:pem(backend.privateKey,'pkcs8'),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()}));
 const keyFile=join(keysDir,'engineer.pem');await writeFile(keyFile,pem(engineer.privateKey,'pkcs8'),{mode:0o600});
 let live=true,revoked=0;
 const salt=randomBytes(16);
 const config={architecture:'authority-only',authorityCheckpointStore:store,
  expectedSessionId:snapshot.session_id,expectedBaseRevision:snapshot.base_revision,repository:snapshot.repository,
  expectedWorkBranch:proposal.proposal.branch,expectedRequirement:proposal.proposal.requirement,
  engineerDid:'did:thesis:engineer',keyId:'engineer',privateKeyFile:keyFile,publicKeyPem:pem(engineer.publicKey,'spki'),
  receiptDirectory:receipts,passwordSaltHex:salt.toString('hex'),passwordScryptHex:scryptSync(password,salt,64).toString('hex'),
  planningIsActive:()=>live,rejectPlanning:async()=>{revoked++;live=false;}};
 const server=await createAuthenticatedEngineerServer(config);
 // Exercise the actual server request handler without opening sockets. The
 // separate GitHub Actions test below uses an actual loopback HTTP listener.
 server.address=()=>({port:8787});
 const call=(path,{method='GET',body,cookie,csrf,origin=root}={})=>new Promise(resolve=>{
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
  req.method=method;req.url=path;req.headers={host:'127.0.0.1:8787',origin,'content-type':'application/json',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})};
  const headers={};let status;
  const res={setHeader(k,v){headers[k]=v;},writeHead(s,h){status=s;Object.assign(headers,h);},end(data){resolve(new Response(data,{status,headers}));}};
  server.emit('request',req,res);
 });
 async function login(){const r=await call('/api/login',{method:'POST',body:{password}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
 const review=async cookie=>(await call('/api/review',{cookie})).json();
 const approve=(packet,cookie,extra={})=>call('/api/approve',{method:'POST',cookie,csrf:packet.csrf_token,body:{proposal_digest:packet.proposal_digest,approved_permission_ids:['permission-1'],confirmation:'APPROVE '+packet.proposal_digest,...extra}});
 return {server,call,login,review,approve,config,home,receipts,checkpointFile:join(checkpoints,snapshot.session_id+'.authority-planning.json'),retire:()=>{live=false;},revoked:()=>revoked};
}
test('authenticated authority-only review signs selected scope without Task/DAG and loads in operational store',async t=>{
 const e=await setup(t),cookie=await e.login(),packet=await e.review(cookie);
 assert.equal(packet.protocol,'authority-only');assert.equal(packet.plan,undefined);
 assert.equal(packet.authorization_proposal.tasks,undefined);
 assert.equal((await e.call('/api/plan',{cookie})).status,404);
 const signed=await e.approve(packet,cookie);assert.equal(signed.status,201);
 assert.equal((await signed.json()).operational_credential_issued,false);
 const store=new SignedAuthorityOnlyFileStore({directory:e.receipts,engineerDid:e.config.engineerDid,trustedKeys:{engineer:{engineer_did:e.config.engineerDid,public_key_pem:e.config.publicKeyPem}}});
 const checked=await store.loadAuthenticatedAuthority(e.config.expectedSessionId);
 assert.deepEqual(checked.authorization.permissions,[packet.permissions[0]&&{resource:packet.permissions[0].resource,operation:packet.permissions[0].operation}]);
 const file=await readFile(join(e.receipts,e.config.expectedSessionId+'.json'),'utf8');
 assert.doesNotMatch(file,/plan_digest|agent_id|depends_on|"tasks"/);
 assert.equal((await e.approve(packet,cookie)).status,401);
 const next=await e.login();assert.equal((await e.approve(await e.review(next),next)).status,409);
});
test('authentication, Origin, CSRF and protocol checks precede Engineer signing',async t=>{
 const e=await setup(t);
 assert.equal((await e.call('/api/review')).status,401);
 const cookie=await e.login(),packet=await e.review(cookie);
 const body={proposal_digest:packet.proposal_digest,approved_permission_ids:['permission-1'],confirmation:'APPROVE '+packet.proposal_digest};
 assert.equal((await e.call('/api/approve',{method:'POST',body,cookie,csrf:'wrong'})).status,403);
 assert.equal((await e.call('/api/approve',{method:'POST',body,cookie,csrf:packet.csrf_token,origin:'http://foreign.local'})).status,403);
 assert.equal((await e.approve(packet,cookie,{plan_digest:packet.proposal_digest})).status,403);
 assert.equal((await e.approve(packet,cookie,{approved_permission_ids:['foreign']})).status,409);
 assert.equal((await e.approve(packet,cookie,{approved_permission_ids:['permission-1','permission-1']})).status,403);
 assert.equal((await e.approve(packet,cookie)).status,201);
});
test('retired Planning and tampered backend provenance cannot be approved',async t=>{
 const e=await setup(t),cookie=await e.login(),packet=await e.review(cookie);
 const ticket=JSON.parse(await readFile(e.checkpointFile,'utf8'));
 ticket.proposal.requirement='foreign';await writeFile(e.checkpointFile,JSON.stringify(ticket));
 assert.notEqual((await e.approve(packet,cookie)).status,201);
 e.retire();assert.equal((await e.call('/api/review',{cookie})).status,409);
});
test('authority mode refuses unsigned/legacy input and unknown architecture before listening',async t=>{
 const e=await setup(t);
 await assert.rejects(createAuthenticatedEngineerServer({...e.config,authorityCheckpointStore:undefined}));
 await assert.rejects(createAuthenticatedEngineerServer({...e.config,trustedPlanFile:'legacy.json'}));
 await assert.rejects(createAuthenticatedEngineerServer({...e.config,architecture:'unknown'}));
 await assert.rejects(createAuthenticatedEngineerServer({...e.config,architecture:undefined}));
 await assert.rejects(createAuthenticatedEngineerServer({...e.config,planningIsActive:undefined}));
});
test('authority-only rejection is terminal and records intent before retirement',async t=>{
 const e=await setup(t),cookie=await e.login(),packet=await e.review(cookie);
 const r=await e.call('/api/reject',{method:'POST',cookie,csrf:packet.csrf_token,body:{proposal_digest:packet.proposal_digest,confirmation:'REJECT '+packet.proposal_digest}});
 assert.equal(r.status,200);assert.equal(e.revoked(),1);
 assert.equal((await e.approve(packet,cookie)).status,401);
 await assert.rejects(createAuthenticatedEngineerServer(e.config));
});
test('authority-only approval over actual loopback HTTP in CI',{skip:process.env.GITHUB_ACTIONS!=='true'},async t=>{
 const e=await setup(t);delete e.server.address;
 await new Promise((ok,bad)=>{e.server.once('error',bad);e.server.listen(0,'127.0.0.1',ok);});
 t.after(()=>new Promise(resolve=>e.server.close(resolve)));
 const base='http://127.0.0.1:'+e.server.address().port;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'content-type':'application/json'},body:JSON.stringify({password})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const p=await (await fetch(base+'/api/authorization',{headers:{Cookie:cookie}})).json();
 const r=await fetch(base+'/api/approve',{method:'POST',headers:{Origin:base,Cookie:cookie,'X-CSRF-Token':p.csrf_token,'content-type':'application/json'},body:JSON.stringify({proposal_digest:p.proposal_digest,approved_permission_ids:['permission-2'],confirmation:'APPROVE '+p.proposal_digest})});
 assert.equal(r.status,201);assert.equal((await r.json()).permission_count,1);
});

test('actual browser script renders only authority scope and sends proposal confirmation',async()=>{
 const elements=new Map(),requests=[];
 const element=()=>({hidden:false,value:'',children:[],listeners:{},style:{},textContent:'',
  append(...v){this.children.push(...v);},replaceChildren(){this.children=[];},
  addEventListener(k,fn){this.listeners[k]=fn;}});
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const packet={protocol:'authority-only',authorization_proposal:{session_id:'session',branch:'feature/work',repository:{owner:'thesis',repository:'repo'},base_revision:'a'.repeat(40),requirement:'Suspend accounts'},proposal_digest:'b'.repeat(64),csrf_token:'csrf',engineer_did:'did:thesis:engineer',permissions:[{id:'permission-1',operation:'update_file',resource:'gitea://scope'}],reject_enabled:true};
 const source=await readFile(new URL('../../../workflow-ui/authenticated.js',import.meta.url),'utf8');
 runInNewContext(source,{document:{getElementById:get,createElement:element,querySelectorAll:()=>[{value:'permission-1'}]},
  fetch:async(path,opts)=>{requests.push({path,opts});return Response.json(path==='/api/review'?packet:{decision_id:'decision'});}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(get('execution-plan-details').hidden,true);
 assert.match(get('review-heading').textContent,/permessi/);
 assert.equal(get('tasks').children.length,0);
 get('confirmation').value='APPROVE '+packet.proposal_digest;
 await get('approve-button').listeners.click();
 const sent=JSON.parse(requests.find(r=>r.path==='/api/approve').opts.body);
 assert.equal(sent.proposal_digest,packet.proposal_digest);
 assert.equal(Object.hasOwn(sent,'plan_digest'),false);
 assert.deepEqual(sent.approved_permission_ids,['permission-1']);
});
