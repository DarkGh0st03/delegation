/** Owner-assembled permission-only Planning -> authenticated Engineer review
 * -> independent native root -> dynamic Coordinator. No public root issuer.
 * The caller owns listener binding; this factory never starts inference until
 * invoked with an explicitly provisioned model and trusted service ports. */
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {createAuthenticatedEngineerServer} from './engineer-approval-server.mjs';
import {TrustedAuthorityOnlyEngineerSession} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-engineer-session.ts';
import {SignedAuthorityOnlyFileStore} from '../../../packages/orchestrator-runtime/src/signed-authority-only-store.ts';
import {DurableAuthorityOnlyActivationJournal} from '../../../packages/orchestrator-runtime/src/authority-only-activation-journal.ts';
import {DurableAuthorityTaskJournal} from '../../../packages/orchestrator-runtime/src/trusted-authority-task-journal.ts';
import {TrustedAuthorityOnlyExecutionCoordinator} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-execution-coordinator.ts';
import {TrustedPlanningGatewayReadPort} from '../../../packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts';
import {TrustedAdkReadOnlyPlanner} from '../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts';
import {TrustedActiveAuthorityPlanning} from '../../../packages/orchestrator-runtime/src/trusted-active-authority-planning.ts';
import {AuthorityPlanningCheckpointStore} from '../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts';
import {authorityOnlyDigest,selectAuthorityOnlyGrant} from '../../../packages/plan-contracts/src/authority-only-approval.mjs';
import {RUST_OPERATIONS} from '../../gateway/src/operation-catalog.ts';
import {TrustedOperationalSessionStore} from '../../gateway/src/trusted-operational-session-store.ts';
import {TrustedOperationalRecoveryStore,reconcileOrphanedOperationalRoots}
 from '../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts';
import {TrustedAuthorityOnlyGatewayAdmissions} from '../../gateway/src/trusted-authority-only-admissions.ts';
import {TrustedAuthorityOnlyEffectStager} from '../../gateway/src/trusted-authority-only-effect-stager.ts';
import {TrustedAuthorityOnlyAdkDecisionProposer}
 from '../../../packages/orchestrator-runtime/src/trusted-authority-only-adk-decision-proposer.mjs';
import {TrustedAuthorityOnlyGiteaMutationPreflight} from '../../gateway/src/trusted-authority-only-mutation-preflight.ts';
import {TrustedAuthorityOnlyRunnerPreflight} from '../../gateway/src/trusted-authority-only-runner-preflight.ts';
import {GiteaClient} from '../../gateway/src/gitea-client.ts';
import {InMemoryRequestStore} from '../../gateway/src/prepare.ts';
import {TrustedAuthorityOnlyChildIssuer} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-child-issuer.ts';
import {preflightNativeD1FailureCandidate}
 from '../../../packages/orchestrator-runtime/src/trusted-native-runner-failure-d1-preflight.ts';
import {DurableNativeD1FirstTaskAdmissionJournal,
 admitFirstNativeD1RepairTask}
 from '../../../packages/orchestrator-runtime/src/trusted-native-d1-first-task-admission.ts';
import {enrollFirstNativeD1ChildAtGateway}
 from '../../../packages/orchestrator-runtime/src/trusted-native-d1-child-gateway-bind.ts';
import {AuthenticatedRunnerFailureObserver}
 from '../../gateway/src/trusted-authority-only-runner-failure-evidence.ts';
import {DurableAuthorityOnlyRunnerIntentJournal}
 from '../../gateway/src/trusted-authority-only-runner-intent-journal.ts';
import {startTrustedAuthorityOnlySdkA2AOwner} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-a2a-owner.ts';
import {DurableAuthorityOnlyChildJournal} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-child-journal.ts';
const OPS=new Set(RUST_OPERATIONS);
const fields=(o,allowed)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k));
function deny(reason){throw Error('Authority-only review host: '+reason);}
export async function createTrustedAuthorityOnlyReviewHost(options){
 if(!options||!(options.checkpoint?.store instanceof AuthorityPlanningCheckpointStore)||
  !(options.activationJournal instanceof DurableAuthorityOnlyActivationJournal)||
  !(options.taskJournal instanceof DurableAuthorityTaskJournal)||
  !(options.operationalRecoveryStore instanceof TrustedOperationalRecoveryStore)||
  !(options.operationalSessionStore instanceof TrustedOperationalSessionStore)||
  !fields(options.approval,['engineerDid','keyId','publicKeyPem','privateKeyFile',
    'receiptDirectory','passwordSaltHex','passwordScryptHex'])||
  !fields(options.planner,['model','planId','onObservation','maxModelTurns',
    'maxProposalRevisions','thinkingLevel','maxModelCallMs','maxOutputTokens','maxPlanningMs'])||
  !fields(options.gateway,['gatewayBaseUrl','adapterBaseUrl','adapterToken','fetchFn','timeoutMs']))
  deny('explicit trusted dependencies required; legacy/context overrides forbidden');
 const snapshot=structuredClone(options.snapshot),requirement=options.requirement,branch=options.workBranch;
 // Optional disposable feature-source Planning is a trusted snapshot pin,
 // not a second source branch that a client or model may substitute.
 if(snapshot.planning_branch!==undefined&&snapshot.planning_branch!==branch)
  deny('Planning source branch differs from Engineer-reviewed work branch');
 const approval={...options.approval},checkpoint={...options.checkpoint};
 const store=checkpoint.store;
 store.assertContext(snapshot,branch,requirement);
 store.assertSigner(checkpoint.backendKeyId,checkpoint.backendPrivateKeyPem);
 const files=new SignedAuthorityOnlyFileStore({directory:approval.receiptDirectory,
  engineerDid:approval.engineerDid,trustedKeys:{[approval.keyId]:{
   engineer_did:approval.engineerDid,public_key_pem:approval.publicKeyPem}}});
 let proposal,pinnedDigest;
 const digest=p=>authorityOnlyDigest(selectAuthorityOnlyGrant(p,p.requested_permissions,
  {allowedOperations:OPS}),{allowedOperations:OPS});
 // The SAME checked store is used by both the session and Coordinator. A
 // signed but foreign/replaced receipt cannot bypass the reviewed proposal.
 const approvals={async loadAuthenticatedAuthority(id){
  if(!proposal||id!==snapshot.session_id)deny('verified review not ready');
  const latest=await store.load();
  if(digest(latest.proposal)!==pinnedDigest)deny('review proposal changed');
  const verified=await files.loadAuthenticatedAuthority(id);
  const expected=selectAuthorityOnlyGrant(proposal,verified.authorization.permissions,
   {allowedOperations:OPS});
  if(!isDeepStrictEqual(expected,verified.authorization))deny('receipt outside reviewed proposal');
  return verified;
 }};
 const session=new TrustedAuthorityOnlyEngineerSession({snapshot,requirement,
  credentials:options.credentials,planningRevisions:options.planningRevisions,
  approvals,journal:options.activationJournal,authenticatedEngineerDid:approval.engineerDid});
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({sessionId:snapshot.session_id,
  engineer:session,approvals,journal:options.taskJournal,trustedAgentRegistry:options.trustedAgentRegistry});
 const agents=Object.fromEntries(['backend','frontend','test'].map(role=>{
  const pin=options.trustedAgentRegistry?.[role];
  if(!pin)deny('three trusted agent card pins required');
  return [role,{did:pin.did,card_ref:pin.card_ref}];
 }));
 let server,attempted=false,closed=false,closing,activationFlight;
 let operationalRootId;
 let operationalCoordinator,executionAdmissionAttempted=false,executionAdmissionFlight;
 let taskStageFlight,taskStageFailed=false,stagedTaskCount=0;
 const stagedTaskIds=new Map();
 // Only original Gateway-attested completions may unlock subsequent ADK
 // choices. A2A artifacts and Task registration never enter this ledger.
 const gatewayAttestedTaskIds=new Map();
 const dispatchAttempts=new Set();
 const issuedEffectStagers=new Map();
 const dispatchedReports=new Map();
 const completionAttempts=new Set();
 let completionFlight,completionFailed=false;
 // A verified Runner FAIL is NOT a successful Test completion.
 // This separate one-shot D1 preflight can never unlock normal Task decisions.
 let d1FailurePreflightAttempted=false,d1FailurePreflightFlight,
  d1FailurePreflightFailed=false,d1VerifiedFailure,
  d1RepairProposalAttempted=false,d1RepairProposal,
  d1RepairAdmissionAttempted=false,d1RepairAdmissionFlight;
 let nativeEffectBindingAttempted=false,nativeEffectBinding;
 let decisionFlight,decisionCalls=0;
 let dispatchFlight,dispatchFailed=false;
 let a2aOwner,a2aStarting,a2aStartAttempted=false;
 async function retire(){
  if(session.phase==='planning')await session.cancelPlanning();
  else if(session.phase==='operational'){
   if(!operationalRootId)deny('missing original durable operational root ID');
   // Persist a Gateway terminal fence before revoking Rust; even when one
   // side fails, attempt BOTH so recovery can finish later without reuse.
   let gatewayError,rustError;
   try{await options.operationalSessionStore.markRetired(snapshot.session_id);}
   catch(error){gatewayError=error;}
   try{await session.retireOperationalRoot();}
   catch(error){rustError=error;}
   if(gatewayError)
    deny('Gateway operational retirement unconfirmed; manual reconciliation required');
   if(rustError)throw rustError;
   // Only both independent shutdown confirmations may retire the intent.
   await options.operationalRecoveryStore.markReconciled({
    sessionId:snapshot.session_id,baseRevision:snapshot.base_revision,
    credentialId:operationalRootId
   });
  }else if(session.phase!=='revoked')
   deny('root state uncertain; manual reconciliation required');
 }
 // Read-only Planning itself must never start while an earlier issued
 // operational root may still exist; an operator must reconcile it first.
 await options.operationalRecoveryStore.assertFreshSession(snapshot.session_id);
 try{
  await session.startPlanning(options.preliminaryRoot);
  const readPort=new TrustedPlanningGatewayReadPort({...options.gateway,coordinator:session,snapshot});
  const planner=new TrustedAdkReadOnlyPlanner({...options.planner,snapshot,requirement,
   workBranch:branch,agents,readPort});
  const active=new TrustedActiveAuthorityPlanning({planner,coordinator:session,
   store,backendKeyId:checkpoint.backendKeyId,backendPrivateKeyPem:checkpoint.backendPrivateKeyPem,
   lifetimeMs:checkpoint.lifetimeMs});
  const ticket=await active.proposeAndPersist();
  proposal=structuredClone(ticket.proposal);pinnedDigest=digest(proposal);
  server=await createAuthenticatedEngineerServer({...approval,architecture:'authority-only',
   authorityCheckpointStore:store,expectedSessionId:snapshot.session_id,
   expectedBaseRevision:snapshot.base_revision,repository:snapshot.repository,
   expectedWorkBranch:branch,expectedRequirement:requirement,
   planningIsActive:()=>{try{session.trustedPlanningAuthority();return !closed;}catch{return false;}},
   rejectPlanning:()=>session.cancelPlanning()});
 }catch(error){
  if(session.phase==='planning'){
   try{await session.cancelPlanning();}catch{deny('startup failed and Planning retirement unconfirmed');}
  }
  throw error;
 }
 return Object.freeze({server,readOnlySessionId:snapshot.session_id,
  get phase(){return session.phase;},
  /** Private service-owner action; never registered on Engineer HTTP/ADK/MCP. */
  async activateOperational(root){
   if(closed||attempted||activationFlight)deny('activation already attempted or host closed');
   activationFlight=(async()=>{
   // Missing/invalid approval does not consume the one-shot transition.
   await approvals.loadAuthenticatedAuthority(snapshot.session_id);
   if(closed||attempted)deny('activation already attempted or host closed');
   attempted=true;
   try{
    // Intent is durable BEFORE the native Rust operational issue call.
    // A crash, ambiguous provider response or failed operation cannot
    // start another signed or unsigned root without manual reconciliation.
    await options.operationalRecoveryStore.recordIntent({
     sessionId:snapshot.session_id,baseRevision:snapshot.base_revision,
     credentialId:root?.credential_id
    });
    operationalRootId=root.credential_id;
    await session.approveAndIssueOperationalRoot(root);
    if(closed){await retire();deny('host closed during root transition');}
    const activation=await coordinator.activate();
    if(closed){await retire();deny('host closed during Coordinator activation');}
    operationalCoordinator=coordinator;
    return Object.freeze({activation,coordinator});
   }catch(error){
    if(session.phase==='operational'){
     try{await session.retireOperationalRoot();}catch{deny('activation failed and operational retirement unconfirmed');}
    }
    throw error;
   }
   })();
   try{return await activationFlight;}finally{activationFlight=undefined;}
  },
   /** R350: owner-private same-session Gateway and Child composition.
   * This only admits authority; it never issues a Child, dispatches A2A,
   * executes a provider operation or claims acceptance. All journals and
   * the native crypto port must be supplied by the trusted owner, not ADK. */
  async admitOperationalExecution(deps){
   if(closed||!operationalCoordinator||session.phase!=='operational')
    deny('execution admission requires an activated operational Coordinator');
   if(executionAdmissionAttempted||executionAdmissionFlight)
    deny('execution admission already attempted');
   executionAdmissionAttempted=true; // one-shot even on ambiguous failure
   executionAdmissionFlight=(async()=>{
    if(!fields(deps,['operationalSessionStore','gatewayTaskJournal',
      'issuerChildJournal','gatewayChildJournal','nativeCryptoPort',
      'effectFenceJournal','sequentialEffectJournal','completionObserver'])||
       !(deps.operationalSessionStore instanceof TrustedOperationalSessionStore)||
       deps.operationalSessionStore!==options.operationalSessionStore||
       !(deps.gatewayTaskJournal instanceof DurableAuthorityTaskJournal)||
       deps.gatewayTaskJournal===options.taskJournal||
       !(deps.issuerChildJournal instanceof DurableAuthorityOnlyChildJournal)||
       !(deps.gatewayChildJournal instanceof DurableAuthorityOnlyChildJournal)||
       deps.issuerChildJournal===deps.gatewayChildJournal||
       deps.nativeCryptoPort?.kind!=='rust-native'||
       typeof deps.nativeCryptoPort.issueChild!=='function')
     deny('distinct owner-private journals and native Rust Child port required');
    const root=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
    if(root.session_id!==snapshot.session_id||
       root.base_revision!==snapshot.base_revision||
       root.engineer_did!==approval.engineerDid||
       !isDeepStrictEqual(root.repository,snapshot.repository))
     deny('Gateway admission cannot change original session or root');
    const gateway=new TrustedAuthorityOnlyGatewayAdmissions({
     repository:snapshot.repository,engineerDid:approval.engineerDid,
     coordinator:operationalCoordinator,approvals:files,
     operationalSessionStore:deps.operationalSessionStore,
     taskJournal:deps.gatewayTaskJournal,childJournal:deps.gatewayChildJournal,
     ...(deps.effectFenceJournal===undefined?{}:{effectFenceJournal:deps.effectFenceJournal}),
     ...(deps.sequentialEffectJournal===undefined?{}:{sequentialEffectJournal:deps.sequentialEffectJournal}),
     ...(deps.completionObserver===undefined?{}:{completionObserver:deps.completionObserver})
    });
    const childIssuer=new TrustedAuthorityOnlyChildIssuer({
     coordinator:operationalCoordinator,nativeCryptoPort:deps.nativeCryptoPort,
     journal:deps.issuerChildJournal
    });
    const admission=await gateway.activate(snapshot.session_id,snapshot.base_revision);
    if(closed)deny('host closed during Gateway admission');
    const live=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
    if(live.root_credential_id!==root.root_credential_id||
       live.authority_digest!==root.authority_digest)
     deny('operational root changed during Gateway admission');
    const executionHandle=Object.freeze({admission,gateway,childIssuer,
     /** R351.0: ADK selects the Task and specialist; only this trusted
      * owner derives the epoch, signed root pins and native Child request. */
     async proposeAndStageTask(input){
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         taskStageFailed||taskStageFlight||decisionFlight||
         dispatchFlight||completionFlight||d1FailurePreflightFlight||
         d1FailurePreflightFailed||dispatchFailed||completionFailed||
         a2aStarting||a2aOwner?.phase==='failed_closed'||
         ++decisionCalls>8)
       deny('bounded owner Task decision requires active quiescent root');
      // A registered Child or completed A2A report is NOT a verified
      // Gateway result. No new model turn until all earlier Tasks have
      // independently attested durable provider/Runner completion.
      if(stagedTaskIds.size!==gatewayAttestedTaskIds.size||
         [...stagedTaskIds.values()].some(pin=>
          !gatewayAttestedTaskIds.has(pin.task_id)))
       deny('next ADK Task decision requires independent Gateway completion');
      if(!fields(input,['model','runtimeTaskId','childParameters']))
       deny('ADK choice cannot supply root, session, or Task authorization');
      const before=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      const epoch=operationalCoordinator.registeredTaskCount+1;
      const proposer=new TrustedAuthorityOnlyAdkDecisionProposer({
       model:input.model,requirement,branch:before.branch,
       rootPermissions:before.root_permissions,
       agents:Object.fromEntries(Object.entries(options.trustedAgentRegistry).map(
        ([agent_id,pin])=>[agent_id,{capabilities:pin.capabilities}]
       )),
       previousTasks:[...gatewayAttestedTaskIds.values()].map(p=>({
        task_id:p.task_id,agent_id:p.agent_id
       }))
      });
      decisionFlight=(async()=>{
       const choice=await proposer.propose();
       const after=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       if(closed||session.phase!=='operational'||
          after.root_credential_id!==before.root_credential_id||
          after.authority_digest!==before.authority_digest||
          operationalCoordinator.registeredTaskCount!==epoch-1)
        deny('owner changed during ADK Task decision');
       const staged=await executionHandle.stageTask({
        task:{task_id:choice.task_id,epoch,agent_id:choice.agent_id,
         depends_on:[...choice.depends_on],permissions:[...choice.permissions]},
        runtimeTaskId:input.runtimeTaskId,
        childParameters:input.childParameters
       });
       return Object.freeze({...staged,
        decision_source:'owner_adk_candidate_coordinator_validated',
        instruction:choice.instruction});
      })();
      try{return await decisionFlight;}
      finally{decisionFlight=undefined;}
     },
     /** R350.2: owner-private Task -> Gateway -> native Child -> enrollment.
     * The caller supplies only Task choices and fresh Child metadata;
     * session, revision, requirement, root and DID come from trusted state.
     * Every ambiguous effect is terminal for this operational session. */
    async stageTask(input){
     if(closed||session.phase!=='operational'||taskStageFailed||
        gateway.phase!=='active'||taskStageFlight)
      deny('Task staging requires quiescent live owner, root and Gateway');
     if(!fields(input,['task','runtimeTaskId','childParameters'])||
        !fields(input.task,['task_id','epoch','agent_id','depends_on','permissions'])||
        !fields(input.childParameters,['credential_id','credential_status',
          'valid_from','validity_seconds']))
      deny('Task input cannot supply root, authority or private identity');
     taskStageFlight=(async()=>{
      const live=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      const proposal={
       session_id:live.session_id,
       requirement_sha256:live.requirement_sha256,
       base_revision:live.base_revision,
       branch:live.branch,
       task_id:input.task.task_id,
       epoch:input.task.epoch,
       agent_id:input.task.agent_id,
       depends_on:input.task.depends_on,
       permissions:input.task.permissions
      };
      const check=()=>{
       if(closed||session.phase!=='operational')
        deny('Task staging stopped by Engineer retirement');
       const current=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       if(current.root_credential_id!==live.root_credential_id||
          current.authority_digest!==live.authority_digest)
        deny('Task staging cannot change operational root');
      };
      check();
      const registered=await operationalCoordinator.registerTask(proposal);
      check();
      const bound=await gateway.bindTrustedTask(
       registered.task_id,input.runtimeTaskId,registered.agent_id);
      check();
      const child=await childIssuer.issueForRegisteredTask(
       registered.task_id,input.childParameters);
      check();
      const enrolled=await gateway.enrollTrustedIssuedChild(
       registered.task_id,input.runtimeTaskId,childIssuer);
      check();
      if(registered.authority_digest!==live.authority_digest||
         bound.authority_digest!==live.authority_digest||
         child.root_credential_id!==live.root_credential_id||
         child.credential_id!==enrolled.credential_id||
         enrolled.runtime_task_id!==input.runtimeTaskId||
         enrolled.gateway_execution_authorized!==false)
       deny('Task, native Child and Gateway enrollment disagree');
      stagedTaskCount++;
      stagedTaskIds.set(input.runtimeTaskId,Object.freeze({
       task_id:registered.task_id,agent_id:registered.agent_id,
       operation:registered.permissions.find(p=>
        p.operation==='update_file'||p.operation==='run_tests')?.operation
      }));
      return Object.freeze({
       status:'owner_child_enrolled_no_provider_execution',
       task_id:registered.task_id,
       runtime_task_id:input.runtimeTaskId,
       epoch:registered.epoch,
       agent_id:registered.agent_id,
       credential_id:child.credential_id,
       gateway_execution_authorized:false
      });
     })();
     try{return await taskStageFlight;}
     catch(error){
      taskStageFailed=true;
      if(session.phase==='operational'){
       try{await session.retireOperationalRoot();}
       catch{deny('Task admission failed and root retirement unconfirmed');}
      }
      throw error;
     }finally{taskStageFlight=undefined;}
    },
    /** R350.3: only the trusted owner may provision SDK A2A agent endpoints
     * and distinct private role-pinned IPC. No LLM/HTTP/Engineer approval
     * endpoint can pass a Coordinator, issuer, Gateway or signing key. */
    async startSdkA2AOwner(config){
     if(closed||session.phase!=='operational'||taskStageFailed||
        taskStageFlight||stagedTaskCount<1||gateway.phase!=='active'||
        a2aStartAttempted||a2aStarting||a2aOwner)
      deny('A2A Owner requires an enrolled Child and quiescent live root');
     if(!fields(config,['agentBaseUrls','stageChannels','agentBindingChannels',
       'a2aPolling'])||
        !fields(config.agentBaseUrls,['backend','frontend','test'])||
        !fields(config.stageChannels,['backend','frontend','test'])||
        !fields(config.agentBindingChannels,['backend','frontend','test']))
      deny('A2A Owner cannot accept root, transport overrides or legacy channels');
     a2aStartAttempted=true;
     a2aStarting=(async()=>{
      const owner=await startTrustedAuthorityOnlySdkA2AOwner({
       coordinator:operationalCoordinator,childIssuer,gateway,
       agentBaseUrls:config.agentBaseUrls,
       stageChannels:config.stageChannels,
       agentBindingChannels:config.agentBindingChannels,
       ...(config.a2aPolling===undefined?{}:{a2aPolling:config.a2aPolling})
      });
      if(closed||session.phase!=='operational'){
       await owner.close();
       deny('Engineer root retired during A2A Owner startup');
      }
      operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      a2aOwner=owner;
      // SDK Owner is private to the verified R349 Engineer session.
      // Only guarded dispatch and attestation on this handle can use it.
      return Object.freeze({
       status:'owner_protected_a2a_started_no_provider_execution',
       gateway_execution_authorized:false
      });
     })();
     try{return await a2aStarting;}
     catch(error){
      if(session.phase==='operational'){
       try{await session.retireOperationalRoot();}
       catch{deny('A2A Owner startup failed and root retirement unconfirmed');}
      }
      throw error;
     }finally{a2aStarting=undefined;}
     },
    /** R350.6: owner-only installation of the real in-process Gateway effect
     * runtime. The original shared Prepare store, mutation preflight and
     * Runner preflight MUST be bound to this very Gateway instance.
     * This is not an A2A/ADK/MCP callable route. */
    bindNativeGatewayEffects(deps){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||taskStageFlight||dispatchFlight||dispatchFailed||
        nativeEffectBindingAttempted)
      deny('native Gateway effect runtime requires active quiescent owner');
     nativeEffectBindingAttempted=true;
     if(!fields(deps,['store','mutation','runner','giteaClient','failureObserver'])||
        !(deps.store instanceof InMemoryRequestStore)||
        !GiteaClient.isPinnedRepositoryClient(
         deps.giteaClient,snapshot.repository.owner,snapshot.repository.repository)||
        !TrustedAuthorityOnlyGiteaMutationPreflight.isNativeForOwner(
         deps.mutation,gateway,deps.giteaClient,
         snapshot.repository.owner+'/'+snapshot.repository.repository,branch)||
        !TrustedAuthorityOnlyRunnerPreflight.isNativeForOwner(
         deps.runner,gateway,deps.giteaClient,
         snapshot.repository.owner+'/'+snapshot.repository.repository,branch)||
        (deps.failureObserver!==undefined&&
         (!(deps.failureObserver instanceof AuthenticatedRunnerFailureObserver)||
          !deps.runner.isForFailureObserver(deps.failureObserver)))){
      dispatchFailed=true;
      deny('native Gateway effect dependencies are not from original session');
     }
     nativeEffectBinding=Object.freeze({...deps});
     return Object.freeze({
      status:'owner_native_gateway_effects_bound_no_execution',
      gateway_execution_authorized:false
     });
    },
    /** Obtain a unique one-shot owner stager after enrolling the Child.
     * Pin exact original Gateway, Task ID, role/tool and owner-selected HEAD. */
    createEnrolledNativeEffectStager(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        !nativeEffectBinding||taskStageFlight||dispatchFlight||
        taskStageFailed||dispatchFailed||
        !fields(input,['runtimeTaskId','expectedHeadSha'])||
        typeof input?.expectedHeadSha!=='string'||
        !/^[a-f0-9]{40}$/u.test(input.expectedHeadSha))
      deny('native effect staging requires pinned owner HEAD and live runtime');
     const pin=stagedTaskIds.get(input.runtimeTaskId);
     if(!pin||!['update_file','run_tests'].includes(pin.operation)||
        issuedEffectStagers.has(input.runtimeTaskId)||
        dispatchAttempts.has(input.runtimeTaskId))
      deny('native effect stager requires enrolled, unspent Task');
     operationalCoordinator.assertTrustedGatewayAuthorityBinding();
     const stager=new TrustedAuthorityOnlyEffectStager({
      store:nativeEffectBinding.store,admissions:gateway,
      mutation:nativeEffectBinding.mutation,
      runner:nativeEffectBinding.runner,
      runtimeTaskId:input.runtimeTaskId,
      tool:pin.operation,expectedHeadSha:input.expectedHeadSha
     });
     issuedEffectStagers.set(input.runtimeTaskId,stager);
     return stager;
    },
     /** R350.5 — dispatch only the original enrolled Task with a genuine
      * owner-private stager created for this Gateway, runtime ID and effect.
      * A2A output is a report, never Gateway provider completion. */
     async dispatchEnrolledTask(input){
      if(closed||session.phase!=='operational'||!a2aOwner||
         taskStageFailed||dispatchFailed||dispatchFlight||
         d1FailurePreflightFlight||d1FailurePreflightFailed||
         taskStageFlight||gateway.phase!=='active')
       deny('protected A2A dispatch requires quiescent live original session');
      if(!fields(input,['taskId','runtimeTaskId','instruction','effectStager','d1Candidate']))
       deny('protected A2A dispatch rejects credentials or authority overrides');
      const pin=stagedTaskIds.get(input.runtimeTaskId);
      if(!pin||pin.task_id!==input.taskId||
         !['update_file','run_tests'].includes(pin.operation)||
         !(input.effectStager instanceof TrustedAuthorityOnlyEffectStager)||
         issuedEffectStagers.get(input.runtimeTaskId)!==input.effectStager||
         !input.effectStager.isForOwnerTask(gateway,input.runtimeTaskId,pin.operation))
       deny('protected A2A dispatch requires an original owner-bound effect stager');
      if(input.d1Candidate!==undefined&&
         (pin.operation!=='run_tests'||pin.agent_id!=='test'||
          !nativeEffectBinding?.failureObserver||
          d1FailurePreflightAttempted))
       deny('D1 failure observer must be installed before original Test dispatch');
      if(dispatchAttempts.has(input.runtimeTaskId))
       deny('protected A2A dispatch replayed');
      dispatchAttempts.add(input.runtimeTaskId); // before sending A2A / private IPC
      dispatchFlight=(async()=>{
       operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       const report=await a2aOwner.dispatchIssuedTask({
        taskId:input.taskId,runtimeTaskId:input.runtimeTaskId,
        instruction:input.instruction,effectStager:input.effectStager
       });
       if(closed||session.phase!=='operational')
        deny('Engineer retired while A2A Task was executing');
       operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       if(report.status!=='a2a_report_not_gateway_completed'||
          report.task_id!==input.taskId||
          report.runtime_task_id!==input.runtimeTaskId||
          report.provider_completion_attested!==false)
        deny('untrusted or mismatched A2A Task report');
       // This is NOT completion. A2A metadata cannot release dependencies.
       dispatchedReports.set(input.runtimeTaskId,Object.freeze({
        task_id:report.task_id,runtime_task_id:report.runtime_task_id
       }));
       return report;
      })();
      try{return await dispatchFlight;}
      catch(error){
       if(input.d1Candidate!==undefined&&
          pin.operation==='run_tests'&&
          nativeEffectBinding?.failureObserver){
        // A Test agent finishes A2A in FAILED state after controlled Docker
        // FAIL. Never treat that A2A error as evidence; cross-check the
        // exact original immutable Runner POST, MAC, native Gateway flight,
        // Gitea HEAD, signed root and Child BEFORE preserving this root.
        d1FailurePreflightAttempted=true;
        try{
         const intent=await nativeEffectBinding.runner
          .getAttemptedIntentForOwnerTask(input.runtimeTaskId);
         const proof=await preflightNativeD1FailureCandidate({
          coordinator:operationalCoordinator,childIssuer,gateway,
          failureObserver:nativeEffectBinding.failureObserver,
          failedRunnerIntent:intent,candidate:input.d1Candidate
         });
         if(closed||session.phase!=='operational'||
            gateway.phase!=='active'||
            proof.status!=='native_d1_failure_source_preflight_only'||
            proof.failed_task_id!==input.taskId||
            proof.failed_runtime_task_id!==input.runtimeTaskId||
            proof.gateway_task_completed!==false||
            proof.child_credential_issued!==false||
            proof.recovery_authorized!==false||
            proof.task_registered!==false)
          deny('authenticated failure flight differs from dispatched Test');
         d1VerifiedFailure=Object.freeze({
          proof,candidate:structuredClone(input.d1Candidate),
          // Never accept this provenance from the model or an A2A report.
          intent,failureObserver:nativeEffectBinding.failureObserver
         });
         // The failed Test Task is NEVER put in the successful dependency
         // ledger, and no model/agent response is returned as a PASS.
         return Object.freeze({
          ...proof,status:'owner_verified_native_test_failure_preflight_only',
          gateway_task_completed:false,recovery_authorized:false,
          child_credential_issued:false,task_registered:false
         });
        }catch(verificationError){
         dispatchFailed=true;
         if(session.phase==='operational'){
          try{await retire();}
          catch{deny('unverified native Test FAIL and root retirement unconfirmed');}
         }
         throw verificationError;
        }
       }
       dispatchFailed=true;
       if(session.phase==='operational'){
        try{await retire();}
        catch{deny('A2A dispatch failed and operational retirement unconfirmed');}
       }
       throw error;
      }finally{dispatchFlight=undefined;}
     },
     /** R352.1: a verified failure may invite ONE bounded ADK proposal.
      * The output is intentionally NOT a Task, a Child, a new permission,
      * a Test PASS, or a Gateway recovery admission. */
     async proposeVerifiedD1RepairTask(input){
      if(closed||session.phase!=='operational'||
         gateway.phase!=='active'||!d1VerifiedFailure||
         d1RepairProposalAttempted||dispatchFlight||completionFlight||
         d1FailurePreflightFlight||decisionFlight||
         !fields(input,['model']))
       deny('D1 model proposal requires authenticated original Runner failure');
      d1RepairProposalAttempted=true; // irreversible decision budget
      const {proof,candidate}=d1VerifiedFailure;
      const live=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      const proposer=new TrustedAuthorityOnlyAdkDecisionProposer({
       model:input.model,requirement,branch:live.branch,
       rootPermissions:live.root_permissions,
       agents:Object.fromEntries(Object.entries(options.trustedAgentRegistry)
        .map(([agent_id,pin])=>[agent_id,{capabilities:pin.capabilities}])),
       previousTasks:[...gatewayAttestedTaskIds.values()],
       verifiedFailure:{
        failed_phase:proof.failed_phase,
        source_evidence_sha256:proof.source_evidence_sha256
       }
      });
      const choice=await proposer.propose();
      const current=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      if(closed||session.phase!=='operational'||
         current.root_credential_id!==live.root_credential_id||
         current.authority_digest!==live.authority_digest||
         choice.agent_id!==candidate.role||
         createHash('sha256').update(JSON.stringify(choice.permissions))
          .digest('hex')!==proof.candidate_permissions_sha256)
       deny('model D1 candidate not identical to original preflighted permission pair');
      const failed=operationalCoordinator.assertTrustedGatewayRegisteredTask(
       proof.failed_task_id);
      // A failed Test is NOT a predecessor of its own repair. The owner
      // fixes the repair dependencies to the already-attested Test prerequisites.
      if(!isDeepStrictEqual(choice.depends_on,failed.depends_on)||
         choice.task_id===failed.task_id)
       deny('D1 proposal changed the original Test prerequisite chain');
      d1RepairProposal=Object.freeze({
       task_id:choice.task_id,agent_id:choice.agent_id,
       depends_on:Object.freeze([...choice.depends_on]),
       permissions:Object.freeze(structuredClone(choice.permissions)),
       instruction:choice.instruction,
       source_evidence_sha256:proof.source_evidence_sha256
      });
      return Object.freeze({
       status:'d1_model_candidate_not_recovery_authorized',
       task_id:choice.task_id,agent_id:choice.agent_id,
       depends_on:choice.depends_on,permissions:choice.permissions,
       instruction:choice.instruction,
       failed_phase:proof.failed_phase,
       source_evidence_sha256:proof.source_evidence_sha256,
       recovery_authorized:false,child_credential_issued:false,
       task_registered:false,gateway_task_completed:false
      });
     },
     /** R352.2: original protected Engineer owner consumes a previously
      * verified model proposal exactly once. Existing R341/R342 components
      * revalidate the full independent FAIL, reserve a crash-durable source
      * BEFORE Coordinator registration, then issue/enroll a NEW native Child.
      * The failed Test remains uncompleted; this is NOT repair execution. */
     async admitVerifiedD1RepairTask(input){
      if(closed||session.phase!=='operational'||
         gateway.phase!=='active'||!d1VerifiedFailure||!d1RepairProposal||
         !d1RepairProposalAttempted||d1RepairAdmissionAttempted||
         d1RepairAdmissionFlight||d1FailurePreflightFlight||
         decisionFlight||taskStageFlight||dispatchFlight||completionFlight||
         taskStageFailed||dispatchFailed||completionFailed||
         !fields(input,['journal','freshStatusEntry'])||
         !(input.journal instanceof DurableNativeD1FirstTaskAdmissionJournal)||
         !fields(input.freshStatusEntry,
          ['statusListCredential','statusListIndex']))
       deny('D1 admission requires one original verified proposal and private journal');
      d1RepairAdmissionAttempted=true; // no retries after crash/ambiguous write
      d1RepairAdmissionFlight=(async()=>{
       const {proof,candidate,intent,failureObserver}=d1VerifiedFailure;
       const proposal=d1RepairProposal;
       const rootBefore=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       const failed=operationalCoordinator.assertTrustedGatewayRegisteredTask(
        intent.task_id);
       if(proof.failed_task_id!==intent.task_id||
          proof.original_session_id!==rootBefore.session_id||
          rootBefore.root_credential_id!==intent.root_credential_id||
          proposal.source_evidence_sha256!==proof.source_evidence_sha256||
          proposal.agent_id!==candidate.role||
          !isDeepStrictEqual(proposal.permissions,candidate.permissions)||
          !isDeepStrictEqual(proposal.depends_on,failed.depends_on)||
          failed.agent_id!=='test'||
          failed.epoch!==intent.epoch||
          stagedTaskIds.has(intent.runtime_task_id)===false||
          gatewayAttestedTaskIds.has(intent.task_id)||
          operationalCoordinator.registeredTaskCount!==intent.epoch)
        deny('D1 proposal, original failed Runner and signed epoch disagree');
       const admitted=await admitFirstNativeD1RepairTask({
        coordinator:operationalCoordinator,childIssuer,gateway,
        failureObserver,failedRunnerIntent:intent,candidate,
        journal:input.journal
       });
       if(admitted.status!=='native_d1_task_registered_without_gateway_or_child'||
          admitted.task_registered!==true||admitted.gateway_registered!==false||
          admitted.child_credential_issued!==false||
          admitted.recovery_execution_authorized!==false||
          admitted.epoch!==intent.epoch+1||
          admitted.source_evidence_sha256!==proof.source_evidence_sha256)
        deny('original D1 Coordinator Task admission is not canonical');
       const enrolled=await enrollFirstNativeD1ChildAtGateway({
        coordinator:operationalCoordinator,childIssuer,gateway,
        failureObserver,failedRunnerIntent:intent,
        journal:input.journal,admission:admitted,
        freshStatusEntry:input.freshStatusEntry
       });
       if(enrolled.status!=='native_d1_child_enrolled_no_provider_effect'||
          enrolled.task_id!==admitted.task_id||
          enrolled.epoch!==admitted.epoch||
          enrolled.original_root_credential_id!==rootBefore.root_credential_id||
          enrolled.source_evidence_sha256!==proof.source_evidence_sha256||
          enrolled.native_child_issued!==true||
          enrolled.gateway_child_enrolled!==true||
          enrolled.provider_executed!==false||
          enrolled.recovery_completed!==false||
          enrolled.gateway_execution_authorized!==false||
          stagedTaskIds.has(enrolled.runtime_task_id))
        deny('new native D1 Child/Gateway enrollment differs from original root');
       const row=operationalCoordinator.assertTrustedGatewayRegisteredTask(
        admitted.task_id);
       if(row.agent_id!==candidate.role||
          !isDeepStrictEqual(row.permissions,candidate.permissions)||
          !isDeepStrictEqual(row.depends_on,failed.depends_on))
        deny('registered native D1 repair Task changed from trusted model proposal');
       // Only the newly enrolled Task is eligible for the existing protected
       // A2A dispatch path. No failed-Test or model-provided completion is added.
       stagedTaskIds.set(enrolled.runtime_task_id,Object.freeze({
        task_id:enrolled.task_id,agent_id:row.agent_id,
        operation:row.permissions.find(p=>
         p.operation==='update_file'||p.operation==='run_tests')?.operation
       }));
       stagedTaskCount++;
       return Object.freeze({...enrolled,
        decision_source:'verified_d1_model_original_coordinator',
        failed_test_task_id:intent.task_id,
        recovery_completed:false,provider_executed:false});
      })();
      try{return await d1RepairAdmissionFlight;}
      catch(error){
       if(session.phase==='operational'){
        try{await retire();}
        catch{deny('ambiguous D1 Task/Child admission and retirement unconfirmed');}
       }
       throw error;
      }finally{d1RepairAdmissionFlight=undefined;}
     },
     /** R350.7 — Gateway alone can confirm an actual provider/Runner
      * completion. The owner passes only IDs pinned to its own prior A2A
      * report, never a model-provided success, receipt, HEAD or signature. */
     async attestEnrolledTaskCompletion(input){
      if(closed||session.phase!=='operational'||!a2aOwner||
         gateway.phase!=='active'||dispatchFailed||completionFailed||
         taskStageFailed||taskStageFlight||dispatchFlight||
         completionFlight||d1FailurePreflightFlight||
         d1FailurePreflightFailed)
       deny('independent Task completion requires a live quiescent owner');
      if(!fields(input,['taskId','runtimeTaskId'])||
         typeof input?.taskId!=='string'||
         typeof input?.runtimeTaskId!=='string')
       deny('completion cannot accept model or provider success claims');
      const pinned=dispatchedReports.get(input.runtimeTaskId);
      if(!pinned||pinned.task_id!==input.taskId||
         completionAttempts.has(input.runtimeTaskId))
       deny('completion has no matching original A2A dispatch report');
      completionAttempts.add(input.runtimeTaskId); // before any async observer read
      completionFlight=(async()=>{
       operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       const observed=await a2aOwner.attestIndependentGatewayCompletion(
        input.taskId,input.runtimeTaskId);
       if(closed||session.phase!=='operational'||
          gateway.phase!=='active')
        deny('Engineer retired during independent completion');
       operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       if(observed.status!=='owner_gateway_completion_independently_observed'||
          observed.task_id!==input.taskId||
          observed.runtime_task_id!==input.runtimeTaskId||
          observed.gateway_execution_authorized!==false)
        deny('independent Gateway completion receipt differs from Task');
       // The receipt is produced by the original protected A2A Owner's
       // independent Gateway observer (never a caller/model parameter).
       // Keep only minimal Task/role provenance, no provider secrets,
       // model-provided artifacts, credentials, or assumed pass claims.
       const pin=stagedTaskIds.get(input.runtimeTaskId);
       if(!pin||pin.task_id!==input.taskId||
          gatewayAttestedTaskIds.has(input.taskId))
        deny('Gateway completion no longer matches original staged Task');
       gatewayAttestedTaskIds.set(input.taskId,Object.freeze({
        task_id:pin.task_id,agent_id:pin.agent_id
       }));
       dispatchedReports.delete(input.runtimeTaskId);
       return observed;
      })();
      try{return await completionFlight;}
      catch(error){
       completionFailed=true;
       if(session.phase==='operational'){
        try{await session.retireOperationalRoot();}
        catch{deny('independent completion failed and root retirement unconfirmed');}
       }
       throw error;
      }finally{completionFlight=undefined;}
     },
     /** R352.0: verify a FAILED Test Runner by the original native
      * Gateway flight + private MAC/independent Gitea observer. This is a
      * bounded D1 PREFLIGHT only, not Test PASS, repair admission or a
      * model-triggered Child. It never enters gatewayAttestedTaskIds. */
     async preflightNativeD1Repair(input){
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         !a2aOwner||dispatchFailed||completionFailed||taskStageFailed||
         dispatchFlight||completionFlight||taskStageFlight||
         decisionFlight||d1FailurePreflightAttempted||
         d1FailurePreflightFlight||d1FailurePreflightFailed)
       deny('native D1 preflight needs one quiescent original Engineer owner');
      if(!fields(input,['failureObserver','failedRunnerIntent','candidate'])||
         !(input.failureObserver instanceof AuthenticatedRunnerFailureObserver))
       deny('D1 cannot accept unverified model/provider failure evidence');
      const intent=input.failedRunnerIntent;
      if(!intent||typeof intent!=='object'||Array.isArray(intent)||
         typeof intent.runtime_task_id!=='string'||
         typeof intent.task_id!=='string')
       deny('D1 requires original durable Test Task/Runner identity');
      // Prior A2A activity only identifies the Task to cross-check. It is
      // never proof of failure: the R339 observer validates the actual
      // Runner attempt, MAC, Gitea HEAD, Rust owner and original Gateway.
      const pin=stagedTaskIds.get(intent.runtime_task_id);
      const reported=dispatchedReports.get(intent.runtime_task_id);
      if(!pin||pin.task_id!==intent.task_id||pin.agent_id!=='test'||
         pin.operation!=='run_tests'||
         reported?.task_id!==intent.task_id||
         reported.runtime_task_id!==intent.runtime_task_id||
         completionAttempts.has(intent.runtime_task_id)||
         gatewayAttestedTaskIds.has(intent.task_id))
       deny('D1 requires dispatched but never-completed original Test Task');
      d1FailurePreflightAttempted=true; // consume BEFORE observer I/O
      d1FailurePreflightFlight=(async()=>{
       operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       const proof=await preflightNativeD1FailureCandidate({
        coordinator:operationalCoordinator,childIssuer,gateway,
        failureObserver:input.failureObserver,
        failedRunnerIntent:intent,candidate:input.candidate
       });
       if(closed||session.phase!=='operational'||
          gateway.phase!=='active'||
          proof.status!=='native_d1_failure_source_preflight_only'||
          proof.original_session_id!==snapshot.session_id||
          proof.failed_task_id!==intent.task_id||
          proof.failed_runtime_task_id!==intent.runtime_task_id||
          proof.gateway_task_completed!==false||
          proof.child_credential_issued!==false||
          proof.task_registered!==false||
          proof.recovery_authorized!==false)
        deny('Runner FAIL preflight changed original Engineer session');
       operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       // Proof is diagnostic data only. It NEVER releases the normal
       // successful-completion gate or issues a replacement Child.
       return proof;
      })();
      try{return await d1FailurePreflightFlight;}
      catch(error){
       d1FailurePreflightFailed=true;
       // Ambiguous Runner/observer evidence cannot become a later D1:
       // retire the root and require independent recovery.
       if(session.phase==='operational'){
        try{await retire();}
        catch{deny('D1 failed and original root retirement unconfirmed');}
       }
       throw error;
      }finally{d1FailurePreflightFlight=undefined;}
     }
    });
    return executionHandle;
   })();
   try{return await executionAdmissionFlight;}
   catch(error){
    if(session.phase==='operational'){
     try{await session.retireOperationalRoot();}
     catch{deny('Gateway admission failed and root retirement unconfirmed');}
    }
    throw error;
   }finally{executionAdmissionFlight=undefined;}
  },
 close(){
   if(closing)return closing;
   closed=true;
   closing=(async()=>{
    // Await the transition owner before deciding which root to retire.
    if(activationFlight)try{await activationFlight;}catch{/* Recheck state below. */}
    if(executionAdmissionFlight)try{await executionAdmissionFlight;}catch{/* Fail closed below. */}
    if(decisionFlight)try{await decisionFlight;}catch{/* Recheck root below. */}
    if(taskStageFlight)try{await taskStageFlight;}catch{/* Recheck root below. */}
    if(a2aStarting)try{await a2aStarting;}catch{/* Recheck root below. */}
    if(dispatchFlight)try{await dispatchFlight;}catch{/* Recheck root below. */}
    if(completionFlight)try{await completionFlight;}catch{/* Recheck root below. */}
    if(d1FailurePreflightFlight)try{await d1FailurePreflightFlight;}catch{/* Recheck root below. */}
    if(d1RepairAdmissionFlight)try{await d1RepairAdmissionFlight;}catch{/* Recheck root below. */}
    try{
     try{if(a2aOwner)await a2aOwner.close();}
     finally{if(session.phase!=='revoked')await retire();}
    }finally{
     if(server.listening)await new Promise((ok,bad)=>server.close(e=>e?bad(e):ok()));
    }
   })();return closing;
  }
 });
}

/** Operator-private recovery only. No automatic reapproval, no issuance,
 * and no HTTP/A2A/MCP route. Both the terminal Gateway fence and native
 * Rust revocation must be confirmed before marking a root reconciled. */
export async function reconcileTrustedAuthorityOnlyReviewRoots(config){
 if(!config||
    !(config.operationalRecoveryStore instanceof TrustedOperationalRecoveryStore)||
    !(config.operationalSessionStore instanceof TrustedOperationalSessionStore)||
    typeof config.credentials?.revokeRoot!=='function')
  deny('recovery requires original durable owner journals and native revoker');
 return reconcileOrphanedOperationalRoots({
  store:config.operationalRecoveryStore,
  gateway:{retireSession:id=>config.operationalSessionStore.markRetired(id)},
  credentials:config.credentials
 });
}

/** Explicit owner entrypoint; the browser can sign, but only this private
 * returned handle can request the native operational transition. */
export async function startTrustedAuthorityOnlyReviewHost(options){
 const port=options?.approvalPort??0;
 if(!Number.isSafeInteger(port)||port<0||port>65535)deny('invalid local listener port');
 const host=await createTrustedAuthorityOnlyReviewHost(options);
 try{
  await new Promise((ok,bad)=>{
   host.server.once('error',bad);
   host.server.listen(port,'127.0.0.1',()=>{host.server.off('error',bad);ok();});
  });
  return Object.freeze({engineerUrl:'http://127.0.0.1:'+host.server.address().port,
   get phase(){return host.phase;},activateOperational:root=>host.activateOperational(root),
   admitOperationalExecution:deps=>host.admitOperationalExecution(deps),
   close:()=>host.close()});
 }catch(error){
  try{await host.close();}catch{deny('listener startup failed and root retirement unconfirmed');}
  throw error;
 }
}
