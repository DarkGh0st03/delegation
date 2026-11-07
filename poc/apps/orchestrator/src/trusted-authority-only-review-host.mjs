import {randomBytes} from 'node:crypto';
import {runTrustedAuthorityOnlyAdaptiveWorkLoop} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-adaptive-work-loop.mjs';
import {runTrustedAuthorityOnlyOperationalWorkflow}
 from './trusted-authority-only-operational-launcher.mjs';
import {TrustedAuthorityOnlyBranchExecutor} from '../../gateway/src/trusted-authority-only-branch-executor.ts';
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
import {TrustedAuthorityOnlySequentialReadUpdateStager}
 from '../../gateway/src/trusted-authority-only-sequential-read-update-stager.ts';
import {AuthenticatedGiteaMutationCompletionObserver}
 from '../../gateway/src/trusted-authority-only-gitea-mutation-evidence.ts';
import {AuthenticatedGiteaReadCompletionObserver}
 from '../../gateway/src/trusted-authority-only-gitea-evidence.ts';
import {canonicalFileUri} from '../../gateway/src/canonical.ts';
import {TrustedAuthorityOnlyAdkDecisionProposer}
 from '../../../packages/orchestrator-runtime/src/trusted-authority-only-adk-decision-proposer.mjs';
import {TrustedAuthorityOnlyGiteaMutationPreflight} from '../../gateway/src/trusted-authority-only-mutation-preflight.ts';
import {TrustedAuthorityOnlyRunnerPreflight} from '../../gateway/src/trusted-authority-only-runner-preflight.ts';
import {TrustedAuthorityOnlyPullRequestExecutor}
 from '../../gateway/src/trusted-authority-only-pull-request-executor.ts';
import {GiteaClient} from '../../gateway/src/gitea-client.ts';
import {InMemoryRequestStore} from '../../gateway/src/prepare.ts';
import {TrustedAuthorityOnlyChildIssuer} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-child-issuer.ts';
import {preflightNativeD1FailureCandidate,observeTrustedNativeTestFailure}
 from '../../../packages/orchestrator-runtime/src/trusted-native-runner-failure-d1-preflight.ts';
import {DurableNativeD1FirstTaskAdmissionJournal,
 admitFirstNativeD1RepairTask}
 from '../../../packages/orchestrator-runtime/src/trusted-native-d1-first-task-admission.ts';
import {enrollFirstNativeD1ChildAtGateway}
 from '../../../packages/orchestrator-runtime/src/trusted-native-d1-child-gateway-bind.ts';
import {AuthenticatedRunnerCompletionObserver}
 from '../../gateway/src/trusted-authority-only-runner-evidence.ts';
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
  d1RepairAdmissionAttempted=false,d1RepairAdmissionFlight,
  d1DispatchPin,d1RepairAttested=false,
  d1RetestAttempted=false,d1RetestPin,d1RetestPassed=false;
 let nativeEffectBindingAttempted=false,nativeEffectBinding;
 let decisionFlight,decisionCalls=0;
 let adaptiveLoopAttempted=false,adaptiveLoopFlight;
 // Retain at most two independently authenticated Runner FAILs.
 // Neither is a completed Task or a new grant under the Engineer root.
 const adaptiveVerifiedFailures=[];
 // Set only after the adaptive controller re-opens an independent latest
 // Runner PASS on the current Gitea HEAD. Never trust A2A readiness text.
 let adaptiveReadyProof;
 const adaptiveInstructions=new Map();
 // The model never receives read data until a signed Child, Gateway read
 // receipt and independent Gitea content have all been reverified.
 const adaptiveSourceObservations=new Map();
 let branchAdmissionAttempted=false;
 const branchTaskPins=new Map(),branchStageAttempts=new Set();
 // R357: a signed create_branch ceiling cannot admit a worker Child before
 // the exact original root-owned branch has independent Gateway completion.
 // Neither a preexisting provider branch nor a model/A2A report suffices.
 function branchReadyForWorkers(){
  const root=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
  if(!root.root_permissions.some(p=>p.operation==='create_branch'))return true;
  return [...branchTaskPins.values()].some(pin=>
   gatewayAttestedTaskIds.has(pin.task_id));
 }
 let pullRequestAdmissionAttempted=false;
 const pullRequestTaskPins=new Map();
 const pullRequestStageAttempts=new Set();
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
      if(!branchReadyForWorkers())
       deny('Backend/Frontend/Test require independently completed original branch Task');
      // A registered Child or completed A2A report is NOT a verified
      // Gateway result. No new model turn until all earlier Tasks have
      // independently attested durable provider/Runner completion.
      const pending=[...stagedTaskIds.values()].filter(pin=>
        !gatewayAttestedTaskIds.has(pin.task_id));
      // A fresh independently passed D1 retest supersedes the old FAIL
      // for scheduling only; it NEVER completes the original Test Task.
      if(pending.length&&!(d1RetestPassed&&pending.length===1&&
         pending[0].task_id===d1VerifiedFailure?.proof?.failed_task_id))
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
       })),
       nextEpoch:epoch
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
     if(!branchReadyForWorkers())
      deny('worker Child admission requires independently completed original branch Task');
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
        p.operation==='update_file'||p.operation==='run_tests'||
        p.operation==='create_pull_request')?.operation??
        (registered.permissions.length===1&&
         registered.permissions[0]?.operation==='read_file'?'read_file':undefined)
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
    /** R367.1: SDK A2A must start AFTER original root/branch verification
     * but BEFORE a model chooses the first worker Task/Child. Later exact
     * private binds still require an admitted native Child and Task.
     * Only the trusted owner may provision SDK A2A agent endpoints
     * and distinct private role-pinned IPC. No LLM/HTTP/Engineer approval
     * endpoint can pass a Coordinator, issuer, Gateway or signing key. */
    async startSdkA2AOwner(config){
     if(closed||session.phase!=='operational'||taskStageFailed||
        taskStageFlight||!branchReadyForWorkers()||gateway.phase!=='active'||
        a2aStartAttempted||a2aStarting||a2aOwner)
      deny('A2A Owner requires independently verified branch and quiescent live root');
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
     if(!fields(deps,['store','mutation','runner','giteaClient','failureObserver','runnerPassObserver','pullRequestExecutor','branchExecutor','mutationObserver','readObserver'])||
        !(deps.store instanceof InMemoryRequestStore)||
        !GiteaClient.isPinnedRepositoryClient(
         deps.giteaClient,snapshot.repository.owner,snapshot.repository.repository)||
        !TrustedAuthorityOnlyGiteaMutationPreflight.isNativeForOwner(
         deps.mutation,gateway,deps.giteaClient,
         snapshot.repository.owner+'/'+snapshot.repository.repository,branch)||
        !TrustedAuthorityOnlyRunnerPreflight.isNativeForOwner(
         deps.runner,gateway,deps.giteaClient,
         snapshot.repository.owner+'/'+snapshot.repository.repository,branch)||
        (deps.mutationObserver!==undefined&&
         !AuthenticatedGiteaMutationCompletionObserver.isForRepository(
          deps.mutationObserver,
          snapshot.repository.owner+'/'+snapshot.repository.repository,branch))||
        (deps.readObserver!==undefined&&
         (!(deps.readObserver instanceof AuthenticatedGiteaReadCompletionObserver)||
          !AuthenticatedGiteaReadCompletionObserver.prototype.isForRepository.call(
           deps.readObserver,
           snapshot.repository.owner+'/'+snapshot.repository.repository,branch)))||
        (deps.branchExecutor!==undefined&&
         !TrustedAuthorityOnlyBranchExecutor.isNativeForOwner(deps.branchExecutor,gateway,deps.giteaClient))||
        (deps.pullRequestExecutor!==undefined&&
         !TrustedAuthorityOnlyPullRequestExecutor.isNativeForOwner(
          deps.pullRequestExecutor,gateway,deps.giteaClient,deps.runnerPassObserver))||
        (deps.runnerPassObserver!==undefined&&
         !AuthenticatedRunnerCompletionObserver.isForRepository(
          deps.runnerPassObserver,
          snapshot.repository.owner+'/'+snapshot.repository.repository,branch))||
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
    /** R353.0: original owner IDs only, never caller/model PASS or SHA.
     * Reopens the authenticated original Runner receipt after the Gateway
     * completion. This is evidence for a future PR, not PR authorization. */
    async inspectVerifiedPullRequestHead(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||dispatchFailed||completionFailed||
        taskStageFlight||dispatchFlight||completionFlight||decisionFlight||
        d1FailurePreflightFlight||d1RepairAdmissionFlight||
        !nativeEffectBinding?.runnerPassObserver||
        !fields(input,['taskId','runtimeTaskId']))
      deny('PR tested HEAD requires live original owner and installed Runner observer');
     const pin=stagedTaskIds.get(input.runtimeTaskId);
     if(!pin||pin.task_id!==input.taskId||pin.agent_id!=='test'||
        gatewayAttestedTaskIds.get(input.taskId)?.agent_id!=='test')
      deny('PR tested HEAD requires independently completed original Test');
     const task=operationalCoordinator.assertTrustedGatewayRegisteredTask(input.taskId);
     const rootBefore=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
     const taskCount=operationalCoordinator.registeredTaskCount;
     // A later failed or unfinished Test cannot be hidden by an older PASS.
     for(const p of stagedTaskIds.values()){
      if(p.agent_id==='test'&&
         operationalCoordinator.assertTrustedGatewayRegisteredTask(p.task_id).epoch>task.epoch)
       deny('PR tested HEAD requires latest original Test');
     }
     completionFlight=(async()=>{
      const completed=await nativeEffectBinding.runner
       .getCompletedIntentForOwnerTask(input.runtimeTaskId);
      const {intent}=completed;
      const child=childIssuer.assertTrustedIssuedChild(input.taskId,operationalCoordinator);
      const expected=Object.fromEntries([
       'session_id','authority_digest','root_credential_id','task_id',
       'runtime_task_id','epoch','agent_did','credential_id',
       'request_id','request_fingerprint'
      ].map(k=>[k,intent[k]]));
      if(intent.task_id!==task.task_id||intent.runtime_task_id!==input.runtimeTaskId||
         intent.epoch!==task.epoch||intent.agent_did!==task.agent_did||
         intent.credential_id!==child.credential_id||
         intent.session_id!==rootBefore.session_id||
         intent.authority_digest!==rootBefore.authority_digest||
         intent.root_credential_id!==rootBefore.root_credential_id||
         intent.branch!==branch||
         intent.repository!==snapshot.repository.owner+'/'+snapshot.repository.repository)
       deny('PR tested HEAD differs from original Test Runner flight');
      const proof=await AuthenticatedRunnerCompletionObserver.prototype
       .observeTestedHead.call(nativeEffectBinding.runnerPassObserver,expected);
      const live=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         live.root_credential_id!==rootBefore.root_credential_id||
         live.authority_digest!==rootBefore.authority_digest||
         operationalCoordinator.registeredTaskCount!==taskCount||
         proof.repository!==intent.repository||proof.branch!==intent.branch||
         proof.tested_commit_sha!==intent.expected_head_sha||
         proof.completion.evidence_sha256!==completed.verified_evidence_sha256||
         proof.project_tests!=='pass'||proof.researcher_acceptance!=='pass'||
         !Object.keys(expected).every(k=>proof.completion[k]===expected[k]))
       deny('PR tested HEAD changed during independent verification');
      return Object.freeze({
       status:'owner_verified_tested_head_not_pr_authorized',
       task_id:input.taskId,runtime_task_id:input.runtimeTaskId,
       repository:proof.repository,branch:proof.branch,
       tested_commit_sha:proof.tested_commit_sha,
       evidence_sha256:proof.completion.evidence_sha256,
       project_tests:'pass',researcher_acceptance:'pass',
       gateway_execution_authorized:false
      });
     })();
     try{return await completionFlight;}
     finally{completionFlight=undefined;}
    },
    /** R353.2: ADK may propose a PR Task only after original Test evidence.
     * Root/epoch/Child and exact tested SHA stay with the original owner.
     * Admission is not permission to issue a provider POST. */
    /** R370: one canonical, host-bound operational launch.
     * The caller supplies private owner transports but can never replace
     * the original Coordinator, Gateway, Child issuer or authority.
     * This is an in-process method; not an HTTP, MCP or A2A endpoint.
     * No automatic PR: a separate PR model, signed grant and private
     * native Rust/Gateway transport are explicitly required.
     */
    async runCanonicalOperationalWorkflow(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        !fields(input,['sdk','adaptive','draftPullRequest','createBranch']))
      deny('canonical launch requires original activated and live Engineer owner');
     return runTrustedAuthorityOnlyOperationalWorkflow({
      execution:executionHandle,...input
     });
    },
    /** Original-owner adaptive WORK loop. PR readiness is not PR execution.
     * The only external callback provisions fresh Child metadata; it grants no scope. */
    async runAdaptiveWorkLoop(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||dispatchFailed||completionFailed||adaptiveLoopAttempted||
        adaptiveLoopFlight||taskStageFlight||dispatchFlight||completionFlight||decisionFlight||
        pullRequestAdmissionAttempted||!nativeEffectBinding||
        !fields(input,['model','nextChildParameters','maxSteps','signal'])||
        typeof input.nextChildParameters!=='function')
      deny('adaptive loop requires original quiescent owner and private Child metadata provisioner');
     adaptiveLoopAttempted=true;
     // The root Branch and PR are separate, one-shot authority decisions.
     // Count only adaptive model turns against the caller's bounded maxSteps;
     // an independently completed Branch cannot consume the final ready_for_pr
     // decision. Re-entry is already fenced by adaptiveLoopAttempted.
     let adaptiveDecisionCalls=0;
     const original=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
     const readContext=async()=>{
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         taskStageFailed||dispatchFailed||completionFailed||taskStageFlight||dispatchFlight||completionFlight)
       deny('adaptive observations require live quiescent original owner');
      if(!branchReadyForWorkers())
       deny('adaptive Executor requires independently completed original branch Task');
      const live=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      if(live.root_credential_id!==original.root_credential_id||
         live.authority_digest!==original.authority_digest||
         (()=>{const pending=[...stagedTaskIds.values()].filter(p=>
           !gatewayAttestedTaskIds.has(p.task_id));
          return pending.length!==adaptiveVerifiedFailures.length||
           pending.some(p=>!adaptiveVerifiedFailures.some(f=>
            f.failed_task_id===p.task_id));
         })())
       deny('adaptive next decision requires independent completion or an authenticated Test FAIL');
      const head=await nativeEffectBinding.giteaClient.getBranchMetadata(branch);
      operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      const sourceObservations=[...adaptiveSourceObservations.values()]
       .filter(o=>o.revision===head.commit_sha);
      return {
       requirement,branch,rootPermissions:live.root_permissions,
       agents:Object.fromEntries(Object.entries(options.trustedAgentRegistry)
        .map(([id,p])=>[id,{capabilities:p.capabilities}])),
       previousTasks:[...gatewayAttestedTaskIds.values()].map(p=>({task_id:p.task_id,agent_id:p.agent_id})),
       nextEpoch:operationalCoordinator.registeredTaskCount+1,
       executionProgress:{current_head_sha:head.commit_sha,
        completed_work:[...stagedTaskIds.values()]
         .filter(p=>gatewayAttestedTaskIds.has(p.task_id))
         .map(p=>({task_id:p.task_id,agent_id:p.agent_id,
          operation:p.operation,instruction:adaptiveInstructions.get(p.task_id)??('Verified '+p.operation)})),
        ...(sourceObservations.length?{source_observations:sourceObservations}:{})},
       ...(adaptiveVerifiedFailures.length?{verifiedFailure:{
        failed_phase:adaptiveVerifiedFailures.at(-1).failed_phase,
        source_evidence_sha256:adaptiveVerifiedFailures.at(-1).source_evidence_sha256,
        ...(adaptiveVerifiedFailures.at(-1).typecheck_error_codes?.length?
         {typecheck_error_codes:[...adaptiveVerifiedFailures.at(-1).typecheck_error_codes]}:{})
       },verifiedFailureHistory:adaptiveVerifiedFailures.map(f=>({
        failed_task_id:f.failed_task_id,failed_phase:f.failed_phase,
        source_evidence_sha256:f.source_evidence_sha256,
        tested_commit_sha:f.tested_commit_sha
       }))}:{})
      };
     };
     adaptiveLoopFlight=runTrustedAuthorityOnlyAdaptiveWorkLoop({
      model:input.model,maxSteps:input.maxSteps,signal:input.signal,
      hooks:{readContext,
       beforeDecision:async()=>{
        if(decisionFlight||++adaptiveDecisionCalls>Math.min(input.maxSteps??8,16))
         deny('adaptive loop exceeds original owner decision budget');
       },
       runDecision:async decide=>{
        decisionFlight=decide();
        try{return await decisionFlight;}finally{decisionFlight=undefined;}
       },
       executeTask:async(choice,context)=>{
        if(!a2aOwner||a2aOwner.phase==='failed_closed')deny('adaptive work requires original protected A2A owner');
        const childParameters=await input.nextChildParameters(Object.freeze({epoch:context.nextEpoch,agent_id:choice.agent_id}));
        input.signal?.throwIfAborted();
        const current=await readContext();
        if(JSON.stringify(current)!==JSON.stringify(context))deny('adaptive Task context changed before staging');
        const runtimeTaskId='dispatch_'+randomBytes(16).toString('base64url');
        const staged=await executionHandle.stageTask({task:{task_id:choice.task_id,epoch:context.nextEpoch,
         agent_id:choice.agent_id,depends_on:[...choice.depends_on],permissions:[...choice.permissions]},
         runtimeTaskId,childParameters});
        // Model-selected read + CAS uses the existing typed native two-effect
        // Gateway journal, never a blind one-shot update.
        const mixed=choice.permissions.some(p=>p.operation==='read_file')&&
         choice.permissions.some(p=>p.operation==='update_file');
        const stager=mixed
         ?await executionHandle.createEnrolledNativeSequentialReadUpdateStager({
          runtimeTaskId,expectedHeadSha:context.executionProgress.current_head_sha})
         :executionHandle.createEnrolledNativeEffectStager({runtimeTaskId,
          expectedHeadSha:context.executionProgress.current_head_sha});
        const dispatched=await executionHandle.dispatchEnrolledTask({
         taskId:staged.task_id,runtimeTaskId,
         instruction:choice.instruction,effectStager:stager
        });
        if(dispatched.status==='owner_verified_native_test_failure_preflight_only'){
         if(adaptiveVerifiedFailures.at(-1)?.failed_task_id!==staged.task_id||
            adaptiveVerifiedFailures.at(-1)?.failed_runtime_task_id!==runtimeTaskId)
          deny('adaptive Test failure has no original authenticated owner proof');
         // Explicit authenticated outcome: no thrown transport exception
         // can be mistaken for a verified Runner FAIL by the adaptive loop.
         return dispatched;
        }
        input.signal?.throwIfAborted();
        await executionHandle.attestEnrolledTaskCompletion({taskId:staged.task_id,runtimeTaskId});
        if(choice.permissions.length===1&&choice.permissions[0]?.operation==='read_file'){
         if(!nativeEffectBinding.readObserver||adaptiveSourceObservations.size>=4)
          deny('bounded independent diagnostic source reader unavailable');
         const binding=gateway.assertTrustedCompletedReadObservationBinding(
          staged.task_id,runtimeTaskId);
         // Call the class's private-field implementation, not a shadowed
         // user/subclass method that could manufacture model-visible source.
         const observation=await AuthenticatedGiteaReadCompletionObserver.prototype
          .observeSource.call(nativeEffectBinding.readObserver,binding.expectation);
         if(observation.status!=='owner_verified_bounded_gitea_source_observation'||
            observation.task_id!==staged.task_id||
            observation.runtime_task_id!==runtimeTaskId||
            observation.evidence_sha256!==binding.evidence_sha256||
            observation.revision!==context.executionProgress.current_head_sha||
            binding.permission_resource!==choice.permissions[0].resource||
            canonicalFileUri(snapshot.repository,branch,observation.path)!==
             binding.permission_resource)
          deny('diagnostic source differs from original signed read and current HEAD');
         operationalCoordinator.assertTrustedGatewayAuthorityBinding();
         adaptiveSourceObservations.set(staged.task_id,Object.freeze({
          task_id:staged.task_id,agent_id:choice.agent_id,
          path:observation.path,revision:observation.revision,
          source_sha256:observation.source_sha256,
          source_bytes:observation.source_bytes,
          excerpt:observation.excerpt,
          excerpt_truncated:observation.excerpt_truncated,
          evidence_sha256:observation.evidence_sha256
         }));
        }
        adaptiveInstructions.set(staged.task_id,choice.instruction.replace(/[\x00-\x1f\x7f]/gu,' '));
       },
       observeVerifiedTestFailure:async({task})=>{
        const observed=adaptiveVerifiedFailures.at(-1);
        if(!observed||task.agent_id!=='test'||
           observed.failed_task_id!==task.task_id)
         deny('no original authenticated Test FAIL for adaptive continuation');
        operationalCoordinator.assertTrustedGatewayAuthorityBinding();
        const flight=gateway.assertTrustedFailedRunnerFlight(
         observed.failed_task_id,observed.failed_runtime_task_id);
        if(flight.gateway_task_completed!==false||
           flight.runtime_task_id!==observed.failed_runtime_task_id)
         deny('adaptive Test FAIL changed original Gateway flight');
        return observed;
       },
       confirmReady:async()=>{
        const latest=[...stagedTaskIds.entries()].filter(([,p])=>p.agent_id==='test'&&p.operation==='run_tests').at(-1);
        if(!latest)deny('adaptive PR readiness requires independently verified latest Test');
        return executionHandle.inspectVerifiedPullRequestHead({taskId:latest[1].task_id,runtimeTaskId:latest[0]});
       },retire
      }});
     try{
      const result=await adaptiveLoopFlight;
      if(result.status==='owner_adaptive_work_ready_for_pr'){
       if(adaptiveReadyProof||result.pr_created!==false||
          typeof result.source_test_task_id!=='string'||
          typeof result.source_test_runtime_task_id!=='string'||
          !/^[a-f0-9]{40}$/u.test(result.tested_commit_sha))
        deny('adaptive readiness is not bound to latest original Test');
       adaptiveReadyProof=Object.freeze({
        source_test_task_id:result.source_test_task_id,
        source_test_runtime_task_id:result.source_test_runtime_task_id,
        tested_commit_sha:result.tested_commit_sha
       });
      }
      return result;
     }finally{adaptiveLoopFlight=undefined;}
    },
    async proposeAndStageBranchTask(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||dispatchFailed||completionFailed||branchAdmissionAttempted||
        taskStageFlight||dispatchFlight||completionFlight||decisionFlight||
        stagedTaskCount!==0||operationalCoordinator.registeredTaskCount!==0||
        !nativeEffectBinding?.branchExecutor||!fields(input,['model','runtimeTaskId']))
      deny('branch requires first Task of original quiescent owner and installed executor');
     const before=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
     const permission=before.root_permissions.find(p=>p.operation==='create_branch');
     const owner=options.trustedAgentRegistry.orchestrator;
     if(!permission||!owner?.capabilities.includes('create_branch'))
      deny('branch requires original Engineer grant and Orchestrator identity');
     branchAdmissionAttempted=true;
     if(++decisionCalls>8)deny('branch exceeds original decision budget');
     const proposer=new TrustedAuthorityOnlyAdkDecisionProposer({model:input.model,
      requirement,branch:before.branch,rootPermissions:before.root_permissions,
      agents:{orchestrator:{capabilities:owner.capabilities}},previousTasks:[],
      nextEpoch:1,decisionKind:'branch'});
     decisionFlight=proposer.propose();
     let choice;
     try{choice=await decisionFlight;}finally{decisionFlight=undefined;}
     if(choice.agent_id!=='orchestrator'||!isDeepStrictEqual(choice.permissions,[permission])||
        choice.depends_on.length!==0)deny('branch decision differs from exact approved owner grant');
     taskStageFlight=(async()=>{
      const live=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      if(closed||session.phase!=='operational'||live.root_credential_id!==before.root_credential_id||
         live.authority_digest!==before.authority_digest||operationalCoordinator.registeredTaskCount!==0)
       deny('branch authority changed during model decision');
      const registered=await operationalCoordinator.registerTask({session_id:live.session_id,
       requirement_sha256:live.requirement_sha256,base_revision:live.base_revision,branch:live.branch,
       task_id:choice.task_id,epoch:1,agent_id:'orchestrator',depends_on:[],permissions:[permission]});
      await gateway.bindTrustedTask(registered.task_id,input.runtimeTaskId,'orchestrator');
      const pin=TrustedAuthorityOnlyBranchExecutor.prototype.pinTask.call(
       nativeEffectBinding.branchExecutor,registered.task_id,input.runtimeTaskId);
      if(pin.base_revision!==before.base_revision||pin.credential_id!==before.root_credential_id)
       deny('branch pin differs from original Engineer baseline');
      operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      stagedTaskCount++;
      stagedTaskIds.set(input.runtimeTaskId,Object.freeze({task_id:registered.task_id,
       agent_id:'orchestrator',operation:'create_branch'}));
      branchTaskPins.set(input.runtimeTaskId,pin);
      return Object.freeze({status:'owner_branch_root_task_bound_no_provider_execution',
       task_id:registered.task_id,runtime_task_id:input.runtimeTaskId,epoch:1,
       credential_id:before.root_credential_id,base_revision:before.base_revision,
       provider_executed:false,gateway_execution_authorized:false});
     })();
     try{return await taskStageFlight;}
     catch(error){taskStageFailed=true;if(session.phase==='operational')await retire();throw error;}
     finally{taskStageFlight=undefined;}
    },
    async stageEnrolledBranch(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||dispatchFailed||completionFailed||
        taskStageFlight||dispatchFlight||completionFlight||decisionFlight||
        !nativeEffectBinding?.branchExecutor||!fields(input,['taskId','runtimeTaskId','requestId']))
      deny('branch staging requires original active owner and installed executor');
     const pin=branchTaskPins.get(input.runtimeTaskId),record=nativeEffectBinding.store.get(input.requestId);
     if(!pin||pin.task_id!==input.taskId||!record||record.consumed||
        record.task_id!==input.runtimeTaskId||record.request.tool!=='create_branch'||
        branchStageAttempts.has(input.runtimeTaskId))deny('branch staging differs from original one-shot Task');
     branchStageAttempts.add(input.runtimeTaskId);
     return TrustedAuthorityOnlyBranchExecutor.prototype.stage.call(nativeEffectBinding.branchExecutor,record);
    },
    async attestEnrolledBranchCompletion(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||dispatchFailed||completionFailed||
        taskStageFlight||dispatchFlight||completionFlight||decisionFlight||
        !nativeEffectBinding?.branchExecutor||!fields(input,['taskId','runtimeTaskId']))
      deny('branch completion requires original active owner and independent reader');
     const pin=branchTaskPins.get(input.runtimeTaskId);
     if(!pin||pin.task_id!==input.taskId||!branchStageAttempts.has(input.runtimeTaskId)||
        completionAttempts.has(input.runtimeTaskId))deny('branch completion requires original staged flight exactly once');
     completionAttempts.add(input.runtimeTaskId);
     completionFlight=(async()=>{
      const observer=TrustedAuthorityOnlyBranchExecutor.prototype.createCompletionObserver.call(nativeEffectBinding.branchExecutor);
      const observed=await gateway.attestTrustedBranchCompletion(input.taskId,input.runtimeTaskId,observer);
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         observed.task_id!==input.taskId||observed.runtime_task_id!==input.runtimeTaskId||
         observed.status!=='task_completion_observed_staged')deny('branch completion differs from original Task');
      operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      gatewayAttestedTaskIds.set(input.taskId,Object.freeze({task_id:input.taskId,agent_id:'orchestrator'}));
      return Object.freeze({...observed,status:'owner_branch_completion_independently_observed'});
     })();
     try{return await completionFlight;}
     catch(error){completionFailed=true;if(session.phase==='operational')await retire();throw error;}
     finally{completionFlight=undefined;}
    },
    async proposeAndStageVerifiedPullRequestTask(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||dispatchFailed||completionFailed||
        pullRequestAdmissionAttempted||taskStageFlight||dispatchFlight||
        completionFlight||decisionFlight||d1FailurePreflightFlight||
        d1RepairAdmissionFlight||
        !fields(input,['model','sourceTestTaskId','sourceTestRuntimeTaskId',
         'runtimeTaskId']))
      deny('PR Task admission requires quiescent original owner and one decision');
     const pending=[...stagedTaskIds.values()].filter(p=>!gatewayAttestedTaskIds.has(p.task_id));
     // The original failed Runner flights remain registered but NEVER
     // completed. PR admission after R356 adaptive recovery requires the
     // explicit ready_for_pr result and the exact independently completed
     // replacement Test. A model claim or a verified FAIL alone is insufficient.
     const adaptiveReady=!!adaptiveReadyProof&&adaptiveLoopAttempted&&
      input.sourceTestTaskId===adaptiveReadyProof.source_test_task_id&&
      input.sourceTestRuntimeTaskId===adaptiveReadyProof.source_test_runtime_task_id&&
      adaptiveVerifiedFailures.length>0&&
      pending.length===adaptiveVerifiedFailures.length&&
      pending.every(p=>adaptiveVerifiedFailures.some(f=>
       p.task_id===f.failed_task_id&&f.gateway_task_completed===false));
     if(pending.length&&!(d1RetestPassed&&pending.length===1&&
        pending[0].task_id===d1VerifiedFailure?.proof?.failed_task_id)&&
        !adaptiveReady)
      deny('PR Task requires independent completion of earlier work or ready adaptive recovery evidence');
     const before=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
     const permission=before.root_permissions.find(p=>p.operation==='create_pull_request');
     const owner=options.trustedAgentRegistry.orchestrator;
     if(!permission||!owner?.capabilities.includes('create_pull_request'))
      deny('PR Task requires original Engineer create_pull_request grant and owner identity');
     const source={taskId:input.sourceTestTaskId,runtimeTaskId:input.sourceTestRuntimeTaskId};
     const first=await executionHandle.inspectVerifiedPullRequestHead(source);
     if(adaptiveReady&&first.tested_commit_sha!==adaptiveReadyProof.tested_commit_sha)
      deny('adaptive PR source differs from independently verified ready HEAD');
     if(pullRequestAdmissionAttempted)
      deny('PR Task decision already attempted');
     pullRequestAdmissionAttempted=true; // bounded model decision, no implicit retry
     // One separately bounded PR decision may follow a fully verified
     // adaptive recovery that already consumed the ordinary eight Task
     // decisions. This never expands Task/Child authority or permits a
     // second PR attempt; the original root and latest Test are rechecked.
     if(++decisionCalls>(adaptiveReady?9:8))
      deny('PR Task exceeds original owner decision budget');
     const epoch=operationalCoordinator.registeredTaskCount+1;
     const proposer=new TrustedAuthorityOnlyAdkDecisionProposer({
      model:input.model,requirement,branch:before.branch,
      rootPermissions:before.root_permissions,decisionKind:'pull_request',
      agents:{orchestrator:{capabilities:owner.capabilities},
       ...Object.fromEntries(Object.entries(options.trustedAgentRegistry)
        .filter(([id])=>id!=='orchestrator')
        .map(([id,pin])=>[id,{capabilities:pin.capabilities}]))},
      previousTasks:[...gatewayAttestedTaskIds.values()],nextEpoch:epoch
     });
     decisionFlight=proposer.propose();
     let choice;
     try{choice=await decisionFlight;}
     finally{decisionFlight=undefined;}
     if(choice.agent_id!=='orchestrator'||
        !isDeepStrictEqual(choice.permissions,[permission])||
        !isDeepStrictEqual(choice.depends_on,[input.sourceTestTaskId]))
      deny('PR Task differs from exact owner grant or verified Test dependency');
     // Reopen the actual receipt/HEAD after the model turn, before root Task binding.
     const current=await executionHandle.inspectVerifiedPullRequestHead(source);
     const live=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
     if(current.tested_commit_sha!==first.tested_commit_sha||
        current.evidence_sha256!==first.evidence_sha256||
        live.root_credential_id!==before.root_credential_id||
        live.authority_digest!==before.authority_digest||
        operationalCoordinator.registeredTaskCount!==epoch-1)
      deny('PR Task source changed before original root Task binding');
     let staged;
     taskStageFlight=(async()=>{
      const registered=await operationalCoordinator.registerTask({
       session_id:live.session_id,requirement_sha256:live.requirement_sha256,
       base_revision:live.base_revision,branch:live.branch,
       task_id:choice.task_id,epoch,agent_id:'orchestrator',
       depends_on:[input.sourceTestTaskId],permissions:[permission]});
      const bound=await gateway.bindTrustedTask(
       registered.task_id,input.runtimeTaskId,'orchestrator');
      const after=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         after.root_credential_id!==before.root_credential_id||
         bound.authority_digest!==before.authority_digest)
       deny('PR root Task changed during original owner binding');
      stagedTaskCount++;
      stagedTaskIds.set(input.runtimeTaskId,Object.freeze({
       task_id:registered.task_id,agent_id:'orchestrator',operation:'create_pull_request'}));
      return Object.freeze({task_id:registered.task_id,runtime_task_id:input.runtimeTaskId,
       epoch:registered.epoch,agent_id:'orchestrator',
       credential_id:before.root_credential_id,gateway_execution_authorized:false});
     })();
     try{staged=await taskStageFlight;}
     catch(error){taskStageFailed=true;
      if(session.phase==='operational')await session.retireOperationalRoot();
      throw error;
     }finally{taskStageFlight=undefined;}
     const pin=Object.freeze({task_id:staged.task_id,
      runtime_task_id:staged.runtime_task_id,instruction:choice.instruction,
      source_test_task_id:input.sourceTestTaskId,
      source_test_runtime_task_id:input.sourceTestRuntimeTaskId,
      tested_commit_sha:current.tested_commit_sha,
      runner_evidence_sha256:current.evidence_sha256,
      root_credential_id:before.root_credential_id,
      authority_digest:before.authority_digest});
     if(nativeEffectBinding.pullRequestExecutor){
      try{
       const admitted=await TrustedAuthorityOnlyPullRequestExecutor.prototype.pinTask
        .call(nativeEffectBinding.pullRequestExecutor,staged.task_id,staged.runtime_task_id,
         input.sourceTestTaskId,input.sourceTestRuntimeTaskId);
       if(admitted.tested_commit_sha!==pin.tested_commit_sha||
          admitted.runner_evidence_sha256!==pin.runner_evidence_sha256)
        deny('Gateway PR pin differs from original Engineer Test evidence');
      }catch(error){
       taskStageFailed=true;
       if(session.phase==='operational')await session.retireOperationalRoot();
       throw error;
      }
     }
     pullRequestTaskPins.set(input.runtimeTaskId,pin);
     return Object.freeze({...staged,
      status:'owner_pr_root_task_bound_no_provider_execution',
      decision_source:'verified_test_adk_original_pr_task',
      instruction:pin.instruction,source_test_task_id:pin.source_test_task_id,
      tested_commit_sha:pin.tested_commit_sha,
      provider_executed:false,pull_request_created:false
     });
    },
    /** Original owner reserves the exact prepared PR before VP/execute.
     * No caller-selected SHA, Test evidence, credential or executor. */
    async stageEnrolledPullRequest(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||dispatchFailed||completionFailed||
        taskStageFlight||dispatchFlight||completionFlight||decisionFlight||
        !nativeEffectBinding?.pullRequestExecutor||
        !fields(input,['taskId','runtimeTaskId','requestId']))
      deny('PR staging requires original active owner and installed executor');
     const pin=pullRequestTaskPins.get(input.runtimeTaskId);
     const record=nativeEffectBinding.store.get(input.requestId);
     if(!pin||pin.task_id!==input.taskId||!record||record.consumed||
        record.task_id!==input.runtimeTaskId||record.request.tool!=='create_pull_request'||
        pullRequestStageAttempts.has(input.runtimeTaskId))
      deny('PR staging differs from original enrolled Task or was already attempted');
     pullRequestStageAttempts.add(input.runtimeTaskId);
     return TrustedAuthorityOnlyPullRequestExecutor.prototype.stage.call(
      nativeEffectBinding.pullRequestExecutor,record,pin.tested_commit_sha);
    },
    /** Independently complete the original PR flight, not a caller's POST report. */
    async attestEnrolledPullRequestCompletion(input){
     if(closed||session.phase!=='operational'||gateway.phase!=='active'||
        taskStageFailed||dispatchFailed||completionFailed||
        taskStageFlight||dispatchFlight||completionFlight||decisionFlight||
        !nativeEffectBinding?.pullRequestExecutor||
        !fields(input,['taskId','runtimeTaskId']))
      deny('PR completion requires original active owner and independent reader');
     const pin=pullRequestTaskPins.get(input.runtimeTaskId);
     if(!pin||pin.task_id!==input.taskId||
        !pullRequestStageAttempts.has(input.runtimeTaskId)||
        completionAttempts.has(input.runtimeTaskId))
      deny('PR completion requires original staged flight and has not already been attempted');
     completionAttempts.add(input.runtimeTaskId);
     completionFlight=(async()=>{
      const observer=TrustedAuthorityOnlyPullRequestExecutor.prototype.createCompletionObserver
       .call(nativeEffectBinding.pullRequestExecutor);
      const observed=await gateway.attestTrustedPullRequestCompletion(
       input.taskId,input.runtimeTaskId,observer);
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         observed.status!=='task_completion_observed_staged'||
         observed.task_id!==input.taskId||observed.runtime_task_id!==input.runtimeTaskId||
         observed.gateway_execution_authorized!==false)
       deny('PR independent completion differs from original Task flight');
      operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      gatewayAttestedTaskIds.set(input.taskId,Object.freeze({
       task_id:input.taskId,agent_id:'orchestrator'}));
      return Object.freeze({...observed,status:'owner_pr_completion_independently_observed'});
     })();
     try{return await completionFlight;}
     catch(error){
      completionFailed=true;
      if(session.phase==='operational')await retire();
      throw error;
     }finally{completionFlight=undefined;}
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
     if(!pin||!['read_file','update_file','run_tests'].includes(pin.operation)||
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
     /** R367: the original owner reserves the exact Task/Child/HEAD and
      * immutable two-effect read -> CAS journal. This is not an A2A tool. */
     async createEnrolledNativeSequentialReadUpdateStager(input){
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         !nativeEffectBinding?.mutationObserver||taskStageFlight||dispatchFlight||
         taskStageFailed||dispatchFailed||
         !fields(input,['runtimeTaskId','expectedHeadSha'])||
         typeof input?.runtimeTaskId!=='string'||
         !/^[a-f0-9]{40}$/u.test(input.expectedHeadSha))
       deny('native sequential staging requires original mutation observer, live owner and HEAD');
      const pin=stagedTaskIds.get(input.runtimeTaskId);
      if(!pin||pin.operation!=='update_file'||
         issuedEffectStagers.has(input.runtimeTaskId)||
         dispatchAttempts.has(input.runtimeTaskId))
       deny('native sequential staging requires enrolled unspent update Task');
      const row=operationalCoordinator.assertTrustedGatewayRegisteredTask(pin.task_id);
      const reads=row.permissions.filter(p=>p.operation==='read_file');
      const updates=row.permissions.filter(p=>p.operation==='update_file');
      if(row.agent_id!==pin.agent_id||row.permissions.length!==2||
         reads.length!==1||updates.length!==1||
         reads[0].resource!==updates[0].resource)
       deny('native sequential staging requires exact same-file read and update grants');
      // Consume owner's one-shot slot BEFORE awaiting journal admission.
      const flight=TrustedAuthorityOnlySequentialReadUpdateStager.begin({
       store:nativeEffectBinding.store,admissions:gateway,
       mutation:nativeEffectBinding.mutation,
       mutationObserver:nativeEffectBinding.mutationObserver,
       planTaskId:pin.task_id,runtimeTaskId:input.runtimeTaskId,
       expectedHeadSha:input.expectedHeadSha
      });
      issuedEffectStagers.set(input.runtimeTaskId,flight);
      try{
       const stager=await flight;
       if(closed||session.phase!=='operational')
        deny('native sequential staging lost original operational root');
       operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       issuedEffectStagers.set(input.runtimeTaskId,stager);
       return stager;
      }catch(error){
       taskStageFailed=true;
       if(session.phase==='operational'){
        try{await retire();}
        catch{deny('native sequential staging failed and root retirement unconfirmed');}
       }
       throw error;
      }
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
      const ordinary=input.effectStager instanceof TrustedAuthorityOnlyEffectStager&&
       input.effectStager.isForOwnerTask(gateway,input.runtimeTaskId,pin?.operation);
      const sequential=pin?.operation==='update_file'&&
       TrustedAuthorityOnlySequentialReadUpdateStager.isNativeForOwner(
        input.effectStager,gateway,input.taskId,input.runtimeTaskId);
      // R376: only the adaptive loop AFTER an independently authenticated
      // Runner FAIL may dispatch a signed one-effect diagnostic read Child.
      // The private independent receipt reader must already be installed.
      const diagnosticRead=pin?.operation==='read_file'&&
       adaptiveLoopAttempted&&adaptiveVerifiedFailures.length>0&&
       ['backend','frontend'].includes(pin.agent_id)&&
       nativeEffectBinding?.readObserver instanceof AuthenticatedGiteaReadCompletionObserver;
      if(!pin||pin.task_id!==input.taskId||
         (!['update_file','run_tests'].includes(pin.operation)&&!diagnosticRead)||
         issuedEffectStagers.get(input.runtimeTaskId)!==input.effectStager||
         !(ordinary||sequential))
       deny('protected A2A dispatch requires an original owner-bound effect stager');
      if(input.d1Candidate!==undefined&&
         (pin.operation!=='run_tests'||pin.agent_id!=='test'||
          !nativeEffectBinding?.failureObserver||
          d1FailurePreflightAttempted))
       deny('D1 failure observer must be installed before original Test dispatch');
      // A D1 candidate may propose instructions, never a mutable dispatch
      // command. Pin the first admitted native repair to that exact choice:
      // roles/permissions alone do not protect model-authored intent.
      if(d1DispatchPin&&input.runtimeTaskId===d1DispatchPin.runtimeTaskId&&
         (input.taskId!==d1DispatchPin.taskId||
          input.instruction!==d1DispatchPin.instruction||
          input.d1Candidate!==undefined))
       deny('D1 dispatch requires original owner-pinned repair instruction');
      if(d1RetestPin&&input.runtimeTaskId===d1RetestPin.runtimeTaskId&&
         (input.taskId!==d1RetestPin.taskId||
          input.instruction!==d1RetestPin.instruction||
          input.d1Candidate!==undefined))
       deny('D1 retest dispatch requires original owner-pinned Test instruction');
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
       // R355.7: an adaptive Test may expose bounded verified Runner FAILs
       // without a preselected D1 repair. A2A error text never becomes proof;
       // independently check original flight, MAC, Child, root and HEAD.
       let failure=error;
       if(adaptiveLoopAttempted&&input.d1Candidate===undefined&&
          pin.agent_id==='test'&&pin.operation==='run_tests'&&
          nativeEffectBinding?.failureObserver&&adaptiveVerifiedFailures.length<2){
        try{
         const intent=await nativeEffectBinding.runner
          .getAttemptedIntentForOwnerTask(input.runtimeTaskId);
         const observed=await observeTrustedNativeTestFailure({
          coordinator:operationalCoordinator,childIssuer,gateway,
          failureObserver:nativeEffectBinding.failureObserver,
          failedRunnerIntent:intent
         });
         if(closed||session.phase!=='operational'||
            observed.status!=='native_test_failure_evidence_verified_only'||
            observed.failed_task_id!==input.taskId||
            observed.failed_runtime_task_id!==input.runtimeTaskId||
            observed.gateway_task_completed!==false||
            observed.recovery_authorized!==false)
          deny('adaptive Test FAIL does not match original authenticated Runner flight');
         if(adaptiveVerifiedFailures.some(f=>
           f.failed_task_id===observed.failed_task_id||
           f.failed_runtime_task_id===observed.failed_runtime_task_id))
          deny('adaptive Test FAIL replay or duplicate observation');
         const verified=Object.freeze({
          ...observed,status:'owner_verified_native_test_failure_preflight_only'
         });
         adaptiveVerifiedFailures.push(verified);
         return verified;
        }catch(observeError){failure=observeError;}
       }
       dispatchFailed=true;
       if(session.phase==='operational'){
        try{await retire();}
        catch{deny('A2A dispatch failed and operational retirement unconfirmed');}
       }
       throw failure;
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
       nextEpoch:operationalCoordinator.registeredTaskCount+1,
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
       // The random native Task ID is selected by the Coordinator, while
       // the instruction is the immutable, previously validated ADK choice.
       // Neither the caller nor an A2A response may replace it at dispatch.
       d1DispatchPin=Object.freeze({
        taskId:enrolled.task_id,runtimeTaskId:enrolled.runtime_task_id,
        instruction:proposal.instruction
       });
       stagedTaskCount++;
       return Object.freeze({...enrolled,instruction:proposal.instruction,
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
     /** R352.5: owner-only ADK retest choice after independently attested
      * D1 repair. Original failed Test remains failed; no new human grant. */
     async proposeAndStageVerifiedD1Retest(input){
      if(closed||session.phase!=='operational'||gateway.phase!=='active'||
         !d1VerifiedFailure||!d1DispatchPin||!d1RepairAttested||
         d1RetestAttempted||d1RetestPin||d1RetestPassed||
         taskStageFailed||taskStageFlight||dispatchFlight||completionFlight||
         decisionFlight||d1FailurePreflightFlight||d1RepairAdmissionFlight||
         dispatchFailed||completionFailed||
         !fields(input,['model','runtimeTaskId','childParameters'])||
         !fields(input.childParameters,['credential_id','credential_status',
           'valid_from','validity_seconds']))
       deny('new D1 Test requires independent repair and fresh private Child');
      const original=d1VerifiedFailure.proof.failed_task_id;
      const uncompleted=[...stagedTaskIds.values()].filter(pin=>
       !gatewayAttestedTaskIds.has(pin.task_id));
      if(uncompleted.length!==1||uncompleted[0].task_id!==original||
         gatewayAttestedTaskIds.has(original)||
         !gatewayAttestedTaskIds.has(d1DispatchPin.taskId)||
         stagedTaskIds.size!==gatewayAttestedTaskIds.size+1)
       deny('D1 retest requires exactly one original incomplete failed Test');
      const failed=operationalCoordinator.assertTrustedGatewayRegisteredTask(original);
      const repair=operationalCoordinator.assertTrustedGatewayRegisteredTask(d1DispatchPin.taskId);
      const dependencies=[...failed.depends_on,repair.task_id];
      if(failed.agent_id!=='test'||
         repair.agent_id!==d1RepairProposal?.agent_id||
         !isDeepStrictEqual(repair.permissions,d1RepairProposal.permissions)||
         dependencies.some(id=>!gatewayAttestedTaskIds.has(id)))
       deny('D1 retest cannot replace unverified original dependencies');
      d1RetestAttempted=true; // one-shot before model or native issuance
      if(++decisionCalls>8)
       deny('D1 retest exceeds bounded original Engineer model turns');
      const rootBefore=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
      const epoch=operationalCoordinator.registeredTaskCount+1;
      const proposer=new TrustedAuthorityOnlyAdkDecisionProposer({
       model:input.model,requirement,branch:rootBefore.branch,
       rootPermissions:rootBefore.root_permissions,
       agents:Object.fromEntries(Object.entries(options.trustedAgentRegistry)
        .map(([agent_id,pin])=>[agent_id,{capabilities:pin.capabilities}])),
       previousTasks:[...gatewayAttestedTaskIds.values()],
       nextEpoch:epoch,
       verifiedFailure:{failed_phase:d1VerifiedFailure.proof.failed_phase,
        source_evidence_sha256:d1VerifiedFailure.proof.source_evidence_sha256}
      });
      decisionFlight=(async()=>{
       const choice=await proposer.propose();
       const current=operationalCoordinator.assertTrustedGatewayAuthorityBinding();
       if(closed||session.phase!=='operational'||
          current.root_credential_id!==rootBefore.root_credential_id||
          current.authority_digest!==rootBefore.authority_digest||
          operationalCoordinator.registeredTaskCount!==epoch-1||
          choice.agent_id!=='test'||choice.task_id===original||
          !isDeepStrictEqual(choice.permissions,failed.permissions)||
          !isDeepStrictEqual(choice.depends_on,dependencies))
        deny('D1 retest ADK choice differs from authorized original Test');
       const staged=await executionHandle.stageTask({
        task:{task_id:choice.task_id,epoch,agent_id:'test',
         depends_on:dependencies,permissions:failed.permissions},
        runtimeTaskId:input.runtimeTaskId,
        childParameters:input.childParameters
       });
       if(staged.status!=='owner_child_enrolled_no_provider_execution'||
          staged.agent_id!=='test'||staged.epoch!==epoch)
        deny('D1 Test did not enroll a fresh native Child');
       d1RetestPin=Object.freeze({taskId:staged.task_id,
        runtimeTaskId:staged.runtime_task_id,instruction:choice.instruction});
       return Object.freeze({...staged,instruction:choice.instruction,
        decision_source:'verified_d1_retest_adk_original_coordinator',
        original_failed_test_task_id:original,
        original_test_completed:false,gateway_execution_authorized:false});
      })();
      try{return await decisionFlight;}
      finally{decisionFlight=undefined;}
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
       // Only the original independent Gateway observer can set these.
       if(d1DispatchPin&&input.runtimeTaskId===d1DispatchPin.runtimeTaskId)
        d1RepairAttested=true;
       if(d1RetestPin&&input.runtimeTaskId===d1RetestPin.runtimeTaskId&&
          input.taskId===d1RetestPin.taskId)
        d1RetestPassed=true;
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
    if(adaptiveLoopFlight)try{await adaptiveLoopFlight;}catch{/* Recheck root below. */}
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
