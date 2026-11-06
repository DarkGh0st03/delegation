/** Free native branch proof from unchanged unsolved main. Preliminary Gateway
 * protocol and ADK decisions are scripted; operational Rust/EVM/OPA/Gitea are real. */
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,scryptSync} from 'node:crypto';
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
const nativeBackendCas=process.env.R3571_NATIVE_BACKEND_CAS==='1';
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
const parent=await mkdtemp(join(tmpdir(),'r354-native-'));
const names=['approvals','activation','tasks','sessions','gatewayTasks','children','gatewayChildren','flights',
 'checkpoints','keys','recovery','mutations','runner','mutationEvidence'];
const path=n=>join(parent,n);
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=path('owner.sock');
let host,http;
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
 const execution=await host.admitOperationalExecution({operationalSessionStore:sessions,
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
 const evidenceKey=nativeBackendCas?randomBytes(32):undefined;
 const mutationObserver=nativeBackendCas?new AuthenticatedGiteaMutationCompletionObserver({
  directory:path('mutationEvidence'),key:evidenceKey,repository:repositoryPath,branch,
  giteaClient:reader
 }):undefined;
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
  assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
  process.stdout.write(JSON.stringify({
   event:'r357_native_same_owner_branch_to_backend_child',
   branch_provider_posts:branchPosts,branch_completion_independent:true,
   backend_task_model_selected_after_branch:true,backend_dependency:branchTaskId,
   genuine_rust_backend_child_vp:true,child_hierarchy_depth:1,
   child_permissions_scoped_to_backend_file:true,
   original_root_unchanged:true,operational_tasks:2,completed_tasks:1,
   main_unsolved_unchanged:true,feature_mutation_not_yet_executed:true,
   paid_model_calls:0
  })+'\n');
 }
 assert.equal((await client.getBranchMetadata('main')).commit_sha,baseRevision);
 assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
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
 if(http)await new Promise(resolve=>http.close(resolve));
 if(host)await host.close();
 await rm(parent,{recursive:true,force:true});
}
