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
    (hooks.observeVerifiedTestFailure!==undefined&&
     typeof hooks.observeVerifiedTestFailure!=='function')||
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
   // A thrown A2A/provider error is *always* terminal. Recovery is
   // possible only through the original owner's explicit authenticated
   // Runner-FAIL result; never "catch error" and attempt to reclassify it.
   const effect=await hooks.executeTask(decision.task,before);
   if(effect?.status==='owner_verified_native_test_failure_preflight_only'){
    if(!hooks.observeVerifiedTestFailure||decision.task.agent_id!=='test'||
       decision.task.permissions.filter(p=>p.operation==='run_tests').length!==1)
     deny('untrusted or unexpected recoverable Test failure result');
    const observed=await hooks.observeVerifiedTestFailure(Object.freeze({
     task:decision.task,context:before
    }));
    signal?.throwIfAborted();
    if(observed?.status!=='owner_verified_native_test_failure_preflight_only'||
       observed.failed_task_id!==decision.task.task_id||
       typeof observed.failed_runtime_task_id!=='string'||
       !/^dispatch_[A-Za-z0-9_-]{22}$/u.test(observed.failed_runtime_task_id)||
       observed.gateway_task_completed!==false||
       observed.recovery_authorized!==false||
       observed.tested_commit_sha!==before.executionProgress?.current_head_sha||
       !['typecheck','backend_tests','frontend_tests','build',
         'playwright_e2e','researcher_acceptance'].includes(observed.failed_phase)||
       !/^[a-f0-9]{64}$/u.test(observed.source_evidence_sha256))
     deny('Test failure is not independently verified by the original owner');
    const progress=await hooks.readContext();
    if(progress.nextEpoch!==before.nextEpoch+1||
       JSON.stringify(progress.rootPermissions)!==JSON.stringify(before.rootPermissions)||
       progress.branch!==before.branch||
       progress.requirement!==before.requirement||
       JSON.stringify(progress.agents)!==JSON.stringify(before.agents)||
       JSON.stringify(progress.previousTasks)!==JSON.stringify(before.previousTasks)||
       progress.executionProgress?.current_head_sha!==observed.tested_commit_sha||
       JSON.stringify(progress.executionProgress?.completed_work)!==
        JSON.stringify(before.executionProgress?.completed_work)||
       JSON.stringify(progress.verifiedFailure)!==JSON.stringify({
        failed_phase:observed.failed_phase,
        source_evidence_sha256:observed.source_evidence_sha256,
        ...(observed.typecheck_error_codes?.length?
         {typecheck_error_codes:[...observed.typecheck_error_codes]}:{})
       }))
     deny('verified Test FAIL did not preserve the original authority and success ledger');
    // The failed Task is registered (epoch advances), but NOT completed.
    // Its evidence is diagnostic input for the next model decision only.
    continue;
   }
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
