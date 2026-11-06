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
  close(){
   if(closing)return closing;
   closed=true;
   closing=(async()=>{
    // Await the transition owner before deciding which root to retire.
    if(activationFlight)try{await activationFlight;}catch{/* Recheck state below. */}
    try{if(session.phase!=='revoked')await retire();}
    finally{
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
   close:()=>host.close()});
 }catch(error){
  try{await host.close();}catch{deny('listener startup failed and root retirement unconfirmed');}
  throw error;
 }
}
