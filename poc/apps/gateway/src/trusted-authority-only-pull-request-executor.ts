import {createHash} from 'node:crypto';
import {TrustedAuthorityOnlyCompletionObserver,type TrustedCompletionExpectation}
 from '../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts';
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
 readonly #reader?:GiteaClient;
 readonly #confirmed=new Map<string,Readonly<{
  binding:TrustedCompletionExpectation;number:number;id:number;
  head_branch:string;base_branch:string;head_revision:string;base_revision:string;
  runner_digest:string;
 }>>();
 readonly #staged=new WeakMap<PreparedRequestRecord,{head:string;digest:string;attempted:boolean}>();
 readonly #stageAttempts=new WeakSet<PreparedRequestRecord>();
 readonly #results=new WeakMap<object,PreparedRequestRecord>();
 constructor(opts:{admissions:TrustedAuthorityOnlyGatewayAdmissions;
  giteaClient:GiteaClient;runnerObserver:AuthenticatedRunnerCompletionObserver;
  repository:string;branch:string;independentGiteaClient?:GiteaClient}){
  if(!(opts?.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !GiteaClient.isPinnedRepositoryClient(opts.giteaClient,
      opts.repository.split('/')[0],opts.repository.split('/')[1])||
     !AuthenticatedRunnerCompletionObserver.isForRepository(
      opts.runnerObserver,opts.repository,opts.branch))
   deny('original Gateway, Gitea and protected Runner observer required');
  if(opts.independentGiteaClient!==undefined&&
     (opts.independentGiteaClient===opts.giteaClient||
      !GiteaClient.isPinnedRepositoryClient(opts.independentGiteaClient,
       opts.repository.split('/')[0],opts.repository.split('/')[1])))
   deny('separate independently pinned PR reader required');
  this.#gate=opts.admissions;this.#client=opts.giteaClient;this.#observer=opts.runnerObserver;
  this.#reader=opts.independentGiteaClient;
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
  await this.#gate.stageTrustedRootPullRequestFlight(record);
  this.#staged.set(record,{head:pin.tested_commit_sha,
   digest:pin.runner_evidence_sha256,attempted:false});
  return Object.freeze({status:'owner_pr_flight_reserved_no_provider_execution',
   tested_commit_sha:pin.tested_commit_sha,provider_executed:false});
 }
 /** Independent GET reader consumes only original private effect provenance. */
 createCompletionObserver():TrustedAuthorityOnlyCompletionObserver{
  if(!this.#reader)deny('independent PR reader was not installed by original owner');
  return new TrustedAuthorityOnlyCompletionObserver({readVerifiedCompletion:async expected=>{
   const confirmed=this.#confirmed.get(expected.task_id);
   if(!confirmed||!Object.keys(confirmed.binding).every(k=>
      confirmed.binding[k as keyof TrustedCompletionExpectation]===
       expected[k as keyof TrustedCompletionExpectation]))
    deny('no original confirmed PR effect for this Task flight');
   const pin=await this.#gate.revalidateTrustedPullRequestTest(expected.runtime_task_id,this.#observer);
   const pr=await GiteaClient.prototype.inspectDraftPullRequest.call(this.#reader!,{
    number:confirmed.number,headBranch:confirmed.head_branch,baseBranch:confirmed.base_branch,
    expectedHeadSha:confirmed.head_revision,expectedBaseSha:confirmed.base_revision});
   await this.#gate.revalidateTrustedPullRequestTest(expected.runtime_task_id,this.#observer);
   if(pr.id!==confirmed.id||pin.runner_evidence_sha256!==confirmed.runner_digest)
    deny('independent PR identity or Runner source changed');
   const evidence_sha256=createHash('sha256').update(JSON.stringify({
    binding:confirmed.binding,number:pr.number,id:pr.id,
    head:pr.head_revision,base:pr.base_revision,draft:pr.draft,
    open:pr.open,merged:pr.merged,runner_digest:confirmed.runner_digest
   })).digest('hex');
   return Object.freeze({...expected,status:'owner_verified_provider_result' as const,
    evidence_sha256,completed_at_ms:Date.now()});
  }});
 }
 /** Exact private provider-result witness; serialized/cloned results are not evidence. */
 assertExecutionResult(record:PreparedRequestRecord,result:unknown):void{
  if(!result||typeof result!=='object'||this.#results.get(result)!==record)
   deny('PR result is not original independently confirmed owner execution');
  const value=result as GiteaCreatePullRequestExecutionResult;
  if(value.provider!=='gitea'||value.tool!=='create_pull_request'||value.performed!==true||
     value.revision!==this.#staged.get(record)?.head)
   deny('PR result differs from original tested HEAD');
 }
 async executeAfterVerifiedRustOpa(record:PreparedRequestRecord,
  verified:VerifiedDelegation,policy:PolicyDecision):Promise<GiteaCreatePullRequestExecutionResult>{
  if(record.request.tool!=='create_pull_request'||record.consumed!==true||
     policy.allow!==true||typeof policy.policy_version!=='string'||!policy.policy_version.trim())
   deny('consumed native-verified OPA-allowed PR required');
  const binding=this.#gate.assertTrustedCompletedPullRequestEvidenceBinding(record,verified);
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
  const execution=Object.freeze({provider:'gitea' as const,performed:true as const,
   tool:'create_pull_request' as const,pull_request_id:result.id,pull_request_number:result.number,
   ...(result.url?{url:result.url}:{}),head_branch:result.head_branch,
   base_branch:result.base_branch,revision:result.head_revision});
  this.#results.set(execution,record);
  this.#confirmed.set(binding.task_id,Object.freeze({binding,
   id:result.id,number:result.number,head_branch:result.head_branch,
   base_branch:result.base_branch,head_revision:result.head_revision,
   base_revision:result.base_revision,runner_digest:pin.runner_evidence_sha256}));
  return execution;
 }
}
