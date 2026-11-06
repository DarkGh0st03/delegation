/**
 * R303.3 — trusted one-attempt controlled Docker Runner, accessible only
 * through an explicitly enabled authority-only Gateway Execute.
 *
 * Precondition: signed Engineer root, enrolled native Rust Test Child, real
 * independent OPA allow, original prepared run_tests request and durable
 * Task-flight + owner-pinned Runner commitment. Any ambiguous POST is
 * terminal; FAIL is never reported as Task completion.
 */
import {GiteaClient} from "./gitea-client.ts";
import {RunnerClient,type RunnerClientRequest} from "./runner-client.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyRunnerPreflight}
 from "./trusted-authority-only-runner-preflight.ts";
import {DurableAuthorityOnlyRunnerIntentJournal}
 from "./trusted-authority-only-runner-intent-journal.ts";
import {TrustedGatewayRunnerPassEvidencePublisher,
 AuthenticatedRunnerCompletionObserver}
 from "./trusted-authority-only-runner-evidence.ts";
import {validateTrustedRunnerFailure}
 from "./trusted-authority-only-runner-failure.ts";
import {TrustedGatewayRunnerFailEvidencePublisher,
 AuthenticatedRunnerFailureObserver}
 from "./trusted-authority-only-runner-failure-evidence.ts";
import type {
 PreparedRequestRecord,VerifiedDelegation,PolicyDecision,
 RunnerExecutionResult
} from "./types.ts";

function deny(reason:string):never{
 throw Error("Trusted authority-only Docker Runner NO-GO: "+reason);
}
const BINDING=[
 "session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","agent_did","credential_id",
 "request_id","request_fingerprint"
] as const;
export class TrustedAuthorityOnlyRunnerExecutor{
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #preflight:TrustedAuthorityOnlyRunnerPreflight;
 readonly #journal:DurableAuthorityOnlyRunnerIntentJournal;
 readonly #gitea:GiteaClient;
 readonly #runner:RunnerClient;
 readonly #publisher:TrustedGatewayRunnerPassEvidencePublisher;
 readonly #observer:AuthenticatedRunnerCompletionObserver;
 readonly #failurePublisher?:TrustedGatewayRunnerFailEvidencePublisher;
 readonly #failureObserver?:AuthenticatedRunnerFailureObserver;
 readonly #repository:string;
 readonly #branch:string;
 #inFlight=false;
 constructor(opts:{
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  preflight:TrustedAuthorityOnlyRunnerPreflight;
  journal:DurableAuthorityOnlyRunnerIntentJournal;
  giteaClient:GiteaClient;
  runnerClient:RunnerClient;
  publisher:TrustedGatewayRunnerPassEvidencePublisher;
  observer:AuthenticatedRunnerCompletionObserver;
  failurePublisher?:TrustedGatewayRunnerFailEvidencePublisher;
  failureObserver?:AuthenticatedRunnerFailureObserver;
  repository:string;branch:string;
 }){
  if(!opts||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.preflight instanceof TrustedAuthorityOnlyRunnerPreflight)||
     !(opts.journal instanceof DurableAuthorityOnlyRunnerIntentJournal)||
     !(opts.giteaClient instanceof GiteaClient)||
     !(opts.runnerClient instanceof RunnerClient)||
     !(opts.publisher instanceof TrustedGatewayRunnerPassEvidencePublisher)||
     !(opts.observer instanceof AuthenticatedRunnerCompletionObserver)||
     !opts.preflight.isForAdmissions(opts.admissions)||
     !opts.preflight.isForGitea(opts.giteaClient)||
     !opts.publisher.isForRunner(opts.runnerClient)||
     (!!opts.failurePublisher!==!!opts.failureObserver)||
     (opts.failurePublisher!==undefined&&(
       !(opts.failurePublisher instanceof TrustedGatewayRunnerFailEvidencePublisher)||
       !(opts.failureObserver instanceof AuthenticatedRunnerFailureObserver)||
       !opts.failurePublisher.isForRunner(opts.runnerClient)||
       !opts.failurePublisher.isForGitea(opts.giteaClient)||
       !opts.failureObserver.isForGitea(opts.giteaClient)
     ))||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   deny("independent owner-controlled Test Runner dependencies required");
  this.#admissions=opts.admissions;
  this.#preflight=opts.preflight;
  this.#journal=opts.journal;
  this.#gitea=opts.giteaClient;
  this.#runner=opts.runnerClient;
  this.#publisher=opts.publisher;
  this.#observer=opts.observer;
  this.#failurePublisher=opts.failurePublisher;
  this.#failureObserver=opts.failureObserver;
  this.#repository=opts.repository;
  this.#branch=opts.branch;
 }
 isForAdmissions(g:TrustedAuthorityOnlyGatewayAdmissions):boolean{
  return this.#admissions===g;
 }
 async executeAfterVerifiedRustOpa(
  record:PreparedRequestRecord,verified:VerifiedDelegation,
  policy:PolicyDecision
 ):Promise<RunnerExecutionResult>{
  if(this.#inFlight)deny("concurrent Docker Runner execution prohibited");
  if(!record||record.consumed!==true||
     record.request.tool!=="run_tests"||
     record.agent_role!=="test"||
     !verified||!Array.isArray(verified.permissions)||
     !policy||policy.allow!==true||
     typeof policy.policy_version!=="string"||
     !policy.policy_version.trim())
   deny("only a native Rust VP + OPA-allowed Test Task can invoke Runner");
  const binding=this.#admissions.assertTrustedCompletedRunnerEvidenceBinding(
   record,verified);
  const intent=this.#preflight.getReservedIntent(record);
  if(BINDING.some(k=>intent[k]!==binding[k])||
     intent.repository!==this.#repository||
     intent.branch!==this.#branch||
     record.request.arguments.branch!==intent.branch||
     record.request.arguments.profile!==intent.runner_profile||
     intent.runner_execution_authorized!==false)
   deny("Runner intent differs from pinned signed Task and enrolled Child");
  this.#inFlight=true;
  try{
   // Independently pin Gitea immediately before the one-shot Runner POST.
   const head=await this.#gitea.getBranchMetadata(intent.branch);
   if(head.commit_sha!==intent.expected_head_sha)
    deny("feature HEAD changed since owner committed Test Task intent");
   // An unknown outcome leaves this marker, so no automatic retry.
   await this.#journal.reserveAttempt(intent);
   const request:RunnerClientRequest={
    request_id:intent.request_id,
    repository:"gitea://gitea.local/"+this.#repository,
    branch:intent.branch,commit_sha:intent.expected_head_sha,
    profile:"poc-default"
   };
   const result=await this.#runner.run(request);
   if(result.status==="fail"){
    // Only a genuine owner-bound Runner FAIL may reach this classification.
    // There is no D1 authority path until a separate durable, independently
    // observed failure gate exists. Never attest or report Task completion.
    validateTrustedRunnerFailure(this.#runner,request,result,intent);
    if(this.#failurePublisher&&this.#failureObserver){
     // Owner-only opt-in: persist a signed non-authorizing FAIL receipt
     // and independently reread it. A failed verification remains terminal.
     const digest=await this.#failurePublisher.publish(
      intent,binding,request,result,policy.policy_version);
     const observed=await this.#failureObserver.observe(intent,binding);
     if(observed.evidence_sha256!==digest||
        observed.tested_commit_sha!==intent.expected_head_sha||
        observed.request_fingerprint!==record.request_fingerprint||
        observed.recovery_authorized!==false)
      deny("independent Runner FAIL observation differs from original Task");
    }
    deny("authenticated Runner FAIL: Task incomplete; D1 gate not armed");
   }
   // The controller already checks the exact request response fields.
   // The publisher validates ALL seven phases, researcher acceptance,
   // result provenance and Gitea HEAD before any SUCCESS receipt.
   const digest=await this.#publisher.publish(
    intent,binding,request,result,policy.policy_version);
   const observed=await this.#observer.observe(binding);
   if(observed.status!=="owner_verified_provider_result"||
      observed.evidence_sha256!==digest||
      observed.request_fingerprint!==record.request_fingerprint)
    deny("independent Runner receipt differs from owner-authenticated PASS");
   await this.#journal.reserveCompletedEvidence(intent,digest);
   return {
    provider:"runner",performed:true,tool:"run_tests",
    branch:intent.branch,revision:intent.expected_head_sha,
    tested_commit_sha:intent.expected_head_sha,
    runner_profile:"poc-default",
    status:"pass",phases:result.phases,
    project_tests:result.project_tests,
    researcher_acceptance:result.researcher_acceptance,
    ...(result.log_reference?{log_reference:result.log_reference}:{})
   };
  }finally{this.#inFlight=false;}
 }
}
