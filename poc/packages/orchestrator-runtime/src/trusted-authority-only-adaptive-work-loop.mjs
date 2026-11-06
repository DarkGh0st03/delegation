/** Owner-only control flow. Hooks belong to the original Engineer host; this
 * module creates no authority, signs nothing, and trusts no A2A completion. */
import {BaseLlm} from '@google/adk';
import {TrustedAuthorityOnlyAdkDecisionProposer} from './trusted-authority-only-adk-decision-proposer.mjs';
const deny=s=>{throw Error('Authority-only adaptive work loop: '+s);};
export async function runTrustedAuthorityOnlyAdaptiveWorkLoop({model,hooks,maxSteps=8,signal}){
 if(!(model instanceof BaseLlm)||!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>8||
    !hooks||['readContext','beforeDecision','executeTask','confirmReady','retire']
     .some(k=>typeof hooks[k]!=='function')||
    (hooks.runDecision!==undefined&&typeof hooks.runDecision!=='function')||
    (signal!==undefined&&!(signal instanceof AbortSignal)))deny('invalid original owner loop configuration');
 let executed=0;
 try{
  for(let step=0;step<maxSteps;step++){
   signal?.throwIfAborted();
   const before=structuredClone(await hooks.readContext());
   await hooks.beforeDecision();
   const decide=()=>new TrustedAuthorityOnlyAdkDecisionProposer({
    ...before,model,decisionKind:'adaptive'
   }).propose();
   const decision=await (hooks.runDecision?hooks.runDecision(decide):decide());
   signal?.throwIfAborted();
   const after=await hooks.readContext();
   if(JSON.stringify(before)!==JSON.stringify(after))deny('original owner progress changed during model decision');
   if(decision.action==='blocked'){
    await hooks.retire();
    return Object.freeze({status:'owner_adaptive_work_blocked',executed_tasks:executed,
     reason:decision.reason,pr_created:false});
   }
   if(decision.action==='ready_for_pr'){
    const proof=await hooks.confirmReady();
    signal?.throwIfAborted();
    if(proof?.status!=='owner_verified_tested_head_not_pr_authorized'||
       !/^[a-f0-9]{40}$/u.test(proof.tested_commit_sha))deny('independent current Test proof missing');
    return Object.freeze({status:'owner_adaptive_work_ready_for_pr',executed_tasks:executed,
     source_test_task_id:proof.task_id,source_test_runtime_task_id:proof.runtime_task_id,
     tested_commit_sha:proof.tested_commit_sha,pr_created:false});
   }
   await hooks.executeTask(decision.task,before);
   signal?.throwIfAborted();
   const progress=await hooks.readContext();
   if(progress.nextEpoch!==before.nextEpoch+1||
      progress.previousTasks.length!==before.previousTasks.length+1||
      !progress.previousTasks.some(p=>p.task_id===decision.task.task_id&&p.agent_id===decision.task.agent_id))
    deny('Task did not yield independently attested owner progress');
   executed++;
  }
  deny('bounded decision budget exhausted without verified PR readiness');
 }catch(error){
  try{await hooks.retire();}
  catch{throw Error('Authority-only adaptive work loop: failure and original root retirement unconfirmed',{cause:error});}
  throw error;
 }
}
