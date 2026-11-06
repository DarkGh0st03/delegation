/** Owner-assembled permission-only Planning -> authenticated Engineer review
 * -> independent native root -> dynamic Coordinator. No public root issuer.
 * The caller owns listener binding; this factory never starts inference until
 * invoked with an explicitly provisioned model and trusted service ports. */
import {isDeepStrictEqual} from 'node:util';
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
import {TrustedAuthorityOnlyGatewayAdmissions} from '../../gateway/src/trusted-authority-only-admissions.ts';
import {TrustedAuthorityOnlyEffectStager} from '../../gateway/src/trusted-authority-only-effect-stager.ts';
import {TrustedAuthorityOnlyChildIssuer} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-child-issuer.ts';
import {startTrustedAuthorityOnlySdkA2AOwner} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-a2a-owner.ts';
import {DurableAuthorityOnlyChildJournal} from '../../../packages/orchestrator-runtime/src/trusted-authority-only-child-journal.ts';
const OPS=new Set(RUST_OPERATIONS);
const fields=(o,allowed)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k));
function deny(reason){throw Error('Authority-only review host: '+reason);}
export async function createTrustedAuthorityOnlyReviewHost(options){
 if(!options||!(options.checkpoint?.store instanceof AuthorityPlanningCheckpointStore)||
  !(options.activationJournal instanceof DurableAuthorityOnlyActivationJournal)||
  !(options.taskJournal instanceof DurableAuthorityTaskJournal)||
  !fields(options.approval,['engineerDid','keyId','publicKeyPem','privateKeyFile',
    'receiptDirectory','passwordSaltHex','passwordScryptHex'])||
  !fields(options.planner,['model','planId','onObservation','maxModelTurns',
    'maxProposalRevisions','thinkingLevel','maxModelCallMs','maxOutputTokens','maxPlanningMs'])||
  !fields(options.gateway,['gatewayBaseUrl','adapterBaseUrl','adapterToken','fetchFn','timeoutMs']))
  deny('explicit trusted dependencies required; legacy/context overrides forbidden');
 const snapshot=structuredClone(options.snapshot),requirement=options.requirement,branch=options.workBranch;
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
 let operationalCoordinator,executionAdmissionAttempted=false,executionAdmissionFlight;
 let taskStageFlight,taskStageFailed=false,stagedTaskCount=0;
 const stagedTaskIds=new Map();
 const dispatchAttempts=new Set();
 let dispatchFlight,dispatchFailed=false;
 let a2aOwner,a2aStarting,a2aStartAttempted=false;
 async function retire(){
  if(session.phase==='planning')await session.cancelPlanning();
  else if(session.phase==='operational')await session.retireOperationalRoot();
  else if(session.phase!=='revoked')deny('root state uncertain; manual reconciliation required');
 }
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
    return Object.freeze({admission,gateway,childIssuer,
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
      return owner;
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
     /** R350.5 — dispatch only the original enrolled Task with a genuine
      * owner-private stager created for this Gateway, runtime ID and effect.
      * A2A output is a report, never Gateway provider completion. */
     async dispatchEnrolledTask(input){
      if(closed||session.phase!=='operational'||!a2aOwner||
         taskStageFailed||dispatchFailed||dispatchFlight||
         taskStageFlight||gateway.phase!=='active')
       deny('protected A2A dispatch requires quiescent live original session');
      if(!fields(input,['taskId','runtimeTaskId','instruction','effectStager']))
       deny('protected A2A dispatch rejects credentials or authority overrides');
      const pin=stagedTaskIds.get(input.runtimeTaskId);
      if(!pin||pin.task_id!==input.taskId||
         !['update_file','run_tests'].includes(pin.operation)||
         !(input.effectStager instanceof TrustedAuthorityOnlyEffectStager)||
         !input.effectStager.isForOwnerTask(gateway,input.runtimeTaskId,pin.operation))
       deny('protected A2A dispatch requires an original owner-bound effect stager');
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
       return report;
      })();
      try{return await dispatchFlight;}
      catch(error){
       dispatchFailed=true;
       if(session.phase==='operational'){
        try{await session.retireOperationalRoot();}
        catch{deny('A2A dispatch failed and operational retirement unconfirmed');}
       }
       throw error;
      }finally{dispatchFlight=undefined;}
     }
    });
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
    if(taskStageFlight)try{await taskStageFlight;}catch{/* Recheck root below. */}
    if(a2aStarting)try{await a2aStarting;}catch{/* Recheck root below. */}
    if(dispatchFlight)try{await dispatchFlight;}catch{/* Recheck root below. */}
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
