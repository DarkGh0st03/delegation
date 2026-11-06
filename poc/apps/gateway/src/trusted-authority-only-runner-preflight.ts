/**
 * R303.1 — owner-pinned Runner/Docker Test intent. No Runner calls.
 *
 * Only trusted Gateway owner can pin the actual Gitea commit. Test Agent
 * tool arguments contain branch/profile, never an arbitrary tested SHA.
 * This is an admission preflight, NOT an executable Runner authorization.
 */
import {GiteaClient} from "./gitea-client.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {DurableAuthorityOnlyRunnerIntentJournal,
 type TrustedAuthorityOnlyRunnerIntent}
 from "./trusted-authority-only-runner-intent-journal.ts";
import type {PreparedRequestRecord} from "./types.ts";

const SHA40=/^[a-f0-9]{40}$/u;
function deny(reason:string):never{
 throw Error("Authority-only Runner preflight NO-GO: "+reason);
}
export class TrustedAuthorityOnlyRunnerPreflight{
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #gitea:GiteaClient;
 readonly #journal:DurableAuthorityOnlyRunnerIntentJournal;
 readonly #repo:string;
 readonly #branch:string;
 readonly #nowMs:()=>number;
 readonly #reserved=new WeakMap<PreparedRequestRecord,
  TrustedAuthorityOnlyRunnerIntent>();
 #inFlight=false;
 constructor(opts:{
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  giteaClient:GiteaClient;
  journal:DurableAuthorityOnlyRunnerIntentJournal;
  repository:string;branch:string;nowMs?:()=>number
 }){
  if(!opts||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.giteaClient instanceof GiteaClient)||
     !(opts.journal instanceof DurableAuthorityOnlyRunnerIntentJournal)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//")||
     opts.branch.startsWith("feature/r302-internal-"))
   deny("trusted owner-only Test Agent/Runner dependencies required");
  this.#admissions=opts.admissions;
  this.#gitea=opts.giteaClient;
  this.#journal=opts.journal;
  this.#repo=opts.repository;
  this.#branch=opts.branch;
  this.#nowMs=opts.nowMs??Date.now;
 }
 /** Genuine class-private Gateway ownership (not structural impersonation). */
 static isNativeForAdmissions(value:unknown,
  admissions:TrustedAuthorityOnlyGatewayAdmissions):
  value is TrustedAuthorityOnlyRunnerPreflight{
  return value instanceof TrustedAuthorityOnlyRunnerPreflight &&
   #admissions in value && value.#admissions===admissions;
 }
 isForAdmissions(a:TrustedAuthorityOnlyGatewayAdmissions):boolean{
  return a===this.#admissions;
 }
 isForGitea(g:GiteaClient):boolean{return g===this.#gitea;}
 /** Only the ORIGINAL in-memory Prepare may retrieve this immutable intent. */
 getReservedIntent(record:PreparedRequestRecord):TrustedAuthorityOnlyRunnerIntent{
  const intent=this.#reserved.get(record);
  if(!intent||intent.runtime_task_id!==record.task_id||
     intent.request_id!==record.request_id||
     intent.request_fingerprint!==record.request_fingerprint||
     record.request.tool!=="run_tests")
   deny("Test Agent request has no protected owner-pinned Runner intent");
  return intent;
 }
 async stageRunner(
  record:PreparedRequestRecord,ownerPinnedHeadSha:string
 ):Promise<Readonly<{
  status:"test_runner_commit_reserved_staged";
  intent:TrustedAuthorityOnlyRunnerIntent;
  runner_execution_authorized:false;
 }>>{
  if(this.#inFlight)deny("concurrent Test Agent reservation");
  if(!SHA40.test(ownerPinnedHeadSha))
   deny("exact owner-selected commit SHA required");
  const binding=this.#admissions.assertTrustedRunnerIntentBinding(record);
  if(record.request.tool!=="run_tests"||
     record.request.arguments.branch!==this.#branch||
     record.request.arguments.profile!=="poc-default")
   deny("Test Agent may only test configured feature branch and profile");
  this.#inFlight=true;
  try{
   // Reserve only if BOTH live reads agree with the owner-pinned commit.
   // The eventual Runner executor will recheck immediately before launch,
   // and must still use the same pinned SHA.
   const head1=await this.#gitea.getBranchMetadata(this.#branch);
   if(head1.commit_sha!==ownerPinnedHeadSha)
    deny("Gitea Test branch changed before Runner reservation");
   const head2=await this.#gitea.getBranchMetadata(this.#branch);
   if(head2.commit_sha!==ownerPinnedHeadSha)
    deny("Gitea Test branch changed during Runner reservation");
   const now=this.#nowMs();
   if(!Number.isSafeInteger(now)||now<=0||
      now>=record.expires_at_ms)
    deny("Test Agent challenge expired before Runner reservation");
   const intent:TrustedAuthorityOnlyRunnerIntent=Object.freeze({
    schema:"authority-only-runner-intent-v1",
    kind:"runner_test_commit_preflight_only",
    ...structuredClone(binding),
    repository:this.#repo,
    branch:this.#branch,
    expected_head_sha:ownerPinnedHeadSha,
    runner_profile:"poc-default",
    prepared_at_ms:now,
    runner_execution_authorized:false
   });
   await this.#journal.reserve(intent);
   this.#reserved.set(record,intent);
   return Object.freeze({
    status:"test_runner_commit_reserved_staged",
    intent,runner_execution_authorized:false
   });
  }finally{this.#inFlight=false;}
 }
}
