/** Free native branch proof from unchanged unsolved main. Preliminary Gateway
 * protocol and ADK decisions are scripted; operational Rust/EVM/OPA/Gitea are real. */
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,scryptSync} from 'node:crypto';
import {createServer} from 'node:net';
import {startSpecializedAgentServer,TrustedEffectStagingTaskRegistry,
 createTrustedEffectAgentBindingServer,connectTrustedOwnerEffectStagingClient}
 from '../../agent-runtime/src/index.ts';
import {TrustedAuthorityOnlyCompletionObserver}
 from '../src/trusted-authority-only-completion-observer.ts';
import {mkdtemp,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BaseLlm} from '@google/adk';
import {startTrustedAuthorityOnlyReviewHost} from '../../../apps/orchestrator/src/trusted-authority-only-review-host.mjs';
import {createTrustedEngineerCredentialPort} from '../src/trusted-engineer-crypto-port.ts';
import {createNativeRustChildCryptographyPort} from '../src/trusted-child-crypto-port.ts';
import {invokeNativeCrypto} from '../../agent-runtime/src/native-crypto-ipc.ts';
import {DurableAuthorityOnlyActivationJournal} from '../src/authority-only-activation-journal.ts';
import {DurableAuthorityTaskJournal} from '../src/trusted-authority-task-journal.ts';
import {DurableAuthorityOnlyChildJournal} from '../src/trusted-authority-only-child-journal.ts';
import {DurableAuthorityOnlyTaskFenceJournal} from '../src/trusted-authority-only-task-fence-journal.ts';
import {AuthorityPlanningCheckpointStore} from '../src/trusted-authority-planning-checkpoint.ts';
import {TrustedOperationalRecoveryStore} from '../src/trusted-operational-recovery-store.ts';
import {preliminaryReadPermissions} from '../src/trusted-engineer-authority.ts';
import {TrustedOperationalSessionStore} from '../../../apps/gateway/src/trusted-operational-session-store.ts';
import {TrustedAuthorityOnlyBranchExecutor} from '../../../apps/gateway/src/trusted-authority-only-branch-executor.ts';
import {GiteaClient} from '../../../apps/gateway/src/gitea-client.ts';
import {GatewayRuntime} from '../../../apps/gateway/src/runtime.ts';
import {createGatewayHttpServer} from '../../../apps/gateway/src/http.ts';
import {loadDirectCoreRustVerifier} from '../../../apps/gateway/src/direct-core-loader.ts';
import {InMemoryRequestStore,InMemoryAuditSink} from '../../../apps/gateway/src/prepare.ts';
import {TrustedAuthorityOnlyGiteaMutationExecutor}
 from '../../../apps/gateway/src/trusted-authority-only-mutation-executor.ts';
import {TrustedGatewayGiteaMutationEvidencePublisher,
 AuthenticatedGiteaMutationCompletionObserver}
 from '../../../apps/gateway/src/trusted-authority-only-gitea-mutation-evidence.ts';
import {ACCOUNT_SUSPENSION_REFERENCE_FILES}
 from '../../../apps/test-runner-controller/fixtures/account-suspension-reference.mjs';
import {ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES}
 from '../../../apps/test-runner-controller/fixtures/account-suspension-unsolved-baseline.mjs';
import {TrustedAuthorityOnlyGiteaMutationPreflight} from '../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts';
import {TrustedAuthorityOnlyRunnerPreflight} from '../../../apps/gateway/src/trusted-authority-only-runner-preflight.ts';
import {DurableAuthorityOnlyGiteaMutationIntentJournal} from '../../../apps/gateway/src/trusted-authority-only-mutation-intent-journal.ts';
import {DurableAuthorityOnlyRunnerIntentJournal} from '../../../apps/gateway/src/trusted-authority-only-runner-intent-journal.ts';
import {ProviderNotFoundError} from '../../../apps/gateway/src/errors.ts';
import {ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT} from '../../../apps/test-runner-controller/fixtures/account-suspension-unsolved-baseline.mjs';
for(const name of ['R233_NATIVE_EVM','ENGINEER_CORE_NATIVE_MODE'])assert.equal(process.env[name],'1');
assert.equal(process.env.ADAPTER_TRUST_PROFILE,'evm');
assert.equal(process.env.GATEWAY_VERIFIER_MODE,'core-rust');
assert.equal(process.env.GEMINI_API_KEY,undefined);assert.equal(process.env.OPENAI_API_KEY,undefined);
const repo={authority:'gitea.local',owner:'thesis',repository:'iam-console-poc'};
assert.equal(process.env.GITEA_OWNER,repo.owner);assert.equal(process.env.GITEA_REPOSITORY,repo.repository);
const branch='feature/account-suspension',sourcePath='apps/backend/src/users/user.service.ts';
const nativeBackendA2A=process.env.R3572_NATIVE_BACKEND_A2A==='1';
const nativeBackendCas=process.env.R3571_NATIVE_BACKEND_CAS==='1'||nativeBackendA2A;
const nativeBranchToBackend=process.env.R357_NATIVE_BRANCH_TO_BACKEND==='1'||nativeBackendCas;
const scopedDir='gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/directories/apps/backend/src/users';
const scopedFile='gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/'+sourcePath;
const backendTaskId='r357-backend-after-branch',backendRuntimeTaskId='dispatch_'+'B'.repeat(22);
const branchTaskId='r354-create-approved-branch';
const requirement='Create the approved Account Suspension feature branch from the reviewed unsolved main baseline';
const sessionId='r354-native-reviewed-branch',runtimeTaskId='dispatch_'+'C'.repeat(22);
const engineerDid=process.env.ADAPTER_ID_ENGINEER,orchestratorDid=process.env.ADAPTER_ID_ORCHESTRATOR;
for(const value of [engineerDid,orchestratorDid])assert.match(value??'',/^did:/u);
let branchPosts=0,otherWrites=0,independentReads=0;
const client=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_GATEWAY_TOKEN,owner:repo.owner,repository:repo.repository,
 fetchFn:async(url,init)=>{
  if(init?.method==='POST'&&new URL(String(url)).pathname.endsWith('/branches'))branchPosts++;
  else if(init?.method&&init.method!=='GET')otherWrites++;
  return fetch(url,init);
 }});
const reader=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_RUNNER_TOKEN,owner:repo.owner,repository:repo.repository,
 fetchFn:async(url,init)=>{assert.equal(init?.method??'GET','GET');independentReads++;return fetch(url,init);}});
assert.ok(process.env.GITEA_RUNNER_TOKEN);
const baseRevision=(await client.getBranchMetadata('main')).commit_sha;
assert.equal(baseRevision,ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT);
await assert.rejects(client.getBranchMetadata(branch),e=>e instanceof ProviderNotFoundError);
const snapshot={session_id:sessionId,repository:repo,base_revision:baseRevision,
 directories:['','apps','apps/backend','apps/backend/src','apps/backend/src/users'],files:[sourcePath]};
class Planner extends BaseLlm{
 calls=0;
 constructor(){super({model:'r354-scripted-native-planner-no-paid-ai'});}
 async *generateContentAsync(){
  this.calls++;
  yield {content:{role:'model',parts:this.calls===1?[{functionCall:{id:'read-main',name:'read_file',
   args:{branch:'main',path:sourcePath}}}]:[{text:JSON.stringify({requested_permissions:[
    {operation:'create_branch',resource_type:'repository',path:null},
    ...(nativeBranchToBackend?[{operation:'update_file',resource_type:'directory',
     path:'apps/backend/src/users'}]:[])],assumptions:[],uncertainties:[]})}]}};
 }
 connect(){throw Error('Paid inference forbidden');}
}
class Decision extends BaseLlm{
 calls=0;
 constructor(){super({model:'r354-scripted-native-branch-decision'});}
 async *generateContentAsync(){this.calls++;yield {content:{role:'model',parts:[{text:JSON.stringify({
  task_id:branchTaskId,agent_id:'orchestrator',depends_on:[],
  permissions:[{resource:'gitea://gitea.local/thesis/iam-console-poc',operation:'create_branch'}],
  instruction:'Create the approved feature branch from the reviewed main revision'})}]}};}
 connect(){throw Error('Paid inference forbidden');}
}
/** R357.0: Task depends on independently completed root branch.
 * The Engineer signs only the ceiling, never this Task selection. */
class BackendDecision extends BaseLlm{
 calls=0;
 constructor(){super({model:'r357-scripted-backend-after-native-root-branch'});}
 async *generateContentAsync(){
  this.calls++;
  yield {content:{role:'model',parts:[{text:JSON.stringify({
   task_id:backendTaskId,agent_id:'backend',depends_on:[branchTaskId],
   permissions:[{resource:scopedFile,operation:'update_file'}],
   instruction:'Implement the Account Suspension change within approved Backend source'
  })}]}};
 }
 connect(){throw Error('Paid inference forbidden');}
}
class BackendSdkEditModel extends BaseLlm{
 requests=[];
 constructor(content){super({model:'r3572-scripted-backend-A2A-no-paid-inference'});this.content=content;}
 async *generateContentAsync(request){
  this.requests.push(request);
  if(this.requests.length===1)
   yield {content:{role:'model',parts:[{functionCall:{
    id:'r3572-edit',name:'update_file',
    args:{branch,path:sourcePath,content:this.content}
   }}]}};
  else yield {content:{role:'model',parts:[{
   text:'Backend file update attempted through protected A2A and native Gateway'
  }]}};
 }
 connect(){throw Error('No paid provider in R357.2');}
}
class InertSdkModel extends BaseLlm{
 constructor(role){super({model:'r3572-inert-'+role});}
 async *generateContentAsync(){throw Error('Unused specialist must not run');}
 connect(){throw Error('No paid provider');}
}
async function freeRolePort(){
 const srv=createServer();
 await new Promise((ok,bad)=>{srv.once('error',bad);srv.listen(0,'127.0.0.1',ok);});
 const address=srv.address();
 if(!address||typeof address==='string')throw Error('No free loopback port');
 await new Promise((ok,bad)=>srv.close(error=>error?bad(error):ok()));
 return address.port;
}
const parent=await mkdtemp(join(tmpdir(),'r354-native-'));
const names=['approvals','activation','tasks','sessions','gatewayTasks','children','gatewayChildren','flights',
 'checkpoints','keys','recovery','mutations','runner','mutationEvidence'];
const path=n=>join(parent,n);
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=path('owner.sock');
let host,http,roleBindingServers=[],a2aRoleServers=[];
try{
 for(const n of names)await mkdir(path(n),{mode:0o700});
 const engineer=generateKeyPairSync('ed25519'),backend=generateKeyPairSync('ed25519');
 const publicPem=engineer.publicKey.export({format:'pem',type:'spki'});
 const privateFile=join(path('keys'),'engineer.pem');
 await writeFile(privateFile,engineer.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});
 const salt=randomBytes(16),password='r354-disposable-review-only';
 const checkpoint=new AuthorityPlanningCheckpointStore({directory:path('checkpoints'),trust:{
  trustedKeys:{backend:{public_key_pem:backend.publicKey.export({format:'pem',type:'spki'})}},
  expectedSessionId:sessionId,expectedRepository:repo,expectedBaseRevision:baseRevision,
  expectedWorkBranch:branch,expectedRequirement:requirement}});
 const params=(id,index,seconds)=>({credential_id:id,valid_from:new Date().toISOString().replace(/\.\d{3}Z$/u,'Z'),
  validity_seconds:seconds,credential_status:{type:'BitstringStatusListEntry',statusPurpose:'revocation',
   statusListIndex:String(index),statusListCredential:'https://status.example/r305'}});
 const preliminary=params('urn:r354:preliminary',29401,360);
 const operational=params('urn:r354:operational',29402,1200);
 const sessions=new TrustedOperationalSessionStore(path('sessions'));
 const planner=new Planner();
 host=await startTrustedAuthorityOnlyReviewHost({snapshot,requirement,workBranch:branch,approvalPort:0,
  preliminaryRoot:preliminary,activationJournal:new DurableAuthorityOnlyActivationJournal(path('activation')),
  taskJournal:new DurableAuthorityTaskJournal(path('tasks')),operationalSessionStore:sessions,
  operationalRecoveryStore:new TrustedOperationalRecoveryStore(path('recovery')),
  checkpoint:{store:checkpoint,backendKeyId:'backend',backendPrivateKeyPem:backend.privateKey.export({format:'pem',type:'pkcs8'})},
  approval:{engineerDid,keyId:'r354-engineer',privateKeyFile:privateFile,publicKeyPem:publicPem,
   receiptDirectory:path('approvals'),passwordSaltHex:salt.toString('hex'),passwordScryptHex:scryptSync(password,salt,64).toString('hex')},
  planner:{model:planner,planId:'r354-reviewed-branch',maxModelTurns:3,maxProposalRevisions:0},
  trustedAgentRegistry:{orchestrator:{did:orchestratorDid,card_ref:'trusted:orchestrator',capabilities:['create_branch']},
   ...Object.fromEntries(['backend','frontend','test'].map(role=>[role,{
    did:process.env['ADAPTER_ID_'+role.toUpperCase()],card_ref:'trusted:'+role,
    capabilities:[role==='test'?'run_tests':'update_file']}]))},
  credentials:createTrustedEngineerCredentialPort({bearerToken:process.env.ADAPTER_CALLER_ENGINEER,timeoutMs:60000}),
  planningRevisions:{async begin(task_id){return {task_id,base_revision:baseRevision,expires_at:new Date(Date.now()+360000).toISOString()};},async end(){}},
  gateway:{gatewayBaseUrl:'http://fixture-planning.invalid',adapterBaseUrl:'http://fixture-crypto.invalid',
   adapterToken:process.env.ADAPTER_CALLER_ORCHESTRATOR,fetchFn:async(url,init)=>{
    const body=JSON.parse(String(init.body));
    if(String(url).endsWith('/prepare')){
     assert.equal(body.tool,'read_file');assert.equal(body.arguments.branch,'main');assert.equal(body.arguments.path,sourcePath);
     return Response.json({request_id:'r354-preliminary-read',audience:'cloud-access-gateway',challenge:'r354-preliminary-challenge',
      required_permission:preliminaryReadPermissions(snapshot).find(p=>p.operation==='read_file')});
    }
    assert.ok(String(url).endsWith('/execute'),'legacy presentation HTTP forbidden');
    assert.ok(body.signed_vp.length>100);
    const source=await client.readTextFile('main',sourcePath,baseRevision);
    return Response.json({execution:{provider:'gitea',performed:true,tool:'read_file',branch:'main',
     path:sourcePath,revision:baseRevision,content:source.content}});
   }}
 });
 const ui=host.engineerUrl;
 const uiCall=(route,body,cookie,csrf)=>fetch(ui+route,{method:body===undefined?'GET':'POST',
  headers:{origin:ui,'content-type':'application/json',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const logged=await uiCall('/api/login',{password});assert.equal(logged.status,200);
 const cookie=logged.headers.get('set-cookie').split(';')[0];
 const packet=await (await uiCall('/api/review',undefined,cookie)).json();
 assert.equal(packet.protocol,'authority-only');
 assert.equal(packet.permissions.length,nativeBranchToBackend?2:1);
 if(nativeBranchToBackend){
  assert.ok(packet.authorization_proposal.requested_permissions.some(p=>
   p.operation==='update_file'&&p.resource===scopedDir));
  assert.equal(packet.authorization_proposal.requested_permissions.some(p=>
   Object.hasOwn(p,'task_id')||Object.hasOwn(p,'agent_id')),false);
 }
 assert.equal(packet.authorization_proposal.requested_permissions[0].operation,'create_branch');
 assert.equal(branchPosts,0);
 const accepted=await uiCall('/api/approve',{proposal_digest:packet.proposal_digest,
  approved_permission_ids:packet.permissions.map(p=>p.id),confirmation:'APPROVE '+packet.proposal_digest},cookie,packet.csrf_token);
 assert.equal(accepted.status,201);assert.equal(host.phase,'planning');
 await assert.rejects(client.getBranchMetadata(branch),e=>e instanceof ProviderNotFoundError);
 const {coordinator}=await host.activateOperational(operational);
 const root=coordinator.assertTrustedGatewayAuthorityBinding().root_credential_id;
 const evidenceKey=nativeBackendCas?randomBytes(32):undefined;
 const mutationObserver=nativeBackendCas?new AuthenticatedGiteaMutationCompletionObserver({
  directory:path('mutationEvidence'),key:evidenceKey,
  repository:repo.owner+'/'+repo.repository,branch,giteaClient:reader
 }):undefined;
 const completionObserver=nativeBackendA2A?new TrustedAuthorityOnlyCompletionObserver({
  readVerifiedCompletion:expected=>mutationObserver.observe(expected)
 }):undefined;
 const execution=await host.admitOperationalExecution({operationalSessionStore:sessions,
  ...(completionObserver?{completionObserver}:{}),
  gatewayTaskJournal:new DurableAuthorityTaskJournal(path('gatewayTasks')),
  issuerChildJournal:new DurableAuthorityOnlyChildJournal(path('children')),
  gatewayChildJournal:new DurableAuthorityOnlyChildJournal(path('gatewayChildren')),
  nativeCryptoPort:createNativeRustChildCryptographyPort({bearerToken:process.env.ADAPTER_CALLER_ORCHESTRATOR,timeoutMs:60000},process.env.ADAPTER_ENGINEER_NATIVE_SOCKET),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path('flights'))});
 const gate=execution.gateway,store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 const branchExecutor=new TrustedAuthorityOnlyBranchExecutor({admissions:gate,giteaClient:client,
  independentGiteaClient:reader,repository:repo.owner+'/'+repo.repository});
 const repositoryPath=repo.owner+'/'+repo.repository;
 const mutationJournal=new DurableAuthorityOnlyGiteaMutationIntentJournal(path('mutations'));
 const mutation=new TrustedAuthorityOnlyGiteaMutationPreflight({admissions:gate,giteaClient:client,
  journal:mutationJournal,repository:repositoryPath,branch});
 const runner=new TrustedAuthorityOnlyRunnerPreflight({admissions:gate,giteaClient:client,
  journal:new DurableAuthorityOnlyRunnerIntentJournal(path('runner')),repository:repositoryPath,branch});
 const mutationExecutor=nativeBackendCas?new TrustedAuthorityOnlyGiteaMutationExecutor({
  admissions:gate,preflight:mutation,journal:mutationJournal,giteaClient:client,
  publisher:new TrustedGatewayGiteaMutationEvidencePublisher({
   directory:path('mutationEvidence'),key:evidenceKey,repository:repositoryPath,branch,
   independentGiteaClient:reader
  }),observer:mutationObserver,repository:repositoryPath,branch
 }):undefined;
 execution.bindNativeGatewayEffects({store,giteaClient:client,branchExecutor,
  mutation,runner});
 const runtime=new GatewayRuntime({bind_host:'127.0.0.1',bind_port:0,prepare:{audience:'cloud-access-gateway',request_ttl_ms:120000,repository:repo},
  verifier_mode:'core-rust',opa_url:'http://127.0.0.1:8181',opa_timeout_ms:6000,provider_mode:'gitea',
  gitea_base_url:process.env.GITEA_HOST_BASE_URL,gitea_gateway_token:process.env.GITEA_GATEWAY_TOKEN,
  gitea_timeout_ms:6000,runner_timeout_ms:900000},
  {store,audit,authorityOnlyAdmissions:gate,authorityOnlyBranchEnabled:true,authorityOnlyBranchExecutor:branchExecutor,
   ...(nativeBackendCas?{authorityOnlyMutationEnabled:true,authorityOnlyMutationExecutor:mutationExecutor}:{})});
 http=createGatewayHttpServer(runtime);await new Promise((ok,bad)=>{http.once('error',bad);http.listen(0,'127.0.0.1',ok);});
 const api='http://127.0.0.1:'+http.address().port;
 const call=async(route,body,status=200)=>{const r=await fetch(api+'/v1/authorization/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
 const decision=new Decision();
 const staged=await execution.proposeAndStageBranchTask({model:decision,runtimeTaskId});
 assert.equal(staged.credential_id,root);assert.equal(branchPosts,0);
 assert.throws(()=>execution.childIssuer.assertTrustedIssuedChild(staged.task_id,coordinator));
 // A pending branch Task MUST block all subsequent ADK Task decisions.
 // A signed Engineer ceiling alone cannot serve as branch completion.
 if(nativeBranchToBackend){
  const tooEarly=new BackendDecision();
  await assert.rejects(execution.proposeAndStageTask({
   model:tooEarly,runtimeTaskId:backendRuntimeTaskId,
   childParameters:params('urn:r357:must-not-issue',29404,500)
  }),/independently completed original branch Task/);
  assert.equal(tooEarly.calls,0);
  assert.equal(coordinator.registeredTaskCount,1);
  assert.equal(gate.stagedCompletedTaskCount,0);
  assert.equal((await readdir(path('children'))).length,0);
  await assert.rejects(client.getBranchMetadata(branch),
   e=>e instanceof ProviderNotFoundError);
 }
 const prepared=await call('prepare',{task_id:runtimeTaskId,agent_role:'orchestrator',tool:'create_branch',arguments:{branch,base_branch:'main'}},201);
 await execution.stageEnrolledBranch({taskId:staged.task_id,runtimeTaskId,requestId:prepared.request_id});
 const vp=await invokeNativeCrypto({socketPath:process.env.ADAPTER_ENGINEER_NATIVE_SOCKET,token:process.env.ADAPTER_CALLER_ORCHESTRATOR,timeoutMs:60000},
  'create_presentation',{credential_id:root,disclosed_permissions:[prepared.required_permission],audience:prepared.audience,challenge:prepared.challenge});
 const result=await call('execute',{request_id:prepared.request_id,signed_vp:vp.signed_vp});
 assert.equal(result.execution.tool,'create_branch');assert.equal(result.execution.revision,baseRevision);
 assert.equal(result.verified_delegation.credential_id,root);assert.equal(result.verified_delegation.root_credential_id,root);
 assert.equal(result.verified_delegation.hierarchy_depth,0);assert.equal(branchPosts,1);assert.equal(gate.stagedCompletedTaskCount,0);
 await execution.attestEnrolledBranchCompletion({taskId:staged.task_id,runtimeTaskId});
 assert.equal(gate.stagedCompletedTaskCount,1);assert.ok(independentReads>=3);
 assert.equal((await readdir(path('children'))).length,0);assert.equal((await readdir(path('gatewayChildren'))).length,0);
 const replay=await call('execute',{request_id:prepared.request_id,signed_vp:vp.signed_vp},409);
 assert.equal(replay.error,'replay_detected');assert.equal(branchPosts,1);assert.equal(otherWrites,0);
 if(nativeBranchToBackend){
  const live=coordinator.assertTrustedGatewayAuthorityBinding();
  assert.equal(live.root_credential_id,root);
  assert.equal(live.root_permissions.length,2);
  const backendDecision=new BackendDecision();
  const childParams=params('urn:r357:child:backend-after-branch',29403,500);
  const backend=await execution.proposeAndStageTask({
   model:backendDecision,runtimeTaskId:backendRuntimeTaskId,
   childParameters:childParams
  });
  assert.equal(backend.status,'owner_child_enrolled_no_provider_execution');
  assert.equal(backend.task_id,backendTaskId);
  assert.equal(backend.epoch,2);
  assert.equal(backend.agent_id,'backend');
  assert.equal(backendDecision.calls,1);
  assert.equal(backend.gateway_execution_authorized,false);
  assert.notEqual(backend.credential_id,root);
  const issued=execution.childIssuer.assertTrustedIssuedChild(backendTaskId,coordinator);
  assert.equal(issued.root_credential_id,root);
  assert.deepEqual(issued.permissions,[{resource:scopedFile,operation:'update_file'}]);
  assert.equal(issued.credential_id,backend.credential_id);
  assert.equal(gate.registeredTaskCount,2);
  assert.equal(coordinator.registeredTaskCount,2);
  assert.equal(gate.stagedCompletedTaskCount,1);
  assert.equal(branchPosts,1);
  assert.equal(otherWrites,0);
  // Issuance journals persist TWO unique O_EXCL guards per Child:
  // one for Task replay and one for credential-ID reuse.
  assert.equal((await readdir(path('children'))).length,2);
  assert.equal((await readdir(path('gatewayChildren'))).length,2);
  const childVp=await invokeNativeCrypto({
   socketPath:process.env.ADAPTER_ENGINEER_NATIVE_SOCKET,
   token:process.env.ADAPTER_CALLER_BACKEND,timeoutMs:60000
  },'create_presentation',{
   credential_id:backend.credential_id,
   disclosed_permissions:[{resource:scopedFile,operation:'update_file'}],
   audience:'cloud-access-gateway',challenge:'r357-disposable-native-backend-nonce'
  });
  const backendProof=await loadDirectCoreRustVerifier({
   allowGiteaScopeCoverage:true
  }).verify({presenter:'backend',audience:'cloud-access-gateway',
   challenge:'r357-disposable-native-backend-nonce',
   required_permission:{resource:scopedFile,operation:'update_file'},
   signed_vp:childVp.signed_vp});
  assert.equal(backendProof.credential_id,backend.credential_id);
  assert.equal(backendProof.root_credential_id,root);
  assert.equal(backendProof.hierarchy_depth,1);
  assert.deepEqual(backendProof.permissions,[{resource:scopedFile,operation:'update_file'}]);
  if(nativeBackendA2A){
   // The original owner, NOT the test fixture, dispatches the Backend
   // through genuine SDK A2A. Agent ADK decides to call update_file,
   // private IPC stages the trusted original Gateway/HEAD intent, and
   // the native Gateway checks the signed Child VP and OPA before CAS.
   const source=await reader.readTextFile(branch,sourcePath,baseRevision);
   assert.equal(source.content,ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[sourcePath]);
   const content=ACCOUNT_SUSPENSION_REFERENCE_FILES[sourcePath];
   assert.notEqual(source.content,content);
   const model=new BackendSdkEditModel(content);
   const roleBindings={},stageChannels={},roleEndpoints={};
   let backendPrepared,backendExecuted,backendSignedVp;
   for(const role of ['backend','frontend','test']){
    const binding={
     socketPath:path('r3572-'+role+'-binding.sock'),
     secretFile:path('r3572-'+role+'-binding.hex')
    };
    const stage={
     socketPath:path('r3572-'+role+'-stage.sock'),
     secretFile:path('r3572-'+role+'-stage.hex')
    };
    await writeFile(binding.secretFile,randomBytes(32).toString('hex')+'\n',
     {mode:0o600,flag:'wx'});
    await writeFile(stage.secretFile,randomBytes(32).toString('hex')+'\n',
     {mode:0o600,flag:'wx'});
    roleBindings[role]=binding;stageChannels[role]=stage;
    const registry=new TrustedEffectStagingTaskRegistry();
    const bindingServer=await createTrustedEffectAgentBindingServer({
     ...binding,registry,expectedRole:role,
     ownerStageClient:await connectTrustedOwnerEffectStagingClient(stage)
    });
    await bindingServer.start();roleBindingServers.push(bindingServer);
    const keys=generateKeyPairSync('ed25519');
    const options={
     role,host:'127.0.0.1',port:await freeRolePort(),
     capabilityProfile:'approved-plan',delegatedAuthorization:true,
     mcpTaskSigning:{
      signingPrivateKeyPem:keys.privateKey.export({
       type:'pkcs8',format:'pem'}).toString(),
      signingPublicKeyPem:keys.publicKey.export({
       type:'spki',format:'pem'}).toString()
     },
     adk:{
      model:role==='backend'?model:new InertSdkModel(role),
      gatewayBaseUrl:api,adapterToken:process.env['ADAPTER_CALLER_'+role.toUpperCase()],
      maxModelTurns:4,maxModelCallMs:10000,gatewayTimeoutMs:120000,
      scopeModelPaths:true,trustedEffectTaskRegistry:registry,
      fetchFn:role!=='backend'?fetch:async(url,init)=>{
       const route=String(url),response=await fetch(url,init);
       if(route.endsWith('/v1/authorization/prepare')&&response.ok)
        backendPrepared=await response.clone().json();
       if(route.endsWith('/v1/authorization/execute')){
        backendSignedVp=JSON.parse(String(init?.body)).signed_vp;
        backendExecuted=await response.clone().json();
       }
       return response;
      }
     }
    };
    const server=await startSpecializedAgentServer(options);
    a2aRoleServers.push(server);roleEndpoints[role]=server.baseUrl;
   }
   const started=await execution.startSdkA2AOwner({
    agentBaseUrls:roleEndpoints,stageChannels,
    agentBindingChannels:roleBindings,
    a2aPolling:{deadlineMs:240000,initialIntervalMs:50,maxIntervalMs:250}
   });
   assert.equal(started.status,'owner_protected_a2a_started_no_provider_execution');
   const stager=execution.createEnrolledNativeEffectStager({
    runtimeTaskId:backendRuntimeTaskId,expectedHeadSha:baseRevision
   });
   await assert.rejects(execution.attestEnrolledTaskCompletion({
    taskId:backendTaskId,runtimeTaskId:backendRuntimeTaskId
   }),/completion has no matching original A2A dispatch report/);
   assert.equal(gate.stagedCompletedTaskCount,1);
   const report=await execution.dispatchEnrolledTask({
    taskId:backendTaskId,runtimeTaskId:backendRuntimeTaskId,
    instruction:'Implement the Account Suspension change in the approved Backend source file',
    effectStager:stager
   });
   assert.equal(report.status,'a2a_report_not_gateway_completed');
   assert.equal(report.provider_completion_attested,false);
   assert.equal(report.task_id,backendTaskId);
   assert.equal(report.runtime_task_id,backendRuntimeTaskId);
   assert.deepEqual(report.artifact.files_modified,[sourcePath]);
   assert.equal(report.artifact.test_outcome,'not_run');
   assert.equal(model.requests.length,2);
   assert.ok(backendPrepared&&backendExecuted&&backendSignedVp);
   assert.equal(backendExecuted.execution.tool,'update_file');
   assert.equal(backendExecuted.verified_delegation.root_credential_id,root);
   assert.equal(backendExecuted.verified_delegation.credential_id,backend.credential_id);
   assert.equal(backendExecuted.verified_delegation.hierarchy_depth,1);
   assert.equal(backendExecuted.execution.commit_sha,report.artifact.commit_sha);
   const committed=backendExecuted.execution.commit_sha;
   assert.match(committed,/^[a-f0-9]{40}$/u);
   assert.notEqual(committed,baseRevision);
   assert.equal((await reader.getBranchMetadata(branch)).commit_sha,committed);
   assert.equal((await reader.readTextFile(branch,sourcePath,committed)).content,content);
   assert.equal(gate.stagedCompletedTaskCount,1,'A2A report cannot attest a provider result');
   const completed=await execution.attestEnrolledTaskCompletion({
    taskId:backendTaskId,runtimeTaskId:backendRuntimeTaskId
   });
   assert.equal(completed.status,'owner_gateway_completion_independently_observed');
   assert.equal(gate.stagedCompletedTaskCount,2);
   await assert.rejects(execution.attestEnrolledTaskCompletion({
    taskId:backendTaskId,runtimeTaskId:backendRuntimeTaskId
   }),/completion has no matching original A2A dispatch report/);
   assert.equal((await readdir(path('mutationEvidence')))
    .filter(name=>name.endsWith('.mutation.json')).length,1);
   const modelText=JSON.stringify(model.requests);
   for(const secret of [process.env.ADAPTER_CALLER_BACKEND,
    backend.credential_id,root,backendSignedVp])
    assert.equal(modelText.includes(secret),false);
   assert.equal((await reader.getBranchMetadata('main')).commit_sha,baseRevision);
   assert.equal((await reader.getBranchMetadata(branch)).commit_sha,committed);
   process.stdout.write(JSON.stringify({
    event:'r3572_native_branch_first_backend_protected_a2a_cas_completed',
    real_branch_created_after_engineer_approval:true,
    original_root_unchanged:true,backend_child_signed_vp_depth:1,
    actual_sdk_a2a_backend_task:true,actual_adk_tool_call:true,
    gateway_native_rust_opa_verified:true,provider_head_cas:true,
    independent_mac_receipt:true,independent_task_completion:true,
    registered_tasks:gate.registeredTaskCount,completed_tasks:gate.stagedCompletedTaskCount,
    unsolved_main_unchanged:true,owner_preseeded_functional_app:false,
    scripted_model_source_edit:true,paid_ai_calls:0
   })+'\n');
  }else if(nativeBackendCas){
   // No test-owner pre-seeding: start from exact independently pinned
   // UNSOLVED main bytes. This source is a SCRIPTED Backend edit (not
   // LLM-generated), and the Gateway itself must commit it using atomic
   // branch HEAD CAS under the new genuine Child VP.
   const original=await reader.readTextFile(branch,sourcePath,baseRevision);
   assert.equal(original.content,ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[sourcePath]);
   const next=ACCOUNT_SUSPENSION_REFERENCE_FILES[sourcePath];
   assert.equal(typeof next,'string');
   assert.notEqual(next,original.content);
   assert.equal(otherWrites,0);
   const preparedUpdate=await call('prepare',{
    task_id:backendRuntimeTaskId,agent_role:'backend',tool:'update_file',
    arguments:{branch,path:sourcePath,content:next}
   },201);
   assert.equal(preparedUpdate.required_permission.operation,'update_file');
   assert.equal(preparedUpdate.required_permission.resource,scopedFile);
   const nativeStager=execution.createEnrolledNativeEffectStager({
    runtimeTaskId:backendRuntimeTaskId,expectedHeadSha:baseRevision
   });
   const reserved=await nativeStager.stage(preparedUpdate.request_id);
   assert.equal(reserved.status,'gitea_update_intent_reserved_without_execution');
   assert.equal(reserved.provider_write_authorized,false);
   assert.equal(otherWrites,0,'preflight is never a Gitea write');
   const nextVp=await invokeNativeCrypto({
    socketPath:process.env.ADAPTER_ENGINEER_NATIVE_SOCKET,
    token:process.env.ADAPTER_CALLER_BACKEND,timeoutMs:60000
   },'create_presentation',{
    credential_id:backend.credential_id,
    disclosed_permissions:[preparedUpdate.required_permission],
    audience:preparedUpdate.audience,challenge:preparedUpdate.challenge
   });
   const changed=await call('execute',{
    request_id:preparedUpdate.request_id,signed_vp:nextVp.signed_vp
   },200);
   assert.equal(changed.execution.tool,'update_file');
   assert.equal(changed.execution.branch,branch);
   assert.equal(changed.execution.path,sourcePath);
   assert.equal(changed.verified_delegation.credential_id,backend.credential_id);
   assert.equal(changed.verified_delegation.root_credential_id,root);
   assert.equal(changed.verified_delegation.hierarchy_depth,1);
   const committed=changed.execution.commit_sha;
   assert.match(committed,/^[a-f0-9]{40}$/u);
   assert.notEqual(committed,baseRevision);
   const independent=await reader.getBranchMetadata(branch);
   assert.equal(independent.commit_sha,committed);
   assert.equal((await reader.readTextFile(branch,sourcePath,committed)).content,next);
   const intent=reserved.intent;
   const expectation=Object.fromEntries([
    'session_id','authority_digest','root_credential_id',
    'task_id','runtime_task_id','epoch','agent_did','credential_id',
    'request_id','request_fingerprint'
   ].map(key=>[key,intent[key]]));
   const observed=await mutationObserver.observe(expectation);
   assert.equal(observed.status,'owner_verified_provider_result');
   assert.match(observed.evidence_sha256,/^[a-f0-9]{64}$/u);
   assert.equal(observed.task_id,backendTaskId);
   assert.equal(observed.runtime_task_id,backendRuntimeTaskId);
   assert.equal(observed.credential_id,backend.credential_id);
   assert.equal(gate.stagedCompletedTaskCount,1,
    'independent provider receipt is not protected A2A Task completion');
   const replay=await call('execute',{
    request_id:preparedUpdate.request_id,signed_vp:nextVp.signed_vp
   },409);
   assert.equal(replay.error,'replay_detected');
   assert.equal((await reader.getBranchMetadata(branch)).commit_sha,committed);
   assert.equal((await reader.getBranchMetadata('main')).commit_sha,baseRevision);
   assert.ok(otherWrites>0,'native Gateway performed at least one real Gitea CAS write');
   assert.equal((await readdir(path('mutationEvidence')))
    .filter(name=>name.endsWith('.mutation.json')).length,1);
   process.stdout.write(JSON.stringify({
    event:'r3571_native_branch_first_backend_cas',
    unsolved_main_unchanged:true,feature_branch_created_after_approval:true,
    original_root_branch_vp:true,native_backend_child_vp:true,
    original_engineer_root_unchanged:true,provider_cas_performed:true,
    backend_source_modified_without_owner_preseed:true,
    independent_gitea_cas_mac_receipt:true,
    original_branch_task_completed:true,backend_task_completed:false,
    protected_a2a_backend_not_yet_tested:true,
    script_selected_backend_content:true,paid_model_calls:0,
    gateway_registered_tasks:gate.registeredTaskCount,
    gateway_completed_tasks:gate.stagedCompletedTaskCount
   })+'\n');
  }else{
   assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
  }
  process.stdout.write(JSON.stringify({
   event:'r357_native_same_owner_branch_to_backend_child',
   branch_provider_posts:branchPosts,branch_completion_independent:true,
   backend_task_model_selected_after_branch:true,backend_dependency:branchTaskId,
   genuine_rust_backend_child_vp:true,child_hierarchy_depth:1,
   child_permissions_scoped_to_backend_file:true,
   original_root_unchanged:true,operational_tasks:2,
   completed_tasks:gate.stagedCompletedTaskCount,
   main_unsolved_unchanged:true,feature_mutation_not_yet_executed:!nativeBackendCas,
   backend_protected_a2a_completed:nativeBackendA2A,
   paid_model_calls:0
  })+'\n');
 }
 assert.equal((await client.getBranchMetadata('main')).commit_sha,baseRevision);
 if(nativeBackendA2A)assert.equal(gate.stagedCompletedTaskCount,2);
 if(!nativeBackendCas)assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
 await host.close();
 const verifier=loadDirectCoreRustVerifier({allowGiteaScopeCoverage:true});
 await assert.rejects(verifier.verify({presenter:'orchestrator',audience:prepared.audience,challenge:prepared.challenge,
  required_permission:prepared.required_permission,signed_vp:vp.signed_vp}));
 process.stdout.write(JSON.stringify({event:'r354_native_reviewed_root_branch_complete',
  main_baseline_unchanged:true,baseline_unsolved:true,branch_absent_before_approval:true,
  branch_provider_posts:branchPosts,root_vp_depth:0,self_delegation:false,independent_branch_completion:true,
  registered_tasks:coordinator.registeredTaskCount,completed_tasks:gate.stagedCompletedTaskCount,
  replay_denied:true,root_revocation_verified:true,paid_model_calls:0,autonomous_functional_generation:false,
  preliminary_gateway_transport:'fixture'})+'\n');
}finally{
 if(host)await host.close();
 await Promise.allSettled([...roleBindingServers,...a2aRoleServers]
  .map(s=>s.close()));
 if(http)await new Promise(resolve=>http.close(resolve));
 await rm(parent,{recursive:true,force:true});
}
