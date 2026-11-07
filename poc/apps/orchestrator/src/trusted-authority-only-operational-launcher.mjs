/**
 * R371 — original trusted Engineer owner OPERATIONAL branch-first launcher.
 *
 * This is an in-process composition helper, NOT an HTTP/ADK/MCP capability,
 * service entrypoint, credential issuer, provider bypass or auto-approval.
 * The original Review Host owns the immutable Engineer grant, Task/Child
 * enrollment, native SDK A2A, Gateway fences and attested Runner/PR receipts.
 *
 * Trusted owner bootstraps and binds the real native Gateway before calling.
 * Callback transports stay private inside that same owner; no credential,
 * signed VP, nonce or raw provider response is returned to a model.
 */
import {randomBytes} from "node:crypto";

function deny(reason){
 throw Error("Original operational launcher denied: "+reason);
}
function exact(value,keys){
 return !!value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).every(k=>keys.includes(k));
}
function nonempty(value,max){
 return typeof value==="string"&&value.trim()===value&&
  value.length>0&&value.length<=max;
}
/** One original session, and at most one PR attempt. No merge action exists.
 *
 * Input MUST be assembled by the trusted in-process operator from its
 * already authenticated Review Host. Never deserialize this input from
 * workflow_dispatch, HTTP, A2A, MCP or a model response.
 *
 * The signed PR grant is checked by proposeAndStageVerifiedPullRequestTask;
 * the independently MAC-authenticated latest Test is rechecked before
 * PR admission, stage, provider POST and final Owner completion.
 *
 * draftPullRequest is OPTIONAL by design: readiness never auto-posts.
 */
export async function runTrustedAuthorityOnlyOperationalWorkflow(input){
 if(!exact(input,["execution","sdk","adaptive","draftPullRequest","createBranch"])||
    !input?.execution||!exact(input.sdk,
     ["agentBaseUrls","stageChannels","agentBindingChannels","a2aPolling"])||
    !exact(input.adaptive,["model","nextChildParameters","maxSteps","maxVerifiedFailures","signal"])||
    typeof input.adaptive.nextChildParameters!=="function"||
    (input.adaptive.maxSteps!==undefined&&
     (!Number.isSafeInteger(input.adaptive.maxSteps)||
      input.adaptive.maxSteps<1||input.adaptive.maxSteps>24))||
    (input.adaptive.maxVerifiedFailures!==undefined&&
     (!Number.isSafeInteger(input.adaptive.maxVerifiedFailures)||
      input.adaptive.maxVerifiedFailures<0||input.adaptive.maxVerifiedFailures>4||
      (input.adaptive.maxSteps!==undefined&&
       input.adaptive.maxVerifiedFailures>input.adaptive.maxSteps))))
  deny("trusted owner, protected A2A and bounded adaptive model required");
 const owner=input.execution;
 if(typeof owner.startSdkA2AOwner!=="function"||
    typeof owner.runAdaptiveWorkLoop!=="function"||
    typeof owner.proposeAndStageVerifiedPullRequestTask!=="function"||
    typeof owner.stageEnrolledPullRequest!=="function"||
    typeof owner.attestEnrolledPullRequestCompletion!=="function"||
    !owner.gateway||typeof owner.gateway.stagedCompletedTaskCount!=="number")
  deny("original Review Host operational execution handle required");
 const branch=input.createBranch;
 if(branch!==undefined&&(!exact(branch,["model","branch","baseBranch",
      "permission","prepare","execute"])||
     !branch.model||typeof branch.prepare!=="function"||
     typeof branch.execute!=="function"||
     !nonempty(branch.branch,190)||
     !/^feature\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch.branch)||
     branch.branch.includes("..")||branch.branch.includes("//")||
     branch.baseBranch!=="main"||
     !exact(branch.permission,["resource","operation"])||
     branch.permission.operation!=="create_branch"||
     !nonempty(branch.permission.resource,1024)))
  deny("branch requires exact original Engineer grant and private native transport");
 const pr=input.draftPullRequest;
 if(pr!==undefined&&(!exact(pr,["model","headBranch","baseBranch","title","body",
     "permission","prepare","execute"])||
    !pr.model||typeof pr.prepare!=="function"||
    typeof pr.execute!=="function"||
    !nonempty(pr.headBranch,190)||!pr.headBranch.startsWith("feature/")||
    pr.baseBranch!=="main"||!nonempty(pr.title,150)||
    !nonempty(pr.body,4096)||
    !exact(pr.permission,["resource","operation"])||
    pr.permission.operation!=="create_pull_request"||
    !nonempty(pr.permission.resource,1024)))
  deny("PR requires an original exact Engineer grant and private native transport");
 // Branch-first mode is deliberately opt-in. It never creates from
 // an unapproved source or skips the original independent Gateway GET.
 // The original Review Host must have a real pinned BranchExecutor
 // bound before attempting any model-selected worker Task.
 let branchProof;
 if(branch!==undefined){
  for(const action of ["proposeAndStageBranchTask","stageEnrolledBranch",
   "attestEnrolledBranchCompletion"])
   if(typeof owner[action]!=="function")
    deny("original root branch owner method missing");
  const runtimeTaskId="dispatch_"+randomBytes(16).toString("base64url");
  const task=await owner.proposeAndStageBranchTask({
   model:branch.model,runtimeTaskId
  });
  if(task.status!=="owner_branch_root_task_bound_no_provider_execution"||
     task.runtime_task_id!==runtimeTaskId||
     task.provider_executed!==false||
     task.gateway_execution_authorized!==false||
     !/^[a-f0-9]{40}$/u.test(task.base_revision))
   deny("original root branch Task was not pinned to reviewed main");
  const request=Object.freeze({
   task_id:runtimeTaskId,agent_role:"orchestrator",
   tool:"create_branch",
   arguments:Object.freeze({branch:branch.branch,base_branch:"main"})
  });
  const prepared=await branch.prepare(request);
  if(!prepared||typeof prepared!=="object"||
     !nonempty(prepared.request_id,128)||
     !nonempty(prepared.audience,256)||
     !nonempty(prepared.challenge,2048)||
     !exact(prepared.required_permission,["resource","operation"])||
     prepared.required_permission.resource!==branch.permission.resource||
     prepared.required_permission.operation!=="create_branch")
   deny("original Gateway Branch Prepare differs from signed permission");
  const staged=await owner.stageEnrolledBranch({
   taskId:task.task_id,runtimeTaskId,requestId:prepared.request_id
  });
  if(staged.status!=="owner_branch_flight_reserved_no_provider_execution"||
     staged.base_revision!==task.base_revision||
     staged.provider_executed!==false)
   deny("branch root Task was not durably staged before Rust VP");
  // Private native Rust VP + original Gateway Rust/OPA/Gitea are invoked
  // only AFTER the one-shot root Branch flight has been reserved.
  const executed=await branch.execute(Object.freeze({
   request,prepared:Object.freeze({...prepared,
    required_permission:Object.freeze({...prepared.required_permission})}),
   expectedMainSha:task.base_revision
  }));
  if(executed?.decision!=="allow"||
     executed.execution?.provider!=="gitea"||
     executed.execution?.performed!==true||
     executed.execution?.tool!=="create_branch"||
     executed.execution?.revision!==task.base_revision)
   deny("native original Gateway did not confirm exact approved main branch source");
  const attested=await owner.attestEnrolledBranchCompletion({
   taskId:task.task_id,runtimeTaskId
  });
  if(attested.status!=="owner_branch_completion_independently_observed"||
     attested.task_id!==task.task_id||
     attested.runtime_task_id!==runtimeTaskId)
   deny("branch not independently attested by original Gateway");
  branchProof=Object.freeze({
   task_id:task.task_id,base_revision:task.base_revision,
   status:"owner_original_branch_independently_attested"
  });
 }
 // No host can make a provider claim merely because protected SDK A2A started.
 const boot=await owner.startSdkA2AOwner(input.sdk);
 if(boot.status!=="owner_protected_a2a_started_no_provider_execution"||
    boot.gateway_execution_authorized!==false)
  deny("protected original A2A startup was not attested");
 const adaptive=await owner.runAdaptiveWorkLoop(input.adaptive);
 if(adaptive.status!=="owner_adaptive_work_ready_for_pr"){
  if(pr!==undefined)deny("PR forbidden without latest independently completed Test");
  return Object.freeze({
   status:"owner_operational_work_finished_without_pr",
   adaptive_status:adaptive.status,executed_tasks:adaptive.executed_tasks,
   ...(branchProof?{branch:branchProof}:{}),pr_created:false
  });
 }
 if(adaptive.pr_created!==false||
    !nonempty(adaptive.source_test_task_id,128)||
    !nonempty(adaptive.source_test_runtime_task_id,128)||
    !/^[a-f0-9]{40}$/u.test(adaptive.tested_commit_sha))
  deny("original independent Test readiness is incomplete");
 if(pr===undefined)return Object.freeze({
  status:"owner_operational_ready_for_review_not_pr_authorized",
  source_test_task_id:adaptive.source_test_task_id,
  source_test_runtime_task_id:adaptive.source_test_runtime_task_id,
  tested_commit_sha:adaptive.tested_commit_sha,
  executed_tasks:adaptive.executed_tasks,
  ...(branchProof?{branch:branchProof}:{}),pr_created:false
 });
 // No model, HTTP request or caller can supply the one-shot PR runtime ID.
 const runtimeTaskId="dispatch_"+randomBytes(16).toString("base64url");
 const task=await owner.proposeAndStageVerifiedPullRequestTask({
  model:pr.model,sourceTestTaskId:adaptive.source_test_task_id,
  sourceTestRuntimeTaskId:adaptive.source_test_runtime_task_id,
  runtimeTaskId
 });
 if(task.status!=="owner_pr_root_task_bound_no_provider_execution"||
    task.runtime_task_id!==runtimeTaskId||
    task.tested_commit_sha!==adaptive.tested_commit_sha||
    task.source_test_task_id!==adaptive.source_test_task_id||
    task.provider_executed!==false||task.pull_request_created!==false)
  deny("model-selected PR Task is not pinned to the signed original root");
 const request=Object.freeze({
  task_id:runtimeTaskId,agent_role:"orchestrator",
  tool:"create_pull_request",
  arguments:Object.freeze({
   head_branch:pr.headBranch,base_branch:"main",
   title:pr.title,body:pr.body
  })
 });
 // Original Gateway Prepare must be scoped BEFORE the owner stages a flight.
 // Neither the result nor callback accesses the model.
 const prepared=await pr.prepare(request);
 if(!prepared||typeof prepared!=="object"||
    !nonempty(prepared.request_id,128)||
    !nonempty(prepared.audience,256)||
    !nonempty(prepared.challenge,2048)||
    !exact(prepared.required_permission,["resource","operation"])||
    prepared.required_permission.operation!==pr.permission.operation||
    prepared.required_permission.resource!==pr.permission.resource)
  deny("original Gateway Prepare does not match the exact signed PR grant");
 const staged=await owner.stageEnrolledPullRequest({
  taskId:task.task_id,runtimeTaskId,requestId:prepared.request_id
 });
 if(staged.status!=="owner_pr_flight_reserved_no_provider_execution"||
    staged.tested_commit_sha!==adaptive.tested_commit_sha||
    staged.provider_executed!==false)
  deny("original one-shot PR flight not durably reserved");
 // execute is provided ONLY by the trusted private owner. In a real run it
 // obtains a native Rust root VP and calls the original Gateway execute;
 // the host and Gateway still enforce Rust verification, OPA and one POST.
 const executed=await pr.execute(Object.freeze({
  request,prepared:Object.freeze({...prepared,
   required_permission:Object.freeze({...prepared.required_permission})}),
  expectedHeadSha:adaptive.tested_commit_sha
 }));
 if(executed?.decision!=="allow"||
    executed.execution?.provider!=="gitea"||
    executed.execution?.performed!==true||
    executed.execution?.tool!=="create_pull_request"||
    executed.execution?.revision!==adaptive.tested_commit_sha||
    !Number.isSafeInteger(executed.execution.pull_request_number)||
    executed.execution.pull_request_number<1)
  deny("PR effect did not return original Gateway Rust/OPA success");
 const attested=await owner.attestEnrolledPullRequestCompletion({
  taskId:task.task_id,runtimeTaskId
 });
 if(attested.status!=="owner_pr_completion_independently_observed"||
    attested.gateway_execution_authorized!==false||
    attested.task_id!==task.task_id||
    attested.runtime_task_id!==runtimeTaskId)
  deny("original independent Draft PR GET/Task completion not confirmed");
 // Return no private VP, challenge, credential, prepared object or model data.
 return Object.freeze({
  status:"owner_operational_draft_pr_independently_attested",
  ...(branchProof?{branch:branchProof}:{}),
  adaptive:Object.freeze({
   status:adaptive.status,executed_tasks:adaptive.executed_tasks,
   pr_created:false,source_test_task_id:adaptive.source_test_task_id,
   source_test_runtime_task_id:adaptive.source_test_runtime_task_id,
   tested_commit_sha:adaptive.tested_commit_sha
  }),
  tested_commit_sha:adaptive.tested_commit_sha,
  source_test_task_id:adaptive.source_test_task_id,
  completed_work_tasks:adaptive.executed_tasks,
  pull_request_task_id:task.task_id,
  pull_request_number:executed.execution.pull_request_number,
  pull_request_attested:true,pr_created:true
 });
}
