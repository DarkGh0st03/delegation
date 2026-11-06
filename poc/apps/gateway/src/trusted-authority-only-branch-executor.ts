/** Original Orchestrator root effect; no Child or moving source ref. */
import {createHash} from 'node:crypto';
import {TrustedAuthorityOnlyCompletionObserver,type TrustedCompletionExpectation}
 from '../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts';
import {GiteaClient} from './gitea-client.ts';
import {TrustedAuthorityOnlyGatewayAdmissions} from './trusted-authority-only-admissions.ts';
import type {PreparedRequestRecord,VerifiedDelegation,PolicyDecision,GiteaCreateBranchExecutionResult} from './types.ts';
const deny=(reason:string):never=>{throw Error('Authority-only branch execution NO-GO: '+reason);};
export class TrustedAuthorityOnlyBranchExecutor{
 readonly #nowMs:()=>number;
 readonly #gate:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #client:GiteaClient;
 readonly #reader:GiteaClient;
 readonly #staged=new WeakMap<PreparedRequestRecord,{sha:string;attempted:boolean}>();
 readonly #attempts=new WeakSet<PreparedRequestRecord>();
 readonly #results=new WeakMap<object,PreparedRequestRecord>();
 readonly #confirmed=new Map<string,Readonly<{
  binding:TrustedCompletionExpectation;branch:string;base_branch:string;sha:string;
 }>>();
 constructor(opts:{admissions:TrustedAuthorityOnlyGatewayAdmissions;giteaClient:GiteaClient;
  independentGiteaClient:GiteaClient;repository:string;nowMs?:()=>number}){
  const parts=opts.repository.split('/');
  if(!(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     opts.giteaClient===opts.independentGiteaClient||parts.length!==2||
     !GiteaClient.isPinnedRepositoryClient(opts.giteaClient,parts[0],parts[1])||
     !GiteaClient.isPinnedRepositoryClient(opts.independentGiteaClient,parts[0],parts[1]))
   deny('original Gateway and separately pinned provider reader required');
  this.#nowMs=opts.nowMs??Date.now;
  this.#gate=opts.admissions;this.#client=opts.giteaClient;this.#reader=opts.independentGiteaClient;
 }
 static isNativeForAdmissions(value:unknown,gate:TrustedAuthorityOnlyGatewayAdmissions):value is TrustedAuthorityOnlyBranchExecutor{
  return value instanceof TrustedAuthorityOnlyBranchExecutor&&#gate in value&&value.#gate===gate;
 }
 static isNativeForOwner(value:unknown,gate:TrustedAuthorityOnlyGatewayAdmissions,client:GiteaClient):value is TrustedAuthorityOnlyBranchExecutor{
  return this.isNativeForAdmissions(value,gate)&&value.#client===client;
 }
 pinTask(taskId:string,runtimeTaskId:string){return this.#gate.pinTrustedBranchTask(taskId,runtimeTaskId);}
 async stage(record:PreparedRequestRecord){
  if(this.#attempts.has(record))deny('branch staging already attempted');
  this.#attempts.add(record);
  const pin=this.#gate.assertTrustedBranchIntentBinding(record);
  if(record.request.tool!=='create_branch')deny('exact branch Prepare required');
  const base=await this.#client.getBranchMetadata(record.request.arguments.base_branch);
  if(base.commit_sha!==pin.base_revision)deny('approved main revision changed');
  await this.#gate.stageTrustedRootBranchFlight(record);
  this.#staged.set(record,{sha:pin.base_revision,attempted:false});
  return Object.freeze({status:'owner_branch_flight_reserved_no_provider_execution',
   base_revision:pin.base_revision,provider_executed:false});
 }
 async executeAfterVerifiedRustOpa(record:PreparedRequestRecord,verified:VerifiedDelegation,
  policy:PolicyDecision):Promise<GiteaCreateBranchExecutionResult>{
  if(record.request.tool!=='create_branch'||record.consumed!==true||policy.allow!==true||
     typeof policy.policy_version!=='string'||!policy.policy_version.trim())
   deny('consumed native-verified OPA-allowed branch Prepare required');
  const binding=this.#gate.assertTrustedCompletedBranchEvidenceBinding(record,verified);
  const intent=this.#staged.get(record);
  if(!intent||intent.attempted)deny('missing original one-shot branch intent or replay');
  intent.attempted=true;
  const args=record.request.arguments;
  const created=await GiteaClient.prototype.createPinnedBranch.call(this.#client,
   args.base_branch,args.branch,intent.sha);
  this.#gate.assertTrustedCompletedBranchEvidenceBinding(record,verified);
  const execution=Object.freeze({provider:'gitea' as const,performed:true as const,
   tool:'create_branch' as const,branch:created.name,base_branch:created.base_branch,
   revision:created.commit_sha,commit_sha:created.commit_sha});
  this.#results.set(execution,record);
  this.#confirmed.set(binding.task_id,Object.freeze({binding,branch:created.name,
   base_branch:created.base_branch,sha:intent.sha}));
  return execution;
 }
 assertExecutionResult(record:PreparedRequestRecord,result:unknown){
  if(!result||typeof result!=='object'||this.#results.get(result)!==record)
   deny('branch result is not original independently confirmed execution');
 }
 createCompletionObserver(){
  return new TrustedAuthorityOnlyCompletionObserver({readVerifiedCompletion:async expected=>{
   const original=this.#confirmed.get(expected.task_id);
   if(!original||!Object.keys(original.binding).every(k=>
      original.binding[k as keyof TrustedCompletionExpectation]===expected[k as keyof TrustedCompletionExpectation]))
    deny('no original confirmed branch effect for this Task flight');
   const observed=await GiteaClient.prototype.inspectPinnedBranch.call(this.#reader,
    original.base_branch,original.branch,original.sha);
   const evidence_sha256=createHash('sha256').update(JSON.stringify({binding:original.binding,
    observed})).digest('hex');
   return Object.freeze({...expected,status:'owner_verified_provider_result' as const,
    evidence_sha256,completed_at_ms:this.#nowMs()});
  }});
 }
}
