/** Original-owner one-shot PR effect. No model-selected SHA or legacy provider. */
import {GiteaClient} from './gitea-client.ts';
import {TrustedAuthorityOnlyGatewayAdmissions} from './trusted-authority-only-admissions.ts';
import {AuthenticatedRunnerCompletionObserver} from './trusted-authority-only-runner-evidence.ts';
import type {PreparedRequestRecord,VerifiedDelegation,PolicyDecision,
 GiteaCreatePullRequestExecutionResult} from './types.ts';
const deny=(reason:string):never=>{throw Error('Authority-only PR execution NO-GO: '+reason);};
export class TrustedAuthorityOnlyPullRequestExecutor{
 readonly #gate:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #client:GiteaClient;
 readonly #observer:AuthenticatedRunnerCompletionObserver;
 readonly #staged=new WeakMap<PreparedRequestRecord,{head:string;digest:string;attempted:boolean}>();
 readonly #stageAttempts=new WeakSet<PreparedRequestRecord>();
 constructor(opts:{admissions:TrustedAuthorityOnlyGatewayAdmissions;
  giteaClient:GiteaClient;runnerObserver:AuthenticatedRunnerCompletionObserver;
  repository:string;branch:string}){
  if(!(opts?.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !GiteaClient.isPinnedRepositoryClient(opts.giteaClient,
      opts.repository.split('/')[0],opts.repository.split('/')[1])||
     !AuthenticatedRunnerCompletionObserver.isForRepository(
      opts.runnerObserver,opts.repository,opts.branch))
   deny('original Gateway, Gitea and protected Runner observer required');
  this.#gate=opts.admissions;this.#client=opts.giteaClient;this.#observer=opts.runnerObserver;
 }
 static isNativeForAdmissions(value:unknown,gate:TrustedAuthorityOnlyGatewayAdmissions):
  value is TrustedAuthorityOnlyPullRequestExecutor{
  return value instanceof TrustedAuthorityOnlyPullRequestExecutor&&#gate in value&&value.#gate===gate;
 }
 static isNativeForOwner(value:unknown,gate:TrustedAuthorityOnlyGatewayAdmissions,
  client:GiteaClient,observer:AuthenticatedRunnerCompletionObserver):
  value is TrustedAuthorityOnlyPullRequestExecutor{
  return this.isNativeForAdmissions(value,gate)&&value.#client===client&&value.#observer===observer;
 }
 async pinTask(taskId:string,runtimeTaskId:string,testTaskId:string,testRuntimeTaskId:string){
  return this.#gate.pinTrustedPullRequestTask(taskId,runtimeTaskId,
   testTaskId,testRuntimeTaskId,this.#observer);
 }
 async stage(record:PreparedRequestRecord,expectedHeadSha:string){
  if(this.#stageAttempts.has(record))deny('PR staging already attempted');
  this.#stageAttempts.add(record);
  const pin=this.#gate.assertTrustedPullRequestIntentBinding(record);
  if(pin.tested_commit_sha!==expectedHeadSha)deny('PR HEAD differs from original owner pin');
  await this.#gate.revalidateTrustedPullRequestTest(record.task_id,this.#observer);
  // O_EXCL flight is durable before signing/POST; reconstruction cannot retry.
  await this.#gate.stageTrustedTaskFlight(record);
  this.#staged.set(record,{head:pin.tested_commit_sha,
   digest:pin.runner_evidence_sha256,attempted:false});
  return Object.freeze({status:'owner_pr_flight_reserved_no_provider_execution',
   tested_commit_sha:pin.tested_commit_sha,provider_executed:false});
 }
 async executeAfterVerifiedRustOpa(record:PreparedRequestRecord,
  verified:VerifiedDelegation,policy:PolicyDecision):Promise<GiteaCreatePullRequestExecutionResult>{
  if(record.request.tool!=='create_pull_request'||record.consumed!==true||
     policy.allow!==true||typeof policy.policy_version!=='string'||!policy.policy_version.trim())
   deny('consumed native-verified OPA-allowed PR required');
  this.#gate.assertTrustedCompletedPullRequestEvidenceBinding(record,verified);
  const intent=this.#staged.get(record);
  if(!intent||intent.attempted)deny('missing original one-shot PR intent or replay');
  intent.attempted=true; // any subsequent ambiguity is terminal, including lost POST ACK
  const pin=await this.#gate.revalidateTrustedPullRequestTest(record.task_id,this.#observer);
  if(pin.tested_commit_sha!==intent.head||pin.runner_evidence_sha256!==intent.digest)
   deny('original PR intent or Runner evidence changed');
  const args=record.request.arguments;
  const result=await this.#client.createDraftPullRequest(
   args.head_branch,args.base_branch,args.title,intent.head,args.body);
  await this.#gate.revalidateTrustedPullRequestTest(record.task_id,this.#observer);
  this.#gate.assertTrustedCompletedPullRequestEvidenceBinding(record,verified);
  return {provider:'gitea',performed:true,tool:'create_pull_request',
   pull_request_id:result.id,pull_request_number:result.number,
   ...(result.url?{url:result.url}:{}),head_branch:result.head_branch,
   base_branch:result.base_branch,revision:result.head_revision};
 }
}
