/** Real ADK Runner, provenance/Engineer signatures, durable stores and
 * Coordinator; credential issuer and Gateway transport are offline fixtures.
 * No native Rust/EVM/OPA/provider or paid inference success is claimed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BaseLlm} from '@google/adk';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createServer} from 'node:net';
import {generateKeyPairSync,randomBytes,scryptSync,createHash} from 'node:crypto';
import {createTrustedAuthorityOnlyReviewHost as createHost,
 reconcileTrustedAuthorityOnlyReviewRoots} from '../src/trusted-authority-only-review-host.mjs';
import {TrustedOperationalRecoveryStore}
 from '../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts';
import {startOwnerControlledEngineerReviewHost} from '../src/trusted-engineer-host.mjs';
import {AuthorityPlanningCheckpointStore} from '../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts';
import {DurableAuthorityOnlyActivationJournal} from '../../../packages/orchestrator-runtime/src/authority-only-activation-journal.ts';
import {DurableAuthorityTaskJournal} from '../../../packages/orchestrator-runtime/src/trusted-authority-task-journal.ts';
import {DurableAuthorityOnlyChildJournal} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-child-journal.ts';
import {TrustedOperationalSessionStore} from '../../gateway/src/trusted-operational-session-store.ts';
import {TrustedAuthorityOnlyEffectStager} from '../../gateway/src/trusted-authority-only-effect-stager.ts';
import {TrustedAuthorityOnlyGiteaMutationPreflight} from '../../gateway/src/trusted-authority-only-mutation-preflight.ts';
import {TrustedAuthorityOnlyRunnerPreflight} from '../../gateway/src/trusted-authority-only-runner-preflight.ts';
import {DurableAuthorityOnlyGiteaMutationIntentJournal}
 from '../../gateway/src/trusted-authority-only-mutation-intent-journal.ts';
import {DurableAuthorityOnlyRunnerIntentJournal}
 from '../../gateway/src/trusted-authority-only-runner-intent-journal.ts';
import {GiteaClient} from '../../gateway/src/gitea-client.ts';
import {AuthenticatedGiteaMutationCompletionObserver,
 TrustedGatewayGiteaMutationEvidencePublisher}
 from '../../gateway/src/trusted-authority-only-gitea-mutation-evidence.ts';
import {AuthenticatedRunnerCompletionObserver,
 TrustedGatewayRunnerPassEvidencePublisher}
 from '../../gateway/src/trusted-authority-only-runner-evidence.ts';
import {AuthenticatedRunnerFailureObserver,TrustedGatewayRunnerFailEvidencePublisher}
 from '../../gateway/src/trusted-authority-only-runner-failure-evidence.ts';
import {RunnerClient} from '../../gateway/src/runner-client.ts';
import {TrustedAuthorityOnlyCompletionObserver}
 from '../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts';
import {InMemoryRequestStore,InMemoryAuditSink,prepareAuthorization} from '../../gateway/src/prepare.ts';
import {TrustedAuthorityOnlyAdkDecisionProposer}
 from '../../../packages/orchestrator-runtime/src/trusted-authority-only-adk-decision-proposer.mjs';
import {DurableNativeD1FirstTaskAdmissionJournal}
 from '../../../packages/orchestrator-runtime/src/trusted-native-d1-first-task-admission.ts';
import {DurableAuthorityOnlyTaskFenceJournal}
 from '../../../packages/orchestrator-runtime/src/trusted-authority-only-task-fence-journal.ts';
import {startSpecializedAgentServer,TrustedEffectStagingTaskRegistry,
 createTrustedEffectAgentBindingServer,connectTrustedOwnerEffectStagingClient}
 from '../../../packages/agent-runtime/src/index.ts';
import {preliminaryReadPermissions} from '../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts';
import {TrustedAuthorityOnlyEngineerSession} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-engineer-session.ts';
import {TrustedPlanningGatewayReadPort} from '../../../packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts';
import {selectAuthorityOnlyGrant,signAuthorityOnlyGrant} from '../../../packages/plan-contracts/src/authority-only-approval.mjs';
import {RUST_OPERATIONS} from '../../gateway/src/operation-catalog.ts';
const snapshot={session_id:'same-root-review',repository:{authority:'gitea.local',owner:'thesis',repository:'iam-console-poc'},base_revision:'a'.repeat(40),directories:['','apps'],files:['apps/user.ts']};
const requirement='Suspend accounts',branch='feature/account-suspension',did='did:thesis:engineer';
const draft={requested_permissions:[{operation:'update_file',resource_type:'file',path:'apps/user.ts'},{operation:'read_file',resource_type:'file',path:'apps/user.ts'}],assumptions:[],uncertainties:[]};
const pem=(k,type)=>k.export({format:'pem',type}).toString();
class R3504ScriptedBackend extends BaseLlm{
 calls=0; requests=[];
 constructor(allowD1=false){super({model:'r3504-scripted-no-inference'});this.allowD1=allowD1;}
 async *generateContentAsync(request){
  this.calls++;this.requests.push(request);
  if(this.calls===1||(this.allowD1&&this.calls===3))
   yield {content:{role:'model',parts:[{functionCall:{
    id:this.calls===3?'r3524-repair':'r3504-update',name:'update_file',
    args:{branch:'feature/account-suspension',path:'apps/user.ts',
     content:this.calls===3?
      'export const suspended=true; export const ui="ready";\n':
      'export const suspended=true;\n'}
   }}]}};
  else yield {content:{role:'model',parts:[{text:'Updated owner-authorized file'}]}};
 }
 connect(){throw Error('Paid model connection forbidden');}
}

class R3513ScriptedFrontend extends BaseLlm{
 calls=0;requests=[];
 constructor(){super({model:'r3513-scripted-frontend-offline'});}
 async *generateContentAsync(req){
  this.calls++;this.requests.push(req);
  if(this.calls===1)yield {content:{role:'model',parts:[{functionCall:{
   id:'r3513-frontend-update',name:'update_file',
   args:{branch:'feature/account-suspension',path:'apps/user.ts',
    content:'export const suspended=true; export const ui="pending";\n'}
  }}]}};
  else yield {content:{role:'model',parts:[{text:'Updated approved Frontend state'}]}};
 }
 connect(){throw Error('Paid model connection forbidden');}
}
class R3514ScriptedTest extends BaseLlm{
 calls=0; requests=[];
 constructor(allowRetest=false){super({model:'r3514-scripted-test-no-inference'});this.allowRetest=allowRetest;}
 async *generateContentAsync(request){
  this.calls++;this.requests.push(request);
  if(this.calls===1||(this.allowRetest&&this.calls===3))yield {content:{role:'model',parts:[{functionCall:{
   id:this.calls===3?'r3525-retest-run':'r3514-test-run',name:'run_tests',
   args:{branch:'feature/account-suspension',profile:'poc-default'}
  }}]}};
  else yield {content:{role:'model',parts:[{text:'Test Runner result received'}]}};
 }
 connect(){throw Error('Paid model connection forbidden in R351.4');}
}
class Scripted extends BaseLlm{
 calls=0;
 constructor(proposal=draft){super({model:'free-owner-review-script'});this.proposal=proposal;}
 async *generateContentAsync(){
  this.calls++;
  if(this.calls===1)yield {content:{role:'model',parts:[{functionCall:{id:'read',name:'read_file',args:{branch:'main',path:snapshot.files[0]}}}]}};
  else yield {content:{role:'model',parts:[{text:JSON.stringify(this.proposal)}]}};
 }
 connect(){throw Error('Paid inference forbidden');}
}
const root=(id,index,seconds=600)=>({credential_id:id,valid_from:new Date().toISOString(),validity_seconds:seconds,
 credential_status:{type:'BitstringStatusListEntry',statusPurpose:'revocation',statusListIndex:String(index),statusListCredential:'https://status.invalid/list'}});
async function fixture(t,flags={}){
 const home=await mkdtemp(join(tmpdir(),'r349-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const dirs=Object.fromEntries(['receipts','checkpoints','activation','tasks','keys','gatewaySessions','gatewayTasks','issuerChildren','gatewayChildren','flights',
  'mutationIntents','runnerIntents','recovery','mutationEvidence',
  'runnerEvidence','d1Admissions'].map(k=>[k,join(home,k)]));
 for(const d of Object.values(dirs))await mkdir(d,{mode:0o700});
 const engineer=generateKeyPairSync('ed25519'),backend=generateKeyPairSync('ed25519');
 const privateKeyFile=join(dirs.keys,'engineer.pem');await writeFile(privateKeyFile,pem(engineer.privateKey,'pkcs8'),{mode:0o600});
 const store=new AuthorityPlanningCheckpointStore({directory:dirs.checkpoints,trust:{
  trustedKeys:{backend:{public_key_pem:pem(backend.publicKey,'spki')}},expectedSessionId:snapshot.session_id,
  expectedRepository:snapshot.repository,expectedBaseRevision:snapshot.base_revision,expectedWorkBranch:branch,expectedRequirement:requirement}});
 const proposal=flags.includeTestPermission?{...draft,requested_permissions:[
  ...draft.requested_permissions,
  {operation:'run_tests',resource_type:'branch',path:null}
 ]}:draft;
 const salt=randomBytes(16),log=[],model=new Scripted(proposal);
 const options={snapshot,requirement,workBranch:branch,preliminaryRoot:root('urn:r349:preliminary',1),
  activationJournal:new DurableAuthorityOnlyActivationJournal(dirs.activation),taskJournal:new DurableAuthorityTaskJournal(dirs.tasks),
  operationalRecoveryStore:new TrustedOperationalRecoveryStore(dirs.recovery),
  operationalSessionStore:new TrustedOperationalSessionStore(dirs.gatewaySessions),
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
 async function approve(ids=['permission-1']){const {cookie,packet}=await review();const r=await call('/api/approve',{cookie,csrf:packet.csrf_token,body:{proposal_digest:packet.proposal_digest,approved_permission_ids:ids,confirmation:'APPROVE '+packet.proposal_digest}});assert.equal(r.status,201);return packet;}
 return {options,start,log,model,call,review,approve,dirs,store,engineer};
}

/** Real native preflight classes and durable journals; only Gitea reads
 * are supplied by a no-network fixture for these cheap offline regressions. */
function nativeOfflinePreflights(gateway,dirs,events=[],provider,originalRunnerJournal){
 class PinnedGiteaReadFixture extends GiteaClient{
  constructor(){super({baseUrl:'http://offline-gitea.invalid',
   token:'offline-no-network',owner:'thesis',repository:'iam-console-poc'});}
  async getBranchMetadata(workBranch){
   assert.equal(workBranch,branch);
   return {name:workBranch,commit_sha:provider?.head??snapshot.base_revision};
  }
  async readTextFile(workBranch,path,revision){
   assert.equal(workBranch,branch);
   assert.equal(path,'apps/user.ts');
   assert.equal(revision,provider?.head??snapshot.base_revision);
   events.push('offline_pinned_gitea_read');
   return {branch:workBranch,path,revision,
    blob_sha:provider?.blob??'b'.repeat(40),
    content:provider?.content??'export const suspended=false;\n'};
  }
 }
 const gitea=new PinnedGiteaReadFixture();
 return {
  gitea,
  mutation:new TrustedAuthorityOnlyGiteaMutationPreflight({
   admissions:gateway,giteaClient:gitea,
   journal:new DurableAuthorityOnlyGiteaMutationIntentJournal(dirs.mutationIntents),
   repository:'thesis/iam-console-poc',branch
  }),
  runner:new TrustedAuthorityOnlyRunnerPreflight({
   admissions:gateway,giteaClient:gitea,
   journal:originalRunnerJournal??
    new DurableAuthorityOnlyRunnerIntentJournal(dirs.runnerIntents),
   repository:'thesis/iam-console-poc',branch
  })
 };
}

function executionDeps(f){
 return {
  operationalSessionStore:f.options.operationalSessionStore,
  gatewayTaskJournal:new DurableAuthorityTaskJournal(f.dirs.gatewayTasks),
  issuerChildJournal:new DurableAuthorityOnlyChildJournal(f.dirs.issuerChildren),
  gatewayChildJournal:new DurableAuthorityOnlyChildJournal(f.dirs.gatewayChildren),
  nativeCryptoPort:{kind:'rust-native',issueChild:async()=>{
   throw Error('no Child issuance in R350 admission-only test');
  }}
 };
}
test('R350 same R349 Engineer session activates independently verified Gateway and native Child issuer',async t=>{
 const f=await fixture(t),host=await f.start();
 await assert.rejects(host.admitOperationalExecution(executionDeps(f)),/requires an activated/);
 await f.approve();
 const {coordinator}=await host.activateOperational(root('urn:r350:operational',2));
 const {gateway,childIssuer,admission}=await host.admitOperationalExecution(executionDeps(f));
 assert.equal(admission.status,'gateway_authority_admitted_preflight_only');
 assert.equal(admission.gateway_execution_authorized,false);
 assert.equal(admission.session_id,snapshot.session_id);
 assert.equal(gateway.phase,'active');
 assert.equal(gateway.registeredTaskCount,0);
 assert.equal(coordinator.registeredTaskCount,0);
 assert.throws(()=>childIssuer.assertTrustedIssuedChild('unregistered',coordinator),/Task not admitted/);
 await assert.rejects(host.admitOperationalExecution(executionDeps(f)),/already attempted/);
 await host.close();
 assert.equal(host.phase,'revoked');
 assert.throws(()=>coordinator.assertTrustedGatewayAuthorityBinding(),/root|retire|active/);
});
test('R350 rejects shared Child journal and retires the original operational root',async t=>{
 const f=await fixture(t),host=await f.start();await f.approve();
 await host.activateOperational(root('urn:r350:invalid',2));
 const deps=executionDeps(f);deps.gatewayChildJournal=deps.issuerChildJournal;
 await assert.rejects(host.admitOperationalExecution(deps),/distinct owner-private journals/);
 assert.equal(host.phase,'revoked');
 assert.equal(f.log.at(-1),'revoke:urn:r350:invalid');
 await host.close();
});


function stagedBackend(rootBinding,{taskId='r350-backend',epoch=1,childId='urn:r350:child:backend',permission}={}){
 const approved=permission??rootBinding.root_permissions.find(p=>p.operation==='update_file');
 assert.ok(approved,'authenticated Engineer review must contain update_file');
 return {
  task:{task_id:taskId,epoch,agent_id:'backend',depends_on:[],permissions:[approved]},
  runtimeTaskId:'dispatch_'+'Q'.repeat(22),
  childParameters:{credential_id:childId,valid_from:new Date().toISOString(),
   validity_seconds:90,credential_status:{type:'BitstringStatusListEntry',
    statusPurpose:'revocation',statusListCredential:'https://status.invalid/r350-child',
    statusListIndex:'3'}}
 };
}
class R351ScriptedDecision extends BaseLlm{
 constructor(candidate){super({model:'r351-scripted-free-decision'});this.candidate=candidate;this.calls=0;this.requests=[];}
 async *generateContentAsync(req){
  this.calls++;this.requests.push(req);
  yield {content:{role:'model',parts:[{text:JSON.stringify(this.candidate)}]}};
 }
 connect(){throw Error('No paid inference in R351 scripted decision test');}
}
test('R351.0 ADK chooses a dynamic Task and Engineer owner stages original native Child',async t=>{
 const f=await fixture(t),host=await f.start();
 await f.approve(['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r351:chosen-root',2));
 const choice=stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding(),{
  taskId:'r351-model-selected'
 });
 const signed=[],deps=executionDeps(f);
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(req){
  signed.push(req);
  return {id:req.credential_id,validFrom:req.valid_from,
   credentialSubject:{sub:'did:thesis:backend',per:structuredClone(req.permissions)},
   credentialStatus:structuredClone(req.credential_status)};
 }};
 const execution=await host.admitOperationalExecution(deps);
 const model=new R351ScriptedDecision({
  task_id:choice.task.task_id,agent_id:'backend',depends_on:[],
  permissions:choice.task.permissions,
  instruction:'Update account suspension Backend within approved scope'
 });
 const result=await execution.proposeAndStageTask({
  model,runtimeTaskId:choice.runtimeTaskId,
  childParameters:choice.childParameters
 });
 assert.equal(result.status,'owner_child_enrolled_no_provider_execution');
 assert.equal(result.decision_source,'owner_adk_candidate_coordinator_validated');
 assert.equal(result.task_id,'r351-model-selected');
 assert.equal(result.agent_id,'backend');
 assert.equal(coordinator.registeredTaskCount,1);
 assert.equal(execution.gateway.registeredTaskCount,1);
 assert.equal(signed.length,1);
 assert.equal(model.calls,1);
 const prompt=JSON.stringify(model.requests);
 assert.equal(prompt.includes('urn:r351:chosen-root'),false);
 assert.equal(prompt.includes(choice.childParameters.credential_id),false);
 assert.equal(prompt.includes(f.options.approval.privateKeyFile),false);
 await host.close();
 assert.equal(host.phase,'revoked');
});
test('R351.0 model-supplied unauthorized Task is rejected before native Child issuance',async t=>{
 const f=await fixture(t),host=await f.start();
 await f.approve(['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r351:denied-root',2));
 const choice=stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding());
 const deps=executionDeps(f);let issued=0;
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(){issued++;throw Error('should not issue');}};
 const execution=await host.admitOperationalExecution(deps);
 const model=new R351ScriptedDecision({
  task_id:'r351-outside-scope',agent_id:'backend',depends_on:[],
  permissions:[{operation:'update_file',resource:'gitea://gitea.local/thesis/iam-console-poc/branches/main/files/secrets.ts'}],
  instruction:'Attempt to edit an unrelated secret'
 });
 await assert.rejects(execution.proposeAndStageTask({
  model,runtimeTaskId:choice.runtimeTaskId,childParameters:choice.childParameters
 }),/R351 authority-only model Task choice denied/);
 assert.equal(issued,0);
 assert.equal(coordinator.registeredTaskCount,0);
 assert.equal(execution.gateway.registeredTaskCount,0);
 assert.equal(host.phase,'operational');
 await host.close();
});
test('R351.1 unverified registered Task never unlocks another model decision',async t=>{
 const f=await fixture(t),host=await f.start();
 await f.approve(['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r3511:pending-root',2));
 const task=stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding(),{
  taskId:'r3511-first'
 });
 let childCalls=0;
 const deps=executionDeps(f);deps.nativeCryptoPort={kind:'rust-native',
  async issueChild(req){
   childCalls++;
   return {id:req.credential_id,validFrom:req.valid_from,
    credentialSubject:{sub:'did:thesis:backend',per:structuredClone(req.permissions)},
    credentialStatus:structuredClone(req.credential_status)};
  }
 };
 const execution=await host.admitOperationalExecution(deps);
 const first=new R351ScriptedDecision({
  task_id:'r3511-first',agent_id:'backend',depends_on:[],
  permissions:task.task.permissions,
  instruction:'First approved Backend effect'
 });
 const staged=await execution.proposeAndStageTask({
  model:first,runtimeTaskId:task.runtimeTaskId,
  childParameters:task.childParameters
 });
 assert.equal(staged.task_id,'r3511-first');
 assert.equal(childCalls,1);
 assert.equal(coordinator.registeredTaskCount,1);
 const second=new R351ScriptedDecision({
  task_id:'r3511-second',agent_id:'backend',
  depends_on:['r3511-first'],permissions:task.task.permissions,
  instruction:'This must not run before the first independent Gateway attestation'
 });
 const another=stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding(),{
  taskId:'r3511-second',epoch:2,childId:'urn:r3511:second-child'
 });
 another.runtimeTaskId='dispatch_'+'M'.repeat(22);
 await assert.rejects(execution.proposeAndStageTask({
  model:second,runtimeTaskId:another.runtimeTaskId,
  childParameters:another.childParameters
 }),/next ADK Task decision requires independent Gateway completion/);
 assert.equal(second.calls,0,'unverified dependency must not be shown to an LLM');
 assert.equal(childCalls,1);
 assert.equal(coordinator.registeredTaskCount,1);
 assert.equal(execution.gateway.registeredTaskCount,1);
 assert.equal(host.phase,'operational');
 await host.close();
});
test('R351.1 isolated ADK proposer accepts only explicitly completed prior Task IDs',async()=>{
 const roots=[{operation:'update_file',
  resource:'gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/user.ts'}];
 const agents={backend:{capabilities:['update_file']}};
 const choice={
  task_id:'r3511-followup',agent_id:'backend',
  depends_on:['r3511-verified'],permissions:roots,
  instruction:'Follow previous verified Backend Task'
 };
 const verifiedModel=new R351ScriptedDecision(choice);
 const admitted=new TrustedAuthorityOnlyAdkDecisionProposer({
  model:verifiedModel,requirement:'Account Suspension',
  branch:'feature/account-suspension',rootPermissions:roots,agents,
  previousTasks:[{task_id:'r3511-verified',agent_id:'backend'}]
 });
 const proposal=await admitted.propose();
 assert.deepEqual(proposal.depends_on,['r3511-verified']);
 const prompt=JSON.stringify(verifiedModel.requests);
 assert.equal(prompt.includes('independently_gateway_completed_tasks'),true);
 assert.equal(prompt.includes('already_registered_tasks'),false);
 const unverifiedModel=new R351ScriptedDecision(choice);
 const denied=new TrustedAuthorityOnlyAdkDecisionProposer({
  model:unverifiedModel,requirement:'Account Suspension',
  branch:'feature/account-suspension',rootPermissions:roots,agents,
  previousTasks:[]
 });
 await assert.rejects(denied.propose(),
  /R351 authority-only model Task choice denied/);
 assert.equal(unverifiedModel.calls,1);
});
test('R350.2 same Engineer root registers Task, binds Gateway, issues native Child and enrolls it',async t=>{
 const f=await fixture(t),host=await f.start();await f.approve(['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r350:operational-task',2));
 const signed=[],deps=executionDeps(f);
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(req){
  signed.push(req);
  return {id:req.credential_id,validFrom:req.valid_from,
   credentialSubject:{sub:'did:thesis:backend',per:structuredClone(req.permissions)},
   credentialStatus:structuredClone(req.credential_status)};
 }};
 const {gateway,childIssuer,stageTask}=await host.admitOperationalExecution(deps);
 const rootBinding=coordinator.assertTrustedGatewayAuthorityBinding();
 const staged=await stageTask(stagedBackend(rootBinding));
 assert.equal(staged.status,'owner_child_enrolled_no_provider_execution');
 assert.equal(staged.gateway_execution_authorized,false);
 assert.equal(staged.agent_id,'backend');
 assert.equal(coordinator.registeredTaskCount,1);
 assert.equal(gateway.registeredTaskCount,1);
 assert.equal(signed.length,1);
 assert.equal(signed[0].parent_credential_id,rootBinding.root_credential_id);
 assert.deepEqual(signed[0].permissions,rootBinding.root_permissions.filter(p=>p.operation==='update_file'));
 const child=childIssuer.assertTrustedIssuedChild(staged.task_id,coordinator);
 assert.equal(child.credential_id,staged.credential_id);
 assert.equal(child.root_credential_id,rootBinding.root_credential_id);
 await assert.rejects(stageTask(stagedBackend(rootBinding)),/Task|epoch|replayed|invalid/);
 assert.equal(host.phase,'revoked');
 await host.close();
});
test('R350.2 rejects out-of-root Task before native signing or Gateway provider effects',async t=>{
 const f=await fixture(t),host=await f.start();await f.approve(['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r350:invalid-task',2));
 let signed=0;const deps=executionDeps(f);
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(){signed++;throw Error('must never be reached');}};
 const {gateway,stageTask}=await host.admitOperationalExecution(deps);
 const live=coordinator.assertTrustedGatewayAuthorityBinding();
 const task=stagedBackend(live);
 task.task.permissions=[{...task.task.permissions[0],
  resource:task.task.permissions[0].resource.replace('apps/user.ts','apps/other.ts')}];
 await assert.rejects(stageTask(task),/authority escalation/);
 assert.equal(signed,0);assert.equal(gateway.registeredTaskCount,0);
 assert.equal(host.phase,'revoked');
 assert.equal(f.log.at(-1),'revoke:urn:r350:invalid-task');
 await host.close();
});
test('R350.2 treats a mismatched native Child signature response as terminal',async t=>{
 const f=await fixture(t),host=await f.start();await f.approve(['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r350:bad-child',2));
 const deps=executionDeps(f);
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(req){
  return {id:'urn:foreign:child',validFrom:req.valid_from,
   credentialSubject:{sub:'did:thesis:backend',per:req.permissions},
   credentialStatus:req.credential_status};
 }};
 const {gateway,stageTask}=await host.admitOperationalExecution(deps);
 await assert.rejects(stageTask(stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding())),
  /native Child credential differs/);
 assert.equal(gateway.registeredTaskCount,1);
 assert.equal(host.phase,'revoked');
 await host.close();
});


async function localPort(){
 const server=createServer();
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 const addr=server.address();
 if(!addr||typeof addr==='string')throw Error('missing loopback A2A port');
 await new Promise((ok,bad)=>server.close(e=>e?bad(e):ok()));
 return addr.port;
}
test('R350.3 same-session Owner starts three pinned A2A SDK agent cards after native Child enrollment',async t=>{
 const f=await fixture(t),host=await f.start();
 await f.approve(['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r350:sdk-root',2));
 const deps=executionDeps(f);
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(req){
  return {id:req.credential_id,validFrom:req.valid_from,
   credentialSubject:{sub:'did:thesis:backend',per:structuredClone(req.permissions)},
   credentialStatus:structuredClone(req.credential_status)};
 }};
 const execution=await host.admitOperationalExecution(deps);
 const {stageTask,startSdkA2AOwner}=execution;
 const stage=stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding());
 await stageTask(stage);
 const temp=await mkdtemp(join(tmpdir(),'r350sdk-'));
 const roles=['backend','frontend','test'];
 const stageChannels={},agentBindingChannels={},a2aUrls={};
 const servers=[],binders=[];
 try{
  for(const role of roles){
   const socket={socketPath:join(temp,role+'-stage.sock'),
    secretFile:join(temp,role+'-stage.hex')};
   const binding={socketPath:join(temp,role+'-bind.sock'),
    secretFile:join(temp,role+'-bind.hex')};
   stageChannels[role]=socket;agentBindingChannels[role]=binding;
   for(const path of [socket.secretFile,binding.secretFile])
    await writeFile(path,randomBytes(32).toString('hex')+'\n',{mode:0o600,flag:'wx'});
   const agent=await startSpecializedAgentServer({role,
    host:'127.0.0.1',port:await localPort(),
    delegatedAuthorization:true,capabilityProfile:'approved-plan'});
   servers.push(agent);a2aUrls[role]=agent.baseUrl;
  }
  for(const role of roles){
   const bind=await createTrustedEffectAgentBindingServer({
    ...agentBindingChannels[role],expectedRole:role,
    registry:new TrustedEffectStagingTaskRegistry(),
    ownerStageClient:await connectTrustedOwnerEffectStagingClient(
     stageChannels[role])
   });
   binders.push(bind);await bind.start();
  }
  const owner=await startSdkA2AOwner({
   stageChannels,agentBindingChannels,agentBaseUrls:a2aUrls
  });
  assert.deepEqual(owner,{
   status:'owner_protected_a2a_started_no_provider_execution',
   gateway_execution_authorized:false
  });
  assert.equal('dispatchIssuedTask' in owner,false);
  assert.equal('attestIndependentGatewayCompletion' in owner,false);
  const {dispatchEnrolledTask,bindNativeGatewayEffects,
   createEnrolledNativeEffectStager,attestEnrolledTaskCompletion}=execution;
  await assert.rejects(attestEnrolledTaskCompletion({
   taskId:stage.task.task_id,runtimeTaskId:stage.runtimeTaskId
  }),/no matching original A2A dispatch report/);
  await assert.rejects(attestEnrolledTaskCompletion({
   taskId:stage.task.task_id,runtimeTaskId:stage.runtimeTaskId,
   claimed_success:true
  }),/cannot accept model or provider success claims/);
  // An arbitrary callback is not a native owner-bound effect stager.
  await assert.rejects(dispatchEnrolledTask({
   taskId:stage.task.task_id,runtimeTaskId:stage.runtimeTaskId,
   instruction:'no native owner stage yet',effectStager:{stage:async()=>{}}
  }),/original owner-bound effect stager/);
  assert.throws(()=>createEnrolledNativeEffectStager({
   runtimeTaskId:stage.runtimeTaskId,expectedHeadSha:'a'.repeat(40)
  }),/native effect staging requires/);
  const nativeStore=new InMemoryRequestStore();
  const realGateway=execution.gateway;
  const {mutation:nativeMutation,runner:nativeRunner,gitea}=
   nativeOfflinePreflights(realGateway,f.dirs);
  assert.deepEqual(bindNativeGatewayEffects({
   store:nativeStore,mutation:nativeMutation,runner:nativeRunner,giteaClient:gitea
  }),{status:'owner_native_gateway_effects_bound_no_execution',
   gateway_execution_authorized:false});
  const genuineStager=createEnrolledNativeEffectStager({
   runtimeTaskId:stage.runtimeTaskId,expectedHeadSha:'a'.repeat(40)
  });
  assert.ok(genuineStager instanceof TrustedAuthorityOnlyEffectStager);
  assert.equal(genuineStager.isForOwnerTask(realGateway,stage.runtimeTaskId,
   'update_file'),true);
  assert.throws(()=>createEnrolledNativeEffectStager({
   runtimeTaskId:stage.runtimeTaskId,expectedHeadSha:'a'.repeat(40)
  }),/unspent Task/);
  assert.throws(()=>bindNativeGatewayEffects({
   store:nativeStore,mutation:nativeMutation,runner:nativeRunner,giteaClient:gitea
  }),/quiescent owner/);
  await assert.rejects(dispatchEnrolledTask({
   taskId:stage.task.task_id,runtimeTaskId:stage.runtimeTaskId,
   instruction:'do not execute',effectStager:{stage:async()=>{}}
  }),/original owner-bound effect stager/);
  await assert.rejects(startSdkA2AOwner({
   stageChannels,agentBindingChannels,agentBaseUrls:a2aUrls
  }),/requires an enrolled Child/);
  // Startup is NOT provider success and cannot fabricate a completion.
  await assert.rejects(execution.attestEnrolledTaskCompletion({
   taskId:stage.task.task_id,runtimeTaskId:stage.runtimeTaskId
  }),/no matching original A2A dispatch report/);
  await host.close();assert.equal(host.phase,'revoked');
 }finally{
  await Promise.allSettled(binders.reverse().map(x=>x.close()));
  await Promise.allSettled(servers.reverse().map(x=>x.close()));
  await rm(temp,{recursive:true,force:true});
  if(host.phase==='operational')await host.close();
 }
});

for(const mode of ['missing','backend','frontend','test','failure',
 'failure-d1-effect','failure-d1-retest','failure-no-receipt','failure-model-denied'])test(
 mode==='failure-no-receipt'?
 'R352.1 Test FAIL without MAC receipt retires original Engineer root':
 mode==='failure-model-denied'?
 'R352.1 verified FAIL does not permit a model-selected foreign D1 role':
 mode==='failure-d1-retest'?
  'R352.5 original D1 repair and independent Runner retest PASS':
  mode==='failure-d1-effect'?
 'R352.4 admitted D1 Backend repairs through original A2A/Gateway and independent Gitea evidence':
 mode==='failure'?
 'R352.1 actual A2A Test FAIL is independently verified and permits only a bounded D1 candidate':
 mode==='test'?
 'R351.4 original Engineer ADK/A2A Test invokes authenticated Runner evidence and attests PASS':
 mode==='frontend'?
 'R351.3 actual Frontend A2A Gateway evidence unlocks bounded ADK Test Agent choice':
 mode==='backend'?
 'R351.2 original Gateway authenticated offline Gitea evidence permits next ADK Frontend choice':
 'R350.4 continuous Engineer authority reaches real ADK/A2A SDK, while Gateway evidence remains required',
 async t=>{
 const verified=mode!=='missing',throughFailure=mode.startsWith('failure'),
  noFailureReceipt=mode==='failure-no-receipt',
  foreignD1Model=mode==='failure-model-denied',
  throughTest=mode==='test'||throughFailure,
  throughFrontend=mode==='frontend'||throughTest,
  d1Retest=mode==='failure-d1-retest',
   d1Effect=mode==='failure-d1-effect'||d1Retest;
 const f=await fixture(t,throughFrontend?{includeTestPermission:true}:{});
 const host=await f.start();
 await f.approve(throughFrontend?['permission-1','permission-2','permission-3']:
  ['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r350:real-a2a-root',2));
 const deps=executionDeps(f),events=[],model=new R3504ScriptedBackend(d1Effect);
 deps.effectFenceJournal=new DurableAuthorityOnlyTaskFenceJournal(f.dirs.flights);
 const fileSha='e'.repeat(40),frontendSha='f'.repeat(40),
  vp='r3504-private-vp',frontendVp='r3513-private-frontend-vp',
  requestId='r3504-prepared-01',frontendRequestId='r3513-prepared-frontend',
  testRequestId='r3514-prepared-runner',
  frontendChallenge='r3513-frontend-challenge',
  testChallenge='r3514-runner-challenge',testVp='r3514-private-test-vp';
 const newContent='export const suspended=true;\n';
 const frontendContent='export const suspended=true; export const ui="pending";\n';
 const newBlob='d'.repeat(40),frontendBlob='c'.repeat(40),oldBlob='b'.repeat(40);
 const repairSha='9'.repeat(40),repairBlob='8'.repeat(40),
  repairContent='export const suspended=true; export const ui="ready";\n',
  repairRequestId='r3524-prepared-d1-repair',repairChallenge='r3524-d1-challenge',
  repairVp='r3524-private-d1-vp',
   retestRequestId='r3525-prepared-retest',
   retestChallenge='r3525-retest-challenge',retestVp='r3525-private-test-vp';
 const provider={head:snapshot.base_revision,parent:snapshot.base_revision,
  blob:oldBlob,content:'export const suspended=false;\n'};
 let publisher,frontendStaged,next,testTask,testStaged,runnerClient,
  runnerPublisher,runnerJournal,failureObserver,failurePublisher,nativeD1,
   d1RetestTask,d1RetestStaged;
 const frontendModel=new R3513ScriptedFrontend();
 const testAgentModel=new R3514ScriptedTest(d1Retest);
 const runnerPhases=['dependency_install','typecheck','backend_tests',
  'frontend_tests','build','playwright_e2e'];
 if(verified){
  // In-memory disposable Gitea fixture, but REAL independent receipt
  // publisher/observer, MAC, HEAD-parent-CAS and file-content checks.
  const reader=new GiteaClient({baseUrl:'http://offline-evidence.r3512.invalid',
   token:'trusted-offline-reader',owner:'thesis',repository:'iam-console-poc',
   fetchFn:async(raw,init)=>{
    assert.equal(init?.method,'GET');
    const u=new URL(String(raw));
    if(u.pathname.endsWith('/branches/feature%2Faccount-suspension'))
     return Response.json({name:branch,commit:{id:provider.head}});
    if(u.pathname.endsWith('/git/commits/'+provider.head))
     return Response.json({sha:provider.head,parents:[{sha:provider.parent}]});
    if(u.pathname.endsWith('/contents/apps/user.ts')){
     assert.equal(u.searchParams.get('ref'),provider.head);
     return Response.json({type:'file',path:'apps/user.ts',encoding:'base64',
      content:Buffer.from(provider.content).toString('base64'),
      size:Buffer.byteLength(provider.content),sha:provider.blob,
      last_commit_sha:provider.head});
    }
    throw Error('unexpected independent Gitea fixture read');
   }
  });
  const baseProof={directory:f.dirs.mutationEvidence,key:randomBytes(32),
   repository:'thesis/iam-console-poc',branch};
  publisher=new TrustedGatewayGiteaMutationEvidencePublisher({
   ...baseProof,independentGiteaClient:reader
  });
  const giteaObserver=new AuthenticatedGiteaMutationCompletionObserver({
   ...baseProof,giteaClient:reader
  }).toTrustedObserver();
  if(throughTest){
   const runnerProof={directory:f.dirs.runnerEvidence,key:randomBytes(32),
    repository:'thesis/iam-console-poc',branch};
   runnerClient=new RunnerClient({
    baseUrl:'http://offline-runner.r3514.invalid',
    gatewayToken:'owner-private-offline-runner-token',
    fetchFn:async(url,init)=>{
     assert.equal(String(url),'http://offline-runner.r3514.invalid/v1/runs');
     assert.equal(init.method,'POST');
     assert.equal(init.headers.authorization,'Bearer owner-private-offline-runner-token');
     const request=JSON.parse(String(init.body));
     const retest=d1Retest&&request.request_id===retestRequestId;
      const failed=throughFailure&&!retest;
      assert.equal(request.request_id,retest?retestRequestId:testRequestId);
     assert.equal(request.repository,'gitea://gitea.local/thesis/iam-console-poc');
     assert.equal(request.branch,branch);
     assert.equal(request.commit_sha,retest?repairSha:frontendSha);
     assert.equal(request.profile,'poc-default');
     // This fixture simulates the HTTP controller; real RunnerClient
     // validates response shape and binds its original request provenance.
     const phases=[...runnerPhases,'researcher_acceptance'].map((phase,i)=>({
      phase,status:failed?
       i===0?'pass':i===1?'fail':'skipped':'pass'
     }));
     return Response.json({
      request_id:request.request_id,repository:request.repository,
      branch,tested_commit_sha:retest?repairSha:frontendSha,runner_profile:'poc-default',
      status:failed?'fail':'pass',
      phases,
      project_tests:{status:failed?'fail':'pass',
       phases:phases.slice(0,-1)},
      researcher_acceptance:phases.at(-1),
      log_reference:'runner-log://12345678-1234-1234-1234-123456789abc'
     });
    }
   });
   runnerPublisher=new TrustedGatewayRunnerPassEvidencePublisher({
    ...runnerProof,runnerClient,independentGiteaClient:reader
   });
   const runnerObserver=new AuthenticatedRunnerCompletionObserver({
    ...runnerProof,giteaClient:reader
   });
   deps.completionObserver=new TrustedAuthorityOnlyCompletionObserver({
    readVerifiedCompletion:e=>(e.task_id==='r3513-test'||
       e.task_id===d1RetestTask?.task_id)?
     runnerObserver.observe(e):giteaObserver.observe(e)
   });
   runnerJournal=new DurableAuthorityOnlyRunnerIntentJournal(f.dirs.runnerIntents);
   if(throughFailure){
    failurePublisher=new TrustedGatewayRunnerFailEvidencePublisher({
     ...runnerProof,runnerClient,journal:runnerJournal,
     independentGiteaClient:reader
    });
    failureObserver=new AuthenticatedRunnerFailureObserver({
     ...runnerProof,giteaClient:reader,journal:runnerJournal
    });
   }
  }else deps.completionObserver=giteaObserver;
  // The provider mutation is simulated by /execute below. A separate
  // observer rereads its state; no A2A artifact is accepted as evidence.
  publisher.setOfflineState=(head,parent,blob,content)=>{
   provider.head=head;provider.parent=parent;
   provider.blob=blob;provider.content=content;
  };
 }
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(req){
  events.push('native_child_fixture');
  return {'@context':['https://www.w3.org/ns/credentials/v2'],
   type:['VerifiableCredential','DelegationCredential'],
   id:req.credential_id,issuer:'did:thesis:rust',
   validFrom:req.valid_from,
   credentialSubject:{sub:'did:thesis:'+req.delegatee,per:structuredClone(req.permissions)},
   credentialStatus:structuredClone(req.credential_status),
   proof:{type:'Ed25519Signature2020',proofValue:'OFFLINE_R3504_FIXTURE'}};
 }};
 const execution=await host.admitOperationalExecution(deps);
 const {gateway,stageTask,startSdkA2AOwner}=execution;
 const task=stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding());
 const firstChoice=new R351ScriptedDecision({task_id:task.task.task_id,
  agent_id:'backend',depends_on:[],permissions:task.task.permissions,
  instruction:'Update Backend Account Suspension within signed scope'});
 const staged=verified?await execution.proposeAndStageTask({
  model:firstChoice,runtimeTaskId:task.runtimeTaskId,
  childParameters:task.childParameters
 }):await stageTask(task);
 assert.equal(staged.status,'owner_child_enrolled_no_provider_execution');
 if(verified)assert.equal(firstChoice.calls,1);
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 const {mutation:nativeMutation,runner:nativeRunner,gitea}=
  nativeOfflinePreflights(gateway,f.dirs,events,verified?provider:undefined,
   runnerJournal);
 assert.equal(execution.bindNativeGatewayEffects({
  store,mutation:nativeMutation,runner:nativeRunner,giteaClient:gitea,
  ...(throughFailure?{failureObserver}:{})
 }).gateway_execution_authorized,false);
 const nativeStager=execution.createEnrolledNativeEffectStager({
  runtimeTaskId:task.runtimeTaskId,expectedHeadSha:snapshot.base_revision
 });
 const temp=await mkdtemp(join(tmpdir(),'r3504a2a-'));
 const roles=['backend','frontend','test'],stageChannels={},
  agentBindingChannels={},a2aUrls={},servers=[],binders=[];
 let ownerStartup;
 const fetchFn=async(url,options)=>{
  const u=String(url),body=JSON.parse(String(options?.body));
  if(u.endsWith('/v1/authorization/prepare')){
   const runnerRequest=throughTest&&testStaged&&
    body.task_id===testTask.runtimeTaskId;
   const retestRequest=d1Retest&&d1RetestTask&&
     body.task_id===d1RetestTask.runtime_task_id;
    if(runnerRequest||retestRequest){
    assert.equal(body.agent_role,'test');
    assert.equal(body.tool,'run_tests');
    assert.deepEqual(body.arguments,{branch,profile:'poc-default'});
    events.push(retestRequest?'retest_gateway_prepare_canonical':'test_gateway_prepare_canonical');
    const prepared=prepareAuthorization(body,{
     audience:'cloud-access-gateway',request_ttl_ms:60000,
     repository:snapshot.repository
    },{
     store,audit,authorityOnlyAdmissions:gateway,
     requestId:()=>retestRequest?retestRequestId:testRequestId,
      challenge:()=>retestRequest?retestChallenge:testChallenge
    });
    assert.equal(store.size(),retestRequest?5:3);
    return Response.json(prepared,{status:201});
   }
   const d1Request=d1Effect&&nativeD1&&
    body.task_id===nativeD1.runtime_task_id;
   const frontendRequest=throughFrontend&&next&&
    body.task_id===next.runtimeTaskId;
   assert.equal(body.task_id,d1Request?nativeD1.runtime_task_id:
    frontendRequest?next.runtimeTaskId:task.runtimeTaskId);
   assert.equal(body.agent_role,frontendRequest?'frontend':'backend');
   assert.equal(body.tool,'update_file');
   assert.deepEqual(body.arguments,{branch,path:'apps/user.ts',
    content:d1Request?repairContent:frontendRequest?frontendContent:newContent});
   events.push(d1Request?'d1_gateway_prepare_canonical':
    frontendRequest?'frontend_gateway_prepare_canonical':'gateway_prepare_canonical');
   const prepared=prepareAuthorization(body,{
    audience:'cloud-access-gateway',request_ttl_ms:60000,
    repository:snapshot.repository
   },{
    store,audit,authorityOnlyAdmissions:gateway,
    requestId:()=>d1Request?repairRequestId:frontendRequest?frontendRequestId:requestId,
    challenge:()=>d1Request?repairChallenge:frontendRequest?frontendChallenge:'r3504-challenge'
   });
   assert.equal(store.size(),d1Request?4:frontendRequest?2:1);
   return Response.json(prepared,{status:201});
  }
  if(u.endsWith('/v1/presentations')){
   const runnerRequest=throughTest&&testStaged&&
    body.credential_id===testStaged.credential_id;
   const retestRequest=d1Retest&&d1RetestStaged&&
     body.credential_id===d1RetestStaged.credential_id;
    if(runnerRequest||retestRequest){
    assert.equal(body.challenge,retestRequest?retestChallenge:testChallenge);
    events.push(retestRequest?'retest_private_vp_fixture':'test_private_vp_fixture');
    return Response.json({signed_vp:retestRequest?retestVp:testVp});
   }
   const d1Request=d1Effect&&nativeD1&&
    body.credential_id===nativeD1.new_child_credential_id;
   const frontendRequest=throughFrontend&&frontendStaged&&
    body.credential_id===frontendStaged.credential_id;
   assert.equal(body.credential_id,d1Request?nativeD1.new_child_credential_id:
    frontendRequest?frontendStaged.credential_id:staged.credential_id);
   assert.equal(body.challenge,d1Request?repairChallenge:
    frontendRequest?frontendChallenge:'r3504-challenge');
   events.push(d1Request?'d1_private_vp_fixture':
    frontendRequest?'frontend_private_vp_fixture':'private_vp_fixture');
   return Response.json({signed_vp:d1Request?repairVp:
    frontendRequest?frontendVp:vp});
  }
  if(u.endsWith('/v1/authorization/execute')){
   if(throughTest&&(body.request_id===testRequestId||d1Retest&&body.request_id===retestRequestId)){
     const retest=body.request_id===retestRequestId;
     const failed=throughFailure&&!retest;
    assert.equal(body.signed_vp,retest?retestVp:testVp);
    const record=store.get(body.request_id);
    assert.ok(record);
    const intent=nativeRunner.getReservedIntent(record);
    assert.equal(intent.request_id,retest?retestRequestId:testRequestId);
    assert.equal(intent.credential_id,retest?d1RetestStaged.credential_id:testStaged.credential_id);
    assert.equal(intent.expected_head_sha,retest?repairSha:frontendSha);
    await runnerJournal.assertReserved(intent);
    const flights=(await readdir(f.dirs.flights))
     .filter(n=>n.endsWith('.flight.json'));
    assert.equal(flights.length,retest?5:3);
    const all=await Promise.all(flights.map(async name=>
     JSON.parse(await readFile(join(f.dirs.flights,name),'utf8'))));
    const flight=all.find(x=>x.request_id===body.request_id);
    assert.equal(flight?.credential_id,retest?d1RetestStaged.credential_id:testStaged.credential_id);
    events.push(retest?'retest_gateway_execute_fixture':'test_gateway_execute_fixture');
    // Reserve irrevocable one-shot Runner POST before any provider request.
    await runnerJournal.reserveAttempt(intent);
    const request={
      request_id:retest?retestRequestId:testRequestId,
     repository:'gitea://gitea.local/thesis/iam-console-poc',
     branch,commit_sha:retest?repairSha:frontendSha,profile:'poc-default'
    };
    const result=await runnerClient.run(request);
    const keys=['session_id','authority_digest','root_credential_id',
     'task_id','runtime_task_id','epoch','agent_did','credential_id',
     'request_id','request_fingerprint'];
    const binding=Object.fromEntries(keys.map(k=>[k,intent[k]]));
    if(failed){
      if(!noFailureReceipt)
      await failurePublisher.publish(intent,binding,request,result,'opa-offline-r3521');
    }else{
     const digest=await runnerPublisher.publish(intent,binding,
      request,result,'opa-offline-r3514');
     await runnerJournal.reserveCompletedEvidence(intent,digest);
    }
    return Response.json({request_id:body.request_id,decision:'allow',
     execution:{provider:'runner',performed:true,tool:'run_tests',
      branch,tested_commit_sha:retest?repairSha:frontendSha,runner_profile:'poc-default',
      status:failed?'fail':'pass',
      project_tests:{status:failed?'fail':'pass'},
      researcher_acceptance:{status:failed?'skipped':'pass'}}
    });
   }
   const d1Request=d1Effect&&nativeD1&&body.request_id===repairRequestId;
   const frontendRequest=throughFrontend&&body.request_id===frontendRequestId;
   const id=d1Request?repairRequestId:frontendRequest?frontendRequestId:requestId;
   const signed=d1Request?repairVp:frontendRequest?frontendVp:vp;
   const nextSha=d1Request?repairSha:frontendRequest?frontendSha:fileSha;
   const previousSha=d1Request?frontendSha:frontendRequest?fileSha:snapshot.base_revision;
   const previousBlob=d1Request?frontendBlob:frontendRequest?newBlob:oldBlob;
   const blob=d1Request?repairBlob:frontendRequest?frontendBlob:newBlob;
   const updated=d1Request?repairContent:frontendRequest?frontendContent:newContent;
   assert.equal(body.request_id,id);
   assert.equal(body.signed_vp,signed);
   events.push(d1Request?'d1_gateway_execute_fixture':
    frontendRequest?'frontend_gateway_execute_fixture':'gateway_execute_fixture');
   if(verified){
    const names=(await readdir(f.dirs.mutationIntents))
     .filter(n=>n.endsWith('.intent.json'));
    const flights=(await readdir(f.dirs.flights))
     .filter(n=>n.endsWith('.flight.json'));
    const count=d1Request?3:frontendRequest?2:1;
    assert.equal(names.length,count);assert.equal(flights.length,count);
    const intents=await Promise.all(names.map(async n=>JSON.parse(
     await readFile(join(f.dirs.mutationIntents,n),'utf8'))));
    const flightsData=await Promise.all(flights.map(async n=>JSON.parse(
     await readFile(join(f.dirs.flights,n),'utf8'))));
    const intent=intents.find(i=>i.request_id===id);
    const flight=flightsData.find(i=>i.request_id===id);
    assert.ok(intent);assert.ok(flight);
    assert.equal(flight.credential_id,d1Request?nativeD1.new_child_credential_id:
     frontendRequest?frontendStaged.credential_id:staged.credential_id);
    const pins=['session_id','authority_digest','root_credential_id',
     'task_id','runtime_task_id','epoch','agent_did','credential_id',
     'request_id','request_fingerprint'];
    const expected=Object.fromEntries(pins.map(k=>[k,intent[k]]));
    publisher.setOfflineState(nextSha,previousSha,blob,updated);
    const result={branch,path:'apps/user.ts',revision:nextSha,
     commit_sha:nextSha,blob_sha:blob,
     previous_revision:previousSha,
     precondition_blob_sha:previousBlob,previous_head_sha:previousSha,
     previous_blob_sha:previousBlob,staging_branch:'feature/r3513-private',
     next_content_sha256:createHash('sha256').update(updated).digest('hex')};
    await publisher.publish(intent,expected,result,'offline-opa-r3513');
   }
   return Response.json({request_id:id,decision:'allow',
    execution:{provider:'gitea',performed:true,tool:'update_file',
     branch,path:'apps/user.ts',commit_sha:nextSha}});
  }
  throw Error('Unexpected untrusted Gateway endpoint '+u);
 };
 try{
  const registries=Object.fromEntries(roles.map(role=>[
   role,new TrustedEffectStagingTaskRegistry()]));
  for(const role of roles){
   const sc={socketPath:join(temp,role+'-stage.sock'),
    secretFile:join(temp,role+'-stage.hex')};
   const bc={socketPath:join(temp,role+'-bind.sock'),
    secretFile:join(temp,role+'-bind.hex')};
   stageChannels[role]=sc;agentBindingChannels[role]=bc;
   for(const key of [sc.secretFile,bc.secretFile])
    await writeFile(key,randomBytes(32).toString('hex')+'\n',
     {mode:0o600,flag:'wx'});
   const server=await startSpecializedAgentServer({
    role,host:'127.0.0.1',port:await localPort(),
    delegatedAuthorization:true,capabilityProfile:'approved-plan',
    ...((role==='backend'||(throughFrontend&&role==='frontend')||
      (throughTest&&role==='test'))?{adk:{
     model:role==='backend'?model:role==='frontend'?frontendModel:testAgentModel,
     gatewayBaseUrl:'http://offline-gateway.r3504.invalid',
     adapterBaseUrl:'http://offline-crypto.r3504.invalid',
     adapterToken:'private-r3504-token',scopeModelPaths:true,
     maxModelTurns:4,maxModelCallMs:5000,
     trustedEffectTaskRegistry:registries[role],fetchFn
    }}:{})
   });
   servers.push(server);a2aUrls[role]=server.baseUrl;
  }
  for(const role of roles){
   const bind=await createTrustedEffectAgentBindingServer({
    ...agentBindingChannels[role],expectedRole:role,
    registry:registries[role],
    ownerStageClient:await connectTrustedOwnerEffectStagingClient(
     stageChannels[role])
   });
   binders.push(bind);await bind.start();
  }
  ownerStartup=await startSdkA2AOwner({stageChannels,agentBindingChannels,
   agentBaseUrls:a2aUrls,a2aPolling:{
    deadlineMs:15000,initialIntervalMs:25,maxIntervalMs:80}});
  assert.equal(ownerStartup.status,'owner_protected_a2a_started_no_provider_execution');
  assert.equal('dispatchIssuedTask' in ownerStartup,false);
  const report=await execution.dispatchEnrolledTask({
   taskId:task.task.task_id,runtimeTaskId:task.runtimeTaskId,
   instruction:'Update only the Engineer-approved file',
   effectStager:nativeStager
  });
  assert.equal(report.status,'a2a_report_not_gateway_completed');
  assert.equal(report.provider_completion_attested,false);
  assert.equal(report.artifact.commit_sha,fileSha);
  assert.deepEqual(report.artifact.files_modified,['apps/user.ts']);
  assert.deepEqual(events,[
   'native_child_fixture','gateway_prepare_canonical',
   'offline_pinned_gitea_read','private_vp_fixture',
   'gateway_execute_fixture']);
  const intents=(await readdir(f.dirs.mutationIntents))
   .filter(n=>n.endsWith('.intent.json'));
  assert.equal(intents.length,1);
  const intent=JSON.parse(await readFile(join(f.dirs.mutationIntents,intents[0]),'utf8'));
  assert.equal(intent.request_id,requestId);
  assert.equal(intent.expected_head_sha,snapshot.base_revision);
  assert.equal(intent.credential_id,staged.credential_id);
  const flights=(await readdir(f.dirs.flights)).filter(n=>n.endsWith('.flight.json'));
  assert.equal(flights.length,1);
  const flight=JSON.parse(await readFile(join(f.dirs.flights,flights[0]),'utf8'));
  assert.equal(flight.session_id,snapshot.session_id);
  assert.equal(flight.task_id,task.task.task_id);
  assert.equal(flight.runtime_task_id,task.runtimeTaskId);
  assert.equal(flight.credential_id,staged.credential_id);
  assert.equal(flight.request_id,requestId);
  assert.equal(gateway.stagedCompletedTaskCount,0);
  assert.equal(model.calls,2);
  for(const secret of [vp,staged.credential_id,requestId,
    'OFFLINE_R3504_FIXTURE'])
   assert.equal(JSON.stringify(model.requests).includes(secret),false);
  await assert.rejects(execution.dispatchEnrolledTask({
   taskId:task.task.task_id,runtimeTaskId:task.runtimeTaskId,
   instruction:'Replay',effectStager:nativeStager
  }),/protected A2A dispatch replayed/);
  if(verified){
   // Share the original Frontend Task pin with the trusted Gateway fixture.
   // Block-scoped shadowing here used to mistake the real Frontend request
   // for the first Backend request, causing an offline-only A2A denial.
   next=stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding(),{
    taskId:'r3512-frontend',epoch:2,childId:'urn:r3512:frontend-child',
    permission:task.task.permissions[0]
   });
   next.runtimeTaskId='dispatch_'+'M'.repeat(22);
   next.childParameters.credential_status.statusListIndex='11';
   const nextModel=new R351ScriptedDecision({
    task_id:next.task.task_id,agent_id:'frontend',
    depends_on:[task.task.task_id],permissions:next.task.permissions,
    instruction:'Frontend after independently attested Backend change'
   });
   await assert.rejects(execution.proposeAndStageTask({
    model:nextModel,runtimeTaskId:next.runtimeTaskId,
    childParameters:next.childParameters
   }),/next ADK Task decision requires independent Gateway completion/);
   assert.equal(nextModel.calls,0);
   const attested=await execution.attestEnrolledTaskCompletion({
    taskId:task.task.task_id,runtimeTaskId:task.runtimeTaskId
   });
   assert.equal(attested.status,'owner_gateway_completion_independently_observed');
   assert.equal(gateway.stagedCompletedTaskCount,1);
   const second=await execution.proposeAndStageTask({
    model:nextModel,runtimeTaskId:next.runtimeTaskId,
    childParameters:next.childParameters
   });
   assert.equal(second.task_id,'r3512-frontend');
   assert.equal(second.agent_id,'frontend');
   assert.equal(second.epoch,2);
   assert.equal(second.decision_source,'owner_adk_candidate_coordinator_validated');
   assert.equal(nextModel.calls,1);
   assert.equal(gateway.registeredTaskCount,2);
   assert.equal(coordinator.registeredTaskCount,2);
   const prompt=JSON.stringify(nextModel.requests);
   assert.ok(prompt.includes('independently_gateway_completed_tasks'));
   assert.equal(prompt.includes(staged.credential_id),false);
   assert.equal(prompt.includes(fileSha),false);
   await assert.rejects(execution.attestEnrolledTaskCompletion({
    taskId:task.task.task_id,runtimeTaskId:task.runtimeTaskId
   }),/no matching original A2A dispatch report/);
   if(throughFrontend){
    // Stage the independently pinned second mutation, using the actual
    // HEAD from the already authenticated Backend Gitea receipt.
    frontendStaged=second;
    const frontendStager=execution.createEnrolledNativeEffectStager({
     runtimeTaskId:next.runtimeTaskId,expectedHeadSha:fileSha
    });
    const frontendReport=await execution.dispatchEnrolledTask({
     taskId:next.task.task_id,runtimeTaskId:next.runtimeTaskId,
     instruction:'Update the Engineer-approved Frontend file',
     effectStager:frontendStager
    });
    assert.equal(frontendReport.status,'a2a_report_not_gateway_completed');
    assert.equal(frontendReport.provider_completion_attested,false);
    assert.equal(frontendReport.role,'frontend');
    assert.equal(frontendReport.artifact.commit_sha,frontendSha);
    assert.deepEqual(frontendReport.artifact.files_modified,['apps/user.ts']);
    assert.equal(frontendModel.calls,2);
    assert.equal(gateway.stagedCompletedTaskCount,1);
    assert.deepEqual(events.slice(-4),[
     'frontend_gateway_prepare_canonical','offline_pinned_gitea_read',
     'frontend_private_vp_fixture','frontend_gateway_execute_fixture'
    ]);
    const testPermission=coordinator.assertTrustedGatewayAuthorityBinding()
     .root_permissions.find(p=>p.operation==='run_tests');
    assert.ok(testPermission,'Test Agent requires separately approved run_tests');
    // The Gateway fixture reads the exact owner-selected Test runtime
    // Task; do not shadow the shared pin with a block-scoped local.
    testTask={
     runtimeTaskId:'dispatch_'+'T'.repeat(22),
     childParameters:{
      credential_id:'urn:r3513:child:test',
      credential_status:{type:'BitstringStatusListEntry',
       statusPurpose:'revocation',statusListCredential:'https://status.invalid/r3513-test',
       statusListIndex:'12'},
      valid_from:new Date().toISOString(),validity_seconds:90
     }
    };
    const testModel=new R351ScriptedDecision({
     task_id:'r3513-test',agent_id:'test',
     depends_on:[task.task.task_id,next.task.task_id],
     permissions:[testPermission],
     instruction:'Run approved tests on fully verified Backend and Frontend effects'
    });
    // An A2A report is NOT a Test prerequisite. The model must not run.
    await assert.rejects(execution.proposeAndStageTask({
     model:testModel,...testTask
    }),/next ADK Task decision requires independent Gateway completion/);
    assert.equal(testModel.calls,0);
    const frontendAttested=await execution.attestEnrolledTaskCompletion({
     taskId:next.task.task_id,runtimeTaskId:next.runtimeTaskId
    });
    assert.equal(frontendAttested.status,'owner_gateway_completion_independently_observed');
    assert.equal(gateway.stagedCompletedTaskCount,2);
    const chosenTest=await execution.proposeAndStageTask({
     model:testModel,...testTask
    });
    assert.equal(chosenTest.task_id,'r3513-test');
    assert.equal(chosenTest.agent_id,'test');
    testStaged=chosenTest;
    assert.equal(chosenTest.epoch,3);
    assert.equal(chosenTest.decision_source,'owner_adk_candidate_coordinator_validated');
    assert.equal(testModel.calls,1);
    assert.equal(coordinator.registeredTaskCount,3);
    assert.equal(gateway.registeredTaskCount,3);
    const taskDecisionPrompt=JSON.stringify(testModel.requests);
    for(const secret of [staged.credential_id,second.credential_id,
     requestId,frontendRequestId,fileSha,frontendSha,frontendVp])
     assert.equal(taskDecisionPrompt.includes(secret),false);
    assert.ok(taskDecisionPrompt.includes('independently_gateway_completed_tasks'));
    if(throughTest){
     const testStager=execution.createEnrolledNativeEffectStager({
      runtimeTaskId:testTask.runtimeTaskId,expectedHeadSha:frontendSha
     });
     const dispatchTest=()=>execution.dispatchEnrolledTask({
      taskId:'r3513-test',runtimeTaskId:testTask.runtimeTaskId,
      instruction:'Run pinned Test on independently verified Backend/Frontend',
      effectStager:testStager,
      ...(throughFailure?{d1Candidate:{
       role:'backend',permissions:task.task.permissions
      }}:{})
     });
     if(noFailureReceipt){
      await assert.rejects(dispatchTest(),
       /ENOENT|no such file|Runner FAIL|failure/);
      assert.equal(host.phase,'revoked');
      assert.equal(gateway.stagedCompletedTaskCount,2);
      assert.equal(coordinator.registeredTaskCount,3);
      await assert.rejects(execution.proposeVerifiedD1RepairTask({
       model:new R351ScriptedDecision({
        task_id:'forged-d1',agent_id:'backend',depends_on:[],
        permissions:task.task.permissions,instruction:'Unverified retry'
       })
      }),/requires authenticated original Runner failure/);
      return;
     }
     const testReport=await dispatchTest();
     if(throughFailure){
      assert.equal(testReport.status,'owner_verified_native_test_failure_preflight_only');
      assert.equal(testReport.failed_phase,'typecheck');
      assert.equal(testReport.gateway_task_completed,false);
      assert.equal(testReport.recovery_authorized,false);
      assert.equal(testReport.child_credential_issued,false);
      assert.equal(testReport.task_registered,false);
      assert.equal(gateway.stagedCompletedTaskCount,2);
      assert.equal(coordinator.registeredTaskCount,3);
      assert.equal(testAgentModel.calls,2);
      assert.equal((await readdir(f.dirs.runnerEvidence))
       .filter(n=>n.endsWith('.runner-fail.json')).length,1);
      const candidate=new R351ScriptedDecision({
       task_id:'r3521-proposed-repair',
       agent_id:foreignD1Model?'frontend':'backend',
       depends_on:[task.task.task_id,next.task.task_id],
       permissions:task.task.permissions,
       instruction:'Repair the verified TypeScript typecheck failure under the signed file scope'
      });
      if(foreignD1Model){
       await assert.rejects(execution.proposeVerifiedD1RepairTask({
        model:candidate
       }),/model D1 candidate not identical/);
       assert.equal(candidate.calls,1);
       assert.equal(coordinator.registeredTaskCount,3);
       assert.equal(gateway.stagedCompletedTaskCount,2);
       assert.equal(host.phase,'operational');
       await assert.rejects(execution.proposeVerifiedD1RepairTask({
        model:new R351ScriptedDecision(candidate.candidate)
       }),/requires authenticated original Runner failure/);
       return;
      }
      const suggestion=await execution.proposeVerifiedD1RepairTask({model:candidate});
      assert.equal(suggestion.status,'d1_model_candidate_not_recovery_authorized');
      if(mode==='failure'||d1Effect){
       const journal=new DurableNativeD1FirstTaskAdmissionJournal(
        f.dirs.d1Admissions);
       // Only the private Engineer owner supplies a new revocable status
       // allocation. Neither A2A nor ADK can select the native Child.
       const newD1=await execution.admitVerifiedD1RepairTask({
        journal,freshStatusEntry:{
         statusListCredential:'https://status.invalid/list',
         statusListIndex:'29110'
        }
       });
       nativeD1=newD1;
       assert.equal(newD1.status,'native_d1_child_enrolled_no_provider_effect');
       assert.equal(newD1.task_registered,true);
       assert.equal(newD1.gateway_child_enrolled,true);
       assert.equal(newD1.native_child_issued,true);
       assert.equal(newD1.epoch,4);
       assert.equal(newD1.failed_test_task_id,'r3513-test');
       assert.equal(newD1.agent_id,undefined);
       assert.equal(newD1.provider_executed,false);
       assert.equal(newD1.recovery_completed,false);
       assert.equal(newD1.gateway_execution_authorized,false);
       assert.equal(newD1.decision_source,'verified_d1_model_original_coordinator');
       assert.equal(newD1.instruction,candidate.candidate.instruction);
       const d1Stager=execution.createEnrolledNativeEffectStager({
        runtimeTaskId:newD1.runtime_task_id,expectedHeadSha:frontendSha
       });
       assert.equal(d1Stager.isForOwnerTask(
        gateway,newD1.runtime_task_id,'update_file'),true);
       // The caller cannot rewrite a signed-scope D1 task as arbitrary text.
       // Rejected dispatches must NOT consume the original one-use stager.
       for(const forgedInstruction of ['Unapproved D1 instruction',
        newD1.instruction+'\nDo something else']){
        await assert.rejects(execution.dispatchEnrolledTask({
         taskId:newD1.task_id,runtimeTaskId:newD1.runtime_task_id,
         instruction:forgedInstruction,effectStager:d1Stager
        }),/D1 dispatch requires original owner-pinned repair instruction/);
       }
       await assert.rejects(execution.attestEnrolledTaskCompletion({
        taskId:newD1.task_id,runtimeTaskId:newD1.runtime_task_id
       }),/no matching original A2A dispatch report/);
       assert.equal(coordinator.registeredTaskCount,4);
       assert.equal(gateway.registeredTaskCount,4);
       assert.equal(gateway.stagedCompletedTaskCount,2);
       const repair=coordinator.assertTrustedGatewayRegisteredTask(
        newD1.task_id);
       assert.equal(repair.agent_id,'backend');
       assert.deepEqual(repair.permissions,task.task.permissions);
       assert.deepEqual(repair.depends_on,
        [task.task.task_id,next.task.task_id]);
       const original=coordinator.assertTrustedGatewayAuthorityBinding();
       assert.equal(newD1.original_root_credential_id,
        original.root_credential_id);
       assert.equal((await readdir(f.dirs.d1Admissions)).length,1);
       if(d1Effect){
        const repairReport=await execution.dispatchEnrolledTask({
         taskId:newD1.task_id,runtimeTaskId:newD1.runtime_task_id,
         instruction:newD1.instruction,effectStager:d1Stager
        });
        assert.equal(repairReport.status,'a2a_report_not_gateway_completed');
        assert.equal(repairReport.role,'backend');
        assert.equal(repairReport.provider_completion_attested,false);
        assert.equal(repairReport.artifact.commit_sha,repairSha);
        assert.deepEqual(repairReport.artifact.files_modified,['apps/user.ts']);
        assert.equal(gateway.stagedCompletedTaskCount,2);
        assert.equal(model.calls,4);
        const repaired=await execution.attestEnrolledTaskCompletion({
         taskId:newD1.task_id,runtimeTaskId:newD1.runtime_task_id
        });
        assert.equal(repaired.status,'owner_gateway_completion_independently_observed');
        assert.equal(repaired.task_id,newD1.task_id);
        assert.equal(gateway.stagedCompletedTaskCount,3);
        assert.equal(provider.head,repairSha);
        assert.equal(provider.parent,frontendSha);
        assert.equal(provider.content,repairContent);
        assert.equal(events.at(-1),'d1_gateway_execute_fixture');
        await assert.rejects(execution.dispatchEnrolledTask({
         taskId:newD1.task_id,runtimeTaskId:newD1.runtime_task_id,
         instruction:newD1.instruction,effectStager:d1Stager
        }),/protected A2A dispatch replayed/);
        await assert.rejects(execution.attestEnrolledTaskCompletion({
         taskId:newD1.task_id,runtimeTaskId:newD1.runtime_task_id
        }),/no matching original A2A dispatch report/);
       }
       await assert.rejects(execution.admitVerifiedD1RepairTask({
        journal,freshStatusEntry:{
         statusListCredential:'https://status.invalid/list',
         statusListIndex:'29111'
        }
       }),/requires one original verified proposal/);
       await assert.rejects(execution.proposeAndStageTask({
        model:new R351ScriptedDecision(candidate.candidate),
        runtimeTaskId:'dispatch_'+'R'.repeat(22),
        childParameters:testTask.childParameters
       }),/next ADK Task decision requires independent Gateway completion/);
      }
      assert.equal(suggestion.failed_phase,'typecheck');
      assert.equal(suggestion.recovery_authorized,false);
      assert.equal(suggestion.task_registered,false);
      assert.equal(suggestion.gateway_task_completed,false);
      assert.equal(suggestion.child_credential_issued,false);
      assert.equal(candidate.calls,1);
      assert.equal(coordinator.registeredTaskCount,
       mode==='failure'||d1Effect?4:3);
      assert.equal(gateway.registeredTaskCount,
       mode==='failure'||d1Effect?4:3);
      assert.equal(gateway.stagedCompletedTaskCount,d1Effect?3:2);
      const prompt=JSON.stringify(candidate.requests);
      assert.ok(prompt.includes('independent_runner_failure'));
      for(const secret of [testVp,testStaged.credential_id,testRequestId])
       assert.equal(prompt.includes(secret),false);
      await assert.rejects(execution.proposeVerifiedD1RepairTask({
       model:new R351ScriptedDecision(candidate.candidate)
      }),/requires authenticated original Runner failure/);
      await assert.rejects(execution.proposeAndStageTask({
       model:new R351ScriptedDecision(candidate.candidate),
       runtimeTaskId:'dispatch_'+'R'.repeat(22),
       childParameters:testTask.childParameters
      }),/next ADK Task decision requires independent Gateway completion/);
      assert.equal(host.phase,'operational');
     }else{
     assert.equal(testReport.status,'a2a_report_not_gateway_completed');
     assert.equal(testReport.provider_completion_attested,false);
     assert.equal(testReport.role,'test');
     assert.equal(testReport.artifact.test_outcome,'pass');
     assert.equal(testReport.artifact.commit_sha,frontendSha);
     // An A2A PASS is UNTRUSTED. The owner intentionally redacts Runner
     // outcome fields until original Gateway attestation succeeds.
     assert.equal(testReport.artifact.tested_commit_sha,undefined);
     assert.equal(testReport.artifact.project_tests,undefined);
     assert.equal(testReport.artifact.researcher_acceptance,undefined);
     assert.equal(testAgentModel.calls,2);
     assert.equal(gateway.stagedCompletedTaskCount,2);
     const pending=(await readdir(f.dirs.runnerIntents))
      .filter(n=>n.endsWith('.intent.json'));
     const attempts=(await readdir(f.dirs.runnerIntents))
      .filter(n=>n.endsWith('.attempt.json'));
     const confirmed=(await readdir(f.dirs.runnerIntents))
      .filter(n=>n.endsWith('.completed.json'));
     assert.equal(pending.length,1);
     assert.equal(attempts.length,1);
     assert.equal(confirmed.length,1);
     assert.equal((await readdir(f.dirs.runnerEvidence))
      .filter(n=>n.endsWith('.runner.json')).length,1);
     const attestedTest=await execution.attestEnrolledTaskCompletion({
      taskId:'r3513-test',runtimeTaskId:testTask.runtimeTaskId
     });
     assert.equal(attestedTest.status,'owner_gateway_completion_independently_observed');
     assert.equal(gateway.stagedCompletedTaskCount,3);
     await assert.rejects(execution.dispatchEnrolledTask({
      taskId:'r3513-test',runtimeTaskId:testTask.runtimeTaskId,
      instruction:'Replay Docker',effectStager:testStager
     }),/protected A2A dispatch replayed/);
     await assert.rejects(execution.attestEnrolledTaskCompletion({
      taskId:'r3513-test',runtimeTaskId:testTask.runtimeTaskId
     }),/no matching original A2A dispatch report/);
     const prompt=JSON.stringify(testAgentModel.requests);
     for(const secret of [testVp,testStaged.credential_id,testRequestId])
      assert.equal(prompt.includes(secret),false);
     }
    }
    assert.equal(host.phase,'operational');
   }
   assert.equal(host.phase,'operational');
  }else{
   await assert.rejects(execution.attestEnrolledTaskCompletion({
    taskId:task.task.task_id,runtimeTaskId:task.runtimeTaskId
   }),/trusted completion observer or owner-private journal missing/);
   assert.equal(gateway.stagedCompletedTaskCount,0);
   assert.equal(host.phase,'revoked');
  }
  await host.close();
 }finally{
  await Promise.allSettled(binders.reverse().map(x=>x.close()));
  await Promise.allSettled(servers.reverse().map(x=>x.close()));
  await rm(temp,{recursive:true,force:true});
  if(host.phase==='operational')await host.close();
 }
});


test('R352.0 original owner refuses Test D1 failure claims without an original A2A dispatch',async t=>{
 const f=await fixture(t,{includeTestPermission:true}),host=await f.start();
 await f.approve(['permission-1','permission-2','permission-3']);
 const {coordinator}=await host.activateOperational(root('urn:r3520:preflight-root',2));
 const deps=executionDeps(f);let signed=0;
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(req){
  signed++;
  return {id:req.credential_id,validFrom:req.valid_from,
   credentialSubject:{sub:'did:thesis:test',per:structuredClone(req.permissions)},
   credentialStatus:structuredClone(req.credential_status)};
 }};
 const execution=await host.admitOperationalExecution(deps);
 const rootBinding=coordinator.assertTrustedGatewayAuthorityBinding();
 const runPermission=rootBinding.root_permissions.find(p=>p.operation==='run_tests');
 assert.ok(runPermission);
 const taskId='r3520-unexecuted-test',runtimeTaskId='dispatch_'+'T'.repeat(22);
 await execution.stageTask({
  task:{task_id:taskId,epoch:1,agent_id:'test',depends_on:[],
   permissions:[runPermission]},
  runtimeTaskId,childParameters:root('urn:r3520:unexecuted-child',3,90)
 });
 assert.equal(signed,1);
 assert.equal(execution.gateway.registeredTaskCount,1);
 assert.equal(execution.gateway.stagedCompletedTaskCount,0);
 // Even a privileged caller cannot introduce fake Failure, Task or
 // model proposal without both the ORIGINAL A2A dispatch and real
 // authenticated Runner FAIL evidence.
 const fake={task_id:taskId,runtime_task_id:runtimeTaskId};
 await assert.rejects(execution.preflightNativeD1Repair({
  failureObserver:{},failedRunnerIntent:fake,
  candidate:{role:'backend',permissions:[runPermission]}
 }),/native D1 preflight needs one quiescent original Engineer owner/);
 assert.equal(host.phase,'operational');
 assert.equal(coordinator.registeredTaskCount,1);
 assert.equal(execution.gateway.stagedCompletedTaskCount,0);
 await host.close();
 assert.equal(host.phase,'revoked');
});

test('R350.6 never binds a foreign preflight to the same-session Gateway',async t=>{
 const f=await fixture(t),host=await f.start();
 await f.approve(['permission-1','permission-2']);
 await host.activateOperational(root('urn:r350:wrong-preflight',2));
 const execution=await host.admitOperationalExecution(executionDeps(f));
 const foreign={
  store:new InMemoryRequestStore(),
  mutation:Object.assign(Object.create(TrustedAuthorityOnlyGiteaMutationPreflight.prototype),{
   isForAdmissions:()=>true
  }),
  runner:Object.assign(Object.create(TrustedAuthorityOnlyRunnerPreflight.prototype),{
   isForAdmissions:()=>true
  })
 };
 assert.throws(()=>execution.bindNativeGatewayEffects(foreign),
  /not from original session/);
 assert.throws(()=>execution.bindNativeGatewayEffects(foreign),
  /active quiescent owner/);
 await host.close();
 assert.equal(host.phase,'revoked');
});

test('R350.8 original Engineer session creates real canonical Gateway Prepare and crash-durable Task flight',async t=>{
 const f=await fixture(t),host=await f.start();
 await f.approve(['permission-1','permission-2']);
 const {coordinator}=await host.activateOperational(root('urn:r3508:operational',2));
 const deps=executionDeps(f);
 const nativeCalls=[];
 deps.effectFenceJournal=new DurableAuthorityOnlyTaskFenceJournal(f.dirs.flights);
 deps.nativeCryptoPort={kind:'rust-native',async issueChild(req){
  nativeCalls.push('native_child_fixture');
  return {id:req.credential_id,validFrom:req.valid_from,
   credentialSubject:{sub:'did:thesis:backend',per:structuredClone(req.permissions)},
   credentialStatus:structuredClone(req.credential_status)};
 }};
 const execution=await host.admitOperationalExecution(deps);
 const task=stagedBackend(coordinator.assertTrustedGatewayAuthorityBinding());
 await execution.stageTask(task);
 assert.equal(nativeCalls.length,1);
 const {gateway}=execution;
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 const config={audience:'cloud-access-gateway',request_ttl_ms:60000,
  repository:snapshot.repository};
 const raw={task_id:task.runtimeTaskId,agent_role:'backend',tool:'update_file',
  arguments:{branch:'feature/account-suspension',path:'apps/user.ts',
   content:'export const suspended=true;'}};
 const prep={store,audit,authorityOnlyAdmissions:gateway,
  requestId:()=> 'req_r3508_trusted',challenge:()=> 'trusted-r3508-challenge'};
 assert.throws(()=>prepareAuthorization({...raw,
  arguments:{...raw.arguments,path:'apps/foreign.ts'}},config,prep),
  /request operation or resource not in exact signed Task grant/);
 assert.equal(store.size(),0);
 const prepared=prepareAuthorization(raw,config,prep);
 assert.equal(prepared.request_id,'req_r3508_trusted');
 assert.equal(prepared.required_permission.operation,'update_file');
 assert.equal(store.size(),1);
 const record=store.get(prepared.request_id);
 assert.equal(record.authority_only_plan_task_id,task.task.task_id);
 assert.equal(record.authority_only_agent_did,'did:thesis:backend');
 const {mutation:nativeMutation,runner:nativeRunner,gitea}=
  nativeOfflinePreflights(gateway,f.dirs,nativeCalls);
 assert.equal(execution.bindNativeGatewayEffects({
  store,mutation:nativeMutation,runner:nativeRunner,giteaClient:gitea}).gateway_execution_authorized,false);
 const stager=execution.createEnrolledNativeEffectStager({
  runtimeTaskId:task.runtimeTaskId,expectedHeadSha:snapshot.base_revision
 });
 const staged=await stager.stage(prepared.request_id);
 assert.equal(staged.provider_write_authorized,false);
 assert.equal(staged.status,'gitea_update_intent_reserved_without_execution');
 assert.deepEqual(nativeCalls,['native_child_fixture','offline_pinned_gitea_read']);
 assert.equal((await readdir(f.dirs.mutationIntents))
  .filter(n=>n.endsWith('.intent.json')).length,1);
 const files=(await readdir(f.dirs.flights)).filter(n=>n.endsWith('.flight.json'));
 assert.equal(files.length,1);
 const durable=JSON.parse(await readFile(join(f.dirs.flights,files[0]),'utf8'));
 assert.equal(durable.session_id,snapshot.session_id);
 assert.equal(durable.task_id,task.task.task_id);
 assert.equal(durable.runtime_task_id,task.runtimeTaskId);
 assert.equal(durable.root_credential_id,'urn:r3508:operational');
 assert.equal(durable.credential_id,task.childParameters.credential_id);
 assert.equal(durable.request_id,prepared.request_id);
 assert.equal(durable.kind,'flight');
 assert.equal(gateway.stagedCompletedTaskCount,0);
 await assert.rejects(gateway.attestTrustedTaskCompletion(
  task.task.task_id,task.runtimeTaskId),
  /trusted completion observer or owner-private journal missing/);
 await assert.rejects(stager.stage(prepared.request_id),/already attempted/);
 assert.equal((await readdir(f.dirs.flights)).filter(n=>n.endsWith('.completion.json')).length,0);
 await host.close();
 assert.equal(host.phase,'revoked');
 assert.equal(f.log.at(-1),'revoke:urn:r3508:operational');
});

test('R350.10 prototype-spoofed native preflights cannot bind the original Gateway',async t=>{
 const f=await fixture(t),host=await f.start();await f.approve(['permission-1','permission-2']);
 await host.activateOperational(root('urn:r35010:brand',2));
 const execution=await host.admitOperationalExecution(executionDeps(f));
 const fakeMutation=Object.assign(Object.create(TrustedAuthorityOnlyGiteaMutationPreflight.prototype),{
  isForAdmissions:()=>true,stageUpdate:async()=>({provider_write_authorized:false})
 });
 const fakeRunner=Object.assign(Object.create(TrustedAuthorityOnlyRunnerPreflight.prototype),{
  isForAdmissions:()=>true,stageRunner:async()=>({runner_execution_authorized:false})
 });
 assert.equal(TrustedAuthorityOnlyGiteaMutationPreflight.isNativeForAdmissions(
  fakeMutation,execution.gateway),false);
 assert.equal(TrustedAuthorityOnlyRunnerPreflight.isNativeForAdmissions(
  fakeRunner,execution.gateway),false);
 assert.throws(()=>execution.bindNativeGatewayEffects({
  store:new InMemoryRequestStore(),mutation:fakeMutation,runner:fakeRunner
 }),/not from original session/);
 await host.close();
 assert.equal(host.phase,'revoked');
});

test('R350.11 retired operational root must have both Gateway terminal fence and native revocation',async t=>{
 const f=await fixture(t),host=await f.start();await f.approve();
 const rootId='urn:r35011:retired';
 await host.activateOperational(root(rootId,2));
 const pending=await f.options.operationalRecoveryStore.pending();
 assert.equal(pending.length,1);
 assert.equal(pending[0].credential_id,rootId);
 await host.close();
 assert.equal(host.phase,'revoked');
 await f.options.operationalRecoveryStore.retiredForSession(
  snapshot.session_id,snapshot.base_revision,rootId);
 await assert.rejects(f.options.operationalSessionStore.reserveActivation(
  snapshot.session_id),/already used or retired/);
 assert.equal((await f.options.operationalRecoveryStore.pending()).length,0);
 assert.equal(f.log.filter(x=>x==='issue:'+rootId).length,1);
 assert.equal(f.log.at(-1),'revoke:'+rootId);
});
test('R350.11 orphan root blocks Planning before a model call and operator-only reconciliation never reissues',async t=>{
 const f=await fixture(t);
 const rootId='urn:r35011:orphan';
 await f.options.operationalRecoveryStore.recordIntent({
  sessionId:snapshot.session_id,baseRevision:snapshot.base_revision,credentialId:rootId
 });
 await assert.rejects(f.start(),/orphaned root intent/);
 assert.deepEqual(f.log,[]);assert.equal(f.model.calls,0);
 const trace=[];
 const n=await reconcileTrustedAuthorityOnlyReviewRoots({
  operationalRecoveryStore:f.options.operationalRecoveryStore,
  operationalSessionStore:f.options.operationalSessionStore,
  credentials:{async revokeRoot(id){trace.push('rust:'+id);}}
 });
 assert.equal(n,1);assert.deepEqual(trace,['rust:'+rootId]);
 await f.options.operationalRecoveryStore.retiredForSession(
  snapshot.session_id,snapshot.base_revision,rootId);
 await assert.rejects(f.start(),/reconciled session cannot be reused/);
 assert.equal(f.model.calls,0);
 await assert.rejects(f.options.operationalSessionStore.reserveActivation(
  snapshot.session_id),/already used or retired/);
});
test('R350.11 failed native revocation leaves pending intent until confirmed operator recovery',async t=>{
 const flags={failRevoke:false},f=await fixture(t,flags);
 const host=await f.start();await f.approve();
 await host.activateOperational(root('urn:r35011:failed-revoke',2));
 flags.failRevoke=true;
 await assert.rejects(host.close(),/Rust unavailable/);
 assert.equal(host.phase,'failed_closed');
 assert.equal((await f.options.operationalRecoveryStore.pending()).length,1);
 await assert.rejects(reconcileTrustedAuthorityOnlyReviewRoots({
  operationalRecoveryStore:f.options.operationalRecoveryStore,
  operationalSessionStore:f.options.operationalSessionStore,
  credentials:{async revokeRoot(){throw Error('still unavailable');}}
 }),/manual reconciliation required/);
 assert.equal((await f.options.operationalRecoveryStore.pending()).length,1);
 flags.failRevoke=false;
 assert.equal(await reconcileTrustedAuthorityOnlyReviewRoots({
  operationalRecoveryStore:f.options.operationalRecoveryStore,
  operationalSessionStore:f.options.operationalSessionStore,
  credentials:f.options.credentials
 }),1);
 assert.equal((await f.options.operationalRecoveryStore.pending()).length,0);
});

test('R350.12 exact original Gitea instance and branch are required by both native preflights',async t=>{
 const f=await fixture(t),host=await f.start();
 await f.approve(['permission-1','permission-2']);
 await host.activateOperational(root('urn:r35012:provider',2));
 const execution=await host.admitOperationalExecution(executionDeps(f));
 const original=nativeOfflinePreflights(execution.gateway,f.dirs);
 const other=new GiteaClient({
  baseUrl:'http://foreign.invalid',token:'private-fixture-only',
  owner:snapshot.repository.owner,repository:snapshot.repository.repository
 });
 const wrongRepo=new GiteaClient({
  baseUrl:'http://foreign.invalid',token:'private-fixture-only',
  owner:'different',repository:snapshot.repository.repository
 });
 assert.equal(GiteaClient.isPinnedRepositoryClient(
  original.gitea,snapshot.repository.owner,snapshot.repository.repository),true);
 assert.equal(GiteaClient.isPinnedRepositoryClient(
  wrongRepo,snapshot.repository.owner,snapshot.repository.repository),false);
 assert.equal(TrustedAuthorityOnlyGiteaMutationPreflight.isNativeForOwner(
  original.mutation,execution.gateway,original.gitea,
  'thesis/iam-console-poc',branch),true);
 assert.equal(TrustedAuthorityOnlyRunnerPreflight.isNativeForOwner(
  original.runner,execution.gateway,original.gitea,
  'thesis/iam-console-poc',branch),true);
 assert.equal(TrustedAuthorityOnlyGiteaMutationPreflight.isNativeForOwner(
  original.mutation,execution.gateway,other,'thesis/iam-console-poc',branch),false);
 assert.equal(TrustedAuthorityOnlyRunnerPreflight.isNativeForOwner(
  original.runner,execution.gateway,other,'thesis/iam-console-poc',branch),false);
 assert.equal(TrustedAuthorityOnlyRunnerPreflight.isNativeForOwner(
  original.runner,execution.gateway,original.gitea,
  'thesis/iam-console-poc','feature/other'),false);
 // A matching repository string on ANOTHER native client is not sufficient.
 assert.throws(()=>execution.bindNativeGatewayEffects({
  store:new InMemoryRequestStore(),mutation:original.mutation,
  runner:original.runner,giteaClient:other
 }),/not from original session/);
 assert.throws(()=>execution.bindNativeGatewayEffects({
  store:new InMemoryRequestStore(),mutation:original.mutation,
  runner:original.runner,giteaClient:original.gitea
 }),/active quiescent owner/);
 await host.close();
 assert.equal(host.phase,'revoked');
});
test('R350.13 feature snapshot allows only pinned feature read and rejects main or changed provider branch',async()=>{
 const feature={...snapshot,planning_branch:branch};
 const source='apps/user.ts',rootId='urn:r35013:preliminary-read';
 let transportCalls=0,wrongProviderBranch=false;
 const session=new TrustedAuthorityOnlyEngineerSession({
  snapshot:feature,requirement,
  authenticatedEngineerDid:did,
  credentials:{
   async issueScopedOrchestratorRoot(request){
    assert.equal(request.credential_id,rootId);
    const featurePermissions=preliminaryReadPermissions(feature);
    assert.deepEqual(request.permissions,featurePermissions);
    assert.equal(featurePermissions.some(p=>p.resource.includes('/branches/main/')),false);
    return {id:rootId,credentialSubject:{per:structuredClone(request.permissions)}};
   },
   async revokeRoot(id){assert.equal(id,rootId);}
  },
  approvals:{async loadAuthenticatedAuthority(){throw Error('never approve');}},
  journal:{async reservePlanning(){},async reserveOperational(){}},
  planningRevisions:{
   async begin(id){return {task_id:id,base_revision:feature.base_revision,
    expires_at:new Date(Date.now()+600000).toISOString()};},
   async end(){}
  }
 });
 await session.startPlanning(root(rootId,1));
 const client=new TrustedPlanningGatewayReadPort({
  coordinator:session,snapshot:feature,
  gatewayBaseUrl:'http://r35013-feature-planning.invalid',
  adapterBaseUrl:'http://r35013-private-crypto.invalid',
  adapterToken:'private-offline-no-billing',
  fetchFn:async(url,init)=>{
   transportCalls++;
   const route=String(url),request=JSON.parse(String(init.body));
   if(route.endsWith('/prepare')){
    assert.equal(request.tool,'read_file');
    assert.deepEqual(request.arguments,{branch,path:source});
    return Response.json({request_id:'r35013-feature-read',audience:'gateway',
     challenge:'read-challenge',required_permission:
      preliminaryReadPermissions(feature).find(p=>p.operation==='read_file')});
   }
   if(route.endsWith('/v1/presentations')){
    assert.equal(request.credential_id,rootId);
    return Response.json({signed_vp:'offline-read-only'});
   }
   if(route.endsWith('/execute')){
    return Response.json({execution:{
     provider:'gitea',performed:true,tool:'read_file',
     branch:wrongProviderBranch?'main':branch,
     path:source,revision:feature.base_revision,
     content:'export const approved = false;'
    }});
   }
   throw Error('untrusted transport path');
  }
 });
 await assert.rejects(client.invoke('read_file',{branch:'main',path:source}),
  /inactive or out-of-scope read/);
 assert.equal(transportCalls,0);
 const result=await client.invoke('read_file',{branch,path:source});
 assert.equal(result.branch,branch);
 assert.equal(result.revision,snapshot.base_revision);
 assert.equal(transportCalls,3);
 wrongProviderBranch=true;
 await assert.rejects(client.invoke('read_file',{branch,path:source}),
  /inactive or out-of-scope read/);
 assert.equal(transportCalls,6);
 await session.cancelPlanning();
 await assert.rejects(client.invoke('read_file',{branch,path:source}),
  /inactive or expired/);
 assert.equal(transportCalls,6);
});

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
test('R350.13 feature Planning source must match the original reviewed work branch',async t=>{
 const f=await fixture(t);
 await assert.rejects(createHost({...f.options,
  snapshot:{...snapshot,planning_branch:'feature/unrelated'}}),
  /Planning source branch differs from Engineer-reviewed work branch/);
 assert.deepEqual(f.log,[]);
 assert.equal(f.model.calls,0);
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
