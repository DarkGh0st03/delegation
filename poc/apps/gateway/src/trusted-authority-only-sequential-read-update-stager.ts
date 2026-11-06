/**
 * R359.4 owner-private read->CAS update coordinator.
 * A typed native Child already granted BOTH permissions for the same file.
 * Owner-held shared Prepare store and exact Gitea HEAD are mandatory.
 * This object has NO HTTP/A2A/MCP endpoint and never authorizes provider I/O.
 */
import {InMemoryRequestStore} from "./prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight}
 from "./trusted-authority-only-mutation-preflight.ts";
import {AuthenticatedGiteaMutationCompletionObserver}
 from "./trusted-authority-only-gitea-mutation-evidence.ts";

const SHA40=/^[a-f0-9]{40}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
type State="read_ready"|"read_pending"|"read_verified"|
 "mutation_pending"|"finalized"|"failed";
function deny(reason:string):never{
 throw Error("Authority-only sequential read/update owner NO-GO: "+reason);
}
export class TrustedAuthorityOnlySequentialReadUpdateStager{
 readonly #store:InMemoryRequestStore;
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
 readonly #observer:AuthenticatedGiteaMutationCompletionObserver;
 readonly #planTaskId:string;
 readonly #runtimeTaskId:string;
 readonly #head:string;
 #state:State="read_ready";
 #readRequestId?:string;
 #updateRequestId?:string;
 #path?:string;
 private constructor(opts:{
  store:InMemoryRequestStore;
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
  mutationObserver:AuthenticatedGiteaMutationCompletionObserver;
  planTaskId:string;runtimeTaskId:string;expectedHeadSha:string;
 }){
  this.#store=opts.store;this.#admissions=opts.admissions;
  this.#mutation=opts.mutation;this.#observer=opts.mutationObserver;
  this.#planTaskId=opts.planTaskId;this.#runtimeTaskId=opts.runtimeTaskId;
  this.#head=opts.expectedHeadSha;
 }
 static async begin(opts:{
  store:InMemoryRequestStore;
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
  mutationObserver:AuthenticatedGiteaMutationCompletionObserver;
  planTaskId:string;runtimeTaskId:string;expectedHeadSha:string;
 }):Promise<TrustedAuthorityOnlySequentialReadUpdateStager>{
  if(!(opts?.store instanceof InMemoryRequestStore)||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.mutation instanceof TrustedAuthorityOnlyGiteaMutationPreflight)||
     !(opts.mutationObserver instanceof AuthenticatedGiteaMutationCompletionObserver)||
     !opts.mutation.isForAdmissions(opts.admissions)||
     !ID.test(opts.planTaskId)||!ID.test(opts.runtimeTaskId)||
     !SHA40.test(opts.expectedHeadSha))
   deny("same trusted owner, exact native Task and pinned HEAD required");
  const started=await opts.admissions.beginTrustedSequentialReadUpdateTask(
   opts.planTaskId,opts.runtimeTaskId);
  if(started.status!=="sequential_read_update_manifest_reserved_staged"||
     started.task_id!==opts.planTaskId||started.total_effects!==2||
     started.gateway_execution_authorized!==false)
   deny("original immutable read/update manifest is not durably reserved");
  return new TrustedAuthorityOnlySequentialReadUpdateStager(opts);
 }
 /** Called only between Gateway Prepare and signed VP, never from the model. */
 async stage(requestId:string):Promise<unknown>{
  if(!ID.test(requestId)||
     (this.#state!=="read_ready"&&this.#state!=="read_verified"))
   deny("out-of-order, duplicate or terminated owner effect");
  const record=this.#store.get(requestId);
  if(!record||record.task_id!==this.#runtimeTaskId||
     record.consumed!==false||record.expires_at_ms<=Date.now()||
     record.pinned_revision!==this.#head||
     !record.request?.arguments||
     typeof record.request.arguments.path!=="string")
   deny("read/update Prepare lacks original Task, path or expected HEAD");
  const tool=record.request.tool;
  if(this.#state==="read_ready"){
   this.#state="failed"; // consume before any durable reservation
   if(tool!=="read_file")deny("first typed effect must read the existing file");
   const result=await this.#admissions.stageTrustedSequentialReadEffect(record);
   if(result.status!=="sequential_read_effect_reserved_staged"||
      result.sequence!==1||result.task_id!==this.#planTaskId||
      result.gateway_execution_authorized!==false)
    deny("owner read flight was not durably staged");
   this.#path=record.request.arguments.path;
   this.#readRequestId=requestId;
   this.#state="read_pending";
   return result;
  }
  this.#state="failed"; // a failed/ambiguous CAS cannot retry
  if(tool!=="update_file"||record.request.arguments.path!==this.#path)
   deny("mutation must target the exact independently read file");
  const intent=await this.#mutation.stageUpdate(record,this.#head);
  if(intent.status!=="gitea_update_intent_reserved_without_execution"||
     intent.provider_write_authorized!==false)
   deny("native Gitea CAS intent not reserved");
  const result=await this.#admissions.stageTrustedSequentialMutationEffect(record);
  if(result.status!=="sequential_mutation_effect_reserved_staged"||
     result.sequence!==2||result.task_id!==this.#planTaskId||
     result.gateway_execution_authorized!==false)
   deny("second native mutation flight not chained to read evidence");
  this.#updateRequestId=requestId;
  this.#state="mutation_pending";
  return result;
 }
 /** Only AFTER actual Gateway read, Rust VP, OPA and MAC source publication. */
 async attestRead(requestId:string):Promise<void>{
  if(this.#state!=="read_pending"||requestId!==this.#readRequestId)
   deny("unverified, foreign or duplicate source read");
  this.#state="failed";
  const result=await this.#admissions.attestTrustedSequentialReadEffect(
   this.#planTaskId,this.#runtimeTaskId);
  if(result.status!=="sequential_read_effect_attested_staged"||
     result.sequence!==1||result.task_id!==this.#planTaskId||
     result.gateway_execution_authorized!==false)
   deny("original first read not independently attested");
  this.#state="read_verified";
 }
 /** Only AFTER actual Gateway CAS; independent mutation observer seals it. */
 async attestMutation(requestId:string):Promise<void>{
  if(this.#state!=="mutation_pending"||requestId!==this.#updateRequestId)
   deny("unverified, foreign or duplicate CAS result");
  this.#state="failed";
  const result=await this.#admissions.attestTrustedSequentialMutationEffect(
   this.#planTaskId,this.#runtimeTaskId,this.#observer.toTrustedObserver());
  if(result.status!=="sequential_mutation_effect_attested_staged"||
     result.sequence!==2||result.task_id!==this.#planTaskId||
     result.gateway_execution_authorized!==false)
   deny("original CAS mutation not independently attested");
  const complete=await this.#admissions.finalizeTrustedSequentialReadTask(
   this.#planTaskId,this.#runtimeTaskId);
  if(complete.status!=="sequential_read_task_complete_staged"||
     complete.total_effects!==2||complete.task_id!==this.#planTaskId||
     complete.gateway_execution_authorized!==false)
   deny("mixed Task final evidence not durably sealed");
  this.#state="finalized";
 }
}
